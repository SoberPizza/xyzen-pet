import type { OrbActivity, OrbEmotion } from '@proj-airi/stage-ui-three'

import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// Serializable snapshot of all debug state for cross-window sync
interface DebugSnapshot {
  debugEnabled: boolean
  debugEmotion: OrbEmotion
  debugActivity: OrbActivity
  debugMood: number
  debugEnergy: number
  debugAudioLevel: number
  debugSpeakingLevel: number
  debugCameraDistance: number
  debugPepperGhost: boolean
  debugEnableControls: boolean
  interactionTrigger: number
}

export const useLightOrbDebugStore = defineStore('light-orb-debug', () => {
  const debugEnabled = ref(false)
  const debugEmotion = ref<OrbEmotion>('neutral')
  const debugActivity = ref<OrbActivity>('idle')
  const debugMood = ref(0.3)
  const debugEnergy = ref(0.8)
  const debugAudioLevel = ref(0)
  const debugSpeakingLevel = ref(0)
  const debugCameraDistance = ref(0.5)
  const debugPepperGhost = ref(true)
  const debugEnableControls = ref(false)

  // Interaction trigger: incremented to signal the Stage to call triggerInteraction
  const interactionTrigger = ref(0)
  function triggerInteraction() {
    interactionTrigger.value++
  }

  // Cross-window sync via BroadcastChannel (settings window ↔ main window)
  const { post, data } = useBroadcastChannel<DebugSnapshot, DebugSnapshot>({ name: 'airi-light-orb-debug' })

  let broadcasting = false

  function snapshot(): DebugSnapshot {
    return {
      debugEnabled: debugEnabled.value,
      debugEmotion: debugEmotion.value,
      debugActivity: debugActivity.value,
      debugMood: debugMood.value,
      debugEnergy: debugEnergy.value,
      debugAudioLevel: debugAudioLevel.value,
      debugSpeakingLevel: debugSpeakingLevel.value,
      debugCameraDistance: debugCameraDistance.value,
      debugPepperGhost: debugPepperGhost.value,
      debugEnableControls: debugEnableControls.value,
      interactionTrigger: interactionTrigger.value,
    }
  }

  // Broadcast local changes to other windows
  watch(
    () => snapshot(),
    (snap) => {
      if (!broadcasting)
        post(snap)
    },
    { deep: true },
  )

  // Receive changes from other windows
  watch(data, (snap) => {
    if (!snap)
      return
    broadcasting = true
    debugEnabled.value = snap.debugEnabled
    debugEmotion.value = snap.debugEmotion
    debugActivity.value = snap.debugActivity
    debugMood.value = snap.debugMood
    debugEnergy.value = snap.debugEnergy
    debugAudioLevel.value = snap.debugAudioLevel
    debugSpeakingLevel.value = snap.debugSpeakingLevel
    debugCameraDistance.value = snap.debugCameraDistance
    debugPepperGhost.value = snap.debugPepperGhost
    debugEnableControls.value = snap.debugEnableControls
    interactionTrigger.value = snap.interactionTrigger
    broadcasting = false
  })

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
