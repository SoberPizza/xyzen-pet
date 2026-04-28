<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useGeneralStore } from '../../stores/general'
import ModuleStatusHeader from './ModuleStatusHeader.vue'

const generalStore = useGeneralStore()
const { configured, brightness, language } = storeToRefs(generalStore)

const brightnessPercent = computed(() => Math.round(brightness.value * 100))
</script>

<template>
  <div class="module-page">
    <ModuleStatusHeader
      module-name="General"
      :configured="configured"
    >
      <template #icon>
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#888"
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
      </template>
    </ModuleStatusHeader>

    <div class="module-card">
      <div class="card-label-row">
        <label
          class="card-label"
          for="general-brightness"
        >Brightness</label>
        <span class="card-readout">{{ brightnessPercent }}%</span>
      </div>
      <input
        id="general-brightness"
        v-model.number="brightness"
        type="range"
        min="0.3"
        max="1.2"
        step="0.05"
        class="range-input"
      >
    </div>

    <div class="module-card">
      <label
        class="card-label"
        for="general-language"
      >Language</label>
      <select
        id="general-language"
        v-model="language"
        class="select-input"
      >
        <option value="en">
          English
        </option>
        <option value="zh">
          中文
        </option>
      </select>
      <p class="card-hint">
        Additional translations coming soon — the UI currently renders in English.
      </p>
    </div>
  </div>
</template>

<style scoped>
.module-page { display: flex; flex-direction: column; gap: 16px; }
.module-card {
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  padding: 16px;
}
.card-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 12px;
}
.card-label {
  display: block;
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 500;
  color: #888;
}
.card-label-row .card-label { margin: 0; }
.card-readout {
  font-size: 12px;
  color: #aaa;
  font-variant-numeric: tabular-nums;
}
.range-input {
  width: 100%;
  accent-color: #6aa2ff;
}
.select-input {
  width: 100%;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #eee;
  outline: none;
  box-sizing: border-box;
}
.card-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #777;
  line-height: 1.5;
}
</style>
