/**
 * Tauri-sibling credential provider.
 *
 * Buddy runs inside a Tauri webview as a sibling of the main Xyzen window.
 * The main window pushes its live Casdoor access token into a process-level
 * Rust bridge (`desktop/src-tauri/src/auth_bridge.rs`). Buddy pulls via
 * `get_auth_credentials` at boot and listens to the
 * `auth-credentials-updated` event for rotations.
 *
 * `isAvailable()` is still gated on `__TAURI_INTERNALS__` so the composer
 * can skip this provider cleanly under jsdom.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { CredentialProvider, CredentialSnapshot } from './types'

const AUTH_UPDATED_EVENT = 'auth-credentials-updated'

interface RawCredentials {
  token?: string | null
  base_url?: string | null
}

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

function toSnapshot(raw: RawCredentials | null | undefined): CredentialSnapshot | null {
  if (!raw) return null
  const token = raw.token ?? ''
  const baseUrl = raw.base_url ?? ''
  // A provider that yields an empty token hasn't "resolved" yet — let the
  // composer fall through instead of forcing HTTP calls to 401.
  if (!token) return null
  return { token, baseUrl }
}

async function fetchCredentials(): Promise<CredentialSnapshot | null> {
  try {
    const raw = await invoke<RawCredentials>('get_auth_credentials')
    return toSnapshot(raw)
  } catch (err) {
    console.warn('[tauriSibling] get_auth_credentials failed:', err)
    return null
  }
}

export function createTauriSiblingProvider(): CredentialProvider {
  const listeners = new Set<(next: CredentialSnapshot | null) => void>()
  let fanoutInstalled = false
  let fanoutUnlisten: (() => void) | null = null

  function pushToRust(next: CredentialSnapshot | null): void {
    // The Rust-side HTTP/SSE/WS clients read from a process-local credential
    // cache populated by `set_auth_credentials`. Keep the TS composer as the
    // single source of truth so downstream providers (future additions) don't
    // need their own IPC plumbing.
    const payload = next
      ? { token: next.token, base_url: next.baseUrl }
      : { token: null, base_url: null }
    invoke('set_auth_credentials', { creds: payload }).catch((err) => {
      console.warn('[tauriSibling] set_auth_credentials failed:', err)
    })
  }

  function notify(next: CredentialSnapshot | null): void {
    pushToRust(next)
    for (const cb of listeners) {
      try {
        cb(next)
      } catch (err) {
        console.warn('[tauriSibling] listener threw:', err)
      }
    }
  }

  function ensureFanout(): void {
    if (fanoutInstalled) return
    fanoutInstalled = true
    listen<RawCredentials>(AUTH_UPDATED_EVENT, (evt) => {
      notify(toSnapshot(evt.payload))
    })
      .then((fn) => {
        fanoutUnlisten = fn
      })
      .catch((err) => {
        console.warn('[tauriSibling] failed to register event listener:', err)
        fanoutInstalled = false
      })
  }

  return {
    name: 'tauriSibling',

    isAvailable() {
      return isTauri()
    },

    async snapshot() {
      ensureFanout()
      const snap = await fetchCredentials()
      // Seed the Rust cache on first read so HTTP calls during boot don't
      // race the event-driven `notify()` path.
      pushToRust(snap)
      return snap
    },

    onChange(cb) {
      listeners.add(cb)
      ensureFanout()
      return () => {
        listeners.delete(cb)
        if (listeners.size === 0 && fanoutUnlisten) {
          fanoutUnlisten()
          fanoutUnlisten = null
          fanoutInstalled = false
        }
      }
    },

    async invalidate() {
      // Re-pull fresh credentials and push to listeners directly. If the
      // Rust bridge is up-to-date we resolve immediately without waiting
      // for the debounced event to arrive.
      const fresh = await fetchCredentials()
      notify(fresh)
    },
  }
}
