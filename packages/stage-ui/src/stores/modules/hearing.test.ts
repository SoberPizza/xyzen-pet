import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { filterTranscriptionByConfidence } from './hearing'

describe('filterTranscriptionByConfidence', () => {
  const segments = [
    { text: 'Hello ', avg_logprob: -0.3 },
    { text: 'world ', avg_logprob: -1.2 },
    { text: 'gibberish', avg_logprob: -2.5 },
  ]

  it('keeps all segments when threshold is very low', () => {
    expect(filterTranscriptionByConfidence(segments, -3)).toBe('Hello world gibberish')
  })

  it('filters out low-confidence segments', () => {
    expect(filterTranscriptionByConfidence(segments, -1)).toBe('Hello')
  })

  it('filters out all segments when threshold is 0', () => {
    expect(filterTranscriptionByConfidence(segments, 0)).toBe('')
  })

  it('returns empty string for empty segments', () => {
    expect(filterTranscriptionByConfidence([], -1)).toBe('')
  })

  it('trims whitespace from result', () => {
    expect(filterTranscriptionByConfidence([{ text: '  hello  ', avg_logprob: -0.5 }], -1)).toBe('hello')
  })
})

vi.mock('../providers', () => ({
  useProvidersStore: () => ({
    getProviderMetadata: () => ({
      capabilities: { listModels: async () => [] },
    }),
    getModelsForProvider: () => [],
    getProviderConfig: () => ({}),
    getTranscriptionFeatures: () => ({
      supportsGenerate: false,
      supportsStreamOutput: true,
      supportsStreamInput: true,
      supportsVADGatedInput: true,
    }),
    isLoadingModels: {},
    modelLoadError: {},
    allAudioTranscriptionProvidersMetadata: { value: [] },
    fetchModelsForProvider: vi.fn(),
    getProviderInstance: vi.fn(),
    disposeProviderInstance: vi.fn(),
    providerRuntimeState: {},
  }),
}))

vi.mock('../providers/sensevoice/stream-transcription', () => ({
  streamSenseVoiceTranscription: vi.fn(),
}))

vi.mock('../providers/aliyun/stream-transcription', () => ({
  streamAliyunTranscription: vi.fn(),
}))

vi.mock('../providers/web-speech-api', () => ({
  streamWebSpeechAPITranscription: vi.fn(),
}))

vi.mock('./hearing-emotion', () => ({
  useHearingEmotionStore: () => ({
    pushEmotion: vi.fn(),
  }),
}))

vi.mock('../../workers/vad/process.worklet?worker&url', () => ({
  default: '',
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

describe('hearing store defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults activeTranscriptionProvider to sensevoice-local-server', async () => {
    const { useHearingStore } = await import('./hearing')
    const store = useHearingStore()
    expect(store.activeTranscriptionProvider).toBe('sensevoice-local-server')
  })

  it('defaults activeTranscriptionModel to SenseVoiceSmall', async () => {
    const { useHearingStore } = await import('./hearing')
    const store = useHearingStore()
    expect(store.activeTranscriptionModel).toBe('SenseVoiceSmall')
  })

  it('reports configured for sensevoice-local-server', async () => {
    const { useHearingStore } = await import('./hearing')
    const store = useHearingStore()
    expect(store.configured).toBe(true)
  })
})
