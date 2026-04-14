import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isUrlMode } from './environment'
import { isUrl, withBase } from './url'

vi.mock('./environment', () => ({
  isUrlMode: vi.fn(),
}))

describe('isUrl', () => {
  it('returns true for https://example.com', () => {
    expect(isUrl('https://example.com')).toBe(true)
  })

  it('returns true for http://localhost:3000', () => {
    expect(isUrl('http://localhost:3000')).toBe(true)
  })

  it('returns false for not-a-url', () => {
    expect(isUrl('not-a-url')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isUrl('')).toBe(false)
  })
})

describe('withBase', () => {
  it('returns url as-is when isUrlMode("server") returns true', () => {
    vi.mocked(isUrlMode).mockReturnValue(true)
    expect(withBase('/path')).toBe('/path')
  })

  describe('when isUrlMode returns false', () => {
    beforeEach(() => {
      vi.mocked(isUrlMode).mockReturnValue(false)
    })

    it('prepends dot to absolute path', () => {
      expect(withBase('/path')).toBe('./path')
    })

    it('leaves relative path with dot-slash unchanged', () => {
      expect(withBase('./path')).toBe('./path')
    })

    it('prepends dot-slash to bare path', () => {
      expect(withBase('path')).toBe('./path')
    })
  })
})
