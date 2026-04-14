import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('AudioContext', class {})

// Import after stubbing AudioContext since the store instantiates one at definition time
const { useAudioContext, useSpeakingStore } = await import('./audio')

function createMockAnalyser(data: number[]): AnalyserNode {
  return {
    frequencyBinCount: data.length,
    getByteFrequencyData: (buffer: Uint8Array) => {
      for (let i = 0; i < data.length; i++)
        buffer[i] = data[i]
    },
  } as unknown as AnalyserNode
}

describe('useAudioContext', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('calculateVolume', () => {
    it('returns 0 for all-zero frequency data', () => {
      const store = useAudioContext()
      const analyser = createMockAnalyser(new Array(128).fill(0))

      expect(store.calculateVolume(analyser, 'linear')).toBe(0)
    })

    it('returns 0 for all-zero frequency data in minmax mode', () => {
      const store = useAudioContext()
      const analyser = createMockAnalyser(new Array(128).fill(0))

      expect(store.calculateVolume(analyser, 'minmax')).toBe(0)
    })

    it('returns a positive value for non-zero frequency data in linear mode', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(100)
      const analyser = createMockAnalyser(data)

      const volume = store.calculateVolume(analyser, 'linear')
      expect(volume).toBeGreaterThan(0)
    })

    it('returns a positive value for varied frequency data in minmax mode', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(0).map((_, i) => i * 2)
      const analyser = createMockAnalyser(data)

      const volume = store.calculateVolume(analyser, 'minmax')
      expect(volume).toBeGreaterThan(0)
    })

    it('returns 0 in minmax mode when all values are identical (range is zero)', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(50)
      const analyser = createMockAnalyser(data)

      // When all values are the same, min === max, range === 0, so normalized values are all 0
      expect(store.calculateVolume(analyser, 'minmax')).toBe(0)
    })

    it('defaults to linear mode when mode is not specified', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(100)
      const analyser = createMockAnalyser(data)

      const defaultResult = store.calculateVolume(analyser)
      const linearResult = store.calculateVolume(analyser, 'linear')

      expect(defaultResult).toBe(linearResult)
    })

    it('linear and minmax modes produce different results for varied data', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(0).map((_, i) => i * 2)
      const analyser = createMockAnalyser(data)

      const linearVolume = store.calculateVolume(analyser, 'linear')
      const minmaxVolume = store.calculateVolume(analyser, 'minmax')

      // Both should be positive but different normalization approaches yield different values
      expect(linearVolume).toBeGreaterThan(0)
      expect(minmaxVolume).toBeGreaterThan(0)
      expect(linearVolume).not.toBe(minmaxVolume)
    })

    it('linear mode produces consistent results for same input', () => {
      const store = useAudioContext()
      const data = new Array(128).fill(100)
      const analyser1 = createMockAnalyser(data)
      const analyser2 = createMockAnalyser(data)

      const result1 = store.calculateVolume(analyser1, 'linear')
      const result2 = store.calculateVolume(analyser2, 'linear')

      expect(result1).toBe(result2)
      expect(result1).toBeGreaterThan(0)
    })
  })
})

describe('useSpeakingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has default nowSpeaking as false', () => {
    const store = useSpeakingStore()
    expect(store.nowSpeaking).toBe(false)
  })

  it('returns min opacity (30) when not speaking', () => {
    const store = useSpeakingStore()

    // When not speaking, returns nowSpeakingAvatarBorderOpacityMin directly (30)
    expect(store.nowSpeakingAvatarBorderOpacity).toBe(30)
  })

  it('computes correct opacity when speaking with mouthOpenSize 0.5', () => {
    const store = useSpeakingStore()
    store.nowSpeaking = true
    store.mouthOpenSize = 0.5

    // (30 + (100 - 30) * 0.5) / 100 = (30 + 35) / 100 = 65 / 100 = 0.65
    expect(store.nowSpeakingAvatarBorderOpacity).toBeCloseTo(0.65, 5)
  })

  it('returns max opacity (1.0) when speaking with mouthOpenSize 1', () => {
    const store = useSpeakingStore()
    store.nowSpeaking = true
    store.mouthOpenSize = 1

    // (30 + (100 - 30) * 1) / 100 = (30 + 70) / 100 = 100 / 100 = 1.0
    expect(store.nowSpeakingAvatarBorderOpacity).toBeCloseTo(1.0, 5)
  })

  it('returns 0.3 when speaking but mouthOpenSize is 0', () => {
    const store = useSpeakingStore()
    store.nowSpeaking = true
    store.mouthOpenSize = 0

    // (30 + (100 - 30) * 0) / 100 = 30 / 100 = 0.3
    expect(store.nowSpeakingAvatarBorderOpacity).toBeCloseTo(0.3, 5)
  })

  it('has default mouthOpenSize of 0', () => {
    const store = useSpeakingStore()
    expect(store.mouthOpenSize).toBe(0)
  })
})
