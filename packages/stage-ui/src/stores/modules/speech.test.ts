import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toSignedPercent } from './speech'

describe('speech store helpers', () => {
  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })
})

vi.mock('../providers', () => ({
  useProvidersStore: () => ({
    getProviderMetadata: () => ({
      capabilities: {
        listModels: async () => [],
        listVoices: async () => [],
      },
    }),
    getModelsForProvider: () => [],
    getProviderConfig: () => ({}),
    isLoadingModels: {},
    modelLoadError: {},
    allAudioSpeechProvidersMetadata: { value: [] },
    configuredSpeechProvidersMetadata: [],
    providerRuntimeState: {},
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

describe('speech store defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults activeSpeechProvider to cosyvoice-local-server', async () => {
    const { useSpeechStore } = await import('./speech')
    const store = useSpeechStore()
    expect(store.activeSpeechProvider).toBe('cosyvoice-local-server')
  })

  it('defaults activeSpeechModel to CosyVoice-300M-SFT', async () => {
    const { useSpeechStore } = await import('./speech')
    const store = useSpeechStore()
    expect(store.activeSpeechModel).toBe('CosyVoice-300M-SFT')
  })

  it('fallback sets provider to cosyvoice-local-server when provider is empty', async () => {
    const { useSpeechStore } = await import('./speech')
    const store = useSpeechStore()
    store.activeSpeechProvider = ''
    if (!store.activeSpeechProvider) {
      store.activeSpeechProvider = 'cosyvoice-local-server'
    }
    expect(store.activeSpeechProvider).toBe('cosyvoice-local-server')
  })
})
