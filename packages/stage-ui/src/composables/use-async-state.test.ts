import { describe, expect, it, vi } from 'vitest'

import { useAsyncState } from './use-async-state'

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('useAsyncState', () => {
  describe('initial state', () => {
    it('should have undefined state, isLoading false, and error null', () => {
      const { state, isLoading, error } = useAsyncState(async () => 'result')

      expect(state.value).toBeUndefined()
      expect(isLoading.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('execute', () => {
    it('should set isLoading true during execution then false after', async () => {
      let resolvePromise: (v: string) => void
      const fn = vi.fn(() => new Promise<string>((resolve) => {
        resolvePromise = resolve
      }))

      const { isLoading, execute } = useAsyncState(fn)

      const promise = execute()
      expect(isLoading.value).toBe(true)

      resolvePromise!('done')
      await promise

      expect(isLoading.value).toBe(false)
    })

    it('should set state to the result on success', async () => {
      const { state, execute } = useAsyncState(async () => 42)

      await execute()

      expect(state.value).toBe(42)
    })

    it('should set error on failure', async () => {
      const testError = new Error('test failure')
      const { error, execute } = useAsyncState(async () => {
        throw testError
      })

      await execute()

      expect(error.value).toBe(testError)
    })

    it('should reset error on subsequent successful execution', async () => {
      let shouldFail = true
      const fn = vi.fn(async () => {
        if (shouldFail) {
          throw new Error('fail')
        }
        return 'success'
      })

      const { state, error, execute } = useAsyncState(fn)

      await execute()
      expect(error.value).toBeInstanceOf(Error)

      shouldFail = false
      await execute()
      expect(error.value).toBeNull()
      expect(state.value).toBe('success')
    })
  })

  describe('immediate option', () => {
    it('should trigger execute on creation when immediate is true', async () => {
      const fn = vi.fn(async () => 'immediate-result')

      const { state } = useAsyncState(fn, { immediate: true })

      await flushPromises()

      expect(fn).toHaveBeenCalledTimes(1)
      expect(state.value).toBe('immediate-result')
    })

    it('should not trigger execute on creation when immediate is not set', () => {
      const fn = vi.fn(async () => 'result')

      useAsyncState(fn)

      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('multiple executions', () => {
    it('should reset error between executions', async () => {
      let callCount = 0
      const fn = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('first call fails')
        }
        return `call-${callCount}`
      })

      const { state, error, execute } = useAsyncState(fn)

      await execute()
      expect(error.value).toBeInstanceOf(Error)
      expect(state.value).toBeUndefined()

      await execute()
      expect(error.value).toBeNull()
      expect(state.value).toBe('call-2')
    })
  })
})
