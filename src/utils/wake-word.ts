/**
 * Wake-word (nickname) validation helpers.
 *
 * A buddy's name + nicknames double as voice wake terms in
 * `standby_wake` mode. CJK terms use tighter length bounds (2–8 chars)
 * than Latin ones (4–16) because each CJK character carries more
 * phonetic weight — an STT-friendly lower bound is shorter.
 * Consumers: `BuddyDetailsDialog` (on-input feedback),
 * `useBuddyVoiceSession` (collecting the wake list sent to the server).
 */

export type WakeTermValidation
  = | { ok: true, value: string }
    | { ok: false, reason: 'empty' | 'too-short' | 'too-long' }

const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/u

export function containsCjk(text: string): boolean {
  return CJK_PATTERN.test(text)
}

export function wakeTermLimits(text: string): { min: number, max: number } {
  return containsCjk(text) ? { min: 2, max: 8 } : { min: 4, max: 16 }
}

export function wakeTermLength(text: string): number {
  return [...text].length
}

export function validateWakeTerm(raw: string): WakeTermValidation {
  const term = raw.trim()
  if (!term) return { ok: false, reason: 'empty' }
  const { min, max } = wakeTermLimits(term)
  const len = wakeTermLength(term)
  if (len < min) return { ok: false, reason: 'too-short' }
  if (len > max) return { ok: false, reason: 'too-long' }
  return { ok: true, value: term }
}

export function collectValidWakeTerms(raw: Iterable<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    const result = validateWakeTerm(r ?? '')
    if (!result.ok) continue
    const key = result.value.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(result.value)
  }
  return out
}
