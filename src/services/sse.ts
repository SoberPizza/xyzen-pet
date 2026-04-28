/**
 * SSE client for /xyzen/api/v1/buddy/events.
 *
 * Responsibilities
 *  - Open a `fetch()` stream with `Authorization: Bearer <jwt>` and fan
 *    frames out onto `xyzenBus` — same emissions as the retired WS client,
 *    so `useXyzenBridge` consumers are unchanged.
 *  - Auto-reconnect with exponential backoff (500ms → 30s).
 *  - Rotate token via `reconnectWithToken()` (called when ResolvedConfig
 *    notifies).
 *  - Handle 401 by setting the sticky `isAuthFailed` flag, emitting
 *    `XyzenAuthFailed`, and pinging `config.invalidateCredentials()` so
 *    the active credential provider can rotate. The sticky flag stops the
 *    retry loop from hammering the endpoint.
 *
 * The transport is SSE-over-fetch (`Response.body.getReader()`) rather than
 * the native `EventSource` API because `EventSource` cannot attach custom
 * headers — the backend expects a `Bearer` token, not a query-string one.
 * This matches the pattern in `http.ts`.
 */

import type { ResolvedConfig } from '../../runtime/config'

import { xyzenBus } from './event-bus'
import {
  XyzenActivityUpdate,
  XyzenAuthFailed,
  XyzenConnected,
  XyzenDisconnected,
  XyzenEmotionUpdate,
  XyzenGestureTrigger,
  XyzenReplyEnd,
  XyzenReplyStart,
  XyzenStateSync,
  XyzenTextChunk,
  XyzenVoicePresenceClosed,
  XyzenVoicePresenceOpened,
  XyzenVoicePresenceSync,
  type XyzenVoiceSource,
} from './types'

const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 30_000

function pickTopicId(data: Record<string, unknown>): string | undefined {
  return typeof data.topic_id === 'string' ? data.topic_id : undefined
}

/**
 * Local midnight as an ISO8601 string. Passed to the server on every
 * connect so the Buddy-topic get-or-create window matches the client's
 * local day, regardless of the backend's timezone.
 */
function localStartOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export class BuddySseClient {
  private abortController: AbortController | null = null
  private intentionalClose = false
  private authFailed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentToken: string
  private isStreaming = false

  constructor(private readonly config: ResolvedConfig) {
    this.currentToken = config.token
  }

  get connected(): boolean {
    return this.isStreaming
  }

  /** True once the server rejected a request with HTTP 401. */
  get isAuthFailed(): boolean {
    return this.authFailed
  }

  connect(): void {
    this.intentionalClose = false
    void this.openStream()
  }

  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnectTimer()
    this.abortController?.abort()
    this.abortController = null
  }

  /** Swap the auth token and reopen the stream. */
  reconnectWithToken(token: string): void {
    this.currentToken = token
    this.authFailed = false
    this.intentionalClose = false
    this.clearReconnectTimer()
    this.abortController?.abort()
    this.abortController = null
    void this.openStream()
  }

  /** Reopen the stream against the current `config.baseUrl`. */
  reconnect(): void {
    this.authFailed = false
    this.intentionalClose = false
    this.clearReconnectTimer()
    this.abortController?.abort()
    this.abortController = null
    void this.openStream()
  }

  // ── internals ─────────────────────────────────────────────────────

  private async openStream(): Promise<void> {
    if (this.intentionalClose) return
    if (this.authFailed) {
      // Server previously rejected the token — do not retry until the
      // credential provider rotates it via `reconnectWithToken`.
      return
    }
    if (!this.currentToken) {
      console.warn('[buddy:sse] No auth token — skipping connect. Call reconnectWithToken() once available.')
      return
    }
    if (!this.config.baseUrl) {
      console.warn('[buddy:sse] No backend baseUrl — skipping connect.')
      return
    }

    const ac = new AbortController()
    this.abortController = ac
    const since = encodeURIComponent(localStartOfTodayISO())
    const url = `${this.config.baseUrl}/xyzen/api/v1/buddy/events?since=${since}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.currentToken}`,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: ac.signal,
      })
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      console.warn('[buddy:sse] fetch failed', err)
      this.scheduleReconnect()
      return
    }

    if (response.status === 401) {
      this.authFailed = true
      this.abortController = null
      console.warn('[buddy:sse] auth rejected (401)')
      xyzenBus.emit(XyzenAuthFailed, undefined)
      // Fire-and-forget: ask the provider to rotate. On success the
      // caller's `onTokenChange` wiring will invoke reconnectWithToken,
      // which clears `authFailed` and reopens.
      void this.config.invalidateCredentials().catch(() => {})
      return
    }

    if (!response.ok || !response.body) {
      console.warn('[buddy:sse] non-2xx response', response.status)
      this.abortController = null
      this.scheduleReconnect()
      return
    }

    this.reconnectAttempts = 0
    this.isStreaming = true
    console.info('[buddy:sse] connected', url)
    xyzenBus.emit(XyzenConnected, undefined)

    try {
      await this.consume(response.body)
    } finally {
      this.isStreaming = false
      this.abortController = null
    }
  }

  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        // Frames are delimited by a blank line (\n\n). Some servers or
        // proxies inject \r\n; normalize to \n before splitting.
        buf = buf.replace(/\r\n/g, '\n')
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          this.dispatchFrame(frame)
        }
      }
      // Stream ended cleanly — server closed.
      console.info('[buddy:sse] stream closed by server')
      xyzenBus.emit(XyzenDisconnected, { code: 1000, reason: 'stream end' })
      if (!this.intentionalClose) this.scheduleReconnect()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        // Our own disconnect/reconnect — no emission needed.
        return
      }
      console.warn('[buddy:sse] stream error', err)
      xyzenBus.emit(XyzenDisconnected, { code: 1006, reason: 'stream error' })
      if (!this.intentionalClose) this.scheduleReconnect()
    } finally {
      try { reader.releaseLock() } catch {}
    }
  }

  private dispatchFrame(frame: string): void {
    if (!frame) return
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim()
      } else if (line.startsWith('data:')) {
        // Per SSE spec, a leading space after `data:` is stripped.
        const rest = line.slice('data:'.length)
        dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
      }
    }
    const payload = dataLines.join('\n')
    let data: Record<string, unknown> = {}
    if (payload) {
      try {
        data = JSON.parse(payload) as Record<string, unknown>
      } catch {
        console.debug('[buddy:sse] dropping malformed data payload for event=', event)
        return
      }
    }
    this.handleEvent(event, data)
  }

  private handleEvent(event: string, data: Record<string, unknown>): void {
    const topic_id = pickTopicId(data)
    switch (event) {
      case 'connected':
        // Server-level "connected" hello. The transport-level connected
        // signal was already emitted when the HTTP handshake completed.
        break
      case 'emotion_update':
        xyzenBus.emit(XyzenEmotionUpdate, {
          emotion: String(data.emotion ?? 'neutral'),
          intensity: Number(data.intensity ?? 1),
          topic_id,
        })
        break
      case 'activity_update':
        xyzenBus.emit(XyzenActivityUpdate, { activity: String(data.activity ?? 'idle'), topic_id })
        break
      case 'gesture_trigger':
        xyzenBus.emit(XyzenGestureTrigger, {
          gesture: String(data.gesture ?? ''),
          intensity: Number(data.intensity ?? 1),
          timestamp_ms: Number(data.timestamp_ms ?? Date.now()),
          topic_id,
        })
        break
      case 'text_chunk':
        xyzenBus.emit(XyzenTextChunk, { content: String(data.content ?? ''), topic_id })
        break
      case 'reply_start':
        xyzenBus.emit(XyzenReplyStart, { topic_id })
        break
      case 'reply_end':
        xyzenBus.emit(XyzenReplyEnd, { topic_id })
        break
      case 'state_sync':
        xyzenBus.emit(XyzenStateSync, {
          emotion: String(data.emotion ?? 'neutral'),
          activity: String(data.activity ?? 'idle'),
          mood: Number(data.mood ?? 0.5),
          energy: Number(data.energy ?? 0.5),
          topic_id,
        })
        break
      case 'voice:presence_opened': {
        const source = data.source === 'web' || data.source === 'buddy' ? (data.source as XyzenVoiceSource) : undefined
        if (!source) break
        xyzenBus.emit(XyzenVoicePresenceOpened, {
          source,
          topic_id: typeof data.topic_id === 'string' ? data.topic_id : undefined,
        })
        break
      }
      case 'voice:presence_closed': {
        const source = data.source === 'web' || data.source === 'buddy' ? (data.source as XyzenVoiceSource) : undefined
        if (!source) break
        xyzenBus.emit(XyzenVoicePresenceClosed, { source })
        break
      }
      case 'voice:presence_sync':
        xyzenBus.emit(XyzenVoicePresenceSync, {
          web: Boolean(data.web),
          buddy: Boolean(data.buddy),
        })
        break
      default:
        // Forward-compat: ignore unknown event types silently.
        break
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.authFailed) return
    const exp = Math.min(BACKOFF_MIN_MS * 2 ** this.reconnectAttempts, BACKOFF_MAX_MS)
    const delay = exp / 2 + Math.random() * (exp / 2)
    this.reconnectAttempts += 1
    console.debug('[buddy:sse] reconnect scheduled attempt=', this.reconnectAttempts, 'delay=', Math.round(delay))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openStream()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
