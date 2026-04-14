import { describe, expect, it, vi } from 'vitest'

import { exportCsv } from './export-csv'

describe('exportCsv', () => {
  it('returns early for empty rows without error', () => {
    expect(() => exportCsv([], 'test')).not.toThrow()
  })

  it('logs warning and returns early in non-browser environment', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Ensure browser globals are not available (default in Node/Vitest)
    const originalBlob = globalThis.Blob
    const originalDocument = globalThis.document
    // @ts-expect-error -- intentionally removing globals for test
    delete globalThis.Blob
    // @ts-expect-error -- intentionally removing globals for test
    delete globalThis.document

    try {
      exportCsv([['a', 'b']], 'test')
      expect(warnSpy).toHaveBeenCalledWith('[CSV] Export is only supported in browser environments')
    }
    finally {
      globalThis.Blob = originalBlob
      globalThis.document = originalDocument
      warnSpy.mockRestore()
    }
  })

  it('creates correct CSV content and triggers download', () => {
    const mockClick = vi.fn()
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test')
    const mockRevokeObjectURL = vi.fn()

    let capturedBlobContent: string | undefined
    const OriginalBlob = globalThis.Blob

    // Mock Blob to capture content
    globalThis.Blob = class MockBlob {
      content: string
      options: any

      constructor(parts: any[], options: any) {
        this.content = parts.join('')
        this.options = options
        capturedBlobContent = this.content
      }
    } as any

    const mockLink = { href: '', download: '', click: mockClick }
    const originalDocument = globalThis.document
    // @ts-expect-error -- partial mock
    globalThis.document = { createElement: vi.fn().mockReturnValue(mockLink) }

    const originalURL = globalThis.URL
    globalThis.URL = {
      ...originalURL,
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
    } as any

    try {
      exportCsv([['Name', 'Age'], ['Alice', 30]], 'export')

      expect(capturedBlobContent).toBe('"Name","Age"\n"Alice","30"')
      expect(mockClick).toHaveBeenCalled()
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test')
      expect(mockLink.href).toBe('blob:test')
      expect(mockLink.download).toMatch(/^export-\d+\.csv$/)
    }
    finally {
      globalThis.Blob = OriginalBlob
      globalThis.document = originalDocument
      globalThis.URL = originalURL
    }
  })

  it('handles quotes in fields by doubling them', () => {
    const OriginalBlob = globalThis.Blob
    let capturedBlobContent: string | undefined

    globalThis.Blob = class MockBlob {
      constructor(parts: any[]) {
        capturedBlobContent = parts.join('')
      }
    } as any

    const mockLink = { href: '', download: '', click: vi.fn() }
    const originalDocument = globalThis.document
    // @ts-expect-error -- partial mock
    globalThis.document = { createElement: vi.fn().mockReturnValue(mockLink) }

    const originalURL = globalThis.URL
    globalThis.URL = {
      ...originalURL,
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    } as any

    try {
      exportCsv([['She said "hello"']], 'test')
      expect(capturedBlobContent).toBe('"She said ""hello"""')
    }
    finally {
      globalThis.Blob = OriginalBlob
      globalThis.document = originalDocument
      globalThis.URL = originalURL
    }
  })
})
