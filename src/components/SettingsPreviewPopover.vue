<script setup lang="ts">
import { Emotion, EMOTION_VRMExpressionName_value } from '../stores/constants/emotions'
import { ref } from 'vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'emotion', name: string, intensity: number): void
  (e: 'viseme', name: 'aa' | 'ih' | 'ou' | 'ee' | 'oh'): void
  (e: 'blink', which: 'blink' | 'blinkLeft' | 'blinkRight'): void
  (e: 'lookAt', dir: 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight'): void
}>()

interface EmotionChip {
  emotion: Emotion
  label: string
  emoji: string
  intensity: number
}

const emotionChips: EmotionChip[] = [
  { emotion: Emotion.Happy, label: 'Happy', emoji: '😊', intensity: 0.8 },
  { emotion: Emotion.Angry, label: 'Angry', emoji: '😠', intensity: 0.8 },
  { emotion: Emotion.Sad, label: 'Sad', emoji: '😢', intensity: 0.8 },
  { emotion: Emotion.Relaxed, label: 'Relaxed', emoji: '😌', intensity: 0.8 },
  { emotion: Emotion.Surprised, label: 'Surprised', emoji: '😲', intensity: 0.9 },
  { emotion: Emotion.Neutral, label: 'Neutral', emoji: '😐', intensity: 1.0 },
]

type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'
const visemes: { id: Viseme, label: string }[] = [
  { id: 'aa', label: 'aa' },
  { id: 'ih', label: 'ih' },
  { id: 'ou', label: 'ou' },
  { id: 'ee', label: 'ee' },
  { id: 'oh', label: 'oh' },
]

type Blink = 'blink' | 'blinkLeft' | 'blinkRight'
const blinks: { id: Blink, label: string }[] = [
  { id: 'blink', label: 'Both' },
  { id: 'blinkLeft', label: 'Left' },
  { id: 'blinkRight', label: 'Right' },
]

type LookDir = 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight'
const lookDirs: { id: LookDir, label: string, icon: string }[] = [
  { id: 'lookUp', label: 'Up', icon: '↑' },
  { id: 'lookDown', label: 'Down', icon: '↓' },
  { id: 'lookLeft', label: 'Left', icon: '←' },
  { id: 'lookRight', label: 'Right', icon: '→' },
]

const activeChip = ref<string | null>(null)

function flashActive(key: string, ms = 600) {
  activeChip.value = key
  setTimeout(() => {
    if (activeChip.value === key)
      activeChip.value = null
  }, ms)
}

function playEmotion(chip: EmotionChip) {
  const vrmName = EMOTION_VRMExpressionName_value[chip.emotion]
  emit('emotion', vrmName, chip.intensity)
  flashActive(`emotion:${chip.emotion}`)
}

function playViseme(id: Viseme) {
  emit('viseme', id)
  flashActive(`viseme:${id}`, 400)
}

function playBlink(id: Blink) {
  emit('blink', id)
  flashActive(`blink:${id}`, 300)
}

function playLookAt(id: LookDir) {
  emit('lookAt', id)
  flashActive(`look:${id}`, 600)
}
</script>

<template>
  <Transition name="preview-pop">
    <div
      v-if="props.open"
      class="preview-popover"
      @click.stop
    >
      <div class="preview-header">
        <span class="preview-title">VRM 1.0 preview</span>
        <span class="preview-hint">Click to try</span>
      </div>

      <section class="preview-section">
        <span class="preview-section-title">Expressions</span>
        <div class="chip-grid chip-grid-3">
          <button
            v-for="chip in emotionChips"
            :key="chip.emotion"
            class="chip"
            :class="{ 'chip-active': activeChip === `emotion:${chip.emotion}` }"
            :title="chip.label"
            @click="playEmotion(chip)"
          >
            <span class="chip-emoji">{{ chip.emoji }}</span>
            <span class="chip-label">{{ chip.label }}</span>
          </button>
        </div>
      </section>

      <section class="preview-section">
        <span class="preview-section-title">Visemes</span>
        <div class="chip-grid chip-grid-5">
          <button
            v-for="v in visemes"
            :key="v.id"
            class="chip chip-mono"
            :class="{ 'chip-active': activeChip === `viseme:${v.id}` }"
            :title="`Viseme ${v.label}`"
            @click="playViseme(v.id)"
          >
            <span class="chip-label chip-label-mono">{{ v.label }}</span>
          </button>
        </div>
      </section>

      <section class="preview-section">
        <span class="preview-section-title">Blink</span>
        <div class="chip-grid chip-grid-3">
          <button
            v-for="b in blinks"
            :key="b.id"
            class="chip"
            :class="{ 'chip-active': activeChip === `blink:${b.id}` }"
            :title="b.id"
            @click="playBlink(b.id)"
          >
            <span class="chip-emoji">👁</span>
            <span class="chip-label">{{ b.label }}</span>
          </button>
        </div>
      </section>

      <section class="preview-section">
        <span class="preview-section-title">Look-at</span>
        <div class="chip-grid chip-grid-4">
          <button
            v-for="l in lookDirs"
            :key="l.id"
            class="chip"
            :class="{ 'chip-active': activeChip === `look:${l.id}` }"
            :title="l.id"
            @click="playLookAt(l.id)"
          >
            <span class="chip-emoji">{{ l.icon }}</span>
            <span class="chip-label">{{ l.label }}</span>
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.preview-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  z-index: 101;
  width: 280px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(24,24,28,0.92);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(16px);
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  gap: 14px;
  transform-origin: bottom right;
}

.preview-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: #eee;
}
.preview-hint {
  font-size: 10px;
  color: #666;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview-section-title {
  font-size: 10px;
  font-weight: 600;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chip-grid {
  display: grid;
  gap: 6px;
}
.chip-grid-3 { grid-template-columns: repeat(3, 1fr); }
.chip-grid-4 { grid-template-columns: repeat(4, 1fr); }
.chip-grid-5 { grid-template-columns: repeat(5, 1fr); }

.chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.05);
  background: rgba(255,255,255,0.02);
  color: #ccc;
  cursor: pointer;
  transition: all 0.15s;
}
.chip:hover {
  background: rgba(100,70,200,0.15);
  border-color: rgba(140,120,220,0.3);
  color: #fff;
  transform: translateY(-1px);
}
.chip-active {
  background: rgba(100,70,200,0.3) !important;
  border-color: rgba(140,120,220,0.6) !important;
  color: #fff !important;
}
.chip-mono {
  padding: 10px 4px;
}
.chip-emoji {
  font-size: 18px;
  line-height: 1;
}
.chip-label {
  font-size: 9px;
  font-weight: 500;
  color: inherit;
}
.chip-label-mono {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.05em;
}

.preview-pop-enter-active, .preview-pop-leave-active {
  transition: all 0.18s ease;
}
.preview-pop-enter-from, .preview-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(6px);
}
</style>
