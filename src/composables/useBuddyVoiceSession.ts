/**
 * Buddy voice-session orchestrator.
 *
 * Glues mic capture → VAD gating → voice WebSocket → streamed PCM
 * playback. Callers just toggle `start()`/`stop()` and observe the
 * reactive state; everything else — barge-in, standby watchdog,
 * wake-word handoff — happens internally.
 *
 * Two modes drive the behaviour:
 *  - `conversation`   tap-like continuous capture. Every committed turn
 *                     runs through STT → LLM → TTS.
 *  - `standby_wake`   mic stays hot; turns only reach the LLM once the
 *                     configured wake word is heard (or we're inside
 *                     the post-wake active window on the server side).
 *
 * State-machine flags mirror `frontend/web/src/hooks/useVoiceCall.ts`:
 * `inputLocked`, `speechActive`, `assistantSpeaking`, `awaitingAssistant`,
 * `playbackActive`, `pendingListening`. They exist to guarantee that the
 * server never flips us back into 'listening' while a turn is still
 * committing or the assistant is still speaking.
 *
 * Assistant audio is routed through a local `AudioDecoder` fed from the
 * voice WS binary frames — this is the same decoder shape used by the
 * old buddy-bridge audio path, now driven by per-topic TTS events
 * rather than per-user Redis pub/sub.
 */

import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useBuddyStore } from '../stores/buddy'
import { useCeoChatStore } from '../stores/ceo-chat'
import { useHearingStore } from '../stores/hearing'
import { resolveConfig } from '../runtime/config'
import { collectValidWakeTerms } from '../utils/wake-word'
import { createAudioDecoder, type AudioDecoder } from '../services/audio-decoder'
import { xyzenBus } from '../services/event-bus'
import {
  XyzenVoiceAudioChunk,
  XyzenVoiceAudioEnd,
  XyzenVoiceAudioStart,
  XyzenVoiceClosed,
  XyzenVoiceError,
  XyzenVoiceInterrupted,
  XyzenVoicePresenceClosed,
  XyzenVoicePresenceOpened,
  XyzenVoicePresenceSync,
  XyzenVoiceStandbyEntered,
  XyzenVoiceStandbyHeard,
  XyzenVoiceStateChanged,
  XyzenVoiceWakeDetected,
  type XyzenVoiceState,
} from '../services/types'
import { VoiceWsClient } from '../services/voice-ws'
import { useVad } from './useVad'
import { useVoiceMic, type VoiceMicFrame } from './useVoiceMic'

export type BuddyVoiceUiState =
  | 'off'
  | 'connecting'
  | 'standby'
  | 'listening'
  | 'active'
  | 'speaking'
  | 'error'

export interface BuddyVoiceSessionOptions {
  audioContext: AudioContext
  currentAudioSource: Ref<AudioNode | undefined>
}

export interface BuddyVoiceStartOptions {
  /**
   * If true, asks the server to close any active web voice session for
   * this user before we connect. Used when the user manually flips the
   * FAB on while the web frontend is holding the mic.
   */
  preempt?: boolean
}

let singleton: ReturnType<typeof create> | null = null

function create(options: BuddyVoiceSessionOptions) {
  const uiState = ref<BuddyVoiceUiState>('off')
  const errorMessage = ref<string | null>(null)
  const isOn = computed(() => uiState.value !== 'off' && uiState.value !== 'error')

  // Cross-surface exclusivity flags. These live for the lifetime of the
  // composable (not just one session) so we remember user intent across
  // auto-pause / auto-resume cycles.
  //   userDisabled — the user manually toggled the voice FAB off.
  //   autoPaused   — we yielded to a web voice session; resume when it closes.
  const userDisabled = ref(false)
  const autoPaused = ref(false)
  const isPaused = computed(() => autoPaused.value && !userDisabled.value)

  // After a manual preempt-start, ignore incoming web presence events for
  // this long. Rationale: when the user flips Buddy on while a web session
  // exists, our preempt closes it — but the web frontend often auto-
  // reconnects immediately, racing our start() and publishing a new
  // presence.opened before we've even finished session.start. Without a
  // grace window, Buddy would yield back instantly and the FAB would look
  // broken ("clicks on, flips off"). Buddy wins during this window.
  const MANUAL_GRACE_MS = 3000
  let manualOverrideUntil = 0
  function inManualGrace(): boolean {
    return Date.now() < manualOverrideUntil
  }

  const mic = useVoiceMic()
  const vad = useVad()
  let client: VoiceWsClient | null = null
  let decoder: AudioDecoder | null = null

  // --- Pre-roll ring buffer ----------------------------------------
  //
  // VAD needs `minSpeechMs` (~560 ms) of above-threshold audio before
  // it fires `speech.start`. Without a buffer the first ~560 ms of
  // the user's utterance would be silently dropped. Hold the last
  // ~800 ms (2× minSpeechMs) of mic frames and replay them to the
  // server the moment the turn actually opens.
  const PREROLL_FRAMES = 40
  const prerollRing: Int16Array[] = []

  // --- State-machine flags (mirror useVoiceCall.ts) -----------------
  let speechActive = false
  let assistantSpeaking = false
  let awaitingAssistant = false
  let playbackActive = false
  let inputLocked = true
  let pendingListening = false
  let lastSpeechAt = 0

  let stopMicHandler: (() => void) | null = null
  let stopVadHandler: (() => void) | null = null
  let stopVadFrameHandler: (() => void) | null = null
  const unsub: Array<() => void> = []

  // Presence subscriptions survive stop()/start() cycles so auto-resume
  // can fire while the session is in 'off'.
  const presenceUnsub: Array<() => void> = []

  function currentlyGated(): boolean {
    return (
      speechActive
      || assistantSpeaking
      || playbackActive
      || awaitingAssistant
    )
  }

  function setState(next: BuddyVoiceUiState): void {
    console.info('[buddy:voice:session] state', uiState.value, '→', next)
    uiState.value = next
  }

  function unlockInputIfReady(): void {
    if (!client || currentlyGated()) return
    inputLocked = false
    pendingListening = false
    const hearing = useHearingStore()
    setState(hearing.wakeWordEnabled ? 'standby' : 'listening')
  }

  function flushPendingListeningState(): void {
    if (pendingListening && !currentlyGated()) {
      unlockInputIfReady()
    }
  }

  function applyServerState(state: XyzenVoiceState): void {
    console.debug('[buddy:voice:session] server state', state, {
      gated: currentlyGated(),
      inputLocked,
      speechActive,
      assistantSpeaking,
      playbackActive,
      awaitingAssistant,
    })
    if (state === 'processing' || state === 'responding' || state === 'speaking') {
      inputLocked = true
    }

    if (state === 'listening' && currentlyGated()) {
      console.info('[buddy:voice:session] listening deferred (gated)')
      pendingListening = true
      return
    }

    if (state === 'listening') {
      inputLocked = false
    }
    pendingListening = false

    switch (state) {
      case 'standby':
        setState('standby')
        break
      case 'listening':
        setState(useHearingStore().wakeWordEnabled ? 'standby' : 'listening')
        break
      case 'processing':
        setState('active')
        break
      case 'responding':
      case 'speaking':
        setState('speaking')
        break
      case 'idle':
      default:
        break
    }
  }

  function startCurrentSpeech(): void {
    if (speechActive) return
    if (inputLocked || assistantSpeaking || playbackActive || awaitingAssistant) return
    if (!client) return
    inputLocked = true
    speechActive = true
    lastSpeechAt = Date.now()
    setState('listening')
    client.startInputAudio()
    // Flush the pre-roll ring so the opening syllables (captured before
    // VAD crossed its `minSpeechMs` threshold) actually reach the STT.
    for (const pcm of prerollRing) client.sendFrame(pcm)
    prerollRing.length = 0
  }

  function commitCurrentSpeech(_reason: string): void {
    if (!speechActive) return
    speechActive = false
    awaitingAssistant = true
    inputLocked = true
    lastSpeechAt = 0
    prerollRing.length = 0
    client?.commitInputAudio()
  }

  function onFrame(frame: VoiceMicFrame): void {
    if (!client) return
    if (!speechActive) {
      if (prerollRing.length >= PREROLL_FRAMES) prerollRing.shift()
      prerollRing.push(frame.pcm16)
      return
    }
    client.sendFrame(frame.pcm16)
  }

  async function start(opts: BuddyVoiceStartOptions = {}): Promise<void> {
    console.info('[buddy:voice:session] start', { preempt: !!opts.preempt, uiState: uiState.value })
    if (uiState.value !== 'off' && uiState.value !== 'error') return
    // Don't open the mic while a web voice session is holding the floor,
    // unless the caller explicitly asked to preempt it.
    if (autoPaused.value && !opts.preempt) {
      console.info('[buddy:voice:session] start skipped: auto-paused')
      return
    }
    errorMessage.value = null
    setState('connecting')

    speechActive = false
    assistantSpeaking = false
    awaitingAssistant = false
    playbackActive = false
    inputLocked = true
    pendingListening = false
    lastSpeechAt = 0

    const hearing = useHearingStore()
    const { playbackVolume } = storeToRefs(hearing)
    const ceo = useCeoChatStore()

    try {
      const topicId = await ceo.ensureTopic()
      const config = await resolveConfig()
      if (!config.token) throw new Error('Voice session requires an auth token.')

      decoder = createAudioDecoder(options.audioContext, options.currentAudioSource, playbackVolume)

      client = new VoiceWsClient(config, config.token)
      await client.connect(topicId, { preempt: opts.preempt })

      unsub.push(xyzenBus.on(XyzenVoiceStateChanged, ({ state }) => applyServerState(state)))
      unsub.push(xyzenBus.on(XyzenVoiceStandbyEntered, () => {
        awaitingAssistant = false
        setState('standby')
      }))
      // Wake-miss turn ended: the server heard speech in standby_wake mode
      // but no wake word was present, so no LLM/TTS follows. Without this
      // handler `awaitingAssistant`/`inputLocked` stay true forever and
      // every subsequent VAD utterance is silently gated at startCurrentSpeech().
      unsub.push(xyzenBus.on(XyzenVoiceStandbyHeard, () => {
        console.debug('[buddy:voice:session] standby.heard — resetting turn flags')
        awaitingAssistant = false
        speechActive = false
        inputLocked = false
        pendingListening = false
        unlockInputIfReady()
      }))
      unsub.push(xyzenBus.on(XyzenVoiceWakeDetected, () => setState('active')))

      unsub.push(xyzenBus.on(XyzenVoiceAudioStart, () => {
        console.info('[buddy:voice:session] assistant.audio.start received')
        assistantSpeaking = true
        playbackActive = true
        awaitingAssistant = true
        inputLocked = true
        pendingListening = false
        if (speechActive && client) {
          speechActive = false
          client.commitInputAudio()
        }
        decoder?.start()
        setState('speaking')
      }))

      let audioChunkCount = 0
      unsub.push(xyzenBus.on(XyzenVoiceAudioChunk, ({ pcm, sample_rate_hz }) => {
        if (!decoder) {
          console.warn('[buddy:voice:session] audio chunk but no decoder')
          return
        }
        audioChunkCount += 1
        if (audioChunkCount === 1) {
          console.info('[buddy:voice:session] first audio chunk → decoder', {
            bytes: pcm.byteLength,
            rate: sample_rate_hz,
          })
        }
        decoder.appendPcm(pcm, sample_rate_hz)
      }))

      unsub.push(xyzenBus.on(XyzenVoiceAudioEnd, () => {
        console.info('[buddy:voice:session] assistant.audio.end')
        audioChunkCount = 0
        decoder?.end()
        assistantSpeaking = false
        playbackActive = false
        awaitingAssistant = false
        speechActive = false
        lastSpeechAt = 0
        flushPendingListeningState()
        unlockInputIfReady()
      }))

      unsub.push(xyzenBus.on(XyzenVoiceInterrupted, () => {
        console.info('[buddy:voice:session] interrupted → clearing playback')
        // Flush any TTS samples still queued in the worklet so playback
        // stops immediately instead of bleeding past the interrupt.
        decoder?.clear()
        assistantSpeaking = false
        playbackActive = false
        awaitingAssistant = false
        inputLocked = false
        pendingListening = false
        unlockInputIfReady()
      }))

      unsub.push(xyzenBus.on(XyzenVoiceError, ({ message }) => {
        console.error('[buddy:voice:session] server error', message)
        errorMessage.value = message
      }))
      unsub.push(xyzenBus.on(XyzenVoiceClosed, () => {
        console.info('[buddy:voice:session] voice WS closed, stopping session')
        if (uiState.value !== 'off') void stop()
      }))

      const buddyStore = useBuddyStore()
      const activeBuddy = buddyStore.activeBuddy
      const wakeWords = collectValidWakeTerms([
        activeBuddy?.name,
        ...(activeBuddy?.nicknames ?? []),
      ])
      const useWake = hearing.wakeWordEnabled && wakeWords.length > 0
      client.startSession({
        mode: useWake ? 'standby_wake' : 'conversation',
        wakeWords: useWake ? wakeWords : undefined,
        wakeWordTimeoutMs: useWake ? hearing.wakeWordTimeout : undefined,
      })

      await mic.start()
      stopMicHandler = mic.onFrame(onFrame)

      stopVadHandler = vad.on((event) => {
        if (event === 'speech.start') {
          if (assistantSpeaking || playbackActive) {
            // Barge-in: user started speaking during assistant TTS.
            client?.interrupt()
            assistantSpeaking = false
            playbackActive = false
            inputLocked = false
          }
          startCurrentSpeech()
        }
        else {
          commitCurrentSpeech('vad_event')
        }
      })

      // Silence-commit watchdog: if VAD stays in "speech" but the last
      // observed speech frame was >1200 ms ago, close the turn.
      stopVadFrameHandler = vad.onFrame((p) => {
        if (p.isSpeech > 0.78) lastSpeechAt = Date.now()
        if (
          speechActive
          && lastSpeechAt > 0
          && Date.now() - lastSpeechAt >= 1200
        ) {
          commitCurrentSpeech('frame_silence')
        }
      })

      await vad.start()

      inputLocked = false
      setState(useWake ? 'standby' : 'listening')
      console.info('[buddy:voice:session] ready', {
        useWake,
        ctxState: options.audioContext.state,
      })
    }
    catch (err) {
      // This catch is the single path that brings down a voice session
      // that already got as far as `session.start`. Log before tearing
      // down so the actual failure (mic permission, VAD load, WS open,
      // token resolve, …) is visible in devtools.
      console.error('[buddy] voice session start failed:', err)
      errorMessage.value = err instanceof Error ? err.message : String(err)
      setState('error')
      await stop()
    }
  }

  async function stop(): Promise<void> {
    if (uiState.value === 'off') return
    speechActive = false
    assistantSpeaking = false
    awaitingAssistant = false
    playbackActive = false
    inputLocked = true
    pendingListening = false
    lastSpeechAt = 0
    prerollRing.length = 0

    for (const off of unsub) off()
    unsub.length = 0
    if (stopMicHandler) { stopMicHandler(); stopMicHandler = null }
    if (stopVadHandler) { stopVadHandler(); stopVadHandler = null }
    if (stopVadFrameHandler) { stopVadFrameHandler(); stopVadFrameHandler = null }

    const c = client
    client = null
    if (c) {
      try { c.stopSession() } catch {}
      c.close()
    }

    try { await vad.stop() } catch {}
    try { await mic.stop() } catch {}

    if (decoder) {
      try { decoder.dispose() } catch {}
      decoder = null
    }

    if (uiState.value !== 'error') setState('off')
  }

  /**
   * Called by the user toggling the FAB. Semantics:
   *  - on → off: remember the user's intent; stop and stay off even if
   *    a web session later closes.
   *  - off → on: clear user/auto-pause state; start with preempt=true so
   *    any active web voice session is closed server-side.
   */
  async function toggle(): Promise<void> {
    if (uiState.value !== 'off' && uiState.value !== 'error') {
      userDisabled.value = true
      autoPaused.value = false
      await stop()
      return
    }
    userDisabled.value = false
    autoPaused.value = false
    manualOverrideUntil = Date.now() + MANUAL_GRACE_MS
    await start({ preempt: true })
  }

  // --- Presence subscriptions (lifetime = composable, not session) ---
  //
  // Sync arrives once when the buddy WS connects. Opened/closed events
  // arrive any time the web frontend toggles its voice WS. We only act
  // on `source === 'web'` — our own presence events are echoes we don't
  // need to handle.
  presenceUnsub.push(xyzenBus.on(XyzenVoicePresenceSync, (p) => {
    if (inManualGrace()) return
    if (p.web && !userDisabled.value) {
      autoPaused.value = true
      if (uiState.value !== 'off' && uiState.value !== 'error') {
        void stop()
      }
    }
    else if (!p.web && autoPaused.value) {
      autoPaused.value = false
      if (!userDisabled.value && (uiState.value === 'off' || uiState.value === 'error')) {
        void start()
      }
    }
  }))

  presenceUnsub.push(xyzenBus.on(XyzenVoicePresenceOpened, (p) => {
    if (p.source !== 'web') return
    if (userDisabled.value) return
    if (inManualGrace()) return
    autoPaused.value = true
    if (uiState.value !== 'off' && uiState.value !== 'error') {
      void stop()
    }
  }))

  presenceUnsub.push(xyzenBus.on(XyzenVoicePresenceClosed, (p) => {
    if (p.source !== 'web') return
    if (!autoPaused.value) return
    autoPaused.value = false
    if (!userDisabled.value && (uiState.value === 'off' || uiState.value === 'error')) {
      void start()
    }
  }))

  // Active-buddy switching: wake words + topic are bound at session start,
  // so when the active buddy (or its name/nicknames) changes while a
  // session is running, tear it down and reopen so the new wake set takes
  // effect immediately. Debounced so rapid toggles don't thrash the WS.
  const buddyStoreForWatch = useBuddyStore()
  let rebindTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => {
      const b = buddyStoreForWatch.activeBuddy
      return [
        buddyStoreForWatch.activeBuddyId,
        b?.name,
        (b?.nicknames ?? []).join('|'),
      ] as const
    },
    (next, prev) => {
      if (!prev) return
      const [prevId, prevName, prevNicks] = prev
      const [nextId, nextName, nextNicks] = next
      if (prevId === nextId && prevName === nextName && prevNicks === nextNicks) return
      if (rebindTimer) clearTimeout(rebindTimer)
      rebindTimer = setTimeout(async () => {
        rebindTimer = null
        if (uiState.value === 'off' || uiState.value === 'error') return
        console.info('[buddy:voice:session] active buddy changed, rebinding session')
        await stop()
        if (!userDisabled.value && !autoPaused.value) {
          await start()
        }
      }, 200)
    },
  )

  return {
    uiState,
    errorMessage,
    isOn,
    isPaused,
    userDisabled,
    start,
    stop,
    toggle,
  }
}

export function useBuddyVoiceSession(options?: BuddyVoiceSessionOptions): ReturnType<typeof create> {
  if (!singleton) {
    if (!options) throw new Error('useBuddyVoiceSession requires options on first call.')
    singleton = create(options)
  }
  return singleton
}
