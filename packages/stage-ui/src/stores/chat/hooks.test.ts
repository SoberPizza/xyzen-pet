import { describe, expect, it, vi } from 'vitest'

import { createChatHooks } from './hooks'

describe('createChatHooks', () => {
  it('should return an object with hook registration methods', () => {
    const hooks = createChatHooks()
    expect(hooks).toBeDefined()
    expect(typeof hooks.onBeforeSend).toBe('function')
    expect(typeof hooks.emitBeforeSendHooks).toBe('function')
    expect(typeof hooks.clearHooks).toBe('function')
  })

  describe('register/unregister pattern', () => {
    it('should return an unsubscribe function when registering a callback', () => {
      const hooks = createChatHooks()
      const callback = vi.fn()
      const unsubscribe = hooks.onBeforeSend(callback)
      expect(typeof unsubscribe).toBe('function')
    })

    it('should call registered callback when emitting', async () => {
      const hooks = createChatHooks()
      const callback = vi.fn()
      hooks.onBeforeSend(callback)

      await hooks.emitBeforeSendHooks('hello', { session: 'test' })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('hello', { session: 'test' })
    })

    it('should not call callback after unsubscribe', async () => {
      const hooks = createChatHooks()
      const callback = vi.fn()
      const unsubscribe = hooks.onBeforeSend(callback)

      unsubscribe()

      await hooks.emitBeforeSendHooks('hello', { session: 'test' })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('emit calls callbacks in order', () => {
    it('should call multiple callbacks in registration order', async () => {
      const hooks = createChatHooks()
      const order: number[] = []

      const cb1 = vi.fn(() => { order.push(1) })
      const cb2 = vi.fn(() => { order.push(2) })
      const cb3 = vi.fn(() => { order.push(3) })

      hooks.onBeforeSend(cb1)
      hooks.onBeforeSend(cb2)
      hooks.onBeforeSend(cb3)

      await hooks.emitBeforeSendHooks('msg', {})

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
      expect(cb3).toHaveBeenCalledTimes(1)
      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('clearHooks', () => {
    it('should remove all registered callbacks', async () => {
      const hooks = createChatHooks()
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      hooks.onBeforeSend(cb1)
      hooks.onBeforeSend(cb2)

      hooks.clearHooks()

      await hooks.emitBeforeSendHooks('msg', {})

      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe removes only that callback', () => {
    it('should only remove the unsubscribed callback, leaving others intact', async () => {
      const hooks = createChatHooks()
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const cb3 = vi.fn()

      hooks.onBeforeSend(cb1)
      const unsub2 = hooks.onBeforeSend(cb2)
      hooks.onBeforeSend(cb3)

      unsub2()

      await hooks.emitBeforeSendHooks('msg', {})

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).not.toHaveBeenCalled()
      expect(cb3).toHaveBeenCalledTimes(1)
    })
  })

  describe('multiple hooks can be registered', () => {
    it('should support registering many callbacks', async () => {
      const hooks = createChatHooks()
      const callbacks = Array.from({ length: 10 }, () => vi.fn())

      for (const cb of callbacks) {
        hooks.onBeforeSend(cb)
      }

      await hooks.emitBeforeSendHooks('msg', {})

      for (const cb of callbacks) {
        expect(cb).toHaveBeenCalledTimes(1)
      }
    })
  })
})
