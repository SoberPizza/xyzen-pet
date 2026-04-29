<script setup lang="ts">
/*
 * BuddiesPanel — "Buddies" tab of SettingsDialog.
 *
 * Shows the buddy grid with active-buddy highlight, cache/offline banner,
 * loading + error empty states, and a Retry action. Clicking a card opens
 * `BuddyDetailsDialog` for per-buddy editing.
 *
 * Data comes from `useBuddyStore`; on mount we retry `initialize({ force })`
 * when the store isn't loaded or its last fetch errored — covers (a) the
 * App.vue fire-and-forget init failing, (b) the user reopening the tab
 * after recovering from offline.
 */

import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import { useBuddyStore } from '../../stores/buddy'
import BuddyDetailsDialog from './BuddyDetailsDialog.vue'

const buddyStore = useBuddyStore()
const { buddies, activeBuddyId, loaded, loading, error, fromCache } = storeToRefs(buddyStore)

const buddiesArray = computed(() =>
  Object.entries(buddies.value).map(([id, buddy]) => ({ id, ...buddy })),
)

const errorHeadline = computed(() => {
  if (!error.value) return ''
  if (error.value.kind === 'auth') return 'Signed out'
  if (error.value.kind === 'network') return 'Offline'
  return 'Couldn’t load buddies'
})

const errorDetail = computed(() => {
  if (!error.value) return ''
  if (error.value.kind === 'auth')
    return 'Your session expired. Reconnect to edit or sync buddies.'
  if (error.value.kind === 'network')
    return 'Backend unreachable. Showing the last synced buddies if available.'
  return error.value.message
})

function retryLoadBuddies() {
  buddyStore
    .initialize({ force: true })
    .catch(err => console.warn('[buddy] initialize failed', err))
}

onMounted(() => {
  if (loading.value) return
  if (!loaded.value || error.value) retryLoadBuddies()
})

const detailsOpen = ref(false)
const selectedBuddyId = ref<string | null>(null)

function openBuddyDetails(id: string) {
  selectedBuddyId.value = id
  detailsOpen.value = true
}
</script>

<template>
  <div>
    <!-- Offline / cached banner -->
    <div
      v-if="buddiesArray.length > 0 && error"
      class="cache-banner"
      :class="error.kind === 'auth' ? 'cache-banner-auth' : 'cache-banner-offline'"
    >
      <span class="cache-dot" />
      <span class="cache-banner-text">
        <strong>{{ errorHeadline }}</strong>
        {{ fromCache ? '— showing cached buddies' : '' }}
      </span>
      <button
        class="cache-banner-btn"
        :disabled="loading"
        @click="retryLoadBuddies"
      >
        {{ loading ? 'Retrying…' : 'Retry' }}
      </button>
    </div>

    <div
      v-if="buddiesArray.length > 0"
      class="buddies-grid"
    >
      <div
        v-for="item in buddiesArray"
        :key="item.id"
        class="buddy-card"
        :class="{ 'buddy-active': item.id === activeBuddyId }"
        @click="openBuddyDetails(item.id)"
      >
        <div class="buddy-avatar">
          <img
            v-if="item.avatar"
            :src="item.avatar"
            :alt="item.name"
            class="buddy-avatar-img"
          >
          <svg
            v-else
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
          <span class="buddy-name">{{ item.name }}</span>
          <span class="buddy-desc">{{ item.race?.description?.slice(0, 60) || 'No description' }}{{ item.race?.description && item.race.description.length > 60 ? '...' : '' }}</span>
        </div>
        <span
          v-if="item.id === activeBuddyId"
          class="buddy-badge"
        >Active</span>
      </div>
    </div>
    <div
      v-else-if="loading"
      class="empty-state"
    >
      <div class="spinner" />
      <p>Loading buddies...</p>
    </div>
    <div
      v-else-if="error"
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
      <button
        class="retry-btn"
        :disabled="loading"
        @click="retryLoadBuddies"
      >
        {{ loading ? 'Retrying…' : 'Retry' }}
      </button>
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
      <p>No buddies yet</p>
    </div>

    <BuddyDetailsDialog
      v-model="detailsOpen"
      :buddy-id="selectedBuddyId"
    />
  </div>
</template>

<style scoped>
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
.buddy-avatar-img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
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
.error-text { color: #d88; font-weight: 500; }
.error-detail {
  max-width: 360px;
  color: #777;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.retry-btn {
  margin-top: 4px;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(100,70,200,0.2);
  color: #d8c8ff;
  cursor: pointer;
  transition: all 0.15s;
}
.retry-btn:hover:not(:disabled) {
  background: rgba(100,70,200,0.35);
  color: #fff;
}
.retry-btn:disabled { opacity: 0.55; cursor: default; }

.cache-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.3;
  color: #ccc;
  border: 1px solid transparent;
}
.cache-banner-offline {
  background: rgba(220, 160, 60, 0.08);
  border-color: rgba(220, 160, 60, 0.22);
  color: #e6c898;
}
.cache-banner-auth {
  background: rgba(220, 90, 90, 0.08);
  border-color: rgba(220, 90, 90, 0.22);
  color: #ecb0b0;
}
.cache-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
  box-shadow: 0 0 8px currentColor;
}
.cache-banner-text { flex: 1; }
.cache-banner-text strong { font-weight: 600; margin-right: 4px; }
.cache-banner-btn {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.cache-banner-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.2);
}
.cache-banner-btn:disabled { opacity: 0.5; cursor: default; }
.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255,255,255,0.08);
  border-top-color: rgba(140,120,220,0.6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
