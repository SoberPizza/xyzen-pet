/**
 * Shared read/write for per-buddy wake-word nicknames.
 *
 * Storage contract:
 *   key   = `buddy/nicknames/{buddyId}`   (see src/ipc/keys.ts)
 *   value = JSON-encoded `string[]`, length ≤ MAX_NICKNAMES, entries
 *           trimmed and non-empty.
 *
 * The remote buddy API has no nickname field, so this never leaves the
 * device. Future wake-word consumers (the voice FSM on the Rust side)
 * will read the same key from the tauri-plugin-store.
 */

import { commands } from '../ipc/bindings'
import { buddyNicknameKey } from '../ipc/keys'

export const MAX_NICKNAMES = 3

/** Trim, drop empties, clamp to MAX_NICKNAMES. */
export function normalizeNicknames(raw: readonly string[]): string[] {
  return raw
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_NICKNAMES)
}

/**
 * Load the persisted list. Returns `[]` if absent, malformed, or
 * unreadable — nicknames are cosmetic until the voice FSM lands, so a
 * failed read shouldn't break the caller.
 */
export async function loadNicknames(buddyId: string): Promise<string[]> {
  try {
    const result = await commands.settingsGet(buddyNicknameKey(buddyId))
    if (result.status !== 'ok' || result.data === null) return []
    const parsed: unknown = JSON.parse(result.data)
    if (!Array.isArray(parsed)) return []
    return normalizeNicknames(
      parsed.filter((v): v is string => typeof v === 'string'),
    )
  } catch {
    return []
  }
}

/** Persist the list. Callers validate via `wake-word.ts` before calling. */
export async function saveNicknames(
  buddyId: string,
  raw: readonly string[],
): Promise<void> {
  const next = normalizeNicknames(raw)
  await commands.settingsSet(buddyNicknameKey(buddyId), JSON.stringify(next))
}
