/**
 * Buddy voice-session orchestrator (thin IPC shim).
 *
 * The full FSM (barge-in, preroll buffer, wake-word gating, standby watchdog,
 * cross-surface exclusivity) lives in Rust under `src-tauri/src/voice/`. This
 * composable is the Vue side of that handshake — it opens a session over
 * IPC, forwards mic PCM frames, and exposes a reactive state ref driven by
 * `voice://state` events.
 *
 * The Rust FSM is currently a scaffold: `voice_start` emits
 * `idle → listening`, `voice_stop` emits `idle`, and pushed frames are
 * dropped silently. Wiring the real pipeline is blocked on the new remote
 * API spec.
 */

import { computed, onScopeDispose, ref } from 'vue'

import { commands, useIpcEvent } from '../ipc/client'
import { useVoiceMic, type VoiceMicFrame } from './useVoiceMic'

export type BuddyVoiceUiState =
  | 'off'
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'preroll'
  | 'speaking'
  | 'barge-in'
  | 'standby'
  | 'error'

interface RustVoiceStateChanged {
  session_id: string
  state: BuddyVoiceUiState
}

async function unwrap<T, E>(
  p: Promise<{ status: 'ok', data: T } | { status: 'error', error: E }>,
): Promise<T> {
  const r = await p
  if (r.status === 'ok') return r.data
  throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error))
}

let singleton: ReturnType<typeof create> | null = null

function create() {
  const uiState = ref<BuddyVoiceUiState>('off')
  const errorMessage = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const isOn = computed(() => uiState.value !== 'off' && uiState.value !== 'error')

  const mic = useVoiceMic()
  let unsubscribeMic: (() => void) | null = null

  useIpcEvent<RustVoiceStateChanged>('voice://state', (payload) => {
    if (sessionId.value && payload.session_id !== sessionId.value) return
    uiState.value = payload.state
  })

  async function start(): Promise<void> {
    if (isOn.value) return
    errorMessage.value = null
    uiState.value = 'connecting'
    try {
      const id = await unwrap(commands.voiceStart({ buddy_id: 'placeholder' }))
      sessionId.value = id

      await mic.start()
      unsubscribeMic = mic.onFrame((frame: VoiceMicFrame) => {
        if (!sessionId.value) return
        void unwrap(
          commands.voicePushFrame(sessionId.value, Array.from(frame.pcm16)),
        ).catch((err) => {
          console.warn('[voice] push_frame failed:', err)
        })
      })
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err)
      uiState.value = 'error'
      sessionId.value = null
      await mic.stop().catch(() => {})
    }
  }

  async function stop(): Promise<void> {
    if (unsubscribeMic) {
      try { unsubscribeMic() } catch {}
      unsubscribeMic = null
    }
    await mic.stop().catch(() => {})

    const id = sessionId.value
    sessionId.value = null
    uiState.value = 'off'
    if (id) {
      await unwrap(commands.voiceStop(id)).catch((err) => {
        console.warn('[voice] stop failed:', err)
      })
    }
  }

  async function toggle(): Promise<void> {
    if (isOn.value) await stop()
    else await start()
  }

  onScopeDispose(() => {
    void stop()
  })

  return {
    state: uiState,
    error: errorMessage,
    isOn,
    start,
    stop,
    toggle,
  }
}

export function useBuddyVoiceSession() {
  if (!singleton) singleton = create()
  return singleton
}
