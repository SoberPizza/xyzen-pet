/**
 * Typed event channels for the Xyzen buddy real-time feed.
 *
 * Backend contract: service/app/api/v1/buddy_events.py (event names match).
 */

import { defineEventa } from './event-bus'

export const XyzenConnected      = defineEventa<void>('xyzen:connected')
export const XyzenDisconnected   = defineEventa<{ code: number, reason: string }>('xyzen:disconnected')
export const XyzenAuthFailed     = defineEventa<void>('xyzen:auth_failed')

/**
 * Fired by `initXyzen()` once the HTTP health probe returns — `ok: true` on
 * HTTP 2xx, `ok: false` on any failure (network, 4xx, 5xx, timeout). The
 * payload carries the backend base URL so UI surfaces can show "which host?"
 * when offline.
 */
export const XyzenHealthChecked  = defineEventa<{ ok: boolean, baseUrl: string, error?: string }>('xyzen:health_checked')

/**
 * Events originating from the backend may carry an optional `topic_id`,
 * signalling which CEO-session topic drove the event. The Buddy frontend
 * follows it to keep its active topic in sync with the rest of Xyzen.
 */
export interface XyzenTopicHint { topic_id?: string }

export const XyzenEmotionUpdate  = defineEventa<{ emotion: string, intensity: number } & XyzenTopicHint>('xyzen:emotion_update')
export const XyzenActivityUpdate = defineEventa<{ activity: string } & XyzenTopicHint>('xyzen:activity_update')
export const XyzenGestureTrigger = defineEventa<{ gesture: string, intensity: number, timestamp_ms: number } & XyzenTopicHint>('xyzen:gesture_trigger')
export const XyzenTextChunk      = defineEventa<{ content: string } & XyzenTopicHint>('xyzen:text_chunk')
export const XyzenReplyStart     = defineEventa<XyzenTopicHint>('xyzen:reply_start')
export const XyzenReplyEnd       = defineEventa<XyzenTopicHint>('xyzen:reply_end')
export const XyzenStateSync      = defineEventa<{
  emotion: string
  activity: string
  mood: number
  energy: number
} & XyzenTopicHint>('xyzen:state_sync')

// ─── Voice WS (`/xyzen/ws/v1/buddy/voice/{topic_id}`) ──────────────────
//
// These events mirror `service/app/core/voice.py` — the same voice
// pipeline that powers the web frontend's voice calls. Buddy connects
// to the buddy-scoped variant of that endpoint which stamps
// `MessageSource.BUDDY` server-side, so TTS only flows back on turns
// that originated from Buddy.

export type XyzenVoiceState =
  | 'idle'
  | 'standby'
  | 'listening'
  | 'processing'
  | 'responding'
  | 'speaking'

export const XyzenVoiceSessionReady   = defineEventa<{ topic_id: string, modes: string[] }>('xyzen:voice:session_ready')
export const XyzenVoiceStateChanged   = defineEventa<{ state: XyzenVoiceState }>('xyzen:voice:state_changed')
export const XyzenVoiceStandbyEntered = defineEventa<void>('xyzen:voice:standby_entered')
export const XyzenVoiceStandbyHeard   = defineEventa<{ text: string }>('xyzen:voice:standby_heard')
export const XyzenVoiceWakeDetected   = defineEventa<{ text: string }>('xyzen:voice:wake_detected')
export const XyzenVoiceTranscriptFinal = defineEventa<{ text: string }>('xyzen:voice:transcript_final')
export const XyzenVoiceAssistantText  = defineEventa<{ text: string, final: boolean }>('xyzen:voice:assistant_text')
export const XyzenVoiceAudioStart     = defineEventa<{ sample_rate_hz: number }>('xyzen:voice:audio_start')
export const XyzenVoiceAudioChunk     = defineEventa<{ pcm: ArrayBuffer, sample_rate_hz: number }>('xyzen:voice:audio_chunk')
export const XyzenVoiceAudioEnd       = defineEventa<void>('xyzen:voice:audio_end')
export const XyzenVoiceInterrupted    = defineEventa<void>('xyzen:voice:interrupted')
export const XyzenVoiceError          = defineEventa<{ message: string }>('xyzen:voice:error')
export const XyzenVoiceClosed         = defineEventa<{ code: number, reason: string }>('xyzen:voice:closed')

// ─── Cross-surface voice presence (delivered over the buddy SSE feed) ──
//
// The backend publishes presence signals to `user:{user_id}:voice:events`
// and fans them into the buddy SSE endpoint. This lets Buddy's voice
// session auto-pause when the web frontend takes the mic and auto-resume
// when it gives it back.

export type XyzenVoiceSource = 'web' | 'buddy'

export const XyzenVoicePresenceOpened = defineEventa<{ source: XyzenVoiceSource, topic_id?: string }>('xyzen:voice:presence_opened')
export const XyzenVoicePresenceClosed = defineEventa<{ source: XyzenVoiceSource }>('xyzen:voice:presence_closed')
export const XyzenVoicePresenceSync   = defineEventa<{ web: boolean, buddy: boolean }>('xyzen:voice:presence_sync')
