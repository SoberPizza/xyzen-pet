<script setup lang="ts">
import { useBuddyStore } from '../stores/buddy'
import { useHearingStore } from '../stores/hearing'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { initXyzen } from '../services/xyzen'
import { HttpError } from '../services/xyzen/http'
import BuddyDetailsDialog from './BuddyDetailsDialog.vue'
import GeneralModule from './modules/GeneralModule.vue'
import VisionModule from './modules/VisionModule.vue'


const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const settingsOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function closeDialog() { settingsOpen.value = false }

function retryLoadBuddies() {
  buddyStore
    .initialize({ force: true })
    .catch(err => console.warn('[buddy] initialize failed', err))
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) closeDialog()
}

type SettingsSection = 'buddies' | 'general' | 'vision' | 'voice' | 'connection'
const activeSection = ref<SettingsSection>('buddies')

const settingsSections: { id: SettingsSection, label: string }[] = [
  { id: 'buddies', label: 'Buddies' },
  { id: 'general', label: 'General' },
  { id: 'vision', label: 'Vision' },
  { id: 'voice', label: 'Voice' },
  { id: 'connection', label: 'Connection' },
]


// Voice / wake-word settings
const hearingStore = useHearingStore()
const { wakeWordEnabled, wakeWordTimeout, playbackVolume } = storeToRefs(hearingStore)

function setActiveSection(section: SettingsSection) {
  activeSection.value = section
}

// Buddy state
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

// Auto-retry initialize() whenever the dialog opens if we're not loaded,
// or if we're only showing cached data because the last fetch errored.
// Covers: (a) App.vue fire-and-forget init failed, (b) user recovered
// from offline and wants fresh data.
watch(
  () => settingsOpen.value,
  (open) => {
    if (!open || loading.value) return
    if (!loaded.value || error.value)
      retryLoadBuddies()
  },
  { immediate: true },
)

const detailsOpen = ref(false)
const selectedBuddyId = ref<string | null>(null)

function openBuddyDetails(id: string) {
  selectedBuddyId.value = id
  detailsOpen.value = true
}

// Connection section — read-only status surface. Credentials flow in from
// the active CredentialProvider (Tauri sibling bridge today). "Test
// connection" still pings the backend to verify reachability + token.
const backendUrlInput = ref('')
const tokenInput = ref('')
const connectionLoaded = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean, message: string } | null>(null)

async function ensureConnectionLoaded() {
  if (connectionLoaded.value) return
  try {
    const { config } = await initXyzen()
    backendUrlInput.value = config.baseUrl
    tokenInput.value = config.token
  } catch (err) {
    console.warn('[buddy] failed to load xyzen config', err)
  }
  connectionLoaded.value = true
}

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

watch(
  () => [settingsOpen.value, activeSection.value] as const,
  ([open, section]) => {
    if (open && section === 'connection') void ensureConnectionLoaded()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="settingsOpen"
        class="dialog-overlay"
        @click="onOverlayClick"
      >
        <div class="dialog-content">
          <!-- Header -->
          <div
            class="dialog-header"
            data-tauri-drag-region
          >
            <h2
              class="dialog-title"
              data-tauri-drag-region
            >
              Settings
            </h2>
            <button
              class="close-btn"
              @click="closeDialog"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              ><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <!-- Body: sidebar + content -->
          <div class="dialog-body">
            <!-- Sidebar -->
            <nav class="dialog-sidebar">
              <button
                v-for="section in settingsSections"
                :key="section.id"
                class="sidebar-btn"
                :class="{ 'sidebar-active': activeSection === section.id }"
                @click="setActiveSection(section.id)"
              >
                <!-- Buddies icon -->
                <svg
                  v-if="section.id === 'buddies'"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                ><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle
                  cx="12"
                  cy="7"
                  r="4"
                /></svg>
                <!-- General icon (sliders) -->
                <svg
                  v-else-if="section.id === 'general'"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                ><line
                  x1="4"
                  y1="7"
                  x2="20"
                  y2="7"
                /><line
                  x1="4"
                  y1="12"
                  x2="20"
                  y2="12"
                /><line
                  x1="4"
                  y1="17"
                  x2="20"
                  y2="17"
                /><circle
                  cx="9"
                  cy="7"
                  r="2"
                /><circle
                  cx="15"
                  cy="12"
                  r="2"
                /><circle
                  cx="9"
                  cy="17"
                  r="2"
                /></svg>
                <!-- Vision icon (eye) -->
                <svg
                  v-else-if="section.id === 'vision'"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
                  cx="12"
                  cy="12"
                  r="3"
                /></svg>
                <!-- Voice icon (mic) -->
                <svg
                  v-else-if="section.id === 'voice'"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                ><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line
                  x1="12"
                  y1="19"
                  x2="12"
                  y2="23"
                /><line
                  x1="8"
                  y1="23"
                  x2="16"
                  y2="23"
                /></svg>
                <!-- Connection icon -->
                <svg
                  v-else-if="section.id === 'connection'"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                ><path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" /><path d="M3 12a9 9 0 0 1 9-9" /><path d="M21 12a9 9 0 0 1-9 9" /></svg>
                <span>{{ section.label }}</span>
              </button>
            </nav>

            <!-- Content area -->
            <div class="dialog-content-area">
              <!-- Buddies section -->
              <div
                v-if="activeSection === 'buddies'"
                class="content-pad"
              >
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
              </div>

              <!-- General section -->
              <div
                v-else-if="activeSection === 'general'"
                class="content-pad"
              >
                <GeneralModule />
              </div>

              <!-- Vision section -->
              <div
                v-else-if="activeSection === 'vision'"
                class="content-pad"
              >
                <VisionModule />
              </div>

              <!-- Voice section -->
              <div
                v-else-if="activeSection === 'voice'"
                class="content-pad"
              >
                <p class="connection-hint">
                  Configure how Buddy listens. With wake word enabled, Buddy stays silent until it hears its name or a nickname; otherwise every utterance is sent as a turn. Edit the name and nicknames on the buddy's profile.
                </p>

                <label class="toggle-row">
                  <input
                    v-model="wakeWordEnabled"
                    type="checkbox"
                  >
                  <span>Require wake phrase before replying</span>
                </label>

                <label
                  class="field-label"
                  for="wake-timeout"
                >Active window after wake (ms)</label>
                <div class="field-row">
                  <input
                    id="wake-timeout"
                    v-model.number="wakeWordTimeout"
                    type="number"
                    min="1000"
                    step="500"
                    class="field-input"
                    :disabled="!wakeWordEnabled"
                  >
                </div>

                <div class="field-label-row">
                  <label
                    class="field-label"
                    for="playback-volume"
                  >Playback volume</label>
                  <span class="field-readout">{{ Math.round(playbackVolume * 100) }}%</span>
                </div>
                <div class="field-row">
                  <input
                    id="playback-volume"
                    v-model.number="playbackVolume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    class="volume-slider"
                  >
                </div>

                <p class="connection-hint">
                  Changes take effect the next time the voice session reconnects. Volume updates live during playback.
                </p>
              </div>

              <!-- Connection section -->
              <div
                v-else-if="activeSection === 'connection'"
                class="content-pad"
              >
                <p class="connection-hint">
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
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <BuddyDetailsDialog
    v-model="detailsOpen"
    :buddy-id="selectedBuddyId"
  />
</template>

<style scoped>
/* Overlay */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Dialog box */
.dialog-content {
  width: 90vw;
  max-width: 880px;
  max-height: 85vh;
  border-radius: 16px;
  overflow: hidden;
  background: #1a1a1e;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
}

/* Header */
.dialog-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.dialog-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #f0f0f0;
}
.close-btn {
  border-radius: 8px;
  padding: 6px;
  border: none;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: all 0.2s;
}
.close-btn:hover { color: #eee; background: rgba(255,255,255,0.06); }

/* Body layout */
.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Sidebar */
.dialog-sidebar {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255,255,255,0.06);
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  padding: 8px 12px;
  text-align: left;
  font-size: 14px;
  border: none;
  background: transparent;
  color: #999;
  cursor: pointer;
  transition: all 0.15s;
}
.sidebar-btn:hover { background: rgba(255,255,255,0.05); color: #ccc; }
.sidebar-active {
  background: rgba(100,70,200,0.12) !important;
  color: #b8a0ff !important;
  font-weight: 500;
}

/* Content area */
.dialog-content-area {
  flex: 1;
  overflow-y: auto;
}
.dialog-content-area::-webkit-scrollbar { width: 6px; }
.dialog-content-area::-webkit-scrollbar-track { background: transparent; }
.dialog-content-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
.content-pad { padding: 20px; }

/* Buddies */
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

/* Empty state */
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

/* Connection section */
.connection-hint {
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
.field-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.field-label-row .field-label { margin-bottom: 6px; }
.field-readout {
  font-size: 12px;
  color: #888;
  font-variant-numeric: tabular-nums;
}
.volume-slider {
  flex: 1;
  min-width: 0;
  accent-color: #8c78dc;
  cursor: pointer;
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
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  font-size: 13px;
  color: #ddd;
  cursor: pointer;
}
.toggle-row input[type="checkbox"] { accent-color: #8c78dc; }

.field-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  resize: vertical;
  min-height: 64px;
  word-break: break-all;
}
.field-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(100,70,200,0.25);
  color: #d8c8ff;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.field-btn:hover:not(:disabled) { background: rgba(100,70,200,0.4); color: #fff; }
.field-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

/* Dialog transition */
.dialog-enter-active, .dialog-leave-active {
  transition: all 0.25s ease;
}
.dialog-enter-active .dialog-content, .dialog-leave-active .dialog-content {
  transition: all 0.25s ease;
}
.dialog-enter-from, .dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .dialog-content, .dialog-leave-to .dialog-content {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
</style>
