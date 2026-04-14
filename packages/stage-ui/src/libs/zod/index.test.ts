import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { getSchemaDefault } from './index'

describe('getSchemaDefault', () => {
  it('returns {} for null schema', () => {
    expect(getSchemaDefault(null)).toEqual({})
  })

  it('returns {} for undefined schema', () => {
    expect(getSchemaDefault(undefined)).toEqual({})
  })

  it('returns defaults from schema with .default() fields', () => {
    const schema = z.object({
      name: z.string().default('Alice'),
      active: z.boolean().default(true),
    })
    expect(getSchemaDefault(schema)).toEqual({ name: 'Alice', active: true })
  })

  it('excludes fields without defaults', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    expect(getSchemaDefault(schema)).toEqual({})
  })

  it('returns only fields that have defaults in a mixed schema', () => {
    const schema = z.object({
      name: z.string().default('Alice'),
      age: z.number(),
      active: z.boolean().default(true),
    })
    expect(getSchemaDefault(schema)).toEqual({ name: 'Alice', active: true })
  })
})
