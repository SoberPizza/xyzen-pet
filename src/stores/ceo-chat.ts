/**
 * Pinia store backing text I/O with the CEO agent.
 *
 * Buddy is the visual avatar of the CEO agent — every message posted here
 * lands on the same session/topic the Xyzen web UI subscribes to, so replies
 * stream into the CEO chat surface in real time.
 *
 * Buddy runs standalone and owns its own active-topic state. At boot it
 * binds to today's "Buddy" topic via the backend's atomic get-or-create
 * endpoint (one topic per user per local day). The topic id is persisted to
 * localStorage so reloads resume the same topic; a `storage` listener keeps
 * multi-tab instances in sync, and WS events carrying `topic_id` rebind the
 * store when the user switches topic from the main Xyzen UI.
 *
 * Reply lifecycle is WS-driven: the backend emits `reply_end` at the close
 * of every agent turn, which commits the streamed text. An activity→idle
 * watcher remains as a belt for older servers and for turns originated by
 * the web UI (where `sending` is false locally).
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { initXyzen } from '../services'
import {
  fetchRootAgentId,
  getOrCreateRecentTopic,
  resolveAgentSession,
  sendCeoMessage,
} from '../services/ceo-chat'
import { xyzenBus } from '../services/event-bus'
import { HttpError } from '../services/http'
import { XyzenReplyEnd } from '../services/types'
import { resolveTraitPrompts } from './constants/trait-prompts'
import { useBuddyStateStore } from './buddy-state'
import { useBuddyStore } from './buddy'

const ACTIVE_CEO_TOPIC_KEY_PREFIX = 'xyzen/active-ceo-topic'

function topicNameForBuddy(buddyName: string): string {
  const trimmed = buddyName.trim()
  return trimmed ? `Buddy ${trimmed}` : 'Buddy'
}

function storageKeyForBuddy(buddyId: string): string {
  return `${ACTIVE_CEO_TOPIC_KEY_PREFIX}:${buddyId}`
}

function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

export const useCeoChatStore = defineStore('ceo-chat', () => {
  const buddyState = useBuddyStateStore()
  const buddyStore = useBuddyStore()

  const sessionId = ref<string | null>(null)
  const topicId = ref<string | null>(null)
  const boundBuddyId = ref<string | null>(null)
  const lastUserMessage = ref('')
  const lastUserMessageId = ref<string | null>(null)
  const lastReply = ref('')
  const sending = ref(false)
  const error = ref<string | null>(null)
  const initialized = ref(false)
  let initPromise: Promise<void> | null = null
  let rebindPromise: Promise<void> | null = null

  let storageHandler: ((ev: StorageEvent) => void) | null = null

  /** Commit whatever the WS bridge has streamed so far as the canonical reply. */
  function commitStreamedReply(): string {
    const streamed = buddyState.streamedText
    if (streamed.length === 0) return ''
    lastReply.value = streamed
    buddyState.clearText()
    return streamed
  }

  function finishStream(): void {
    if (!sending.value) return
    commitStreamedReply()
    sending.value = false
  }

  // Primary signal: backend emits `reply_end` at the close of every agent turn.
  xyzenBus.on(XyzenReplyEnd, () => {
    if (sending.value) finishStream()
    else commitStreamedReply()
  })

  // Belt: activity → idle transitions also commit streamed text, covering
  // replies to web-UI-originated user messages (where `sending` is false) and
  // older servers that haven't shipped reply_end yet.
  watch(
    () => buddyState.activity,
    (next, prev) => {
      if (next !== 'idle' || prev === 'idle') return
      if (sending.value) {
        if (buddyState.streamedText.length > 0) finishStream()
        return
      }
      commitStreamedReply()
    },
  )

  function writeActiveTopic(tid: string): void {
    if (typeof localStorage === 'undefined') return
    const buddyId = boundBuddyId.value
    if (!buddyId) return
    try {
      localStorage.setItem(storageKeyForBuddy(buddyId), tid)
    } catch {
      // no-op: Safari private mode etc.
    }
  }

  function handleActiveTopicChanged(nextTopicId: string): void {
    if (nextTopicId === topicId.value) {
      console.info('[ceo-chat] active topic unchanged:', nextTopicId)
      return
    }
    console.info('[ceo-chat] active topic changed:', topicId.value, '->', nextTopicId)
    sending.value = false
    error.value = null
    lastUserMessage.value = ''
    lastUserMessageId.value = null
    lastReply.value = ''
    buddyState.clearText()
    topicId.value = nextTopicId
  }

  /**
   * Idempotent setter for the active topic id. Called by the WS bridge when an
   * incoming event carries a `topic_id` field — e.g. the user started a new
   * topic from the main Xyzen UI and Buddy should follow it without requiring
   * a page reload.
   */
  function setActiveTopicId(nextTopicId: string): void {
    if (!nextTopicId || nextTopicId === topicId.value) return
    writeActiveTopic(nextTopicId)
    handleActiveTopicChanged(nextTopicId)
  }

  function registerActiveTopicListener(): void {
    if (typeof window === 'undefined' || storageHandler) return
    storageHandler = (ev: StorageEvent) => {
      const buddyId = boundBuddyId.value
      if (!buddyId) return
      if (ev.key !== storageKeyForBuddy(buddyId)) return
      const next = ev.newValue
      if (!next) return
      handleActiveTopicChanged(next)
    }
    window.addEventListener('storage', storageHandler)
  }

  async function bindTopicForActiveBuddy(): Promise<void> {
    const buddy = buddyStore.activeBuddy
    const buddyId = buddyStore.activeBuddyId
    if (!buddyId || !buddy) {
      // No active buddy yet — wait for the buddy store to initialize.
      boundBuddyId.value = null
      topicId.value = null
      return
    }
    const sid = sessionId.value
    if (!sid) throw new Error('CEO session not initialized')

    const topic = await getOrCreateRecentTopic(
      (await initXyzen()).http,
      sid,
      topicNameForBuddy(buddy.name),
      startOfToday(),
    )
    // Reset transient turn state so a stale reply from the previous buddy
    // can't leak into the newly bound topic.
    sending.value = false
    error.value = null
    lastUserMessage.value = ''
    lastUserMessageId.value = null
    lastReply.value = ''
    buddyState.clearText()

    boundBuddyId.value = buddyId
    topicId.value = topic.id
    writeActiveTopic(topic.id)
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      const { http } = await initXyzen()
      const rootAgentId = await fetchRootAgentId(http)
      const session = await resolveAgentSession(http, rootAgentId)
      sessionId.value = session.id

      await bindTopicForActiveBuddy()
      registerActiveTopicListener()
      initialized.value = true
    })().catch((err) => {
      initPromise = null
      throw err
    })
    return initPromise
  }

  // Rebind whenever the active buddy changes. Debounced implicitly by the
  // serial awaited rebindPromise so overlapping activations queue cleanly.
  watch(
    () => buddyStore.activeBuddyId,
    (nextId, prevId) => {
      if (!nextId || nextId === prevId) return
      if (!initialized.value) return
      rebindPromise = (async () => {
        try {
          if (rebindPromise) await rebindPromise
          await bindTopicForActiveBuddy()
        } catch (err) {
          console.warn('[ceo-chat] failed to rebind topic on buddy switch', err)
        }
      })()
    },
  )

  async function ensureTopic(): Promise<string> {
    if (!initialized.value) await initialize()
    const tid = topicId.value
    if (!tid) throw new Error('Buddy has no active CEO topic.')
    console.info('[ceo-chat] ensureTopic ->', tid)
    return tid
  }

  async function send(message: string): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed || sending.value) return

    error.value = null
    lastReply.value = ''
    lastUserMessage.value = trimmed
    lastUserMessageId.value = null
    buddyState.clearText()
    sending.value = true

    try {
      const tid = await ensureTopic()
      const { http } = await initXyzen()
      const b = buddyStore.activeBuddy
      const buddyContext = b
        ? {
            description: b.race?.description ?? null,
            traits: resolveTraitPrompts(
              [
                b.categoryTraitCode,
                b.attributeTraitCode,
                b.raceTraitCode,
                ...b.genericTraitCodes,
              ].filter((c): c is string => Boolean(c)),
            ),
          }
        : undefined
      if (!b) {
        console.warn('[buddy:prompt] no active buddy — sending with voice-rules-only prompt')
      }
      console.info('[buddy:prompt] send context', {
        buddyId: buddyStore.activeBuddyId || null,
        descriptionChars: buddyContext?.description?.length ?? 0,
        traitCount: buddyContext?.traits.length ?? 0,
      })
      const res = await sendCeoMessage(http, tid, trimmed, buddyContext)
      lastUserMessageId.value = res.messageId
    } catch (err) {
      sending.value = false
      error.value = err instanceof HttpError
        ? `${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Failed to send message.'
    }
  }

  function reset(): void {
    sending.value = false
    error.value = null
    lastUserMessage.value = ''
    lastUserMessageId.value = null
    lastReply.value = ''
    buddyState.clearText()
  }

  return {
    sessionId,
    topicId,
    lastUserMessage,
    lastReply,
    sending,
    error,
    initialized,
    initialize,
    send,
    ensureTopic,
    setActiveTopicId,
    reset,
  }
})
