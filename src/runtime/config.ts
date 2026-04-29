/**
 * Runtime config resolver — provider-composer edition.
 *
 * Buddy sources its `{baseUrl, token}` pair from a chain of
 * `CredentialProvider`s. Today the only provider is `tauriSibling`, which
 * receives the Casdoor access token from the Xyzen desktop shell via IPC.
 *
 * The composer picks the first available provider whose `snapshot()` yields
 * a token, then forwards that provider's `onChange` stream to call sites.
 * Providers own the credential lifecycle; there is no imperative setter.
 *
 * The public surface (`ResolvedConfig` shape) is preserved so callers in
 * `services/http.ts`, `services/sse.ts`, and
 * `services/index.ts` don't change.
 */

import type { CredentialProvider, CredentialSnapshot } from './providers/types'

import { createTauriSiblingProvider } from './providers/tauriSibling'

export interface ResolvedConfig {
  /** HTTP base, e.g. `http://localhost:8000` — no trailing slash, no path. */
  readonly baseUrl: string
  /** Full HTTP URL to the buddy SSE endpoint (without query string). */
  readonly eventsUrl: string
  /** Current JWT; empty string when unavailable. */
  readonly token: string
  /** Subscribe to token rotations. Returns an unsubscribe fn. */
  onTokenChange: (cb: (token: string) => void) => () => void
  /** Subscribe to backend-URL rotations. Returns an unsubscribe fn. */
  onBackendUrlChange: (cb: (baseUrl: string) => void) => () => void
  /** Request that the active provider re-pull its credentials (e.g. after a 401). */
  invalidateCredentials: () => Promise<void>
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function deriveEventsUrl(baseUrl: string): string {
  if (!baseUrl) return ''
  return `${baseUrl}/xyzen/api/v1/buddy/events`
}

/**
 * Providers the composer will try, in priority order. Exported so tests
 * can inject mocks via `resolveConfig({ providers })`.
 */
export function defaultProviders(): CredentialProvider[] {
  return [createTauriSiblingProvider()]
}

export interface ResolveOptions {
  providers?: CredentialProvider[]
}

export async function resolveConfig(options: ResolveOptions = {}): Promise<ResolvedConfig> {
  const providers = options.providers ?? defaultProviders()

  const tokenListeners = new Set<(token: string) => void>()
  const baseUrlListeners = new Set<(baseUrl: string) => void>()
  const state = { baseUrl: '', token: '' }

  let activeProvider: CredentialProvider | null = null
  let activeUnsubscribe: (() => void) | null = null

  function applySnapshot(next: CredentialSnapshot | null): void {
    const nextToken = next?.token ?? ''
    const nextBaseUrl = next?.baseUrl ? stripTrailingSlash(next.baseUrl) : ''

    if (nextBaseUrl !== state.baseUrl) {
      state.baseUrl = nextBaseUrl
      baseUrlListeners.forEach(l => l(state.baseUrl))
    }
    if (nextToken !== state.token) {
      state.token = nextToken
      tokenListeners.forEach(l => l(state.token))
    }
  }

  // Pick the first available provider that yields a non-null snapshot. If
  // none do, we keep `{baseUrl: origin, token: ''}` — HTTP will 401 and the
  // retry layer will call `invalidateCredentials` which re-walks the chain.
  for (const provider of providers) {
    if (!provider.isAvailable()) continue
    const snap = await provider.snapshot()
    if (snap) {
      activeProvider = provider
      applySnapshot(snap)
      break
    }
    // Provider is available but doesn't have credentials yet — subscribe
    // so it can wake us up if it acquires some (e.g. main Xyzen window
    // logs in after Buddy boots).
    if (!activeProvider) {
      activeProvider = provider
      break
    }
  }

  if (activeProvider) {
    activeUnsubscribe = activeProvider.onChange(applySnapshot)
  }

  async function invalidateCredentials(): Promise<void> {
    if (activeProvider?.invalidate) {
      await activeProvider.invalidate()
      return
    }
    // No invalidate hook — nothing to do; the caller's single-flight retry
    // will fall through and surface XyzenAuthFailed.
  }

  // Tear-down isn't exposed today (initXyzen is a singleton for the app
  // lifetime), but keep the unsubscribe reference so a future reset path
  // can hook it without rewriting this module.
  void activeUnsubscribe

  return {
    get baseUrl() {
      return state.baseUrl
    },
    get eventsUrl() {
      return deriveEventsUrl(state.baseUrl)
    },
    get token() {
      return state.token
    },
    onTokenChange(cb) {
      tokenListeners.add(cb)
      return () => tokenListeners.delete(cb)
    },
    onBackendUrlChange(cb) {
      baseUrlListeners.add(cb)
      return () => baseUrlListeners.delete(cb)
    },
    invalidateCredentials,
  }
}
