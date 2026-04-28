/**
 * Pinia store for hearing / STT / wake-word configuration.
 *
 * Buddy's voice session reads `wakeWordEnabled` and `wakeWordTimeout`
 * here to decide between continuous conversation mode and standby_wake
 * mode. The actual wake terms come from the active buddy's name and
 * nicknames (see `buddy` store), not from this store. Other STT fields
 * are kept around for future per-provider routing but are not consumed
 * by the current backend — the Xyzen voice pipeline uses its own
 * DashScope qwen3-asr-flash transcriber.
 */

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

const CONFIDENCE_THRESHOLD_DISABLED = -3

export const useHearingStore = defineStore('hearing-store', () => {
  const activeTranscriptionProvider = useLocalStorage('settings/hearing/active-provider', 'xyzen-backend')
  const activeTranscriptionModel = useLocalStorage('settings/hearing/active-model', '')
  const autoSendEnabled = useLocalStorage<boolean>('settings/hearing/auto-send-enabled', false)
  const autoSendDelay = useLocalStorage<number>('settings/hearing/auto-send-delay', 2000)
  const confidenceThreshold = useLocalStorage<number>('settings/hearing/confidence-threshold', CONFIDENCE_THRESHOLD_DISABLED)

  // Wake word configuration. When `wakeWordEnabled` is true AND the
  // active buddy has at least one valid name/nickname term, the voice
  // session opens in `standby_wake` mode. `wakeWordTimeout` (ms) is the
  // post-wake follow-up window during which turns skip re-matching.
  const wakeWordEnabled = useLocalStorage('hearing-wake-word-enabled', true)
  const wakeWordTimeout = useLocalStorage('hearing-wake-word-timeout', 10000)

  // TTS playback volume (0..1). Applied via a GainNode between the
  // voice-playback worklet and the audio destination; lip-sync reads
  // the pre-gain worklet `volume`, so visemes survive muted playback.
  const playbackVolume = useLocalStorage<number>('settings/voice/playback-volume', 1)

  const configured = computed(() => {
    return !!activeTranscriptionProvider.value
  })

  function resetState() {
    activeTranscriptionProvider.value = 'xyzen-backend'
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
