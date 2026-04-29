/**
 * Pinia store for app-wide "General" preferences (UI brightness, language).
 *
 * Persistence lives in the Rust settings store (`tauri-plugin-store`) via
 * `useIpcSetting`; values sync across the main/settings windows without
 * page reloads.
 *
 * Brightness is a CSS `filter: brightness()` multiplier applied to the
 * buddy root in App.vue. Language persists the user's locale choice.
 */

import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useIpcSetting } from '../ipc/client'

export const useGeneralStore = defineStore('general', () => {
  const brightness = useIpcSetting<number>('settings/general/brightness', 1)
  const language = useIpcSetting<string>('settings/general/language', 'en')

  const configured = computed(() => true)

  return { brightness, language, configured }
})
