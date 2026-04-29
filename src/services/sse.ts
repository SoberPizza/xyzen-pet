/**
 * Thin IPC shim for the Xyzen SSE buddy-events feed.
 *
 * The stream itself runs in Rust (`src-tauri/src/net/sse.rs`). This module
 * just issues lifecycle commands (`xyzen_sse_{connect,disconnect}`) and
 * listens for the fanout events (`xyzen://sse/*`), then re-emits the same
 * bus events that `useXyzenBridge` consumes — so downstream call sites are
 * unchanged.
 *
 * Kept as a class so `services/index.ts` can still hold onto a handle with
 * `connect()` / `reconnect()` / `disconnect()` semantics; the methods are now
 * IPC wrappers rather than WebSocket/fetch handles.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ResolvedConfig } from '../runtime/config'

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

interface RustSseEvent {
  event: string
  data: Record<string, unknown>
}

interface RustDisconnected {
  code: number
  reason: string
}

interface SseStatus {
  connected: boolean
  auth_failed: boolean
}

function pickTopicId(data: Record<string, unknown>): string | undefined {
  return typeof data.topic_id === 'string' ? data.topic_id : undefined
}

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

export class BuddySseClient {
  private connectedFlag = false
  private authFailed = false
  private unlisteners: UnlistenFn[] = []

  // The constructor still accepts a ResolvedConfig for back-compat with
  // `services/index.ts`, which also passes it to the HTTP client. The SSE
  // transport now pulls credentials from the Rust-side cache directly.
  constructor(_config: ResolvedConfig) {
    if (!isTauri()) return
    this.installListeners()
  }

  get connected(): boolean {
    return this.connectedFlag
  }

  get isAuthFailed(): boolean {
    return this.authFailed
  }

  connect(): void {
    if (!isTauri()) return
    void invoke('xyzen_sse_connect').catch((err) => {
      console.warn('[buddy:sse] connect invoke failed:', err)
    })
  }

  disconnect(): void {
    if (!isTauri()) return
    void invoke('xyzen_sse_disconnect').catch(() => {})
  }

  /**
   * Kept for API compatibility with the pre-IPC client. Rust pulls the
   * current token from the shared auth cache on every (re)connect, so the
   * token argument is unused — but callers in `services/index.ts` still
   * call this on every `onTokenChange`, so we re-arm the stream to match
   * the old semantics.
   */
  reconnectWithToken(_token: string): void {
    if (!isTauri()) return
    this.authFailed = false
    void invoke('xyzen_sse_disconnect')
      .catch(() => {})
      .then(() => invoke('xyzen_sse_connect'))
      .catch((err) => {
        console.warn('[buddy:sse] reconnect invoke failed:', err)
      })
  }

  reconnect(): void {
    this.reconnectWithToken('')
  }

  /** Rarely useful from TS, but mirrors the `BuddySseClient` surface. */
  async status(): Promise<SseStatus | null> {
    if (!isTauri()) return null
    try {
      return await invoke<SseStatus>('xyzen_sse_status')
    } catch {
      return null
    }
  }

  // ── internals ─────────────────────────────────────────────────────

  private installListeners(): void {
    listen<null>('xyzen://sse/connected', () => {
      this.connectedFlag = true
      this.authFailed = false
      xyzenBus.emit(XyzenConnected, undefined)
    })
      .then(fn => this.unlisteners.push(fn))
      .catch(err => console.warn('[buddy:sse] listen connected:', err))

    listen<RustDisconnected>('xyzen://sse/disconnected', (evt) => {
      this.connectedFlag = false
      xyzenBus.emit(XyzenDisconnected, {
        code: evt.payload.code,
        reason: evt.payload.reason,
      })
    })
      .then(fn => this.unlisteners.push(fn))
      .catch(err => console.warn('[buddy:sse] listen disconnected:', err))

    listen<null>('xyzen://auth-failed', () => {
      this.authFailed = true
      xyzenBus.emit(XyzenAuthFailed, undefined)
    })
      .then(fn => this.unlisteners.push(fn))
      .catch(err => console.warn('[buddy:sse] listen auth-failed:', err))

    listen<RustSseEvent>('xyzen://sse/event', (evt) => {
      this.handleEvent(evt.payload.event, evt.payload.data ?? {})
    })
      .then(fn => this.unlisteners.push(fn))
      .catch(err => console.warn('[buddy:sse] listen event:', err))
  }

  /**
   * Fan the Rust-decoded event + data into the same `xyzenBus` signals the
   * retired in-browser client emitted. Event names / payload shapes are
   * identical to the old `handleEvent` so downstream consumers are unchanged.
   */
  private handleEvent(event: string, data: Record<string, unknown>): void {
    const topic_id = pickTopicId(data)
    switch (event) {
      case 'connected':
        break
      case 'emotion_update':
        xyzenBus.emit(XyzenEmotionUpdate, {
          emotion: String(data.emotion ?? 'neutral'),
          intensity: Number(data.intensity ?? 1),
          topic_id,
        })
        break
      case 'activity_update':
        xyzenBus.emit(XyzenActivityUpdate, {
          activity: String(data.activity ?? 'idle'),
          topic_id,
        })
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
        xyzenBus.emit(XyzenTextChunk, {
          content: String(data.content ?? ''),
          topic_id,
        })
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
        const source = data.source === 'web' || data.source === 'buddy'
          ? (data.source as XyzenVoiceSource)
          : undefined
        if (!source) break
        xyzenBus.emit(XyzenVoicePresenceOpened, {
          source,
          topic_id: typeof data.topic_id === 'string' ? data.topic_id : undefined,
        })
        break
      }
      case 'voice:presence_closed': {
        const source = data.source === 'web' || data.source === 'buddy'
          ? (data.source as XyzenVoiceSource)
          : undefined
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
        break
    }
  }
}
