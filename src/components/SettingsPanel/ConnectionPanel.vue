<script setup lang="ts">
/*
 * ConnectionPanel — "Connection" tab of SettingsDialog.
 *
 * Drives the Xyzen device-code auth flow. Editable backend origin + client
 * id live in the shared settings store so the Rust auth client picks up
 * changes without a restart. The auth status card subscribes to
 * `auth://status` and mirrors the state machine in `src-tauri/src/auth/`.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { AuthStatus } from '../../ipc/bindings'
import { commands } from '../../ipc/bindings'
import { useIpcEvent, useIpcSetting } from '../../ipc/client'

const DEFAULT_BACKEND_URL = 'http://localhost'
const DEFAULT_CLIENT_ID = 'buddy-desktop'

const version = ref('…')
const backendUrl = useIpcSetting<string>('settings/auth/backend_url', DEFAULT_BACKEND_URL)
const clientId = useIpcSetting<string>('settings/auth/client_id', DEFAULT_CLIENT_ID)

const status = ref<AuthStatus>({ kind: 'idle' })
const starting = ref(false)
const startError = ref<string | null>(null)

const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

const pending = computed(() => (status.value.kind === 'pending' ? status.value : null))
const secondsLeft = computed(() => {
  if (!pending.value) return 0
  return Math.max(0, Math.ceil((pending.value.expires_at_ms - now.value) / 1000))
})

async function hydrateStatus() {
  try {
    status.value = await commands.authStatus()
  } catch (err) {
    console.warn('[auth] status hydrate failed', err)
  }
}

useIpcEvent<AuthStatus>('auth://status', (payload) => {
  status.value = payload
})

onMounted(async () => {
  tick = setInterval(() => { now.value = Date.now() }, 1000)
  try {
    const info = await commands.appInfo()
    version.value = info.version
  } catch (err) {
    console.warn('[buddy] failed to read app info', err)
    version.value = '—'
  }
  await hydrateStatus()
})

onUnmounted(() => {
  if (tick !== null) clearInterval(tick)
})

async function signIn() {
  starting.value = true
  startError.value = null
  try {
    const res = await commands.authStart()
    if (res.status === 'error') {
      startError.value = res.error
    }
    // On success, the `auth://status` event will flip the UI to Pending.
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  } finally {
    starting.value = false
  }
}

async function cancel() {
  try {
    await commands.authCancel()
  } catch (err) {
    console.warn('[auth] cancel failed', err)
  }
}

async function signOut() {
  try {
    await commands.authSignOut()
  } catch (err) {
    console.warn('[auth] sign out failed', err)
  }
}
</script>

<template>
  <div>
    <p class="hint">
      Buddy signs in to Xyzen using a device-code flow. Click Sign in, then approve the request on your computer.
    </p>

    <label class="field-label">App version</label>
    <div class="field-row">
      <input
        class="field-input"
        :value="version"
        readonly
      >
    </div>

    <label class="field-label">Backend origin</label>
    <div class="field-row">
      <input
        v-model="backendUrl"
        class="field-input"
        :placeholder="DEFAULT_BACKEND_URL"
        spellcheck="false"
      >
    </div>
    <p class="field-hint">
      The Xyzen server's origin — the <code>/xyzen/api/v1/...</code> prefix is appended automatically.
    </p>

    <label class="field-label">Client ID</label>
    <div class="field-row">
      <input
        v-model="clientId"
        class="field-input"
        :placeholder="DEFAULT_CLIENT_ID"
        spellcheck="false"
      >
    </div>

    <div class="auth-card">
      <template v-if="status.kind === 'idle'">
        <div class="auth-row">
          <span class="auth-state">Not signed in</span>
          <button
            class="primary-btn"
            :disabled="starting"
            @click="signIn"
          >
            {{ starting ? 'Starting…' : 'Sign in' }}
          </button>
        </div>
        <p
          v-if="startError"
          class="auth-error"
        >
          {{ startError }}
        </p>
      </template>

      <template v-else-if="pending">
        <p class="auth-state">
          Enter this code on your computer:
        </p>
        <div class="user-code">
          {{ pending.user_code }}
        </div>
        <a
          class="auth-link"
          :href="pending.verification_uri_complete"
          target="_blank"
          rel="noopener"
        >
          Open approval page
        </a>
        <p class="auth-sub">
          Waiting for approval… expires in {{ secondsLeft }}s
        </p>
        <div class="auth-row">
          <button
            class="ghost-btn"
            @click="cancel"
          >
            Cancel
          </button>
        </div>
      </template>

      <template v-else-if="status.kind === 'authenticated'">
        <div class="auth-row">
          <span class="auth-state auth-ok">Signed in</span>
          <button
            class="ghost-btn"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </template>

      <template v-else-if="status.kind === 'error'">
        <p class="auth-state auth-err">
          {{ status.message }}
        </p>
        <p class="auth-sub">
          Code: {{ status.code }}
        </p>
        <div class="auth-row">
          <button
            class="primary-btn"
            :disabled="starting"
            @click="signIn"
          >
            Try again
          </button>
        </div>
      </template>
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
  margin-bottom: 6px;
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
.field-hint {
  margin: 0 0 14px;
  font-size: 11px;
  color: #777;
}
.field-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #aaa;
  background: rgba(255,255,255,0.04);
  padding: 1px 4px;
  border-radius: 3px;
}

.auth-card {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.02);
}
.auth-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.auth-state {
  font-size: 13px;
  color: #ccc;
  margin: 0;
}
.auth-state.auth-ok { color: #6ee7a8; }
.auth-state.auth-err { color: #f59a9a; }
.auth-sub {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #888;
}
.auth-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #f59a9a;
  word-break: break-word;
}
.user-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #eee;
  padding: 12px 14px;
  margin: 8px 0 10px;
  border-radius: 8px;
  background: rgba(140,120,220,0.08);
  border: 1px solid rgba(140,120,220,0.2);
  text-align: center;
}
.auth-link {
  display: inline-block;
  font-size: 13px;
  color: #b8a0ff;
  text-decoration: none;
  margin-bottom: 6px;
}
.auth-link:hover { text-decoration: underline; }

.primary-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(100,70,200,0.35);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}
.primary-btn:hover:not(:disabled) { background: rgba(100,70,200,0.5); }
.primary-btn:disabled { opacity: 0.55; cursor: default; }

.ghost-btn {
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(255,255,255,0.04);
  color: #ddd;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ghost-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
</style>
