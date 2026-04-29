<script setup lang="ts">
/*
 * SettingsDialog — the buddy settings surface.
 *
 * Two mount paths share this component:
 *  - Tauri: rendered full-window inside `SettingsStandalone.vue`, which
 *    lives at `#/settings` and is opened via the `open_buddy_settings_window`
 *    IPC command.
 *  - Browser dev: rendered as an in-app modal from `App.vue` when the
 *    settings FAB is clicked (no dedicated window available).
 *
 * This file owns only the dialog chrome (overlay, header, sidebar, content
 * slot, transition). Each section lives in its own component under
 * `SettingsPanel/` — panels mount lazily when their tab becomes active, so
 * they own their own loading lifecycle.
 */

import { computed, ref } from 'vue'

import BuddiesPanel from './SettingsPanel/Buddies/BuddiesPanel.vue'
import ConnectionPanel from './SettingsPanel/ConnectionPanel.vue'
import GeneralPanel from './SettingsPanel/GeneralPanel.vue'
import VisionPanel from './SettingsPanel/VisionPanel.vue'
import VoicePanel from './SettingsPanel/VoicePanel.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const settingsOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function closeDialog() { settingsOpen.value = false }

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) closeDialog()
}

// Buddies and Connection panels are restored as UI shells — their internal
// wiring is no-op'd until the new backend API lands.
type SettingsSection = 'buddies' | 'general' | 'vision' | 'voice' | 'connection'
const activeSection = ref<SettingsSection>('buddies')

const settingsSections: { id: SettingsSection, label: string }[] = [
  { id: 'buddies', label: 'Buddies' },
  { id: 'general', label: 'General' },
  { id: 'vision', label: 'Vision' },
  { id: 'voice', label: 'Voice' },
  { id: 'connection', label: 'Connection' },
]

function setActiveSection(section: SettingsSection) {
  activeSection.value = section
}
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
              <div class="content-pad">
                <BuddiesPanel v-if="activeSection === 'buddies'" />
                <GeneralPanel v-else-if="activeSection === 'general'" />
                <VisionPanel v-else-if="activeSection === 'vision'" />
                <VoicePanel v-else-if="activeSection === 'voice'" />
                <ConnectionPanel v-else-if="activeSection === 'connection'" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
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
