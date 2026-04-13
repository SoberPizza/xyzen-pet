import type { EmotionPayload } from '../../constants/emotions'

import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Shared store for STT-detected emotions.
 *
 * Providers that support emotion recognition (e.g. SenseVoice) push emotion payloads here.
 * The Stage scene reads from this store to drive VRM/Live2D expressions without
 * injecting emotion data into the LLM context.
 */
export const useHearingEmotionStore = defineStore('modules:hearing:emotion', () => {
  const latestEmotion = ref<EmotionPayload | null>(null)
  const listeners = new Set<(emotion: EmotionPayload) => void>()

  function pushEmotion(emotion: EmotionPayload) {
    latestEmotion.value = emotion
    for (const listener of listeners)
      listener(emotion)
  }

  function onEmotion(callback: (emotion: EmotionPayload) => void) {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  return {
    latestEmotion,
    pushEmotion,
    onEmotion,
  }
})
