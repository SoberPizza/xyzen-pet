import { describe, expect, it } from 'vitest'

import {
  normalizeNullableAnyOf,
  normalizeSparkCommandDestinations,
  normalizeSparkCommandGuidanceOptions,
  normalizeSparkCommandMetadata,
  normalizeSparkCommandPersona,
  normalizeSparkCommandStringList,
  normalizeSparkCommandStringValue,
} from './spark-command-shared'

describe('normalizeSparkCommandMetadata', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeSparkCommandMetadata(undefined)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(normalizeSparkCommandMetadata([])).toBeUndefined()
  })

  it('converts key-value array to record', () => {
    const result = normalizeSparkCommandMetadata([
      { key: 'a', value: 1 },
      { key: 'b', value: 'x' },
    ])
    expect(result).toEqual({ a: 1, b: 'x' })
  })
})

describe('normalizeSparkCommandPersona', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeSparkCommandPersona(undefined)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(normalizeSparkCommandPersona([])).toBeUndefined()
  })

  it('converts traits array to record keyed by trait name', () => {
    const result = normalizeSparkCommandPersona([
      { traits: 'bravery', strength: 'high' },
    ])
    expect(result).toEqual({ bravery: 'high' })
  })
})

describe('normalizeSparkCommandGuidanceOptions', () => {
  it('strips null values to undefined', () => {
    const result = normalizeSparkCommandGuidanceOptions([
      {
        label: 'opt',
        steps: ['step1'],
        rationale: null,
        possibleOutcome: null,
        risk: null,
        fallback: null,
        triggers: null,
      },
    ])
    expect(result).toEqual([
      {
        label: 'opt',
        steps: ['step1'],
        rationale: undefined,
        possibleOutcome: undefined,
        risk: undefined,
        fallback: undefined,
        triggers: undefined,
      },
    ])
  })

  it('keeps non-null values', () => {
    const result = normalizeSparkCommandGuidanceOptions([
      {
        label: 'opt',
        steps: ['step1'],
        rationale: 'because',
        possibleOutcome: ['win'],
        risk: 'high',
        fallback: ['retreat'],
        triggers: ['low-hp'],
      },
    ])
    expect(result).toEqual([
      {
        label: 'opt',
        steps: ['step1'],
        rationale: 'because',
        possibleOutcome: ['win'],
        risk: 'high',
        fallback: ['retreat'],
        triggers: ['low-hp'],
      },
    ])
  })

  it('converts empty arrays to undefined for possibleOutcome, fallback, triggers', () => {
    const result = normalizeSparkCommandGuidanceOptions([
      {
        label: 'opt',
        steps: ['step1'],
        rationale: 'ok',
        possibleOutcome: [],
        risk: 'low',
        fallback: [],
        triggers: [],
      },
    ])
    expect(result[0].possibleOutcome).toBeUndefined()
    expect(result[0].fallback).toBeUndefined()
    expect(result[0].triggers).toBeUndefined()
  })
})

describe('normalizeSparkCommandDestinations', () => {
  it('returns undefined for null', () => {
    expect(normalizeSparkCommandDestinations(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(normalizeSparkCommandDestinations(undefined as any)).toBeUndefined()
  })

  it('passes through arrays', () => {
    const arr = ['agent-1', 'agent-2']
    expect(normalizeSparkCommandDestinations(arr)).toBe(arr)
  })

  it('passes through { all: true }', () => {
    const dest = { all: true as const }
    expect(normalizeSparkCommandDestinations(dest)).toBe(dest)
  })

  it('strips null exclude from include/exclude object', () => {
    const result = normalizeSparkCommandDestinations({ include: ['a'], exclude: null })
    expect(result).toEqual({ include: ['a'] })
  })

  it('returns undefined when both include and exclude are null', () => {
    expect(normalizeSparkCommandDestinations({ include: null, exclude: null })).toBeUndefined()
  })

  it('returns undefined when both include and exclude are empty', () => {
    expect(normalizeSparkCommandDestinations({ include: [], exclude: [] })).toBeUndefined()
  })
})

describe('normalizeSparkCommandStringList', () => {
  it('returns undefined for null', () => {
    expect(normalizeSparkCommandStringList(null)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(normalizeSparkCommandStringList([])).toBeUndefined()
  })

  it('returns the array when non-empty', () => {
    expect(normalizeSparkCommandStringList(['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('normalizeSparkCommandStringValue', () => {
  it('returns undefined for null', () => {
    expect(normalizeSparkCommandStringValue(null)).toBeUndefined()
  })

  it('returns the string when non-null', () => {
    expect(normalizeSparkCommandStringValue('hello')).toBe('hello')
  })
})

describe('normalizeNullableAnyOf', () => {
  it('collapses scalar anyOf with null to type array', () => {
    const result = normalizeNullableAnyOf({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    })
    expect(result).toEqual({ type: ['string', 'null'] })
    expect(result.anyOf).toBeUndefined()
  })

  it('does NOT collapse object anyOf unions', () => {
    const schema = {
      anyOf: [
        { type: 'object' as const, properties: { a: { type: 'string' as const } }, required: ['a'] },
        { type: 'null' as const },
      ],
    }
    const result = normalizeNullableAnyOf(schema)
    // Object type is not in the scalar set, so anyOf should remain
    expect(result.anyOf).toBeDefined()
  })

  it('recursively processes properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
      },
    }
    const result = normalizeNullableAnyOf(schema)
    expect(result.properties!.name).toEqual({ type: ['string', 'null'] })
  })

  it('recursively processes single items schema', () => {
    const schema = {
      type: 'array' as const,
      items: {
        anyOf: [{ type: 'number' as const }, { type: 'null' as const }],
      },
    }
    const result = normalizeNullableAnyOf(schema)
    expect(result.items).toEqual({ type: ['number', 'null'] })
  })

  it('recursively processes array items', () => {
    const schema = {
      type: 'array' as const,
      items: [
        { anyOf: [{ type: 'integer' as const }, { type: 'null' as const }] },
        { type: 'string' as const },
      ],
    }
    const result = normalizeNullableAnyOf(schema)
    expect((result.items as any[])[0]).toEqual({ type: ['integer', 'null'] })
    expect((result.items as any[])[1]).toEqual({ type: 'string' })
  })

  it('processes oneOf entries recursively', () => {
    const schema = {
      oneOf: [
        {
          type: 'object' as const,
          properties: {
            value: { anyOf: [{ type: 'boolean' as const }, { type: 'null' as const }] },
          },
        },
      ],
    }
    const result = normalizeNullableAnyOf(schema)
    expect((result.oneOf![0] as any).properties.value).toEqual({ type: ['boolean', 'null'] })
  })
})
