import { describe, expect, it } from 'vitest'

import { createServerChannelQrPayload, parseServerChannelQrPayload } from './server-channel-qr'

describe('createServerChannelQrPayload', () => {
  const validPayload = {
    type: 'airi:server-channel' as const,
    version: 1 as const,
    urls: ['ws://localhost:3000/ws'],
    authToken: 'test-token',
  }

  it('validates and normalizes a valid payload', () => {
    const result = createServerChannelQrPayload(validPayload)
    expect(result.type).toBe('airi:server-channel')
    expect(result.version).toBe(1)
    expect(result.authToken).toBe('test-token')
    expect(result.urls).toHaveLength(1)
    // URL normalization may add a trailing slash
    expect(result.urls[0]).toContain('localhost:3000/ws')
  })

  it('throws for invalid URL (not ws/wss)', () => {
    expect(() => createServerChannelQrPayload({
      ...validPayload,
      urls: ['http://example.com'],
    })).toThrow()
  })

  it('throws for empty urls array', () => {
    expect(() => createServerChannelQrPayload({
      ...validPayload,
      urls: [],
    })).toThrow()
  })

  it('throws for wrong type field', () => {
    expect(() => createServerChannelQrPayload({
      ...validPayload,
      type: 'wrong-type' as any,
    })).toThrow()
  })

  it('throws for wrong version', () => {
    expect(() => createServerChannelQrPayload({
      ...validPayload,
      version: 2 as any,
    })).toThrow()
  })
})

describe('parseServerChannelQrPayload', () => {
  it('parses a valid JSON string correctly', () => {
    const payload = {
      type: 'airi:server-channel',
      version: 1,
      urls: ['ws://localhost:3000/ws'],
      authToken: 'test-token',
    }
    const result = parseServerChannelQrPayload(JSON.stringify(payload))
    expect(result.type).toBe('airi:server-channel')
    expect(result.version).toBe(1)
    expect(result.authToken).toBe('test-token')
    expect(result.urls).toHaveLength(1)
  })

  it('throws for invalid JSON', () => {
    expect(() => parseServerChannelQrPayload('not-json')).toThrow()
  })
})
