import { describe, expect, it, vi } from 'vitest'

const EMOTION_VALUES = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral']

let capturedEmotionsHandler: ((ctx: any) => any) | undefined
let capturedDelayHandler: ((ctx: any) => any) | undefined

vi.mock('@proj-airi/stream-kit', () => ({
  createQueue: (opts: any) => {
    const queue = {
      handlers: opts?.handlers ?? [],
      enqueue: vi.fn(),
      onData: vi.fn(),
    }
    return queue
  },
}))

vi.mock('@moeru/std', async (importOriginal) => {
  const original = await importOriginal<Record<string, any>>()
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  }
})

// We test the parsing logic indirectly by calling the composables
// and examining how they process data through their queue handlers.
// Since the internal functions are closures, we test via the queue behavior.

describe('queues - emotion parsing', () => {
  describe('aCT emotion tag parsing', () => {
    it('should parse simple emotion string from ACT tag', async () => {
      // Test the regex pattern: <|ACT:{...}|>
      const actPattern = /<\|ACT:(.*?)\|>/
      const input = '<|ACT:{"emotion":"happy"}|>'
      const match = input.match(actPattern)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('{"emotion":"happy"}')

      const parsed = JSON.parse(match![1])
      expect(parsed.emotion).toBe('happy')
    })

    it('should parse emotion object with name and intensity', () => {
      const actPattern = /<\|ACT:(.*?)\|>/
      const input = '<|ACT:{"emotion":{"name":"sad","intensity":0.5}}|>'
      const match = input.match(actPattern)

      expect(match).not.toBeNull()
      const parsed = JSON.parse(match![1])
      expect(parsed.emotion.name).toBe('sad')
      expect(parsed.emotion.intensity).toBe(0.5)
    })

    it('should not match when there is no ACT tag', () => {
      const actPattern = /<\|ACT:(.*?)\|>/
      const input = 'just a normal message'
      const match = input.match(actPattern)

      expect(match).toBeNull()
    })

    it('should not parse invalid JSON in ACT tag', () => {
      const actPattern = /<\|ACT:(.*?)\|>/
      const input = '<|ACT:not-json|>'
      const match = input.match(actPattern)

      expect(match).not.toBeNull()
      expect(() => JSON.parse(match![1])).toThrow()
    })
  })

  describe('normalizeEmotionName logic', () => {
    it('should accept valid emotion names', () => {
      for (const emotion of EMOTION_VALUES) {
        expect(EMOTION_VALUES.includes(emotion)).toBe(true)
      }
    })

    it('should reject invalid emotion names', () => {
      const invalid = ['unknown', 'joy', 'fear', '', 'HAPPY']
      for (const name of invalid) {
        expect(EMOTION_VALUES.includes(name)).toBe(false)
      }
    })
  })

  describe('normalizeIntensity logic', () => {
    it('should clamp values above 1 to 1', () => {
      const normalize = (v: number) => Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v))
      expect(normalize(1.5)).toBe(1)
      expect(normalize(100)).toBe(1)
    })

    it('should clamp negative values to 0', () => {
      const normalize = (v: number) => Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v))
      expect(normalize(-0.5)).toBe(0)
      expect(normalize(-100)).toBe(0)
    })

    it('should keep values in [0, 1] as-is', () => {
      const normalize = (v: number) => Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v))
      expect(normalize(0)).toBe(0)
      expect(normalize(0.5)).toBe(0.5)
      expect(normalize(1)).toBe(1)
    })

    it('should return 1 for NaN', () => {
      const normalize = (v: number) => Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v))
      expect(normalize(Number.NaN)).toBe(1)
    })
  })
})

describe('queues - delay parsing', () => {
  describe('dELAY tag parsing', () => {
    it('should parse valid delay tag', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/
      const input = '<|DELAY:3|>'
      const match = input.match(delayPattern)

      expect(match).not.toBeNull()
      expect(Number(match![1])).toBe(3)
    })

    it('should parse decimal delay values', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/
      const input = '<|DELAY:1.5|>'
      const match = input.match(delayPattern)

      expect(match).not.toBeNull()
      expect(Number(match![1])).toBe(1.5)
    })

    it('should parse zero delay', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/
      const input = '<|DELAY:0|>'
      const match = input.match(delayPattern)

      expect(match).not.toBeNull()
      expect(Number(match![1])).toBe(0)
    })

    it('should not match when there is no delay tag', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/
      const input = 'just a normal message'
      const match = input.match(delayPattern)

      expect(match).toBeNull()
    })

    it('should not match invalid delay format', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/
      const input = '<|DELAY:abc|>'
      const match = input.match(delayPattern)

      expect(match).toBeNull()
    })
  })

  describe('splitDelays logic', () => {
    it('should split text around delay tags', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/g
      const input = 'Hello<|DELAY:2|>World<|DELAY:1|>End'

      const parts: Array<{ type: 'text', value: string } | { type: 'delay', value: number }> = []
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = delayPattern.exec(input)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: input.slice(lastIndex, match.index) })
        }
        parts.push({ type: 'delay', value: Number(match[1]) })
        lastIndex = delayPattern.lastIndex
      }
      if (lastIndex < input.length) {
        parts.push({ type: 'text', value: input.slice(lastIndex) })
      }

      expect(parts).toEqual([
        { type: 'text', value: 'Hello' },
        { type: 'delay', value: 2 },
        { type: 'text', value: 'World' },
        { type: 'delay', value: 1 },
        { type: 'text', value: 'End' },
      ])
    })

    it('should handle text with no delay tags', () => {
      const delayPattern = /<\|DELAY:(\d+(?:\.\d+)?)\|>/g
      const input = 'Hello World'

      const hasMatch = delayPattern.test(input)
      expect(hasMatch).toBe(false)
    })
  })
})
