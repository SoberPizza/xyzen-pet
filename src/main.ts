/**
 * App bootstrap.
 *
 * Fires the Xyzen backend init in the background (non-blocking — we mount
 * the Vue app even when the backend is unreachable so the avatar still
 * renders), then installs Pinia + TresJS and mounts `App.vue` into
 * `#buddy-app`.
 */

import Tres from '@tresjs/core'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { initXyzen } from './services'

const pinia = createPinia()

async function bootstrap() {
  try {
    const handle = await initXyzen()
    console.info('[buddy] Xyzen bridge initialized:', {
      baseUrl: handle.config.baseUrl,
      eventsUrl: handle.config.eventsUrl,
      hasToken: Boolean(handle.config.token),
    })
  } catch (err) {
    // Buddy still renders the VRM without backend connectivity —
    // fall through so the user can see the avatar and settings UI.
    console.error('[buddy] Failed to initialize Xyzen backend:', err)
  }

  createApp(App)
    .use(pinia)
    .use(Tres)
    .mount('#buddy-app')
}

bootstrap()
