/**
 * Reactive wrapper around the Buddy session-status SSE stream.
 *
 * Rust (`session_stream::session`) owns the actual SSE connection; this
 * composable just mirrors the latest `BuddySessionEvent` the backend has
 * observed into Vue refs. Two surfaces are exposed separately — `ui` drives
 * the status pill + toast stack, `vrm` feeds into the gesture driver.
 *
 * Singleton-scoped so the overlay window and the settings window both see
 * the same state without double-subscribing to the Tauri event bus.
 */

import { ref, type Ref } from 'vue'

import type {
  BuddySessionEvent,
  BuddyUiKeyword,
  BuddyVrmKeyword,
} from '../ipc/bindings'
import { commands, useIpcEvent } from '../ipc/client'

export interface BuddySession {
  /** Latest UI-surface keyword. Defaults to `idle` until the first event. */
  ui: Ref<BuddyUiKeyword>
  /** Latest VRM-surface keyword. Defaults to `idle` until the first event. */
  vrm: Ref<BuddyVrmKeyword>
  /** Raw last event for callers that need session_id / topic_id / meta. */
  lastEvent: Ref<BuddySessionEvent | null>
}

let singleton: BuddySession | null = null

function create(): BuddySession {
  const ui = ref<BuddyUiKeyword>('idle')
  const vrm = ref<BuddyVrmKeyword>('idle')
  const lastEvent = ref<BuddySessionEvent | null>(null)

  function apply(event: BuddySessionEvent) {
    console.info('[buddy-session] apply', { ui: event.ui, vrm: event.vrm })
    lastEvent.value = event
    // Either field may be null when a `status` event only touches one
    // surface; preserve the previous value on the other so a tool_done UI
    // frame doesn't reset the VRM back to idle.
    if (event.ui != null) {
      if (event.ui !== ui.value)
        console.info('[buddy-session] ui', ui.value, '→', event.ui)
      ui.value = event.ui
    }
    if (event.vrm != null) {
      if (event.vrm !== vrm.value)
        console.info('[buddy-session] vrm', vrm.value, '→', event.vrm)
      vrm.value = event.vrm
    }
  }

  // Seed from the Rust-side cache so the pill + VRM are correct on mount
  // even if the process started before this scope did. The command
  // returns `Option<BuddySessionEvent>` directly (no Result wrapper), so
  // we just null-check the resolved value.
  commands.sessionStreamStatus()
    .then((snapshot) => {
      console.info('[buddy-session] seed', snapshot)
      if (snapshot) apply(snapshot)
    })
    .catch((err) => console.warn('[buddy-session] seed failed:', err))

  useIpcEvent<BuddySessionEvent>('buddy://session-status', (payload) => {
    console.debug('[buddy-session] event received')
    apply(payload)
  })

  return { ui, vrm, lastEvent }
}

export function useBuddySession(): BuddySession {
  if (!singleton) singleton = create()
  return singleton
}
