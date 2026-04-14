import { describe, expect, it } from 'vitest'

import { nlsMetaEndpointFromRegion, nlsWebSocketEndpointFromRegion } from './utils'

describe('nlsMetaEndpointFromRegion', () => {
  it('returns URL with region cn-shanghai', () => {
    const url = nlsMetaEndpointFromRegion('cn-shanghai')
    expect(url.href).toBe('http://nls-meta.cn-shanghai.aliyuncs.com/')
  })

  it('returns URL with region cn-beijing', () => {
    const url = nlsMetaEndpointFromRegion('cn-beijing')
    expect(url.href).toBe('http://nls-meta.cn-beijing.aliyuncs.com/')
  })
})

describe('nlsWebSocketEndpointFromRegion', () => {
  it('defaults to cn-shanghai when no region is provided', () => {
    const url = nlsWebSocketEndpointFromRegion()
    expect(url.hostname).toBe('nls-gateway-cn-shanghai.aliyuncs.com')
    expect(url.pathname).toBe('/ws/v1')
    expect(url.protocol).toBe('wss:')
  })

  it('returns correct URL for cn-shanghai', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-shanghai')
    expect(url.href).toBe('wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1')
  })

  it('returns correct URL for cn-beijing', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-beijing')
    expect(url.href).toBe('wss://nls-gateway-cn-beijing.aliyuncs.com/ws/v1')
  })

  it('returns correct URL for cn-shenzhen', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-shenzhen')
    expect(url.href).toBe('wss://nls-gateway-cn-shenzhen.aliyuncs.com/ws/v1')
  })

  // NOTICE: The source sets `url.hostname` to a string containing `:80`
  // (e.g. `nls-gateway-cn-shanghai-internal-internal.aliyuncs.com:80`).
  // The URL API silently rejects hostname values that include a port,
  // so the hostname remains `example.com`. This is a known bug in the
  // source; the tests assert actual (buggy) behaviour.
  it('falls through for cn-shanghai-internal due to invalid hostname assignment', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-shanghai-internal')
    expect(url.hostname).toBe('example.com')
  })

  it('falls through for cn-beijing-internal due to invalid hostname assignment', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-beijing-internal')
    expect(url.hostname).toBe('example.com')
  })

  it('falls through to default example.com base for unknown region', () => {
    const url = nlsWebSocketEndpointFromRegion('eu-west-1')
    expect(url.hostname).toBe('example.com')
    expect(url.pathname).toBe('/ws/v1')
  })
})
