/**
 * WebSocket client for `/xyzen/ws/v1/buddy/voice/{topic_id}`.
 *
 * The buddy-scoped voice endpoint is a near-clone of the web voice WS
 * at `/ws/voice/{topic_id}`, but the server hard-codes
 * `MessageSource.BUDDY` on every turn it originates. TTS events from
 * web-originated turns are suppressed server-side by
 * `VoiceCallSession._listen_for_stream` so nothing leaks across
 * surfaces — the source filter is authoritative, not client-asserted.
 *
 * Protocol:
 *  - Sends JSON control (`session.start`, `input_audio.start`,
 *    `input_audio.commit`, `interrupt`, `session.stop`, `ping`).
 *  - Sends binary PCM16 mono 16 kHz 20 ms frames (640 bytes each).
 *  - Receives JSON events (state, transcripts, assistant text deltas,
 *    wake/standby, errors).
 *  - Receives binary PCM16 mono 24 kHz frames between
 *    `assistant.audio.start` and `assistant.audio.end`; forwarded as
 *    `XyzenVoiceAudioChunk` so the audio decoder can play them.
 *
 * Kept separate from `BuddySseClient` so the long-lived buddy event
 * feed (output-only emotion/activity SSE stream) isn't coupled to
 * voice-session lifecycle.
 */

import type { ResolvedConfig } from '../../runtime/config'

import { xyzenBus } from './event-bus'
import {
  XyzenVoiceAssistantText,
  XyzenVoiceAudioChunk,
  XyzenVoiceAudioEnd,
  XyzenVoiceAudioStart,
  XyzenVoiceClosed,
  XyzenVoiceError,
  XyzenVoiceInterrupted,
  XyzenVoiceSessionReady,
  XyzenVoiceStandbyEntered,
  XyzenVoiceStandbyHeard,
  XyzenVoiceStateChanged,
  XyzenVoiceTranscriptFinal,
  XyzenVoiceWakeDetected,
  type XyzenVoiceState,
} from './types'

const PING_INTERVAL_MS = 15_000

export interface VoiceSessionStartOptions {
  mode: 'conversation' | 'standby_wake'
  wakeWords?: string[]
  wakeWordTimeoutMs?: number
}

export interface VoiceConnectOptions {
  /** If true, asks the server to preempt any active web voice session before we connect. */
  preempt?: boolean
}

export class VoiceWsClient {
  private ws: WebSocket | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private assistantAudioSampleRate = 24000
  private readonly baseUrl: string
  private firstBinarySeen = false
  private binaryFrameCount = 0

  constructor(config: ResolvedConfig, private readonly token: string) {
    this.baseUrl = config.baseUrl
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Opens the WebSocket and waits until the server accepts it.
   * Throws if the connection fails or is rejected.
   */
  async connect(topicId: string, opts: VoiceConnectOptions = {}): Promise<void> {
    if (!this.token) throw new Error('Voice WS requires an auth token.')
    const preempt = opts.preempt ? '&preempt=1' : ''
    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/xyzen/ws/v1/buddy/voice/${encodeURIComponent(topicId)}?token=${encodeURIComponent(this.token)}${preempt}`

    console.info('[buddy:voice:ws] connecting', {
      url: wsUrl.replace(/token=[^&]+/, 'token=***'),
      preempt: !!opts.preempt,
    })

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
        console.info('[buddy:voice:ws] open')
        resolve()
      }
      const onError = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
        console.error('[buddy:voice:ws] connect failed')
        reject(new Error('Voice WS failed to open'))
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)
    })

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleJson(event.data)
      }
      else if (event.data instanceof ArrayBuffer) {
        this.binaryFrameCount += 1
        if (!this.firstBinarySeen) {
          this.firstBinarySeen = true
          console.info('[buddy:voice:ws] first binary frame', {
            bytes: event.data.byteLength,
            rate: this.assistantAudioSampleRate,
          })
        }
        else if (this.binaryFrameCount % 50 === 0) {
          console.debug('[buddy:voice:ws] binary frame', {
            n: this.binaryFrameCount,
            bytes: event.data.byteLength,
          })
        }
        xyzenBus.emit(XyzenVoiceAudioChunk, {
          pcm: event.data,
          sample_rate_hz: this.assistantAudioSampleRate,
        })
      }
    }

    ws.onclose = (event) => {
      this.clearPing()
      this.ws = null
      console.info('[buddy:voice:ws] closed', { code: event.code, reason: event.reason })
      xyzenBus.emit(XyzenVoiceClosed, { code: event.code, reason: event.reason })
    }

    ws.onerror = () => {
      // onclose will fire right after with the actual code/reason.
      console.warn('[buddy:voice:ws] socket error event')
    }

    this.pingInterval = setInterval(() => {
      if (!this.connected) return
      this.sendJson({ type: 'ping' })
    }, PING_INTERVAL_MS)
  }

  startSession(options: VoiceSessionStartOptions): void {
    const data: Record<string, unknown> = { mode: options.mode }
    if (options.wakeWords && options.wakeWords.length > 0) data.wake_words = options.wakeWords
    if (options.wakeWordTimeoutMs) data.wake_word_timeout_ms = options.wakeWordTimeoutMs
    this.sendJson({ type: 'session.start', data })
  }

  startInputAudio(): void {
    this.sendJson({ type: 'input_audio.start' })
  }

  commitInputAudio(): void {
    this.sendJson({ type: 'input_audio.commit' })
  }

  interrupt(): void {
    this.sendJson({ type: 'interrupt' })
  }

  stopSession(): void {
    this.sendJson({ type: 'session.stop' })
  }

  sendFrame(pcm16: Int16Array): void {
    if (!this.connected) return
    // Clone into a tightly-packed ArrayBuffer — the source Int16Array may
    // be backed by a transferred buffer we can't resend.
    const buf = new ArrayBuffer(pcm16.byteLength)
    new Int16Array(buf).set(pcm16)
    try { this.ws!.send(buf) } catch {}
  }

  close(): void {
    this.clearPing()
    const ws = this.ws
    this.ws = null
    if (ws) {
      try { ws.close(1000, 'client stop') } catch {}
    }
  }

  // ── internals ─────────────────────────────────────────────────────

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.connected) return
    try { this.ws!.send(JSON.stringify(payload)) } catch {}
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private handleJson(raw: string): void {
    let msg: { type?: string, data?: unknown }
    try { msg = JSON.parse(raw) }
    catch {
      console.warn('[buddy:voice:ws] json parse failed', raw.slice(0, 200))
      return
    }

    const type = msg.type
    const data = (msg.data ?? {}) as Record<string, unknown>

    console.debug('[buddy:voice:ws] msg', type)

    switch (type) {
      case 'session.ready':
        xyzenBus.emit(XyzenVoiceSessionReady, {
          topic_id: String(data.topic_id ?? ''),
          modes: Array.isArray(data.modes) ? data.modes.map(String) : [],
        })
        break
      case 'state.changed':
        xyzenBus.emit(XyzenVoiceStateChanged, {
          state: String(data.state ?? 'idle') as XyzenVoiceState,
        })
        break
      case 'standby.entered':
        xyzenBus.emit(XyzenVoiceStandbyEntered, undefined)
        break
      case 'standby.heard':
        xyzenBus.emit(XyzenVoiceStandbyHeard, { text: String(data.text ?? '') })
        break
      case 'wake.detected':
        xyzenBus.emit(XyzenVoiceWakeDetected, { text: String(data.text ?? '') })
        break
      case 'transcript.final':
        xyzenBus.emit(XyzenVoiceTranscriptFinal, { text: String(data.text ?? '') })
        break
      case 'assistant.text.delta':
        xyzenBus.emit(XyzenVoiceAssistantText, { text: String(data.text ?? ''), final: false })
        break
      case 'assistant.text.final':
        xyzenBus.emit(XyzenVoiceAssistantText, { text: String(data.text ?? ''), final: true })
        break
      case 'assistant.audio.start':
        this.assistantAudioSampleRate = Number(data.sample_rate_hz ?? 24000)
        console.info('[buddy:voice:ws] assistant.audio.start', { rate: this.assistantAudioSampleRate })
        xyzenBus.emit(XyzenVoiceAudioStart, { sample_rate_hz: this.assistantAudioSampleRate })
        break
      case 'assistant.audio.end':
        console.info('[buddy:voice:ws] assistant.audio.end')
        xyzenBus.emit(XyzenVoiceAudioEnd, undefined)
        break
      case 'interrupted':
        xyzenBus.emit(XyzenVoiceInterrupted, undefined)
        break
      case 'error':
        console.error('[buddy:voice:ws] server error', data.message)
        xyzenBus.emit(XyzenVoiceError, { message: String(data.message ?? 'Voice error') })
        break
      case 'pong':
      case 'input_audio.committed':
      case 'session.closed':
        break
      default:
        console.debug('[buddy:voice:ws] ignored msg', type)
        break
    }
  }
}
