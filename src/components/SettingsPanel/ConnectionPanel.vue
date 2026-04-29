<script setup lang="ts">
/*
 * ConnectionPanel — "Connection" tab of SettingsDialog.
 *
 * Read-only status surface for the Xyzen backend session. The active
 * CredentialProvider (Tauri sibling bridge today) supplies baseUrl + token;
 * this panel displays them and lets the user ping the backend to verify
 * reachability and token validity.
 *
 * Credentials are loaded lazily on mount — the panel only mounts when the
 * Connection tab is active, so the import cost of `initXyzen` is paid only
 * when the user visits this tab.
 */

import { onMounted, ref } from 'vue'

import { initXyzen } from '../../services'
import { HttpError } from '../../services/http'

const backendUrlInput = ref('')
const tokenInput = ref('')
const testing = ref(false)
const testResult = ref<{ ok: boolean, message: string } | null>(null)

onMounted(async () => {
  try {
    const { config } = await initXyzen()
    backendUrlInput.value = config.baseUrl
    tokenInput.value = config.token
  } catch (err) {
    console.warn('[buddy] failed to load xyzen config', err)
  }
})

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const { http } = await initXyzen()
    await http.get('/root-agent/')
    testResult.value = { ok: true, message: 'Connected — backend reachable and token accepted.' }
  } catch (err) {
    const msg = err instanceof HttpError
      ? `${err.status}: ${err.message}`
      : err instanceof Error
        ? err.message
        : 'Unknown error'
    testResult.value = { ok: false, message: msg }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div>
    <p class="hint">
      Connected via the Xyzen desktop app. The main window owns the access token; Buddy rotates automatically when you log in or out of Xyzen.
    </p>
    <label class="field-label">Backend URL</label>
    <div class="field-row">
      <input
        class="field-input"
        :value="backendUrlInput || '—'"
        readonly
      >
    </div>
    <label class="field-label">Auth token</label>
    <div class="field-row">
      <input
        class="field-input"
        :value="tokenInput ? `${tokenInput.slice(0, 16)}…` : '—'"
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
