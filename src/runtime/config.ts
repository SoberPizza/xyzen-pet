/**
 * Runtime config resolver — provider-composer edition.
 *
 * Buddy sources its `{baseUrl, token}` pair from a chain of
 * `CredentialProvider`s. Today the chain is:
 *
 *   1. tauriSibling  → Xyzen desktop shell pushes the Casdoor token via IPC
 *   2. devicePairing → STUB (RPi kiosk future work)
 *
 * Each provider has its own availability check and change-notification
 * stream. The composer picks the first available one whose `snapshot()`
 * yields a token, then forwards that provider's `onChange` to call sites.
 *
 * The public surface (`ResolvedConfig` shape) is preserved so callers in
 * `services/xyzen/http.ts`, `services/xyzen/sse.ts`, and
 * `services/xyzen/index.ts` don't change. `setToken` / `setBackendUrl`
 * are retained as no-ops with a deprecation warning — the Connection
 * tab in SettingsDialog is the last caller and is being removed.
 */

import type { CredentialProvider, CredentialSnapshot } from './providers/types'

import { createDevicePairingProvider } from './providers/devicePairing'
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
  /** Deprecated — providers own the credential lifecycle now. No-op with warning. */
  setToken: (next: string) => void
  /** Deprecated — providers own the credential lifecycle now. No-op with warning. */
  setBackendUrl: (next: string) => void
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
  return [createTauriSiblingProvider(), createDevicePairingProvider()]
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
    setToken() {
      console.warn('[runtime/config] setToken is a no-op — credentials are provider-managed.')
    },
    setBackendUrl() {
      console.warn('[runtime/config] setBackendUrl is a no-op — credentials are provider-managed.')
    },
  }
}
