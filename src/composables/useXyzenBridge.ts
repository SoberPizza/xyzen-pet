/**
 * Wire Xyzen WS events into buddy's VRM pipeline.
 *
 * Call once from `App.vue` `onMounted`:
 *
 *   useXyzenBridge({
 *     audioContext,
 *     currentAudioSource,
 *     onEmotion: enqueueEmotion,
 *   })
 *
 * - emotion_update  → `onEmotion({ name, intensity })`  (mapped → App.vue runner)
 * - text_chunk       → appended to `buddyStateStore.streamedText`
 * - activity/state   → `buddyStateStore`
 * - connected/disc.  → `buddyStateStore.connected`
 *
 * Audio no longer flows through this bridge — assistant PCM is streamed
 * over the voice WS (`useBuddyVoiceSession`). The `audioContext` and
 * `currentAudioSource` are accepted for parity with the voice session
 * (lip-sync watches the same source ref) but the bridge itself only
 * handles emotion/activity/text events now.
 */

import type { Ref } from 'vue'

import { onBeforeUnmount } from 'vue'

import type { EmotionPayload } from '../stores/constants/emotions'

import { Emotion } from '../stores/constants/emotions'
import { useBuddyStore } from '../stores/buddy'
import { useBuddyStateStore } from '../stores/buddy-state'
import { useCeoChatStore } from '../stores/ceo-chat'
import { getLastHealth } from '../services'
import { xyzenBus } from '../services/event-bus'
import {
  XyzenActivityUpdate,
  XyzenConnected,
  XyzenDisconnected,
  XyzenEmotionUpdate,
  XyzenHealthChecked,
  XyzenReplyEnd,
  XyzenReplyStart,
  XyzenStateSync,
  XyzenTextChunk,
} from '../services/types'

// Canonical VRM 1.0 preset names — the backend normalizes dialect names
// (surprise, joy, sorrow, think, …) before publishing, so this table only
// needs the six canonical values. Anything else collapses to Neutral.
const EMOTION_ALIASES: Record<string, Emotion> = {
  happy: Emotion.Happy,
  angry: Emotion.Angry,
  sad: Emotion.Sad,
  relaxed: Emotion.Relaxed,
  surprised: Emotion.Surprised,
  neutral: Emotion.Neutral,
}

function mapEmotion(raw: string): Emotion {
  return EMOTION_ALIASES[raw.toLowerCase()] ?? Emotion.Neutral
}

export interface XyzenBridgeOptions {
  audioContext: AudioContext
  currentAudioSource: Ref<AudioNode | undefined>
  /** Push an emotion into App.vue's sequential emotion runner. */
  onEmotion: (payload: EmotionPayload) => void
}

export function useXyzenBridge(options: XyzenBridgeOptions) {
  const buddyState = useBuddyStateStore()
  const ceoChat = useCeoChatStore()
  const buddyStore = useBuddyStore()

  const unsubscribers: Array<() => void> = []

  function maybeUpdateTopic(payload: { topic_id?: string } | undefined): void {
    const tid = payload?.topic_id
    if (tid) ceoChat.setActiveTopicId(tid)
  }

  unsubscribers.push(xyzenBus.on(XyzenConnected, () => {
    buddyState.setConnected(true)
    // Backend is the source of truth for buddy rows. Every WS (re)connect
    // is an opportunity to reconcile local cache with the DB — e.g. edits
    // from another tab/device, or gender/trait changes made server-side.
    // `initialize({ force: true })` refetches the list and overwrites the
    // IndexedDB cache; the `initPromise` guard dedupes the very first
    // boot-time call from App.vue.onMounted.
    void buddyStore.initialize({ force: true }).catch((err) => {
      console.warn('[buddy] post-reconnect refresh failed', err)
    })
  }))

  unsubscribers.push(xyzenBus.on(XyzenDisconnected, () => {
    buddyState.setConnected(false)
  }))

  unsubscribers.push(xyzenBus.on(XyzenHealthChecked, (payload) => {
    buddyState.setHttpHealth(payload)
  }))

  // initXyzen() fires the first health probe before Pinia is mounted, so the
  // initial emit can land before this subscriber exists. Seed from the cache.
  const cached = getLastHealth()
  if (cached) buddyState.setHttpHealth(cached)

  unsubscribers.push(xyzenBus.on(XyzenEmotionUpdate, (payload) => {
    maybeUpdateTopic(payload)
    const name = mapEmotion(payload.emotion)
    buddyState.setEmotion(name, payload.intensity)
    options.onEmotion({ name, intensity: payload.intensity })
  }))

  unsubscribers.push(xyzenBus.on(XyzenActivityUpdate, (payload) => {
    maybeUpdateTopic(payload)
    buddyState.setActivity(payload.activity)
  }))

  unsubscribers.push(xyzenBus.on(XyzenStateSync, (patch) => {
    maybeUpdateTopic(patch)
    buddyState.syncState(patch)
    options.onEmotion({ name: mapEmotion(patch.emotion), intensity: 0.7 })
  }))

  unsubscribers.push(xyzenBus.on(XyzenTextChunk, (payload) => {
    maybeUpdateTopic(payload)
    buddyState.appendText(payload.content)
  }))

  unsubscribers.push(xyzenBus.on(XyzenReplyStart, (payload) => {
    maybeUpdateTopic(payload)
  }))

  unsubscribers.push(xyzenBus.on(XyzenReplyEnd, (payload) => {
    maybeUpdateTopic(payload)
  }))

  onBeforeUnmount(() => {
    for (const off of unsubscribers) off()
  })
}
