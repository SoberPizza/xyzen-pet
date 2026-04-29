/**
 * Thin IPC shim for the buddy voice WebSocket.
 *
 * Connection lifecycle, framing, ping loop, and TTS playback all live in
 * Rust (`src-tauri/src/net/voice_ws.rs`). This module just issues commands
 * and fans the emitted Tauri events onto `xyzenBus`, preserving the
 * `VoiceWsClient` surface expected by `useBuddyVoiceSession`.
 *
 * Binary TTS chunks currently arrive via `xyzen://voice/audio-chunk`
 * events. Stage 5 will swap this hot path to `tauri::ipc::Channel` so
 * raw PCM bypasses the JSON serialiser — the TS surface here won't change
 * when that lands.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ResolvedConfig } from '../runtime/config'

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

export interface VoiceSessionStartOptions {
  mode: 'conversation' | 'standby_wake'
  wakeWords?: string[]
  wakeWordTimeoutMs?: number
}

export interface VoiceConnectOptions {
  preempt?: boolean
}

interface RustSessionReady { topic_id: string, modes: string[] }
interface RustStateChanged { state: string }
interface RustText { text: string }
interface RustAssistantText { text: string, final_flag: boolean }
interface RustAudioStart { sample_rate_hz: number }
interface RustError { message: string }
interface RustClosed { code: number, reason: string }

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

export class VoiceWsClient {
  private unlisteners: UnlistenFn[] = []
  private isOpen = false
  /** Live sample rate, tracked from `audio-start`; stamped onto each chunk
   *  we deliver via `XyzenVoiceAudioChunk`. */
  private assistantAudioSampleRate = 24_000

  // Token is no longer read here — Rust pulls it from the shared auth
  // cache on `open`. Kept in the constructor signature so callers in
  // `useBuddyVoiceSession` don't need to change yet.
  constructor(_config: ResolvedConfig, private readonly _token: string) {}

  get connected(): boolean {
    return this.isOpen
  }

  async connect(topicId: string, opts: VoiceConnectOptions = {}): Promise<void> {
    if (!isTauri()) throw new Error('Voice WS requires the Tauri IPC bridge.')
    this.installListeners()

    // Dedicated binary channel for TTS PCM. Tauri v2 routes `Channel<T>`
    // payloads as ArrayBuffers when T is a byte sequence, bypassing the
    // JSON serialiser — at ~50 emits/s and ~960 bytes/frame that's the
    // difference between steady playback and scheduler jitter on the Pi.
    const audioChannel = new Channel<ArrayBuffer>()
    audioChannel.onmessage = (buf) => {
      xyzenBus.emit(XyzenVoiceAudioChunk, {
        pcm: buf,
        sample_rate_hz: this.assistantAudioSampleRate,
      })
    }

    await invoke('xyzen_voice_ws_open', {
      args: { topicId, preempt: !!opts.preempt },
      audioChannel,
    })
    this.isOpen = true
  }

  startSession(options: VoiceSessionStartOptions): void {
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_start_session', {
      args: {
        mode: options.mode,
        wakeWords: options.wakeWords,
        wakeWordTimeoutMs: options.wakeWordTimeoutMs,
      },
    }).catch(err => console.warn('[voice:ws] start_session:', err))
  }

  startInputAudio(): void {
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_input_start').catch(() => {})
  }

  commitInputAudio(): void {
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_input_commit').catch(() => {})
  }

  interrupt(): void {
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_interrupt').catch(() => {})
  }

  stopSession(): void {
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_stop_session').catch(() => {})
  }

  sendFrame(pcm16: Int16Array): void {
    if (!isTauri() || !this.isOpen) return
    // Copy into a tightly-packed Uint8Array (source may be a subview on a
    // transferred buffer we can't resend). Tauri v2 routes typed-array
    // arguments over its binary IPC path, so there's no JSON-array blowup
    // at 50 frames/s.
    const bytes = new Uint8Array(pcm16.byteLength)
    bytes.set(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength))
    void invoke('xyzen_voice_ws_send_frame', { pcm16: bytes }).catch(() => {})
  }

  close(): void {
    this.isOpen = false
    this.clearListeners()
    if (!isTauri()) return
    void invoke('xyzen_voice_ws_close').catch(() => {})
  }

  // ── internals ─────────────────────────────────────────────────────

  private installListeners(): void {
    this.clearListeners()

    const reg = <T>(name: string, cb: (payload: T) => void) => {
      listen<T>(name, (evt) => cb(evt.payload))
        .then(fn => this.unlisteners.push(fn))
        .catch(err => console.warn(`[voice:ws] listen ${name}:`, err))
    }

    reg<RustSessionReady>('xyzen://voice/session-ready', (p) => {
      xyzenBus.emit(XyzenVoiceSessionReady, { topic_id: p.topic_id, modes: p.modes })
    })
    reg<RustStateChanged>('xyzen://voice/state', (p) => {
      // Rust emits both the transient "opened" marker and real server-side
      // state transitions through this channel. Only server states match
      // XyzenVoiceState; "opened" is dropped (the WS open resolves via the
      // command's return).
      if (p.state === 'opened') return
      xyzenBus.emit(XyzenVoiceStateChanged, { state: p.state as XyzenVoiceState })
    })
    reg<null>('xyzen://voice/standby-entered', () => {
      xyzenBus.emit(XyzenVoiceStandbyEntered, undefined)
    })
    reg<RustText>('xyzen://voice/standby-heard', (p) => {
      xyzenBus.emit(XyzenVoiceStandbyHeard, { text: p.text })
    })
    reg<RustText>('xyzen://voice/wake-detected', (p) => {
      xyzenBus.emit(XyzenVoiceWakeDetected, { text: p.text })
    })
    reg<RustText>('xyzen://voice/transcript-final', (p) => {
      xyzenBus.emit(XyzenVoiceTranscriptFinal, { text: p.text })
    })
    reg<RustAssistantText>('xyzen://voice/assistant-text', (p) => {
      xyzenBus.emit(XyzenVoiceAssistantText, { text: p.text, final: p.final_flag })
    })
    reg<RustAudioStart>('xyzen://voice/audio-start', (p) => {
      this.assistantAudioSampleRate = p.sample_rate_hz
      xyzenBus.emit(XyzenVoiceAudioStart, { sample_rate_hz: p.sample_rate_hz })
    })
    // Binary chunks travel over the `Channel<ArrayBuffer>` opened in
    // `connect()`; no event listener needed on this path.
    reg<null>('xyzen://voice/audio-end', () => {
      xyzenBus.emit(XyzenVoiceAudioEnd, undefined)
    })
    reg<null>('xyzen://voice/interrupted', () => {
      xyzenBus.emit(XyzenVoiceInterrupted, undefined)
    })
    reg<RustError>('xyzen://voice/error', (p) => {
      xyzenBus.emit(XyzenVoiceError, { message: p.message })
    })
    reg<RustClosed>('xyzen://voice/closed', (p) => {
      this.isOpen = false
      xyzenBus.emit(XyzenVoiceClosed, { code: p.code, reason: p.reason })
    })
  }

  private clearListeners(): void {
    for (const un of this.unlisteners) {
      try { un() } catch {}
    }
    this.unlisteners = []
  }
}
