/**
 * Lightweight i18n helper for buddy labels.
 *
 * Buddy is decoupled from the rest of the monorepo and has no existing i18n
 * framework, so this is a plain code → label lookup keyed on the active
 * locale. Extend with a real i18n library only if we add runtime locale
 * switching.
 */

import enBuddy from './en/buddy.json'
import zhCNBuddy from './zh-CN/buddy.json'

export type BuddyLocale = 'zh-CN' | 'en'

type BuddyNamespace = {
  stage: Record<string, string>
  attribute: Record<string, string>
  gender: Record<string, string>
}

const DICTIONARIES: Record<BuddyLocale, BuddyNamespace> = {
  'zh-CN': zhCNBuddy as BuddyNamespace,
  'en': enBuddy as BuddyNamespace,
}

function pickLocale(): BuddyLocale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const lang = (navigator.language || '').toLowerCase()
  if (lang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

const activeLocale: BuddyLocale = pickLocale()

export type BuddyLabelNamespace = keyof BuddyNamespace

/** Resolve a `code` under `namespace` to a display label. Falls back to the code. */
export function tBuddy(namespace: BuddyLabelNamespace, code: string | null | undefined): string {
  if (!code) return ''
  const dict = DICTIONARIES[activeLocale][namespace]
  return dict[code] ?? code
}
