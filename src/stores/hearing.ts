/**
 * Pinia store for hearing / STT / wake-word configuration.
 *
 * Buddy's voice session reads `wakeWordEnabled` and `wakeWordTimeout` here
 * to decide between conversation and standby_wake modes. Persistence moved
 * from `useLocalStorage` to the Rust settings store so the values sync
 * across windows and survive a clean-install.
 */

import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useIpcSetting } from '../ipc/client'

const CONFIDENCE_THRESHOLD_DISABLED = -3

export const useHearingStore = defineStore('hearing-store', () => {
  // STT fields are kept for future per-provider routing; unused by the
  // current (to-be-rebuilt) voice pipeline.
  const activeTranscriptionProvider = useIpcSetting<string>('settings/hearing/active-provider', 'none')
  const activeTranscriptionModel = useIpcSetting<string>('settings/hearing/active-model', '')
  const autoSendEnabled = useIpcSetting<boolean>('settings/hearing/auto-send-enabled', false)
  const autoSendDelay = useIpcSetting<number>('settings/hearing/auto-send-delay', 2000)
  const confidenceThreshold = useIpcSetting<number>('settings/hearing/confidence-threshold', CONFIDENCE_THRESHOLD_DISABLED)

  // Wake word configuration. `wakeWordTimeout` is the post-wake follow-up
  // window during which turns skip re-matching.
  const wakeWordEnabled = useIpcSetting<boolean>('settings/hearing/wake-word-enabled', true)
  const wakeWordTimeout = useIpcSetting<number>('settings/hearing/wake-word-timeout', 10000)

  // TTS playback volume (0..1). Applied via a GainNode between the
  // voice-playback worklet and the audio destination; lip-sync reads
  // the pre-gain worklet `volume`, so visemes survive muted playback.
  const playbackVolume = useIpcSetting<number>('settings/voice/playback-volume', 1)

  const configured = computed(() => {
    return !!activeTranscriptionProvider.value
  })

  function resetState() {
    activeTranscriptionProvider.value = 'none'
    activeTranscriptionModel.value = ''
    autoSendEnabled.value = false
    autoSendDelay.value = 2000
    confidenceThreshold.value = CONFIDENCE_THRESHOLD_DISABLED
  }

  return {
    activeTranscriptionProvider,
    activeTranscriptionModel,
    autoSendEnabled,
    autoSendDelay,
    confidenceThreshold,
    wakeWordEnabled,
    wakeWordTimeout,
    playbackVolume,
    configured,
    resetState,
  }
})
