import type { Eventa } from '@moeru/eventa'

import type { SpeechPipelineEventName } from './eventa'
import type {
  IntentHandle,
  IntentOptions,
  LoggerLike,
  PlaybackItem,
  SpeechPipelineEvents,
  TextSegment,
  TextToken,
  TtsRequest,
  TtsResult,
} from './types'

import { createContext } from '@moeru/eventa'

import { speechPipelineEventMap } from './eventa'
import { createPriorityResolver } from './priority'
import { createTtsSegmentStream } from './processors/tts-chunker'
import { createPushStream } from './stream'

export interface SpeechPipelineOptions<TAudio> {
  tts: (request: TtsRequest, signal: AbortSignal) => Promise<TAudio | null>
  /**
   * Optional streaming TTS generator. When provided and returning a non-empty async iterable,
   * the pipeline schedules audio chunks incrementally instead of waiting for the full result.
   * Falls back to `tts` when absent or when the generator returns immediately.
   */
  ttsStream?: (request: TtsRequest, signal: AbortSignal) => AsyncIterable<TAudio>
  /**
   * Maximum number of concurrent TTS generation tasks. Default is 4. Must be at least 1.
   *
   * @default 4
   */
  ttsMaxConcurrent?: number
  playback: {
    schedule: (item: PlaybackItem<TAudio>) => void
    stopAll: (reason: string) => void
    stopByIntent: (intentId: string, reason: string) => void
    stopByOwner: (ownerId: string, reason: string) => void
    onStart: (listener: (event: { item: PlaybackItem<TAudio>, startedAt: number }) => void) => void
    onEnd: (listener: (event: { item: PlaybackItem<TAudio>, endedAt: number }) => void) => void
    onInterrupt: (listener: (event: { item: PlaybackItem<TAudio>, reason: string, interruptedAt: number }) => void) => void
    onReject: (listener: (event: { item: PlaybackItem<TAudio>, reason: string }) => void) => void
  }
  logger?: LoggerLike
  priority?: ReturnType<typeof createPriorityResolver>
  segmenter?: (tokens: ReadableStream<TextToken>, meta: { streamId: string, intentId: string }) => ReadableStream<TextSegment>
}

interface IntentState {
  intentId: string
  streamId: string
  priority: number
  ownerId?: string
  behavior: 'queue' | 'interrupt' | 'replace'
  createdAt: number
  controller: AbortController
  stream: ReadableStream<TextToken>
  closeStream: () => void
  canceled: boolean
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSpeechPipeline<TAudio>(options: SpeechPipelineOptions<TAudio>) {
  const logger = options.logger ?? console
  const priorityResolver = options.priority ?? createPriorityResolver()
  const segmenter = options.segmenter ?? createTtsSegmentStream
  const ttsMaxConcurrent = Math.max(1, options.ttsMaxConcurrent ?? 4)
  const context = createContext()

  const intents = new Map<string, IntentState>()
  const pending: IntentState[] = []
  let activeIntent: IntentState | null = null

  options.playback.onStart(event => context.emit(speechPipelineEventMap.onPlaybackStart, event))
  options.playback.onEnd(event => context.emit(speechPipelineEventMap.onPlaybackEnd, event))
  options.playback.onInterrupt(event => context.emit(speechPipelineEventMap.onPlaybackInterrupt, event))
  options.playback.onReject(event => context.emit(speechPipelineEventMap.onPlaybackReject, event))

  function enqueueIntent(intent: IntentState) {
    pending.push(intent)
  }

  function pickNextIntent() {
    if (pending.length === 0)
      return null
    pending.sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt))
    return pending.shift() ?? null
  }

  async function runIntent(intent: IntentState) {
    activeIntent = intent
    context.emit(speechPipelineEventMap.onIntentStart, intent.intentId)

    const tokenStream = intent.stream
    const segmentStream = segmenter(tokenStream, { streamId: intent.streamId, intentId: intent.intentId })
    const completedRequests = new Map<number, TtsResult<TAudio> | null>()
    const streamingContinuation = new Map<number, TtsResult<TAudio>[]>()
    const inFlightTasks = new Set<Promise<void>>()
    let nextRequestSequence = 0
    let nextSequenceToSchedule = 0

    function schedulePlaybackItem(result: TtsResult<TAudio>) {
      options.playback.schedule({
        id: createId('playback'),
        streamId: result.streamId,
        intentId: result.intentId,
        segmentId: result.segmentId,
        sequence: result.sequence,
        ownerId: intent.ownerId,
        priority: intent.priority,
        text: result.text,
        special: result.special,
        audio: result.audio,
        createdAt: Date.now(),
      })
    }

    function scheduleCompletedRequests() {
      while (completedRequests.has(nextSequenceToSchedule)) {
        const completedRequest = completedRequests.get(nextSequenceToSchedule) ?? null
        completedRequests.delete(nextSequenceToSchedule)

        if (completedRequest) {
          schedulePlaybackItem(completedRequest)
        }

        // Drain any streaming continuation chunks for this sequence
        const continuation = streamingContinuation.get(nextSequenceToSchedule)
        if (continuation) {
          for (const chunk of continuation) {
            schedulePlaybackItem(chunk)
          }
          streamingContinuation.delete(nextSequenceToSchedule)
        }

        nextSequenceToSchedule += 1
      }
    }

    function createTtsTask(request: TtsRequest) {
      const task = (async () => {
        let audio: TAudio | null = null
        try {
          audio = await options.tts(request, intent.controller.signal)
        }
        catch (err) {
          logger.warn('TTS generation failed:', err)
          if (intent.controller.signal.aborted)
            return
        }

        if (intent.controller.signal.aborted) {
          completedRequests.set(request.sequence, null)
          scheduleCompletedRequests()
          return
        }

        if (!audio) {
          completedRequests.set(request.sequence, null)
          scheduleCompletedRequests()
          return
        }

        const ttsResult: TtsResult<TAudio> = {
          streamId: request.streamId,
          intentId: request.intentId,
          segmentId: request.segmentId,
          sequence: request.sequence,
          text: request.text,
          special: request.special,
          audio,
          createdAt: Date.now(),
        }

        context.emit(speechPipelineEventMap.onTtsResult, ttsResult)
        completedRequests.set(request.sequence, ttsResult)
        scheduleCompletedRequests()
      })()
        .finally(() => {
          inFlightTasks.delete(task)
        })

      inFlightTasks.add(task)
      return task
    }

    function createTtsStreamTask(request: TtsRequest) {
      const task = (async () => {
        let isFirst = true
        try {
          for await (const audio of options.ttsStream!(request, intent.controller.signal)) {
            if (intent.controller.signal.aborted)
              break

            const result: TtsResult<TAudio> = {
              streamId: request.streamId,
              intentId: request.intentId,
              segmentId: `${request.segmentId}:${isFirst ? 'head' : Date.now()}`,
              sequence: request.sequence,
              text: isFirst ? request.text : '',
              special: isFirst ? request.special : null,
              audio,
              createdAt: Date.now(),
            }

            if (isFirst) {
              context.emit(speechPipelineEventMap.onTtsResult, result)
              completedRequests.set(request.sequence, result)
              scheduleCompletedRequests()
              isFirst = false
            }
            else if (request.sequence < nextSequenceToSchedule) {
              // Already past this sequence's turn, schedule directly
              schedulePlaybackItem(result)
            }
            else {
              // Buffer for when this sequence's turn comes
              const buf = streamingContinuation.get(request.sequence) ?? []
              buf.push(result)
              streamingContinuation.set(request.sequence, buf)
            }
          }
        }
        catch (err) {
          if (!intent.controller.signal.aborted)
            logger.warn('TTS stream failed:', err)
        }

        if (isFirst) {
          // Stream produced nothing — mark as completed with null
          completedRequests.set(request.sequence, null)
          scheduleCompletedRequests()
        }
      })().finally(() => {
        inFlightTasks.delete(task)
      })

      inFlightTasks.add(task)
      return task
    }

    try {
      const reader = segmentStream.getReader()

      while (true) {
        while (!intent.controller.signal.aborted && inFlightTasks.size >= ttsMaxConcurrent) {
          await Promise.race(inFlightTasks)
        }

        const { value, done } = await reader.read()
        if (done)
          break
        if (!value)
          continue
        if (intent.canceled || intent.controller.signal.aborted) {
          await reader.cancel()
          break
        }

        context.emit(speechPipelineEventMap.onSegment, value)

        if (value.text === '' && value.special) {
          context.emit(speechPipelineEventMap.onSpecial, value)
          continue
        }

        const request: TtsRequest = {
          streamId: value.streamId,
          intentId: value.intentId,
          segmentId: value.segmentId,
          sequence: nextRequestSequence++,
          text: value.text,
          special: value.special,
          priority: intent.priority,
          createdAt: Date.now(),
        }

        context.emit(speechPipelineEventMap.onTtsRequest, request)
        if (options.ttsStream) {
          createTtsStreamTask(request)
        }
        else {
          createTtsTask(request)
        }
      }

      await Promise.allSettled(inFlightTasks)
      scheduleCompletedRequests()
      reader.releaseLock()
    }
    catch (err) {
      logger.warn('Speech pipeline intent failed:', err)
    }
    finally {
      if (intent.canceled) {
        context.emit(speechPipelineEventMap.onIntentCancel, { intentId: intent.intentId, reason: intent.controller.signal.reason as string | undefined })
      }
      else {
        context.emit(speechPipelineEventMap.onIntentEnd, intent.intentId)
      }

      intents.delete(intent.intentId)
      if (activeIntent?.intentId === intent.intentId)
        activeIntent = null

      if (!activeIntent) {
        const next = pickNextIntent()
        if (next)
          void runIntent(next)
      }
    }
  }

  function openIntent(optionsInput?: IntentOptions): IntentHandle {
    const intentId = optionsInput?.intentId ?? createId('intent')
    const streamId = optionsInput?.streamId ?? createId('stream')
    const priority = priorityResolver.resolve(optionsInput?.priority)
    const behavior = optionsInput?.behavior ?? 'queue'
    const ownerId = optionsInput?.ownerId

    const controller = new AbortController()
    const { stream, write, close } = createPushStream<TextToken>()
    let sequence = 0

    const intent: IntentState = {
      intentId,
      streamId,
      priority,
      ownerId,
      behavior,
      createdAt: Date.now(),
      controller,
      stream,
      closeStream: close,
      canceled: false,
    }

    intents.set(intentId, intent)

    const handle: IntentHandle = {
      intentId,
      streamId,
      priority,
      ownerId,
      stream,
      writeLiteral(text: string) {
        if (intent.canceled)
          return
        write({
          type: 'literal',
          value: text,
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      writeSpecial(special: string) {
        if (intent.canceled)
          return
        write({
          type: 'special',
          value: special,
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      writeFlush() {
        if (intent.canceled)
          return
        write({
          type: 'flush',
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      end() {
        close()
      },
      cancel(reason?: string) {
        cancelIntent(intentId, reason)
      },
    }

    if (!activeIntent) {
      void runIntent(intent)
      return handle
    }

    if (behavior === 'replace') {
      cancelIntent(activeIntent.intentId, 'replace')
      void runIntent(intent)
      return handle
    }

    if (behavior === 'interrupt' && intent.priority >= activeIntent.priority) {
      cancelIntent(activeIntent.intentId, 'interrupt')
      void runIntent(intent)
      return handle
    }

    enqueueIntent(intent)
    return handle
  }

  function cancelIntent(intentId: string, reason?: string) {
    const intent = intents.get(intentId)
    if (!intent)
      return
    intent.canceled = true
    intent.controller.abort(reason ?? 'canceled')
    intent.closeStream()

    if (activeIntent?.intentId === intentId) {
      options.playback.stopByIntent(intentId, reason ?? 'canceled')
      return
    }

    const index = pending.findIndex(item => item.intentId === intentId)
    if (index >= 0)
      pending.splice(index, 1)
  }

  function interrupt(reason: string) {
    if (activeIntent)
      cancelIntent(activeIntent.intentId, reason)
  }

  function stopAll(reason: string) {
    for (const intent of intents.values()) {
      intent.canceled = true
      intent.controller.abort(reason)
      intent.closeStream()
    }
    pending.length = 0
    intents.clear()
    activeIntent = null
    options.playback.stopAll(reason)
  }

  return {
    openIntent,
    cancelIntent,
    interrupt,
    stopAll,
    on<K extends SpeechPipelineEventName>(event: K, listener: SpeechPipelineEvents<TAudio>[K]) {
      return context.on(speechPipelineEventMap[event] as Eventa<any>, (payload) => {
        listener(payload?.body ?? payload)
      })
    },
  }
}
