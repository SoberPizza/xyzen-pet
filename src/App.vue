<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'

import { useAudioContext } from './stores/audio'
import { useGeneralStore } from './stores/general'
import { useBuddyVoiceSession } from './composables/useBuddyVoiceSession'
import SettingsStandalone from './components/SettingsStandalone.vue'
import { animations } from './three/assets/vrm'
import { resolveVrmAsset } from './three/assets/vrm/models/registry'
import ThreeScene from './three/components/ThreeScene.vue'
import { DEFAULT_GESTURE_ACTIONS, useVRMGestureDriver } from './three/composables/vrm/gesture-driver'
import { useModelStore } from './three/stores/model-store'
import { invoke } from '@tauri-apps/api/core'
import type { CachedBuddyEnvelope } from './ipc/bindings'
import { commands } from './ipc/bindings'
import { useIpcSetting } from './ipc/client'
import { CACHE_KEY_BUDDY_ENVELOPE } from './ipc/keys'

const audioContextStore = useAudioContext()
const generalStore = useGeneralStore()

// VRM + animation driver come from the Rust buddy cache: `buddy_get_me`
// returns a `BuddyCoreDTO.vrm_model` filename, which `resolveVrmAsset`
// maps to a bundled URL + optional per-model gesture driver.
const cachedBuddyEnvelope = useIpcSetting<CachedBuddyEnvelope | null>(
  CACHE_KEY_BUDDY_ENVELOPE,
  null,
)
const activeVrmAsset = computed(() => {
  const vrmModel = cachedBuddyEnvelope.value?.envelope?.buddy?.vrm_model
  return vrmModel ? resolveVrmAsset(vrmModel) : undefined
})
const stageModelSelectedUrl = computed<string | undefined>(() => activeVrmAsset.value?.url)
const stageModelRenderer = computed<'vrm' | 'disabled'>(() =>
  activeVrmAsset.value ? 'vrm' : 'disabled',
)
const stageViewControlsEnabled = ref(false)
const activeDisplayConfig = computed(() => undefined)

const { brightness } = storeToRefs(generalStore)
const buddyRootStyle = computed(() => ({ filter: `brightness(${brightness.value})` }))

// The bundled buddy app serves two surfaces: the main overlay window (default
// route) and the Settings window (#/settings). Settings runs in its own Tauri
// window opened via `open_buddy_settings_window`.
const isSettingsRoute = typeof window !== 'undefined' && window.location.hash.startsWith('#/settings')

const hovering = ref(false)

// --- Edit-mode state: window resize persisted here; VRM position lives in the
//     model store's `modelOffset` (Vec3 in world space) which VRMModel watches
//     and applies to `vrmGroup.position`. ---
const WINDOW_DEFAULT = { w: 240, h: 320 }
const WINDOW_MIN = { w: 180, h: 240 }
const WINDOW_MAX = { w: 640, h: 900 }
const windowSize = useLocalStorage('buddy-window-size', { ...WINDOW_DEFAULT })
const editMode = ref(false)
function toggleEditMode() { editMode.value = !editMode.value }

const modelStore = useModelStore()
const { modelOffset, cameraDistance, cameraFOV } = storeToRefs(modelStore)

// --- Edit-mode drag / resize ---
interface DragState {
  kind: 'move' | 'resize'
  startX: number
  startY: number
  baseOffsetX: number
  baseOffsetY: number
  baseW: number
  baseH: number
  worldPerPixel: number
}
const drag = ref<DragState | null>(null)

/**
 * Convert a screen-pixel delta into a world-space delta at the model plane.
 * Visible height at distance d with vertical FOV is `2 * d * tan(fov/2)`;
 * dividing by the current container height gives world units per pixel.
 */
function currentWorldPerPixel(): number {
  const containerH = windowSize.value.h
  if (!containerH) return 0.003
  const d = Math.max(cameraDistance.value, 1e-3)
  const fovRad = (cameraFOV.value * Math.PI) / 180
  return (2 * d * Math.tan(fovRad / 2)) / containerH
}

function onMoveHandleDown(e: PointerEvent) {
  if (!editMode.value) return
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag.value = {
    kind: 'move',
    startX: e.clientX,
    startY: e.clientY,
    baseOffsetX: modelOffset.value.x,
    baseOffsetY: modelOffset.value.y,
    baseW: windowSize.value.w,
    baseH: windowSize.value.h,
    worldPerPixel: currentWorldPerPixel(),
  }
}

function onResizeHandleDown(e: PointerEvent) {
  if (!editMode.value) return
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag.value = {
    kind: 'resize',
    startX: e.clientX,
    startY: e.clientY,
    baseOffsetX: modelOffset.value.x,
    baseOffsetY: modelOffset.value.y,
    baseW: windowSize.value.w,
    baseH: windowSize.value.h,
    worldPerPixel: 0,
  }
}

function onDragMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const dx = e.clientX - d.startX
  const dy = e.clientY - d.startY
  if (d.kind === 'move') {
    // Camera sits on the -Z side looking toward +Z, so its own +X axis
    // (screen-right) maps to world -X. Negate dx so a rightward drag moves
    // the model rightward on screen. Screen-y points down; world-y points
    // up — invert dy.
    modelOffset.value = {
      x: d.baseOffsetX - dx * d.worldPerPixel,
      y: d.baseOffsetY - dy * d.worldPerPixel,
      z: modelOffset.value.z,
    }
  } else {
    // Resize handle sits at the top-left; dragging up/left grows the window.
    windowSize.value = {
      w: Math.max(WINDOW_MIN.w, Math.min(WINDOW_MAX.w, d.baseW - dx)),
      h: Math.max(WINDOW_MIN.h, Math.min(WINDOW_MAX.h, d.baseH - dy)),
    }
  }
}

function onDragUp(e: PointerEvent) {
  if (!drag.value) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  drag.value = null
}

// Fire-and-forget Tauri IPC. Errors are swallowed so jsdom test mounts (and
// any transient bridge failure) don't blow up the caller.
function tauriInvoke(cmd: string, args?: Record<string, unknown>): void {
  invoke(cmd, args).catch(() => {})
}

// --- Keep the Tauri window in sync with the persisted logical size. ---
let pendingResize: number | null = null
function scheduleTauriResize() {
  if (pendingResize !== null) return
  pendingResize = requestAnimationFrame(() => {
    pendingResize = null
    tauriInvoke('resize_buddy_window', {
      w: windowSize.value.w,
      h: windowSize.value.h,
    })
  })
}
watch(windowSize, scheduleTauriResize, { deep: true })

// --- UI panels ---
const fabsVisible = computed(() => hovering.value || editMode.value)

function openSettings() {
  tauriInvoke('open_buddy_settings_window')
}

// Drag-vs-click guard for the Settings FAB. The button carries
// `data-tauri-drag-region` so the OS can grab it to move the window; without
// this guard, releasing after a drag also fires @click and would open the
// settings window. We track pointer-move distance and suppress the click once
// movement crosses the threshold.
const DRAG_THRESHOLD_PX = 5
const settingsPointerStart = ref<{ x: number, y: number } | null>(null)
const settingsWasDragged = ref(false)

function onSettingsPointerDown(e: PointerEvent) {
  settingsPointerStart.value = { x: e.clientX, y: e.clientY }
  settingsWasDragged.value = false
}

function onSettingsPointerMove(e: PointerEvent) {
  const start = settingsPointerStart.value
  if (!start) return
  const dx = e.clientX - start.x
  const dy = e.clientY - start.y
  if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
    settingsWasDragged.value = true
  }
}

function onSettingsClick() {
  const dragged = settingsWasDragged.value
  settingsPointerStart.value = null
  settingsWasDragged.value = false
  if (dragged) return
  openSettings()
}

const vrmViewerRef = ref<InstanceType<typeof ThreeScene>>()
const currentAudioSource = shallowRef<AudioNode>()

// --- Audio context ---
const { audioContext } = audioContextStore

// --- Gesture driver: IPC `avatar://gesture` events → VRM actions. ---
//
// Function-form `registry` so swapping the active buddy also swaps its
// per-model gesture overrides — `useVRMGestureDriver` flushes the
// cooldown map when the returned registry reference changes.
useVRMGestureDriver({
  target: () => {
    if (stageModelRenderer.value !== 'vrm') return undefined
    const viewer = vrmViewerRef.value
    if (!viewer) return undefined
    return {
      setExpression: (name, intensity) => viewer.setExpression(name, intensity),
      setLookAt: (dir, ms) => viewer.setLookAt(dir, ms),
      pulseMorph: (name, peak, ms) => viewer.pulseMorph(name, peak, ms),
    }
  },
  registry: () => ({
    ...DEFAULT_GESTURE_ACTIONS,
    ...(activeVrmAsset.value?.driver?.gestures ?? {}),
  }),
})

// --- Voice session: driven by the Rust FSM via IPC. ---
const voiceSession = useBuddyVoiceSession()

const micFabState = computed<'on' | 'off' | 'connecting' | 'error'>(() => {
  if (voiceSession.state.value === 'error') return 'error'
  if (voiceSession.state.value === 'connecting') return 'connecting'
  if (voiceSession.state.value === 'off') return 'off'
  return 'on'
})
const micFabTitle = computed(() => {
  switch (micFabState.value) {
    case 'on': return 'Voice on — click to mute'
    case 'connecting': return 'Connecting voice…'
    case 'error': return voiceSession.error.value ?? 'Voice error — click to retry'
    case 'off':
    default: return 'Voice off — click to enable'
  }
})
async function onMicFabClick() {
  console.info('[buddy:voice:app] mic FAB clicked', { wasOn: voiceSession.isOn.value })
  try {
    await voiceSession.toggle()
  }
  catch (err) {
    console.warn('[buddy] voice toggle failed', err)
  }
}

// Resume audio context on first interaction
let audioContextResumed = false
function resumeAudioContextOnInteraction(e: Event) {
  if (audioContextResumed || !audioContext) return
  audioContextResumed = true
  console.info('[buddy:voice:app] audio context resumed via', e.type, {
    prevState: audioContext.state,
  })
  audioContext.resume().catch(() => {})
}

if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown']
  events.forEach((event) => {
    window.addEventListener(event, resumeAudioContextOnInteraction, { once: true, passive: true })
  })
}

// --- Lifecycle ---
onMounted(async () => {
  if (isSettingsRoute) return

  // Restore persisted window size on first paint so buddy matches the
  // user's last layout. Rust will clamp + re-anchor to the bottom-right.
  tauriInvoke('resize_buddy_window', {
    w: windowSize.value.w,
    h: windowSize.value.h,
  })

  // Warm the buddy envelope on mount — `useIpcSetting` picks up the
  // resulting `settings://changed` emission and drives the VRM
  // selection. Unauthenticated / transport errors are expected here
  // (typedError resolves the result; nothing to await).
  void commands.buddyGetMe()

  console.info('[buddy:voice:app] auto-starting voice session on mount')
  await voiceSession.start().catch(err => console.warn('[buddy] voice session start failed', err))
})

onBeforeUnmount(() => {
  if (!isSettingsRoute) void voiceSession.stop()
})
</script>

<template>
  <SettingsStandalone v-if="isSettingsRoute" />
  <div
    v-else
    class="buddy-root"
    :style="buddyRootStyle"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <div
      class="buddy-stage"
      :class="{ 'buddy-stage-edit': editMode }"
    >
      <div class="buddy-avatar-holder">
        <ThreeScene
          v-if="stageModelRenderer === 'vrm'"
          ref="vrmViewerRef"
          class="buddy-scene"
          :model-src="stageModelSelectedUrl"
          :idle-animation="animations.idleLoop.toString()"
          :show-axes="stageViewControlsEnabled"
          :audio-context="audioContext"
          :current-audio-source="currentAudioSource"
          :display-config="activeDisplayConfig"
          @error="console.error"
        />
        <div
          v-if="stageModelRenderer === 'disabled'"
          class="buddy-scene buddy-scene-placeholder"
        >
          {{ cachedBuddyEnvelope ? 'No model available' : 'Loading model...' }}
        </div>
      </div>

      <!-- Edit-mode overlays: move (fills avatar area) + resize (top-left corner). -->
      <template v-if="editMode">
        <div
          class="edit-move-handle"
          title="Drag to reposition the avatar"
          @pointerdown="onMoveHandleDown"
          @pointermove="onDragMove"
          @pointerup="onDragUp"
          @pointercancel="onDragUp"
        />
        <div
          class="edit-resize-handle"
          title="Drag to resize the window"
          @pointerdown="onResizeHandleDown"
          @pointermove="onDragMove"
          @pointerup="onDragUp"
          @pointercancel="onDragUp"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </div>
        <div class="edit-frame" />
      </template>

      <!-- Floating action buttons (bottom-right column) -->
      <div
        class="fab-container"
        :class="{ 'fab-hidden': !fabsVisible }"
      >
        <button
          class="fab"
          :class="['mic-fab', `mic-fab--${micFabState}`]"
          :title="micFabTitle"
          @click="onMicFabClick"
        >
          <svg
            v-if="micFabState === 'on' || micFabState === 'connecting'"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <line
              x1="12"
              y1="19"
              x2="12"
              y2="22"
            />
          </svg>
          <svg
            v-else
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line
              x1="3"
              y1="3"
              x2="21"
              y2="21"
            />
            <path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-1m14 0v1a7 6.97 0 0 1-.11 1.23" />
            <line
              x1="12"
              y1="19"
              x2="12"
              y2="22"
            />
          </svg>
          <!-- Pause badge reserved for a future cross-surface
               exclusivity signal; the old backend event source is gone. -->
        </button>
        <button
          class="fab"
          :class="{ active: editMode }"
          title="Edit layout (window size + avatar position)"
          @click="toggleEditMode"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line
              x1="21"
              y1="3"
              x2="14"
              y2="10"
            />
            <line
              x1="3"
              y1="21"
              x2="10"
              y2="14"
            />
          </svg>
        </button>
        <button
          class="fab settings-fab"
          data-tauri-drag-region=""
          title="Settings (drag to move window)"
          @pointerdown="onSettingsPointerDown"
          @pointermove="onSettingsPointerMove"
          @click="onSettingsClick"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle
              cx="12"
              cy="12"
              r="3"
            /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.buddy-root {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: transparent;
}

.buddy-stage {
  position: relative;
  width: 100%;
  height: 100%;
}
.buddy-avatar-holder {
  /* Leave ~30px on the right for the FAB column. */
  position: absolute;
  inset: 0 30px 0 0;
  will-change: transform;
}
.buddy-scene {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  overflow: hidden;
}
.buddy-scene-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #737373;
  font-size: 0.875rem;
}

/* Edit-mode chrome */
.buddy-stage-edit .buddy-avatar-holder {
  outline: 1px dashed rgba(140, 120, 220, 0.55);
  outline-offset: -1px;
}
.edit-frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 1px solid rgba(140, 120, 220, 0.45);
  border-radius: 16px;
}
.edit-move-handle {
  position: absolute;
  inset: 0 30px 0 0;
  cursor: grab;
  background: rgba(140, 120, 220, 0.06);
  border-radius: 16px;
  z-index: 90;
}
.edit-move-handle:active { cursor: grabbing; }
.edit-resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  cursor: nwse-resize;
  z-index: 91;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(230, 225, 245, 0.85);
  background: rgba(60, 50, 100, 0.78);
  border: 1px solid rgba(140, 120, 220, 0.6);
  border-radius: 8px;
  backdrop-filter: blur(8px);
}
.edit-resize-handle:active { cursor: grabbing; }

/* FAB buttons — bottom-right column. */
.fab-container {
  position: absolute;
  bottom: 8px;
  right: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  opacity: 1;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fab-container.fab-hidden {
  opacity: 0;
  transform: translateX(6px);
  pointer-events: none;
}
.fab {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(30,30,30,0.85);
  backdrop-filter: blur(12px);
  color: #e0e0e0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}
.fab:hover {
  background: rgba(50,50,50,0.9);
  border-color: rgba(255,255,255,0.3);
}
.fab.active {
  background: rgba(80,60,180,0.7);
  border-color: rgba(140,120,220,0.6);
}
.fab > svg {
  pointer-events: none;
}
.settings-fab {
  cursor: grab;
}
.settings-fab:active {
  cursor: grabbing;
}

/* Mic FAB state colors. */
.mic-fab { position: relative; }
.mic-fab--on {
  background: rgba(60,130,90,0.75);
  border-color: rgba(120,200,150,0.55);
}
.mic-fab--on:hover { background: rgba(70,150,105,0.85); }
.mic-fab--connecting {
  background: rgba(70,90,140,0.7);
  border-color: rgba(130,160,220,0.55);
}
.mic-fab--paused {
  background: rgba(150,120,60,0.75);
  border-color: rgba(220,180,110,0.55);
}
.mic-fab--paused:hover { background: rgba(170,135,70,0.85); }
.mic-fab--error {
  background: rgba(160,60,60,0.75);
  border-color: rgba(220,120,120,0.55);
}
.mic-fab__badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5b041;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.45);
}
</style>
