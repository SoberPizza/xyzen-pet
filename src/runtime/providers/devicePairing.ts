/**
 * Device-pairing credential provider — STUB.
 *
 * Target use case: Buddy runs as a standalone Tauri binary on an RPi kiosk.
 * There is no sibling Xyzen webview to piggy-back on, so Buddy must acquire
 * its own long-lived token via a device-authorization grant.
 *
 * TODO: RPi pairing.
 *   - Implement state machine: unpaired → pending (user_code + QR visible)
 *     → paired (token + refresh_token in Tauri store) → refreshing.
 *   - Wire to new backend endpoints `/xyzen/api/v1/auth/device/code` and
 *     `/xyzen/api/v1/auth/device/poll`.
 *   - Persist the refresh token via tauri-plugin-store.
 *
 * Until then the provider advertises `isAvailable() === false` so the
 * composer skips it silently.
 */

import type { CredentialProvider } from './types'

export function createDevicePairingProvider(): CredentialProvider {
  return {
    name: 'devicePairing',
    isAvailable() {
      return false
    },
    async snapshot() {
      return null
    },
    onChange() {
      return () => {}
    },
  }
}
