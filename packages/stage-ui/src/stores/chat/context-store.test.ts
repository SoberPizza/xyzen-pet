import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@proj-airi/server-sdk', () => ({
  ContextUpdateStrategy: {
    ReplaceSelf: 'replace-self',
    AppendSelf: 'append-self',
  },
}))

vi.mock('../../utils/event-source', () => ({
  getEventSourceKey: (event: { source?: string }) => event.source ?? 'unknown',
}))

// Import after mocks are set up
const { useChatContextStore } = await import('./context-store')

function makeMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    contextId: 'ctx-1',
    strategy: 'replace-self' as const,
    text: 'hello',
    createdAt: Date.now(),
    source: 'test-source',
    ...overrides,
  }
}

describe('useChatContextStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('ingestContextMessage', () => {
    it('creates a new bucket and replaces with ReplaceSelf strategy', () => {
      const store = useChatContextStore()

      const result = store.ingestContextMessage(makeMsg({
        strategy: 'replace-self',
        text: 'first message',
      }))

      expect(result).toBeDefined()
      expect(result!.sourceKey).toBe('test-source')
      expect(result!.mutation).toBe('replace')
      expect(result!.entryCount).toBe(1)
    })

    it('replaces existing messages for the same source with ReplaceSelf', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({
        id: 'msg-1',
        strategy: 'replace-self',
        text: 'first',
      }))

      store.ingestContextMessage(makeMsg({
        id: 'msg-2',
        strategy: 'replace-self',
        text: 'second',
      }))

      // ReplaceSelf should replace, so only the latest message remains
      expect(store.activeContexts['test-source']).toHaveLength(1)
      expect(store.activeContexts['test-source'][0].text).toBe('second')
    })

    it('appends messages for the same source with AppendSelf strategy', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({
        id: 'msg-1',
        strategy: 'append-self',
        text: 'first',
      }))

      const result = store.ingestContextMessage(makeMsg({
        id: 'msg-2',
        strategy: 'append-self',
        text: 'second',
      }))

      expect(result).toBeDefined()
      expect(result!.mutation).toBe('append')
      expect(result!.entryCount).toBe(2)
      expect(store.activeContexts['test-source']).toHaveLength(2)
    })

    it('tracks separate buckets for different sources', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({
        source: 'source-a',
        strategy: 'append-self',
        text: 'from a',
      }))

      store.ingestContextMessage(makeMsg({
        source: 'source-b',
        strategy: 'append-self',
        text: 'from b',
      }))

      expect(store.activeContexts['source-a']).toHaveLength(1)
      expect(store.activeContexts['source-b']).toHaveLength(1)
    })

    it('appends to context history on each ingest', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({ id: 'msg-1', text: 'first' }))
      store.ingestContextMessage(makeMsg({ id: 'msg-2', text: 'second' }))

      expect(store.contextHistory).toHaveLength(2)
      expect(store.contextHistory[0].sourceKey).toBe('test-source')
      expect(store.contextHistory[1].sourceKey).toBe('test-source')
    })

    it('caps context history at 400 entries', () => {
      const store = useChatContextStore()

      for (let i = 0; i < 450; i++) {
        store.ingestContextMessage(makeMsg({
          id: `msg-${i}`,
          strategy: 'append-self',
          text: `message ${i}`,
        }))
      }

      expect(store.contextHistory).toHaveLength(400)
      // The earliest entries should have been trimmed; the last entry should be from the final ingest
      expect(store.contextHistory[399].text).toBe('message 449')
    })

    it('returns undefined for an unrecognized strategy', () => {
      const store = useChatContextStore()

      const result = store.ingestContextMessage(makeMsg({
        strategy: 'unknown-strategy',
      }))

      // Neither ReplaceSelf nor AppendSelf matched, so result is undefined
      expect(result).toBeUndefined()
    })
  })

  describe('resetContexts', () => {
    it('clears all active contexts and history', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({ text: 'some data' }))
      expect(Object.keys(store.activeContexts).length).toBeGreaterThan(0)
      expect(store.contextHistory.length).toBeGreaterThan(0)

      store.resetContexts()

      expect(Object.keys(store.activeContexts)).toHaveLength(0)
      expect(store.contextHistory).toHaveLength(0)
    })
  })

  describe('getContextsSnapshot', () => {
    it('returns a clone of the active contexts', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({ text: 'snapshot test' }))

      const snapshot = store.getContextsSnapshot()

      expect(snapshot['test-source']).toBeDefined()
      expect(snapshot['test-source']).toHaveLength(1)
      expect(snapshot['test-source'][0].text).toBe('snapshot test')

      // Modifying the snapshot should not affect the store
      snapshot['test-source'][0].text = 'mutated'
      expect(store.activeContexts['test-source'][0].text).toBe('snapshot test')
    })

    it('returns an empty object when no contexts exist', () => {
      const store = useChatContextStore()
      const snapshot = store.getContextsSnapshot()

      expect(snapshot).toEqual({})
    })
  })

  describe('getContextBucketsSnapshot', () => {
    it('returns an array of bucket snapshots with correct shape', () => {
      const store = useChatContextStore()
      const now = Date.now()

      store.ingestContextMessage(makeMsg({
        id: 'msg-1',
        strategy: 'append-self',
        text: 'first',
        createdAt: now - 1000,
      }))

      store.ingestContextMessage(makeMsg({
        id: 'msg-2',
        strategy: 'append-self',
        text: 'second',
        createdAt: now,
      }))

      const buckets = store.getContextBucketsSnapshot()

      expect(buckets).toHaveLength(1)
      expect(buckets[0].sourceKey).toBe('test-source')
      expect(buckets[0].entryCount).toBe(2)
      expect(buckets[0].latestCreatedAt).toBe(now)
      expect(buckets[0].messages).toHaveLength(2)
    })

    it('returns multiple buckets for different sources', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({ source: 'alpha', text: 'a' }))
      store.ingestContextMessage(makeMsg({ source: 'beta', text: 'b' }))

      const buckets = store.getContextBucketsSnapshot()

      expect(buckets).toHaveLength(2)
      const sourceKeys = buckets.map(b => b.sourceKey).sort()
      expect(sourceKeys).toEqual(['alpha', 'beta'])
    })

    it('returns cloned messages that do not affect the store', () => {
      const store = useChatContextStore()

      store.ingestContextMessage(makeMsg({ text: 'original' }))

      const buckets = store.getContextBucketsSnapshot()
      buckets[0].messages[0].text = 'tampered'

      expect(store.activeContexts['test-source'][0].text).toBe('original')
    })

    it('returns an empty array when no contexts exist', () => {
      const store = useChatContextStore()
      const buckets = store.getContextBucketsSnapshot()

      expect(buckets).toEqual([])
    })
  })
})
