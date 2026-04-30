<script setup lang="ts">
/**
 * Top-left status surface driven by the Buddy session-status SSE stream.
 *
 * Two elements stacked vertically:
 *  - Always-visible **pill** reflecting the current sustained UI keyword
 *    (idle / thinking / speaking / tool_running / tool_done).
 *  - Transient **toast stack** for one-shot lifecycle keywords
 *    (session_started / session_ended / disconnected / reconnected /
 *    error). Toasts auto-dismiss after 3 s and cap at 3 visible.
 *
 * Positioned absolutely by App.vue; `pointer-events: none` so the
 * overlay never fights with the FAB column or the edit-mode handles.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { BuddyUiKeyword } from '../ipc/bindings'
import { useBuddySession } from '../composables/useBuddySession'

// Sustained states drive the pill; the rest ride as toasts.
const SUSTAINED = new Set<BuddyUiKeyword>([
  'idle',
  'thinking',
  'speaking',
  'tool_running',
  'tool_done',
])

interface PillSpec {
  label: string
  /** CSS color class suffix: `pill--${tone}`. */
  tone: 'gray' | 'blue' | 'green' | 'amber' | 'red'
}

const PILL_BY_KEYWORD: Record<BuddyUiKeyword, PillSpec> = {
  idle:            { label: 'Idle',         tone: 'gray' },
  thinking:        { label: 'Thinking…', tone: 'blue' },
  speaking:        { label: 'Speaking',     tone: 'green' },
  tool_running:    { label: 'Using tool…', tone: 'amber' },
  tool_done:       { label: 'Tool done',    tone: 'green' },
  // One-shot keywords still have a pill entry for the brief window
  // between a `status` arriving with a one-shot `ui` and the next
  // sustained transition — matches the server's pattern of not
  // re-emitting the previous sustained value.
  session_started: { label: 'Session started', tone: 'green' },
  session_ended:   { label: 'Session ended',   tone: 'gray' },
  disconnected:    { label: 'Disconnected',    tone: 'red' },
  reconnected:     { label: 'Reconnected',     tone: 'green' },
  error:           { label: 'Error',            tone: 'red' },
}

const ONE_SHOT_TOASTS: Record<BuddyUiKeyword, { icon: string, label: string, tone: 'gray' | 'green' | 'amber' | 'red' } | null> = {
  idle: null,
  thinking: null,
  speaking: null,
  tool_running: null,
  tool_done: null,
  session_started: { icon: '▶', label: 'Session started', tone: 'green' },
  session_ended:   { icon: '✔', label: 'Session ended',   tone: 'gray' },
  disconnected:    { icon: '⚠', label: 'Disconnected',    tone: 'red' },
  reconnected:     { icon: '↻', label: 'Reconnected',     tone: 'green' },
  error:           { icon: '✖', label: 'Error',            tone: 'red' },
}

const TOAST_TTL_MS = 3000
const TOAST_MAX = 3

interface Toast {
  id: number
  icon: string
  label: string
  tone: 'gray' | 'green' | 'amber' | 'red'
  timer: ReturnType<typeof setTimeout>
}

const session = useBuddySession()

// Track the sustained pill separately from the raw `ui` ref: the pill
// should stick on the last sustained keyword even when a one-shot
// (disconnected / reconnected / …) briefly flashes through.
const sustainedUi = ref<BuddyUiKeyword>(SUSTAINED.has(session.ui.value) ? session.ui.value : 'idle')

const pill = computed<PillSpec>(() => PILL_BY_KEYWORD[sustainedUi.value])

const toasts = ref<Toast[]>([])
let nextToastId = 1

function pushToast(ui: BuddyUiKeyword) {
  const spec = ONE_SHOT_TOASTS[ui]
  if (!spec) return
  const id = nextToastId++
  const timer = setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, TOAST_TTL_MS)
  toasts.value.push({ id, ...spec, timer })
  if (toasts.value.length > TOAST_MAX) {
    const dropped = toasts.value.shift()
    if (dropped) clearTimeout(dropped.timer)
  }
}

watch(session.ui, (next) => {
  if (SUSTAINED.has(next)) {
    sustainedUi.value = next
  } else {
    pushToast(next)
  }
}, { immediate: false })

onBeforeUnmount(() => {
  for (const t of toasts.value) clearTimeout(t.timer)
  toasts.value = []
})
</script>

<template>
  <div class="status-overlay">
    <div
      class="pill"
      :class="`pill--${pill.tone}`"
    >
      <span class="dot" />
      <span class="label">{{ pill.label }}</span>
    </div>
    <transition-group
      name="toast"
      tag="div"
      class="toast-stack"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.tone}`"
      >
        <span class="toast-icon">{{ t.icon }}</span>
        <span class="toast-label">{{ t.label }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.status-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 95;
  max-width: calc(100% - 60px);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  background: rgba(20, 20, 25, 0.72);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e6e6ea;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  align-self: flex-start;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #888;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.pill--gray  .dot { background: #8c8c8c; }
.pill--blue  .dot { background: #6aa9ff; box-shadow: 0 0 6px rgba(106, 169, 255, 0.6); }
.pill--green .dot { background: #4ac08a; box-shadow: 0 0 6px rgba(74, 192, 138, 0.6); }
.pill--amber .dot { background: #f5b041; box-shadow: 0 0 6px rgba(245, 176, 65, 0.6); }
.pill--red   .dot { background: #e05757; box-shadow: 0 0 6px rgba(224, 87, 87, 0.6); }

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.toast {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(20, 20, 25, 0.82);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e6e6ea;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  align-self: flex-start;
}
.toast--gray  { border-color: rgba(140, 140, 140, 0.35); }
.toast--green { border-color: rgba(74, 192, 138, 0.45); }
.toast--amber { border-color: rgba(245, 176, 65, 0.45); }
.toast--red   { border-color: rgba(224, 87, 87, 0.45); }
.toast-icon {
  font-size: 12px;
  line-height: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
