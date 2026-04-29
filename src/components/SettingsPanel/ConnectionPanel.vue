<script setup lang="ts">
/*
 * ConnectionPanel — "Connection" tab of SettingsDialog.
 *
 * Read-only status surface. The old remote-API wiring (Xyzen sibling
 * bridge + HTTP probe) has been stripped — today the panel only shows
 * the packaged app version (via the `app_info` IPC command) and
 * placeholders where the backend URL / auth token will land once the
 * new remote API is wired up.
 */

import { onMounted, ref } from 'vue'

import { commands } from '../../ipc/bindings'

const version = ref('…')
const testing = ref(false)
const testResult = ref<{ ok: boolean, message: string } | null>(null)

onMounted(async () => {
  try {
    const info = await commands.appInfo()
    version.value = info.version
  } catch (err) {
    console.warn('[buddy] failed to read app info', err)
    version.value = '—'
  }
})

function testConnection() {
  // Wire-up target for the rebuilt API. Kept interactive so the UI flow
  // can be tested independently; flip to `await commands.pingBackend()`
  // (or equivalent) once that command exists.
  testing.value = true
  testResult.value = null
  setTimeout(() => {
    testing.value = false
    testResult.value = {
      ok: false,
      message: 'Not wired yet — pending the new remote API.',
    }
  }, 250)
}
</script>

<template>
  <div>
    <p class="hint">
      The remote API is being rebuilt. Once it's online, Buddy will show the backend URL and rotate the access token automatically when you log in or out of the host app.
    </p>
    <label class="field-label">App version</label>
    <div class="field-row">
      <input
        class="field-input"
        :value="version"
        readonly
      >
    </div>
    <label class="field-label">Backend URL</label>
    <div class="field-row">
      <input
        class="field-input"
        value="<not configured>"
        readonly
      >
    </div>
    <label class="field-label">Auth token</label>
    <div class="field-row">
      <input
        class="field-input"
        value="<not configured>"
        readonly
      >
    </div>
    <div class="test-row">
      <button
        class="test-btn"
        :disabled="testing"
        @click="testConnection"
      >
        {{ testing ? 'Testing…' : 'Test connection' }}
      </button>
      <span
        v-if="testResult"
        class="test-result"
        :class="testResult.ok ? 'test-ok' : 'test-err'"
      >
        {{ testResult.message }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 20px;
  font-size: 13px;
  color: #888;
  line-height: 1.5;
}
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #bbb;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field-row {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  align-items: flex-start;
}
.field-input {
  flex: 1;
  min-width: 0;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.03);
  padding: 8px 10px;
  color: #eee;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.field-input:focus {
  border-color: rgba(140,120,220,0.5);
  background: rgba(255,255,255,0.05);
}
.test-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 4px;
}
.test-btn {
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(255,255,255,0.04);
  color: #ddd;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.test-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; }
.test-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.test-result { font-size: 12px; line-height: 1.4; word-break: break-word; }
.test-ok { color: #6ee7a8; }
.test-err { color: #f59a9a; }
</style>
