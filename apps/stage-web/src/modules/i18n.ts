import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createI18n } from 'vue-i18n'

function getLocale() {
  let language = localStorage.getItem('settings/language')

  if (!language) {
    // Fallback to browser language
    language = navigator.language || 'en'
  }

  return resolveSupportedLocale(language, Object.keys(messages!))
}

export const i18n = createI18n({
  legacy: false,
  locale: getLocale(),
  fallbackLocale: 'en',
  messages,
  // NOTICE: Some i18n messages intentionally contain HTML (e.g. Ollama troubleshooting).
  // The HTML is sanitized with DOMPurify before rendering via v-html, so XSS is not a concern.
  warnHtmlMessage: false,
})
