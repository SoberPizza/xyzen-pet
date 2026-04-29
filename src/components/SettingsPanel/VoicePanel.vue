<script setup lang="ts">
/*
 * VoicePanel — "Voice" tab of SettingsDialog.
 *
 * Controls wake-word gating (toggle + active window) and live playback
 * volume. State is owned by `useHearingStore`. Wake-word / timeout changes
 * apply on the next voice session reconnect; volume updates live.
 */

import { storeToRefs } from 'pinia'

import { useHearingStore } from '../../stores/hearing'

const hearingStore = useHearingStore()
const { wakeWordEnabled, wakeWordTimeout, playbackVolume } = storeToRefs(hearingStore)
</script>

<template>
  <div>
    <p class="hint">
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

    <p class="hint">
      Changes take effect the next time the voice session reconnects. Volume updates live during playback.
    </p>
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
.field-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>
