/**
 * Thin wrappers around the generated `bindings.ts` surface + helpers that
 * turn one-shot commands into reactive Vue state.
 *
 * Every module under `src/` that needs to touch the backend goes through
 * these helpers — direct `invoke` / `listen` calls are reserved for this
 * file so the IPC contract is reviewable in one place.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, ref, type Ref, watch } from 'vue'

import { commands } from './bindings'

export { commands } from './bindings'

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

/**
 * Resolve the `status: "ok" | "error"` envelope tauri-specta wraps commands
 * in when they return `Result<T, E>`. Panics over to a rejected promise on
 * error so call sites can use the usual try/catch flow.
 */
async function unwrap<T, E>(p: Promise<{ status: 'ok', data: T } | { status: 'error', error: E }>): Promise<T> {
  const r = await p
  if (r.status === 'ok') return r.data
  throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error))
}

interface SettingsChangedPayload {
  key: string
  value_json: string | null
}

/**
 * Reactive binding for a single settings key.
 *
 * On mount: reads the current value from the Rust-backed store (returns the
 * `defaultValue` if the key isn't set yet).
 * On write: persists to the store and emits `settings://changed` so other
 * windows/components observing the same key re-sync without a page reload.
 */
export function useIpcSetting<T>(key: string, defaultValue: T): Ref<T> {
  const state = ref(defaultValue) as Ref<T>
  let unlisten: UnlistenFn | null = null
  let applyingRemote = false

  async function load() {
    if (!isTauri()) return
    try {
      const raw = await unwrap(commands.settingsGet(key))
      if (raw !== null) {
        applyingRemote = true
        state.value = JSON.parse(raw) as T
        applyingRemote = false
      }
    } catch (err) {
      console.warn(`[ipc] settings_get ${key} failed:`, err)
    }
  }

  void load()

  if (isTauri()) {
    void listen<SettingsChangedPayload>('settings://changed', (evt) => {
      if (evt.payload.key !== key) return
      applyingRemote = true
      if (evt.payload.value_json === null) {
        state.value = defaultValue
      } else {
        try {
          state.value = JSON.parse(evt.payload.value_json) as T
        } catch (err) {
          console.warn(`[ipc] settings://changed ${key} parse failed:`, err)
        }
      }
      applyingRemote = false
    }).then((fn) => {
      unlisten = fn
    })
  }

  watch(state, (next) => {
    if (applyingRemote || !isTauri()) return
    const encoded = JSON.stringify(next)
    void unwrap(commands.settingsSet(key, encoded)).catch((err) => {
      console.warn(`[ipc] settings_set ${key} failed:`, err)
    })
  }, { deep: true, flush: 'sync' })

  onScopeDispose(() => {
    try { unlisten?.() } catch {}
  })

  return state
}

/** Listen to a Tauri event, automatically unsubscribing on scope dispose. */
export function useIpcEvent<T>(name: string, handler: (payload: T) => void): void {
  if (!isTauri()) return
  let unlisten: UnlistenFn | null = null
  let disposed = false
  listen<T>(name, (evt) => handler(evt.payload))
    .then((fn) => {
      if (disposed) { try { fn() } catch {} }
      else unlisten = fn
    })
    .catch(err => console.warn(`[ipc] listen ${name} failed:`, err))
  onScopeDispose(() => {
    disposed = true
    try { unlisten?.() } catch {}
  })
}
