/**
 * App bootstrap.
 *
 * Synchronous mount — backend I/O now happens in Rust and is reached via
 * Tauri IPC after mount, so there's nothing to `await` here. The avatar
 * renders immediately; individual composables lazy-initialize their IPC
 * subscriptions.
 */

import Tres from '@tresjs/core'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'

createApp(App)
  .use(createPinia())
  .use(Tres)
  .mount('#buddy-app')
