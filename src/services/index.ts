/**
 * Public entrypoint for the Xyzen backend integration.
 *
 * Called once from `main.ts` before the app mounts.
 *
 * Boot sequence (non-blocking — the app mounts even if the backend is down):
 *   1. Resolve config (URL + token from localStorage / env / origin).
 *   2. Fire an unauthenticated `/xyzen/api/health` probe in the background
 *      and emit `XyzenHealthChecked` with the outcome.
 *   3. Kick off the SSE connect — it self-heals via exponential backoff.
 */

import type { ResolvedConfig } from '../runtime/config'
import type { BuddiesClient } from './buddies'
import type { HttpClient } from './http'

import { resolveConfig } from '../runtime/config'
import { createBuddiesClient } from './buddies'
import { xyzenBus } from './event-bus'
import { createHttpClient } from './http'
import { BuddySseClient } from './sse'
import { XyzenHealthChecked } from './types'

export interface XyzenHealthSnapshot {
  ok: boolean
  baseUrl: string
  error?: string
}

export interface XyzenHandle {
  config: ResolvedConfig
  http: HttpClient
  buddies: BuddiesClient
  sse: BuddySseClient
}

let handle: XyzenHandle | null = null
let lastHealth: XyzenHealthSnapshot | null = null

/**
 * Synchronous accessor for the most recent health probe result.
 * Exposed so subscribers that mount after the probe resolves can seed their
 * state without awaiting `initXyzen()`.
 */
export function getLastHealth(): XyzenHealthSnapshot | null {
  return lastHealth
}

async function probeHealth(config: ResolvedConfig, http: HttpClient): Promise<void> {
  try {
    await http.health()
    console.info('[xyzen] Backend health OK:', config.baseUrl)
    lastHealth = { ok: true, baseUrl: config.baseUrl }
    xyzenBus.emit(XyzenHealthChecked, lastHealth)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[xyzen] Backend health probe failed:', config.baseUrl, error)
    lastHealth = { ok: false, baseUrl: config.baseUrl, error }
    xyzenBus.emit(XyzenHealthChecked, lastHealth)
  }
}

export async function initXyzen(): Promise<XyzenHandle> {
  if (handle) return handle

  const config = await resolveConfig()
  const http = createHttpClient(config)
  const buddies = createBuddiesClient(http)
  const sse = new BuddySseClient(config)

  // Fire-and-forget: don't block the first consumer on a health probe.
  // Listeners subscribed before this call will see the result via the bus.
  void probeHealth(config, http)

  sse.connect()
  config.onTokenChange(token => sse.reconnectWithToken(token))
  config.onBackendUrlChange(() => {
    sse.reconnect()
    void probeHealth(config, http)
  })

  handle = { config, http, buddies, sse }
  return handle
}

export { xyzenBus } from './event-bus'
export * from './types'
export type {
  BuddiesClient,
  BuddyAppearanceCreate,
  BuddyAppearanceRead,
  BuddyAppearanceUpdate,
  BuddyCreate,
  BuddyRead,
  BuddyStage,
  BuddyUpdate,
  StageHistoryEntry,
} from './buddies'
export { HttpError } from './http'
export type { HttpClient, RequestOptions } from './http'
export type { BuddySseClient } from './sse'
