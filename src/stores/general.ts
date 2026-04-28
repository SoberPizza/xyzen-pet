/**
 * Pinia store for app-wide "General" preferences (UI brightness, language).
 *
 * Brightness is a CSS `filter: brightness()` multiplier applied to the
 * buddy root in App.vue; it lets the user dim a transparent Tauri
 * overlay without killing GPU lighting. Language persists the user's
 * locale choice — translations are wired later, so for now only `en`
 * is actually rendered.
 */

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export const useGeneralStore = defineStore('general', () => {
  const brightness = useLocalStorage<number>('settings/general/brightness', 1)
  const language = useLocalStorage<string>('settings/general/language', 'en')

  const configured = computed(() => true)

  return { brightness, language, configured }
})
