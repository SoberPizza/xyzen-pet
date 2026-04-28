<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import ModuleStatusHeader from './ModuleStatusHeader.vue'

const refreshingDevices = ref(false)

// Camera permission
const cameraPermission = ref<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown')

async function checkCameraPermission() {
  try {
    const result = await navigator.permissions.query({ name: 'camera' as PermissionName })
    cameraPermission.value = result.state as 'prompt' | 'granted' | 'denied'
    result.addEventListener('change', () => {
      cameraPermission.value = result.state as 'prompt' | 'granted' | 'denied'
    })
  }
  catch {
    cameraPermission.value = 'unknown'
  }
}

async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach(t => t.stop())
    cameraPermission.value = 'granted'
    await loadVideoDevices()
  }
  catch {
    cameraPermission.value = 'denied'
  }
}

// Camera device enumeration
const videoDevices = ref<MediaDeviceInfo[]>([])
const selectedCamera = useLocalStorage('pet-vision-selected-camera', '')

async function loadVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  videoDevices.value = devices.filter(d => d.kind === 'videoinput')
  if (!selectedCamera.value && videoDevices.value.length > 0)
    selectedCamera.value = videoDevices.value[0].deviceId
}

const visionReady = computed(() =>
  (cameraPermission.value === 'granted' || cameraPermission.value === 'unknown')
  && videoDevices.value.length > 0,
)

async function refreshDevices() {
  refreshingDevices.value = true
  try { await loadVideoDevices() }
  finally { refreshingDevices.value = false }
}

// Live camera preview
const videoRef = ref<HTMLVideoElement | null>(null)
const activeStream = ref<MediaStream | null>(null)
const isPreviewing = ref(false)

async function startPreview() {
  stopPreview()
  if (!selectedCamera.value) return

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: selectedCamera.value } },
    })
    activeStream.value = stream
    isPreviewing.value = true

    await nextTick()
    if (videoRef.value) {
      videoRef.value.srcObject = stream
      videoRef.value.play()
    }
  }
  catch (err) {
    captureError.value = err instanceof Error ? err.message : 'Failed to start preview'
    isPreviewing.value = false
  }
}

function stopPreview() {
  if (activeStream.value) {
    activeStream.value.getTracks().forEach(t => t.stop())
    activeStream.value = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
  isPreviewing.value = false
}

watch(selectedCamera, (newVal, oldVal) => {
  if (newVal !== oldVal && isPreviewing.value) startPreview()
})

onUnmounted(() => stopPreview())

// Capture
const captureSource = ref<'camera' | 'screen'>('camera')
const capturedImages = ref<string[]>([])
const isCapturing = ref(false)
const captureError = ref('')

async function captureFrame() {
  captureError.value = ''
  isCapturing.value = true
  let needsCleanup = false
  let stream: MediaStream | null = activeStream.value

  try {
    if (!stream) {
      if (!selectedCamera.value) {
        captureError.value = 'No camera selected'
        isCapturing.value = false
        return
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedCamera.value } },
      })
      needsCleanup = true
    }

    const video = document.createElement('video')
    video.srcObject = stream
    video.playsInline = true
    await video.play()

    if (needsCleanup) await new Promise(resolve => setTimeout(resolve, 500))

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    capturedImages.value = [canvas.toDataURL('image/png'), ...capturedImages.value].slice(0, 5)
  }
  catch (err) {
    captureError.value = err instanceof Error ? err.message : 'Failed to capture frame'
  }
  finally {
    if (needsCleanup && stream) stream.getTracks().forEach(t => t.stop())
    isCapturing.value = false
  }
}

async function captureScreen() {
  captureError.value = ''
  isCapturing.value = true
  let stream: MediaStream | null = null

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    const video = document.createElement('video')
    video.srcObject = stream
    video.playsInline = true
    await video.play()

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    capturedImages.value = [canvas.toDataURL('image/png'), ...capturedImages.value].slice(0, 5)
  }
  catch (err) {
    if (!(err instanceof DOMException && err.name === 'NotAllowedError'))
      captureError.value = err instanceof Error ? err.message : 'Failed to capture screen'
  }
  finally {
    if (stream) stream.getTracks().forEach(t => t.stop())
    isCapturing.value = false
  }
}

function handleCapture() {
  if (captureSource.value === 'camera') captureFrame()
  else captureScreen()
}

function removeCapture(index: number) {
  capturedImages.value.splice(index, 1)
}

onMounted(async () => {
  await checkCameraPermission()
  if (cameraPermission.value === 'granted' || cameraPermission.value === 'unknown')
    await loadVideoDevices()
})
</script>

<template>
  <div class="module-page">
    <!-- Status Header -->
    <ModuleStatusHeader
      module-name="Vision"
      :configured="visionReady"
    >
      <template #icon>
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#888"
          stroke-width="1.5"
        ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
          cx="12"
          cy="12"
          r="3"
        /></svg>
      </template>
      <template #action>
        <button
          class="reconnect-btn"
          :disabled="refreshingDevices"
          @click="refreshDevices"
        >
          <svg
            v-if="refreshingDevices"
            class="spin"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
          <span>Refresh Devices</span>
        </button>
      </template>
    </ModuleStatusHeader>

    <!-- Permission Banner -->
    <div
      v-if="cameraPermission === 'prompt' || cameraPermission === 'denied'"
      class="permission-banner"
      :class="cameraPermission === 'denied' ? 'banner-red' : 'banner-amber'"
    >
      <div class="banner-content">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          :stroke="cameraPermission === 'denied' ? '#ef4444' : '#f59e0b'"
          stroke-width="1.5"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle
            cx="12"
            cy="13"
            r="4"
          />
        </svg>
        <div class="banner-text">
          <span class="banner-title">
            {{ cameraPermission === 'denied' ? 'Camera access denied' : 'Camera access required' }}
          </span>
          <span class="banner-desc">
            {{ cameraPermission === 'denied' ? 'Please enable camera access in your browser settings' : 'Grant camera access to use vision features' }}
          </span>
        </div>
        <button
          v-if="cameraPermission === 'prompt'"
          class="grant-btn"
          @click="requestCameraPermission"
        >
          Grant Access
        </button>
      </div>
    </div>

    <!-- Camera Selector + Preview -->
    <div class="module-card">
      <div class="camera-row">
        <div class="camera-select-wrap">
          <label class="card-label">Camera</label>
          <select
            class="select-input"
            :value="selectedCamera"
            @change="selectedCamera = ($event.target as HTMLSelectElement).value"
          >
            <option
              value=""
              disabled
            >
              Select a camera
            </option>
            <option
              v-for="d in videoDevices"
              :key="d.deviceId"
              :value="d.deviceId"
            >
              {{ d.label || d.deviceId }}
            </option>
          </select>
        </div>
        <button
          class="preview-btn"
          :class="isPreviewing ? 'preview-stop' : ''"
          :disabled="!selectedCamera"
          @click="isPreviewing ? stopPreview() : startPreview()"
        >
          <svg
            v-if="isPreviewing"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="2"
          /></svg>
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><polygon points="5 3 19 12 5 21 5 3" /></svg>
          <span>{{ isPreviewing ? 'Stop' : 'Preview' }}</span>
        </button>
      </div>

      <div
        v-if="isPreviewing"
        class="video-preview"
      >
        <video
          ref="videoRef"
          autoplay
          playsinline
          muted
        />
      </div>
    </div>

    <!-- Capture Controls -->
    <div class="module-card">
      <h3 class="card-label">
        Capture
      </h3>
      <div class="card-content">
        <!-- Source Toggle -->
        <div class="source-toggle">
          <button
            class="toggle-btn"
            :class="captureSource === 'camera' ? 'toggle-active' : ''"
            @click="captureSource = 'camera'"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            ><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle
              cx="12"
              cy="13"
              r="4"
            /></svg>
            <span>Camera</span>
          </button>
          <button
            class="toggle-btn"
            :class="captureSource === 'screen' ? 'toggle-active' : ''"
            @click="captureSource = 'screen'"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            ><rect
              x="2"
              y="3"
              width="20"
              height="14"
              rx="2"
              ry="2"
            /><line
              x1="8"
              y1="21"
              x2="16"
              y2="21"
            /><line
              x1="12"
              y1="17"
              x2="12"
              y2="21"
            /></svg>
            <span>Screen</span>
          </button>
        </div>

        <button
          class="btn-primary btn-full"
          :disabled="isCapturing || (captureSource === 'camera' && !selectedCamera)"
          @click="handleCapture"
        >
          <svg
            v-if="isCapturing"
            class="spin"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <span>{{ isCapturing ? 'Capturing...' : captureSource === 'camera' ? 'Capture Frame' : 'Capture Screen' }}</span>
        </button>

        <div
          v-if="captureError"
          class="error-box"
        >
          {{ captureError }}
        </div>
      </div>
    </div>

    <!-- Gallery -->
    <div
      v-if="capturedImages.length > 0"
      class="module-card"
    >
      <h3 class="card-label">
        Captures <span class="capture-count">({{ capturedImages.length }}/5)</span>
      </h3>
      <div class="gallery">
        <div
          v-for="(img, index) in capturedImages"
          :key="index"
          class="gallery-item"
        >
          <img
            :src="img"
            alt="Captured frame"
          >
          <button
            class="gallery-remove"
            @click="removeCapture(index)"
          >
            &times;
          </button>
        </div>
      </div>
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
.card-label {
  display: block;
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 500;
  color: #888;
}
.card-content { display: flex; flex-direction: column; gap: 12px; }
.select-input {
  width: 100%;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #eee;
  outline: none;
}
.camera-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.camera-select-wrap { flex: 1; }
.preview-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #ccc;
  cursor: pointer;
  transition: background 0.2s;
}
.preview-btn:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
.preview-btn:disabled { opacity: 0.5; cursor: default; }
.preview-stop {
  border-color: rgba(239,68,68,0.3);
  color: #f87171;
}
.preview-stop:hover:not(:disabled) { background: rgba(239,68,68,0.1); }
.video-preview {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}
.video-preview video { width: 100%; display: block; }
.source-toggle {
  display: flex;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  overflow: hidden;
}
.toggle-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: rgba(255,255,255,0.04);
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn:hover { background: rgba(255,255,255,0.08); }
.toggle-active {
  background: rgba(100,70,200,0.5);
  color: #fff;
}
.toggle-active:hover { background: rgba(100,70,200,0.6); }
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: rgba(100,70,200,0.6);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) { background: rgba(120,90,220,0.8); }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-full { width: 100%; }
.error-box {
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  background: rgba(239,68,68,0.1);
  color: #f87171;
}
.permission-banner {
  border-radius: 12px;
  padding: 16px;
}
.banner-amber { background: rgba(245,158,11,0.1); }
.banner-red { background: rgba(239,68,68,0.1); }
.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}
.banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.banner-title { font-size: 13px; font-weight: 500; color: #eee; }
.banner-desc { font-size: 12px; color: #999; }
.grant-btn {
  flex-shrink: 0;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: #f59e0b;
  color: #000;
  cursor: pointer;
}
.grant-btn:hover { background: #d97706; }
.capture-count { font-size: 11px; color: #666; }
.gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.gallery-item {
  position: relative;
  flex-shrink: 0;
}
.gallery-item img {
  height: 96px;
  width: auto;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  object-fit: cover;
}
.gallery-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.gallery-item:hover .gallery-remove { opacity: 1; }
.reconnect-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #ccc;
  cursor: pointer;
  transition: background 0.2s;
}
.reconnect-btn:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
.reconnect-btn:disabled { opacity: 0.5; cursor: default; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }
</style>
