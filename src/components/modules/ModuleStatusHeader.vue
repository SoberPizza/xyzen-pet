<script setup lang="ts">
const props = defineProps<{
  moduleName: string
  configured: boolean
}>()
</script>

<template>
  <div class="module-status-header">
    <div class="module-status-info">
      <slot name="icon" />
      <div class="module-status-text">
        <span class="module-status-name">{{ props.moduleName }}</span>
        <div class="module-status-indicator">
          <span
            class="status-dot"
            :class="props.configured ? 'dot-green' : 'dot-gray'"
          />
          <span class="status-label">{{ props.configured ? 'Available' : 'Unavailable' }}</span>
        </div>
      </div>
    </div>

    <slot name="action" />
  </div>
</template>

<style scoped>
.module-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  padding: 16px;
}
.module-status-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.module-status-text {
  display: flex;
  flex-direction: column;
}
.module-status-name {
  font-weight: 500;
  color: #f0f0f0;
  font-size: 14px;
}
.module-status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-green { background: #22c55e; }
.dot-gray { background: #555; }
.status-label {
  font-size: 12px;
  color: #888;
}
</style>
