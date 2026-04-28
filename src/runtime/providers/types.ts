/**
 * CredentialProvider: pluggable source for Buddy's `{baseUrl, token}` pair.
 *
 * Different deployments use different sources:
 *  - `tauriSibling`: Buddy runs as a sibling webview in the Xyzen desktop
 *    shell; the main window pushes its Casdoor token through a Rust-side
 *    bridge and Buddy pulls it via Tauri IPC.
 *  - `devicePairing`: Buddy runs standalone on an RPi kiosk and pairs with
 *    the backend via a device-authorization grant. Stub for now.
 *
 * `buddy/src/runtime/config.ts` composes providers in priority order and
 * picks the first one that yields credentials. See the plan for details.
 */

export interface CredentialSnapshot {
  baseUrl: string
  token: string
}

export interface CredentialProvider {
  readonly name: string
  /** True when this provider can serve credentials in the current environment. */
  isAvailable: () => boolean
  /** Resolve credentials. Null if unavailable at this moment. */
  snapshot: () => Promise<CredentialSnapshot | null>
  /** Subscribe to rotation events (login/refresh/logout). Returns unsubscribe. */
  onChange: (cb: (next: CredentialSnapshot | null) => void) => () => void
  /**
   * Called by the composer when the current token was rejected (401).
   * Provider may refresh state (e.g. re-pull from IPC) and re-fire onChange.
   */
  invalidate?: () => Promise<void>
}
