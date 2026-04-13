/**
 * Connects audio analyser output to orb reactive parameters.
 *
 * Provides smoothed audioLevel and speakingLevel refs
 * that can be fed into the orb behavior composable.
 */

import { ref } from 'vue'

export interface OrbAudioReactiveOptions {
  /** Smoothing factor 0-1 (higher = smoother, more lag) */
  smoothing?: number
  /** Amplification factor */
  amplification?: number
}

export function useOrbAudioReactive(options: OrbAudioReactiveOptions = {}) {
  const { smoothing = 0.7, amplification = 3 } = options

  const audioLevel = ref(0)
  const speakingLevel = ref(0)

  /**
   * Feed raw microphone RMS volume (0-1 range) each frame.
   */
  function updateAudioLevel(rawLevel: number) {
    const amplified = Math.min(1, rawLevel * amplification)
    audioLevel.value = audioLevel.value * smoothing + amplified * (1 - smoothing)
  }

  /**
   * Feed raw TTS playback volume (0-1 range) each frame.
   */
  function updateSpeakingLevel(rawLevel: number) {
    const amplified = Math.min(1, rawLevel * amplification)
    speakingLevel.value = speakingLevel.value * smoothing + amplified * (1 - smoothing)
  }

  /**
   * Reset both levels to 0 (e.g., when audio stops).
   */
  function reset() {
    audioLevel.value = 0
    speakingLevel.value = 0
  }

  return {
    audioLevel,
    speakingLevel,
    updateAudioLevel,
    updateSpeakingLevel,
    reset,
  }
}
