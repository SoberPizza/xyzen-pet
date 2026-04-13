import type { StreamTranscriptionDelta, StreamTranscriptionResult } from '@xsai/stream-transcription'

import { extractSenseVoiceEmotion } from '../../../composables/sensevoice-emotion'

type AudioChunk = ArrayBuffer | ArrayBufferView

function toArrayBuffer(chunk: AudioChunk): ArrayBuffer {
  if (chunk instanceof ArrayBuffer)
    return chunk

  if (ArrayBuffer.isView(chunk)) {
    if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength)
      return chunk.buffer as ArrayBuffer

    return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
  }

  throw new TypeError('Unsupported audio chunk type for SenseVoice streaming transcription')
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/**
 * FunASR WebSocket first-frame configuration message.
 *
 * The FunASR server expects a JSON configuration message as the first frame,
 * describing the audio format, sample rate, and streaming mode.
 */
interface FunASRFirstFrame {
  mode: '2pass' | 'online' | 'offline'
  chunk_size: number[]
  wav_name?: string
  wav_format?: string
  is_speaking: boolean
  hotwords?: string
  itn?: boolean
}

/**
 * FunASR server response message.
 *
 * The server sends JSON messages with transcription results. The `text` field
 * contains the recognized text (possibly with SenseVoice emotion/language/event tags).
 * `mode` indicates the decoding pass (e.g., "2pass-online" for streaming partial,
 * "2pass-offline" for final result).
 */
interface FunASRResponse {
  text: string
  mode?: string
  is_final?: boolean
  timestamp?: Array<[number, number]>
}

export interface SenseVoiceStreamOptions {
  baseURL?: string | URL
  inputAudioStream?: ReadableStream<AudioChunk>
  file?: Blob
  abortSignal?: AbortSignal
  /** Callback for each emotion detected in transcription results. */
  onEmotion?: (emotion: { name: string, intensity: number }) => void
  /** Callback when a sentence-final result arrives. */
  onSentenceFinal?: (text: string) => void
}

/**
 * Stream transcription via a FunASR WebSocket server running SenseVoice.
 *
 * Protocol:
 * 1. Connect to FunASR WebSocket endpoint (default ws://localhost:10095).
 * 2. Send a JSON first-frame message with audio format configuration.
 * 3. Continuously send PCM16 audio data as binary frames.
 * 4. Receive JSON responses with transcription text (may include SenseVoice tags).
 * 5. Send a JSON end-of-stream marker (`is_speaking: false`) to get the final result.
 */
export function streamSenseVoiceTranscription(options: SenseVoiceStreamOptions & Record<string, unknown>): StreamTranscriptionResult {
  const baseURL = options.baseURL
    ? (typeof options.baseURL === 'string' ? options.baseURL : options.baseURL.toString())
    : 'ws://localhost:10095'

  const audioStream = options.inputAudioStream ?? options.file?.stream()
  if (!audioStream)
    throw new TypeError('Audio stream or file is required for SenseVoice streaming transcription.')

  const deferredText = createDeferred<string>()

  let fullText = ''
  let textStreamCtrl: ReadableStreamDefaultController<string> | undefined
  let fullStreamCtrl: ReadableStreamDefaultController<StreamTranscriptionDelta> | undefined

  const fullStream = new ReadableStream<StreamTranscriptionDelta>({
    start(controller) {
      fullStreamCtrl = controller
    },
  })

  const textStream = new ReadableStream<string>({
    start(controller) {
      textStreamCtrl = controller
    },
  })

  void (async () => {
    let ws: WebSocket | undefined
    let reader: ReadableStreamDefaultReader<AudioChunk> | undefined

    try {
      ws = new WebSocket(baseURL)
      ws.binaryType = 'arraybuffer'

      const openPromise = new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve()
        ws!.onerror = (event) => {
          reject(new Error(`WebSocket connection to FunASR server failed: ${event}`))
        }
      })

      if (options.abortSignal?.aborted) {
        ws.close()
        throw options.abortSignal.reason ?? new DOMException('Aborted', 'AbortError')
      }

      const abortHandler = () => {
        ws?.close(1000, 'aborted')
      }
      options.abortSignal?.addEventListener('abort', abortHandler, { once: true })

      await openPromise

      // Send first-frame configuration
      const firstFrame: FunASRFirstFrame = {
        mode: '2pass',
        chunk_size: [5, 10, 5],
        wav_format: 'pcm',
        is_speaking: true,
        itn: true,
      }
      ws.send(JSON.stringify(firstFrame))

      // Handle incoming messages
      ws.onmessage = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data as string) as FunASRResponse
          if (!response.text)
            return

          const { cleanText, emotion } = extractSenseVoiceEmotion(response.text)

          if (emotion)
            options.onEmotion?.(emotion)

          if (cleanText) {
            options.onSentenceFinal?.(cleanText)

            fullText += `${cleanText}\n`
            fullStreamCtrl?.enqueue({ delta: `${cleanText}\n`, type: 'transcript.text.delta' })
            textStreamCtrl?.enqueue(`${cleanText}\n`)
          }
        }
        catch (err) {
          console.warn('[SenseVoice] Failed to parse server message:', err)
        }
      }

      ws.onerror = (event) => {
        console.error('[SenseVoice] WebSocket error:', event)
      }

      ws.onclose = () => {
        options.abortSignal?.removeEventListener('abort', abortHandler)
      }

      // Stream audio data
      reader = (audioStream as ReadableStream<AudioChunk>).getReader()
      while (true) {
        if (options.abortSignal?.aborted)
          break

        const { done, value } = await reader.read()
        if (done)
          break
        if (value && ws.readyState === WebSocket.OPEN)
          ws.send(toArrayBuffer(value))
      }

      // Send end-of-stream marker
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ is_speaking: false }))
      }

      // Wait briefly for final results before closing
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000)
        const prevOnMessage = ws!.onmessage
        ws!.onmessage = (event: MessageEvent) => {
          // Process message through existing handler
          if (prevOnMessage)
            (prevOnMessage as (ev: MessageEvent) => void)(event)

          // Check if this is a final result
          try {
            const response = JSON.parse(event.data as string) as FunASRResponse
            if (response.is_final || response.mode === '2pass-offline') {
              clearTimeout(timeout)
              resolve()
            }
          }
          catch {}
        }

        ws!.onclose = () => {
          clearTimeout(timeout)
          options.abortSignal?.removeEventListener('abort', abortHandler)
          resolve()
        }
      })

      if (ws.readyState === WebSocket.OPEN)
        ws.close(1000, 'stream ended')

      fullStreamCtrl?.enqueue({ delta: '', type: 'transcript.text.done' })
      fullStreamCtrl?.close()
      textStreamCtrl?.close()
      deferredText.resolve(fullText.trim())
    }
    catch (err) {
      fullStreamCtrl?.error(err)
      textStreamCtrl?.error(err)
      deferredText.reject(err)
      reader?.cancel().catch(() => {})
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.close(1000, 'error')
    }
  })()

  return {
    fullStream,
    text: deferredText.promise,
    textStream,
  }
}
