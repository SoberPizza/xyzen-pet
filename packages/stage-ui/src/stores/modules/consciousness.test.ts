import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../providers', () => ({
  useProvidersStore: () => ({
    getProviderMetadata: () => ({
      capabilities: { listModels: async () => [] },
    }),
    getModelsForProvider: () => [],
    isLoadingModels: {},
    modelLoadError: {},
    fetchModelsForProvider: vi.fn(),
  }),
}))

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useLocalStorageManualReset: (_key: string, defaultValue: unknown) => {
      const r = vueRef(defaultValue)
      ;(r as any).reset = () => {
        r.value = defaultValue
      }
      return r
    },
  }
})

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<any>()
  const { ref: vueRef } = await import('vue')
  return {
    ...actual,
    refManualReset: (defaultValue: unknown) => {
      const factory = typeof defaultValue === 'function' ? defaultValue : () => defaultValue
      const r = vueRef(factory())
      ;(r as any).reset = () => {
        r.value = factory()
      }
      return r
    },
  }
})

describe('consciousness store defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults activeProvider to llama-cpp-local', async () => {
    const { useConsciousnessStore } = await import('./consciousness')
    const store = useConsciousnessStore()
    expect(store.activeProvider).toBe('llama-cpp-local')
  })

  it('defaults activeModel to qwen3-1.7b', async () => {
    const { useConsciousnessStore } = await import('./consciousness')
    const store = useConsciousnessStore()
    expect(store.activeModel).toBe('qwen3-1.7b')
  })

  it('reports configured when both provider and model are set', async () => {
    const { useConsciousnessStore } = await import('./consciousness')
    const store = useConsciousnessStore()
    expect(store.configured).toBe(true)
  })

  it('reports not configured when provider is empty', async () => {
    const { useConsciousnessStore } = await import('./consciousness')
    const store = useConsciousnessStore()
    store.activeProvider = ''
    expect(store.configured).toBe(false)
  })
})
