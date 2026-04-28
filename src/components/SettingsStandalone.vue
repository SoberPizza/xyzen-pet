<script setup lang="ts">
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

import SettingsDialog from './SettingsDialog.vue'

const open = ref(true)
function onUpdate(value: boolean) {
  if (value) return
  invoke('close_buddy_settings_window').catch(() => {})
}
</script>

<template>
  <SettingsDialog
    :model-value="open"
    @update:model-value="onUpdate"
  />
</template>

<!-- Global overrides for the borderless, transparent settings window: let the
     OS window chrome (which is gone) reveal a clean dialog card, without the
     modal overlay's semi-transparent scrim or extra borders. -->
<style>
.dialog-overlay {
  background: transparent !important;
  backdrop-filter: none !important;
}
.dialog-content {
  width: 100vw !important;
  max-width: none !important;
  height: 100vh !important;
  max-height: none !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
</style>
