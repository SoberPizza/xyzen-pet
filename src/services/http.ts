/**
 * Thin IPC shim for the Xyzen REST API.
 *
 * As of the Rust-port stage, all network work happens in
 * `src-tauri/src/net/http.rs`. This module is just a typed wrapper around
 * `invoke('xyzen_http_request', ...)` that preserves the previous
 * `HttpClient` surface so `buddies.ts`, `ceo-chat.ts`, and
 * `services/index.ts` don't need to change.
 *
 * Auth + base URL come from the Rust-side credential cache (pushed in via
 * `set_auth_credentials` by `runtime/providers/tauriSibling.ts`), so the
 * `ResolvedConfig` arguments are accepted for back-compat but only
 * `baseUrl` is read (for the special-cased `health()` URL that the TS
 * layer still owns).
 */

import { invoke } from '@tauri-apps/api/core'

import type { ResolvedConfig } from '../runtime/config'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  /** Skip the Bearer header — useful for unauthenticated endpoints like /health. */
  auth?: boolean
  /** Override the 20s default on the Rust side. */
  timeoutMs?: number
  /** Pass through an absolute URL (skips `/xyzen/api/v1` prefix). */
  absolute?: boolean
  /** Kept for call-site compatibility; the Rust client owns cancellation via timeout. */
  signal?: AbortSignal
}

export interface HttpClient {
  request: <T>(path: string, opts?: RequestOptions) => Promise<T>
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => Promise<T>
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) => Promise<T>
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) => Promise<T>
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) => Promise<T>
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => Promise<T>
  /** Convenience: GET `/xyzen/api/health`. */
  health: () => Promise<unknown>
}

interface RustHttpResponse {
  status: number
  body: unknown
  headers: Record<string, string>
}

interface RustHttpRequest {
  method?: string
  path: string
  body?: unknown
  headers?: Record<string, string>
  auth: boolean
  absolute: boolean
  timeoutMs?: number
}

function parseRustError(raw: unknown): { status: number, message: string } {
  const text = typeof raw === 'string' ? raw : String(raw ?? 'unknown error')
  // Rust serialises HttpError::Status via Display as "http {status}: {message}".
  const m = /^http (\d+): (.*)$/s.exec(text)
  if (m) return { status: Number(m[1]), message: m[2] }
  if (text.startsWith('auth failed')) return { status: 401, message: text }
  if (text.startsWith('timeout')) return { status: 0, message: text }
  return { status: 0, message: text }
}

export function createHttpClient(config: ResolvedConfig): HttpClient {
  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      body,
      headers,
      auth = true,
      timeoutMs,
      absolute = false,
    } = opts

    const payload: RustHttpRequest = {
      method,
      path,
      body: body instanceof FormData
        // FormData doesn't survive JSON serialisation. The Rust client
        // accepts JSON-only bodies; callers needing multipart uploads
        // should switch to a dedicated command.
        ? undefined
        : body,
      headers,
      auth,
      absolute,
      timeoutMs,
    }

    let resp: RustHttpResponse
    try {
      resp = await invoke<RustHttpResponse>('xyzen_http_request', { req: payload })
    } catch (err) {
      const { status, message } = parseRustError(err)
      throw new HttpError(status, message)
    }

    if (resp.status >= 400) {
      const parsed = resp.body
      const message = typeof parsed === 'object' && parsed !== null && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${resp.status}`
      throw new HttpError(resp.status, message, parsed)
    }

    return resp.body as T
  }

  return {
    request,
    get: (path, opts) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
    patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
    del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
    health: () => request(`${config.baseUrl}/xyzen/api/health`, { auth: false, absolute: true }),
  }
}
