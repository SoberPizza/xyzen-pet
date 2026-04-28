import Tres from '@tresjs/core'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { initXyzen } from './services/xyzen'

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
