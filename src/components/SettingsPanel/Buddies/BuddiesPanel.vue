<script setup lang="ts">
/*
 * BuddiesPanel — "Buddies" tab of SettingsDialog.
 *
 * Cache-first: the envelope lives in the settings-plugin store under
 * `buddy/cache/envelope` and is refreshed only on explicit Refresh,
 * post-auth warm, or write-through mutations. Normal opens do zero
 * network traffic. The settings-changed event stream keeps every
 * window's view in sync automatically.
 */

import { computed, ref } from 'vue'

import type { BuddyError, CachedBuddyEnvelope } from '../../../ipc/bindings'
import { commands } from '../../../ipc/bindings'
import { useIpcSetting } from '../../../ipc/client'
import { CACHE_KEY_BUDDY_ENVELOPE } from '../../../ipc/keys'
import BuddyDetailsDialog from './BuddyDetailsDialog.vue'

const cached = useIpcSetting<CachedBuddyEnvelope | null>(
  CACHE_KEY_BUDDY_ENVELOPE,
  null,
)

const envelope = computed(() => cached.value?.envelope ?? null)
const activeBuddy = computed(() => envelope.value?.buddy ?? null)
const race = computed(() => envelope.value?.race ?? null)

const localeIsZh = typeof navigator !== 'undefined'
  && (navigator.language || '').toLowerCase().startsWith('zh')

const raceLabel = computed(() => {
  const r = race.value
  if (!r) return ''
  return (localeIsZh ? r.name_zh : r.name_en) || r.code
})

const subtitle = computed(() => {
  const b = activeBuddy.value
  if (!b) return ''
  const parts: string[] = []
  if (raceLabel.value) parts.push(raceLabel.value)
  parts.push(`Lv ${b.bonding_level}`)
  return parts.join(' · ') || b.stage
})

// --- Sync + errors ---
const syncing = ref(false)
const syncError = ref<BuddyError | null>(null)
// `now` ticks every 30s so the "last synced Xm ago" caption stays fresh
// without us reaching for a full reactive-clock utility.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
if (typeof window !== 'undefined') {
  clockTimer = setInterval(() => { now.value = Date.now() }, 30_000)
  import('vue').then(({ onScopeDispose }) => {
    onScopeDispose(() => {
      if (clockTimer) clearInterval(clockTimer)
    })
  })
}

const lastSyncedLabel = computed(() => {
  const t = cached.value?.synced_at_ms
  if (!t) return ''
  const diffMs = Math.max(0, now.value - t)
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(t).toLocaleDateString()
})

const errorHeadline = computed(() => {
  const e = syncError.value
  if (!e) return ''
  if (e.kind === 'unauthenticated') return 'Not signed in'
  if (e.kind === 'unauthorized') return 'Session expired'
  return 'Sync failed'
})

const errorDetail = computed(() => {
  const e = syncError.value
  if (!e) return ''
  if (e.kind === 'unauthenticated')
    return 'Sign in on the Connection tab to load your buddy.'
  if (e.kind === 'unauthorized')
    return 'Your session expired — sign in again on the Connection tab.'
  if (e.kind === 'not_found') return 'Buddy not found on the server.'
  if (e.kind === 'conflict' || e.kind === 'validation' || e.kind === 'transport')
    return e.message
  if (e.kind === 'server') return `${e.status}: ${e.message}`
  return ''
})

const isAuthError = computed(() => {
  const e = syncError.value
  return !!e && (e.kind === 'unauthenticated' || e.kind === 'unauthorized')
})

async function refresh() {
  syncing.value = true
  syncError.value = null
  try {
    const result = await commands.buddySync()
    if (result.status === 'error') syncError.value = result.error
    // Success path: Rust wrote the cache, `useIpcSetting` re-reads via
    // the settings-changed event — no local mutation needed here.
  } catch (err) {
    syncError.value = {
      kind: 'transport',
      message: err instanceof Error ? err.message : String(err),
    }
  } finally {
    syncing.value = false
  }
}

const detailsOpen = ref(false)

function openBuddyDetails() {
  if (activeBuddy.value) detailsOpen.value = true
}
</script>

<template>
  <div>
    <div
      v-if="activeBuddy"
      class="card-wrap"
    >
      <div class="buddies-grid">
        <div
          class="buddy-card buddy-active"
          @click="openBuddyDetails"
        >
          <div class="buddy-avatar">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            ><circle
              cx="12"
              cy="8"
              r="4"
            /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
          </div>
          <div class="buddy-info">
            <span class="buddy-name">{{ activeBuddy.name }}</span>
            <span class="buddy-desc">{{ subtitle }}</span>
          </div>
          <span class="buddy-badge">Active</span>
        </div>
      </div>
      <div class="card-footer">
        <span class="sync-caption">
          <template v-if="lastSyncedLabel">Last synced {{ lastSyncedLabel }}</template>
        </span>
        <button
          class="refresh-btn"
          :disabled="syncing"
          @click="refresh"
        >
          {{ syncing ? 'Syncing…' : 'Refresh' }}
        </button>
      </div>
      <div
        v-if="syncError"
        class="inline-error"
      >
        {{ errorDetail || errorHeadline }}
      </div>
    </div>
    <div
      v-else-if="syncError && isAuthError"
      class="empty-state"
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#c55"
        stroke-width="1.5"
      ><circle
        cx="12"
        cy="12"
        r="10"
      /><line
        x1="12"
        y1="8"
        x2="12"
        y2="12"
      /><line
        x1="12"
        y1="16"
        x2="12.01"
        y2="16"
      /></svg>
      <p class="error-text">
        {{ errorHeadline }}
      </p>
      <p class="error-detail">
        {{ errorDetail }}
      </p>
    </div>
    <div
      v-else
      class="empty-state"
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#555"
        stroke-width="1"
      ><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle
        cx="12"
        cy="7"
        r="4"
      /></svg>
      <p>No buddy cached yet</p>
      <p class="empty-hint">
        Sync with the server to load your buddy.
      </p>
      <button
        class="sync-cta"
        :disabled="syncing"
        @click="refresh"
      >
        {{ syncing ? 'Syncing…' : 'Sync now' }}
      </button>
      <p
        v-if="syncError"
        class="error-detail"
      >
        {{ errorDetail || errorHeadline }}
      </p>
    </div>

    <BuddyDetailsDialog
      v-model="detailsOpen"
      :cached="cached"
    />
  </div>
</template>

<style scoped>
.card-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.buddies-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.buddy-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-radius: 12px;
  padding: 16px;
  border: 2px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}
.buddy-card:hover { border-color: rgba(140,120,220,0.3); background: rgba(255,255,255,0.04); }
.buddy-active {
  border-color: rgba(140,120,220,0.4) !important;
  background: rgba(100,70,200,0.08) !important;
}
.buddy-avatar {
  color: #666;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}
.buddy-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.buddy-name { font-size: 14px; font-weight: 500; color: #eee; }
.buddy-desc { font-size: 12px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.buddy-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(100,70,200,0.3);
  color: #b8a0ff;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 4px;
}
.sync-caption {
  font-size: 11px;
  color: #777;
}
.refresh-btn {
  border: none;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(100,70,200,0.18);
  color: #c4b0ff;
  cursor: pointer;
  transition: all 0.15s;
}
.refresh-btn:hover:not(:disabled) {
  background: rgba(100,70,200,0.3);
  color: #fff;
}
.refresh-btn:disabled { opacity: 0.55; cursor: default; }

.inline-error {
  font-size: 12px;
  color: #e08a8a;
  padding: 0 4px;
  line-height: 1.4;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
  color: #555;
  font-size: 14px;
}
.empty-state p { margin: 0; }
.empty-hint { font-size: 12px; color: #777; max-width: 300px; line-height: 1.5; }
.error-text { color: #d88; font-weight: 500; }
.error-detail {
  max-width: 360px;
  color: #777;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.sync-cta {
  margin-top: 4px;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(100,70,200,0.22);
  color: #d8c8ff;
  cursor: pointer;
  transition: all 0.15s;
}
.sync-cta:hover:not(:disabled) {
  background: rgba(100,70,200,0.38);
  color: #fff;
}
.sync-cta:disabled { opacity: 0.55; cursor: default; }
</style>
