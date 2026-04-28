/**
 * Realtime buddy state pushed from the backend.
 *
 * `activity_update`, `state_sync`, and `text_chunk` WS events land here.
 * UI layers can `storeToRefs(useBuddyStateStore())` to reflect live state.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type BuddyActivity = 'idle' | 'thinking' | 'speaking' | 'listening'

const KNOWN_ACTIVITIES: readonly BuddyActivity[] = ['idle', 'thinking', 'speaking', 'listening']

function toActivity(raw: string): BuddyActivity {
  return (KNOWN_ACTIVITIES as readonly string[]).includes(raw) ? (raw as BuddyActivity) : 'idle'
}

const STREAMED_TEXT_CAP = 4000

export const useBuddyStateStore = defineStore('buddy-state', () => {
  const connected = ref(false)
  const activity = ref<BuddyActivity>('idle')
  const emotion = ref('neutral')
  const emotionIntensity = ref(1)
  const mood = ref(0.5)
  const energy = ref(0.5)

  /**
   * HTTP-side reachability, populated by the `XyzenHealthChecked` probe in
   * `initXyzen()`. `null` until the first probe completes; `true`/`false`
   * afterwards. Distinct from `connected`, which tracks the WebSocket.
   */
  const httpHealthy = ref<boolean | null>(null)
  const httpBaseUrl = ref<string>('')
  const httpError = ref<string | null>(null)

  /** Append-only buffer for streamed assistant text. Trimmed to cap. */
  const streamedText = ref('')

  function setConnected(value: boolean): void {
    connected.value = value
  }

  function setHttpHealth(next: { ok: boolean, baseUrl: string, error?: string }): void {
    httpHealthy.value = next.ok
    httpBaseUrl.value = next.baseUrl
    httpError.value = next.error ?? null
  }

  function setActivity(value: BuddyActivity | string): void {
    activity.value = typeof value === 'string' ? toActivity(value) : value
  }

  function setEmotion(name: string, intensity: number): void {
    emotion.value = name
    emotionIntensity.value = intensity
  }

  function syncState(patch: { emotion: string, activity: string, mood: number, energy: number }): void {
    emotion.value = patch.emotion
    activity.value = toActivity(patch.activity)
    mood.value = patch.mood
    energy.value = patch.energy
  }

  function appendText(chunk: string): void {
    const next = streamedText.value + chunk
    streamedText.value = next.length > STREAMED_TEXT_CAP
      ? next.slice(next.length - STREAMED_TEXT_CAP)
      : next
  }

  function clearText(): void {
    streamedText.value = ''
  }

  return {
    connected,
    activity,
    emotion,
    emotionIntensity,
    mood,
    energy,
    httpHealthy,
    httpBaseUrl,
    httpError,
    streamedText,
    setConnected,
    setHttpHealth,
    setActivity,
    setEmotion,
    syncState,
    appendText,
    clearText,
  }
})
