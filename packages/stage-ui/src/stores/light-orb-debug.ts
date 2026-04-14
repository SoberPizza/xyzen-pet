import type { OrbActivity, OrbEmotion } from '@proj-airi/stage-ui-three'

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLightOrbDebugStore = defineStore('light-orb-debug', () => {
  const debugEnabled = ref(false)
  const debugEmotion = ref<OrbEmotion>('neutral')
  const debugActivity = ref<OrbActivity>('idle')
  const debugMood = ref(0.3)
  const debugEnergy = ref(0.8)
  const debugAudioLevel = ref(0)
  const debugSpeakingLevel = ref(0)
  const debugCameraDistance = ref(1.4)
  const debugPepperGhost = ref(true)
  const debugEnableControls = ref(false)

  // Interaction trigger: incremented to signal the Stage to call triggerInteraction
  const interactionTrigger = ref(0)
  function triggerInteraction() {
    interactionTrigger.value++
  }

  return {
    debugEnabled,
    debugEmotion,
    debugActivity,
    debugMood,
    debugEnergy,
    debugAudioLevel,
    debugSpeakingLevel,
    debugCameraDistance,
    debugPepperGhost,
    debugEnableControls,
    interactionTrigger,
    triggerInteraction,
  }
})
