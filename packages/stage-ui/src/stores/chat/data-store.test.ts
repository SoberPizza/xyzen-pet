import { describe, expect, it } from 'vitest'

import { createChatDataStore } from './data-store'

interface ChatHistoryItem {
  role: string
  content: string
}

function createMockAccess() {
  let activeSessionId = 'default'
  let sessions: Record<string, ChatHistoryItem[]> = {}
  let generations: Record<string, number> = {}

  return {
    getActiveSessionId: () => activeSessionId,
    setActiveSessionId: (id: string) => { activeSessionId = id },
    getSessions: () => sessions,
    setSessions: (s: Record<string, ChatHistoryItem[]>) => { sessions = s },
    getGenerations: () => generations,
    setGenerations: (g: Record<string, number>) => { generations = g },
  }
}

const mkSys = () => ({ role: 'system', content: 'test system' }) as any

describe('createChatDataStore', () => {
  describe('ensureSession', () => {
    it('should create a session with initial message if missing', () => {
      const access = createMockAccess()
      const store = createChatDataStore(access)

      store.ensureSession('session-1', mkSys)

      const messages = store.getSessionMessages('session-1', mkSys)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({ role: 'system', content: 'test system' })
    })

    it('should not overwrite existing session', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [{ role: 'user', content: 'existing' }],
      })
      const store = createChatDataStore(access)

      store.ensureSession('session-1', mkSys)

      const messages = store.getSessionMessages('session-1', mkSys)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({ role: 'user', content: 'existing' })
    })
  })

  describe('getSessionMessages', () => {
    it('should return messages for a session', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hello' },
        ],
      })
      const store = createChatDataStore(access)

      const messages = store.getSessionMessages('session-1', mkSys)
      expect(messages).toHaveLength(2)
      expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
    })

    it('should create session with initial message for non-existent session', () => {
      const access = createMockAccess()
      const store = createChatDataStore(access)

      const messages = store.getSessionMessages('non-existent', mkSys)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({ role: 'system', content: 'test system' })
    })
  })

  describe('setSessionMessages', () => {
    it('should replace messages in a session', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [{ role: 'system', content: 'old' }],
      })
      const store = createChatDataStore(access)

      store.setSessionMessages('session-1', [
        { role: 'system', content: 'new' },
        { role: 'user', content: 'hi' },
      ] as any)

      const messages = store.getSessionMessages('session-1', mkSys)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({ role: 'system', content: 'new' })
    })
  })

  describe('setActiveSession', () => {
    it('should set the active session ID', () => {
      const access = createMockAccess()
      const store = createChatDataStore(access)

      store.setActiveSession('session-2', mkSys)

      expect(access.getActiveSessionId()).toBe('session-2')
    })
  })

  describe('resetSession', () => {
    it('should bump generation and replace messages', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [{ role: 'user', content: 'old msg' }],
      })
      access.setGenerations({ 'session-1': 1 })
      const store = createChatDataStore(access)

      store.resetSession('session-1', mkSys)

      const messages = store.getSessionMessages('session-1', mkSys)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({ role: 'system', content: 'test system' })
      expect(store.getSessionGeneration('session-1')).toBeGreaterThan(1)
    })
  })

  describe('refreshSystemMessages', () => {
    it('should replace the first system message in all sessions', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [
          { role: 'system', content: 'old system' },
          { role: 'user', content: 'hello' },
        ],
        'session-2': [
          { role: 'system', content: 'old system 2' },
          { role: 'assistant', content: 'hi' },
        ],
      })
      const store = createChatDataStore(access)

      const newSys = () => ({ role: 'system', content: 'new system' }) as any
      store.refreshSystemMessages(newSys)

      const s1 = store.getSessionMessages('session-1', newSys)
      const s2 = store.getSessionMessages('session-2', newSys)
      expect(s1[0]).toEqual({ role: 'system', content: 'new system' })
      expect(s1[1]).toEqual({ role: 'user', content: 'hello' })
      expect(s2[0]).toEqual({ role: 'system', content: 'new system' })
      expect(s2[1]).toEqual({ role: 'assistant', content: 'hi' })
    })
  })

  describe('replaceSessions', () => {
    it('should replace all sessions and reset generations', () => {
      const access = createMockAccess()
      access.setSessions({
        old: [{ role: 'user', content: 'old' }],
      })
      access.setGenerations({ old: 5 })
      const store = createChatDataStore(access)

      store.replaceSessions({
        new1: [{ role: 'system', content: 'fresh' }],
      } as any, mkSys)

      const sessions = store.getAllSessions()
      expect(sessions.new1).toHaveLength(1)
      expect(store.getSessionGeneration('new1')).toBe(0)
    })
  })

  describe('resetAllSessions', () => {
    it('should clear everything and create a default session', () => {
      const access = createMockAccess()
      access.setSessions({
        'session-1': [{ role: 'user', content: 'data' }],
        'session-2': [{ role: 'user', content: 'data2' }],
      })
      access.setGenerations({ 'session-1': 3, 'session-2': 2 })
      const store = createChatDataStore(access)

      store.resetAllSessions(mkSys)

      const sessions = store.getAllSessions()
      const keys = Object.keys(sessions)
      expect(keys).toContain('default')
      expect(sessions.default).toHaveLength(1)
      expect(sessions.default[0]).toEqual({ role: 'system', content: 'test system' })
    })
  })

  describe('getSessionGeneration / bumpSessionGeneration', () => {
    it('should return 0 for unknown session', () => {
      const access = createMockAccess()
      const store = createChatDataStore(access)

      expect(store.getSessionGeneration('unknown')).toBe(0)
    })

    it('should increment generation on bump', () => {
      const access = createMockAccess()
      const store = createChatDataStore(access)

      store.bumpSessionGeneration('session-1')
      expect(store.getSessionGeneration('session-1')).toBe(1)

      store.bumpSessionGeneration('session-1')
      expect(store.getSessionGeneration('session-1')).toBe(2)
    })
  })

  describe('getAllSessions', () => {
    it('should return a deep clone of sessions', () => {
      const access = createMockAccess()
      access.setSessions({
        s1: [{ role: 'user', content: 'msg' }],
      })
      const store = createChatDataStore(access)

      const clone = store.getAllSessions()
      clone.s1[0].content = 'mutated'

      const original = store.getSessionMessages('s1', mkSys)
      expect(original[0].content).toBe('msg')
    })
  })
})
