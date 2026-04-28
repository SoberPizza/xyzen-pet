/**
 * Thin fetch wrapper for the Xyzen REST API.
 *
 * Auto-prefixes `/xyzen/api/v1`, attaches `Authorization: Bearer <token>`,
 * times out after 20s via `AbortController`, and emits `xyzen:auth_failed`
 * on 401 (consumer decides whether to rotate token or surface UI).
 *
 * Intentionally minimal — buddy only needs `health()` and `auth.me()` at
 * this stage. Add more typed helpers as provider adapters come online.
 */

import type { ResolvedConfig } from '../../runtime/config'

import { xyzenBus } from './event-bus'
import { XyzenAuthFailed } from './types'

const API_PREFIX = '/xyzen/api/v1'
// Cold paths (first POST after container start, DB pool warmup, Alembic
// migration kick-off) can easily exceed a tight budget. 20s leaves room for
// the slow path while still catching a genuinely hung request.
const DEFAULT_TIMEOUT_MS = 20_000

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
  /** Override the 5s default. */
  timeoutMs?: number
  /** Pass through an absolute URL (skips `/xyzen/api/v1` prefix). */
  absolute?: boolean
  signal?: AbortSignal
  /** Internal: set on the single-flight retry after a 401 refresh so we don't loop. */
  _retriedAfterAuthRefresh?: boolean
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

export function createHttpClient(config: ResolvedConfig): HttpClient {
  function buildUrl(path: string, absolute: boolean): string {
    if (absolute || /^https?:\/\//i.test(path)) return path
    const prefix = path.startsWith('/') ? API_PREFIX : `${API_PREFIX}/`
    return `${config.baseUrl}${prefix}${path}`
  }

  /**
   * Wait for the next token rotation (via `config.onTokenChange`) or the
   * short timeout, whichever comes first. Used by the 401 retry path to
   * give `invalidateCredentials()` a chance to push a fresh token before
   * we re-issue the request.
   */
  function waitForTokenRotation(timeoutMs = 250): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const unsubscribe = config.onTokenChange(() => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve()
      })
      setTimeout(() => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve()
      }, timeoutMs)
    })
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      auth = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      absolute = false,
      signal,
      _retriedAfterAuthRefresh = false,
    } = opts

    const url = buildUrl(path, absolute)
    const finalHeaders: Record<string, string> = { ...headers }
    if (body !== undefined && !(body instanceof FormData)) {
      finalHeaders['Content-Type'] ??= 'application/json'
    }
    if (auth && config.token) {
      finalHeaders.Authorization = `Bearer ${config.token}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const onExternalAbort = () => controller.abort()
    signal?.addEventListener('abort', onExternalAbort)

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onExternalAbort)
    }

    if (response.status === 401 && auth && !_retriedAfterAuthRefresh) {
      // Ask the active CredentialProvider to re-pull (sibling webview may
      // have just refreshed). Wait briefly for the new token to land, then
      // retry once. A second 401 falls through to XyzenAuthFailed.
      await config.invalidateCredentials()
      await waitForTokenRotation()
      return request(path, { ...opts, _retriedAfterAuthRefresh: true })
    }

    if (response.status === 401) {
      xyzenBus.emit(XyzenAuthFailed, undefined)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const parsed: unknown = contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined)

    if (!response.ok) {
      const message = typeof parsed === 'object' && parsed !== null && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : response.statusText || `HTTP ${response.status}`
      throw new HttpError(response.status, message, parsed)
    }

    return parsed as T
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
