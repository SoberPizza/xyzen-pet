<script setup lang="ts">
/**
 * Holographic Sparkler Spirit scene orchestrator.
 *
 * Composes: SparklerCore (bright center + diffraction spikes),
 * SparkRays (radiating spark lines), SparkParticles (flying sparks with gravity),
 * camera, and bloom post-processing.
 *
 * Optimized for Pepper's Ghost prism projection: high contrast on black background.
 */

import type { OrbActivity, OrbEmotion } from '../../composables/orb/types'

import { OrbitControls } from '@tresjs/cientos'
import { TresCanvas } from '@tresjs/core'
import { BloomPmndrs, EffectComposerPmndrs } from '@tresjs/post-processing'
import { computed, onBeforeUnmount, onMounted, ref, toRefs } from 'vue'

import SparklerCore from './SparklerCore.vue'
import SparkParticles from './SparkParticles.vue'
import SparkRays from './SparkRays.vue'

import { useOrbAudioReactive } from '../../composables/orb/use-orb-audio-reactive'
import { useOrbBehavior } from '../../composables/orb/use-orb-behavior'

const props = withDefaults(defineProps<{
  mood?: number
  energy?: number
  activity?: OrbActivity
  currentEmotion?: OrbEmotion
  rawAudioLevel?: number
  rawSpeakingLevel?: number
  cameraDistance?: number
  enableControls?: boolean
  pepperGhost?: boolean
}>(), {
  mood: 0.3,
  energy: 0.8,
  activity: 'idle',
  currentEmotion: 'neutral',
  rawAudioLevel: 0,
  rawSpeakingLevel: 0,
  cameraDistance: 1.4,
  enableControls: false,
  pepperGhost: true,
})

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const { mood, energy, activity, currentEmotion } = toRefs(props)

const {
  audioLevel,
  speakingLevel,
  updateAudioLevel,
  updateSpeakingLevel,
} = useOrbAudioReactive()

const {
  uniforms,
  triggerInteraction,
  updateColors,
} = useOrbBehavior({
  mood,
  energy,
  activity,
  currentEmotion,
  audioLevel,
  speakingLevel,
})

// Pepper's Ghost: black background for prism projection
const clearColor = computed(() => props.pepperGhost ? '#000000' : 'transparent')
const clearAlpha = computed(() => !props.pepperGhost)

// Bloom: very subtle at low resolution to avoid washing out details
// At 320x320 the blur kernel covers a huge proportion of the canvas
const bloomIntensity = computed(() => props.pepperGhost ? 0.4 : 0.25)
const bloomThreshold = computed(() => props.pepperGhost ? 0.6 : 0.7)

// Slow Y-axis rotation for holographic depth perception through prism
const groupRotationY = ref(0)
const ROTATION_SPEED = 0.3 // radians per second

let rafId: number | null = null
let lastTime = 0

function frameLoop(now: number) {
  const dt = lastTime ? (now - lastTime) / 1000 : 1 / 60
  lastTime = now

  updateAudioLevel(props.rawAudioLevel)
  updateSpeakingLevel(props.rawSpeakingLevel)
  updateColors(dt)

  // Continuous slow rotation - particles in 3D space create real parallax
  groupRotationY.value += ROTATION_SPEED * dt

  rafId = requestAnimationFrame(frameLoop)
}

onMounted(() => {
  lastTime = 0
  rafId = requestAnimationFrame(frameLoop)
  componentState.value = 'mounted'
})

onBeforeUnmount(() => {
  if (rafId !== null)
    cancelAnimationFrame(rafId)
})

function onPointerEnter() {
  triggerInteraction(0.3)
}

function onClick() {
  triggerInteraction(1.0)
}

defineExpose({
  triggerInteraction,
})
</script>

<template>
  <div
    :class="['w-full h-full', 'cursor-pointer']"
    @pointerenter="onPointerEnter"
    @click="onClick"
  >
    <TresCanvas
      :clear-color="clearColor"
      :alpha="clearAlpha"
      window-size
    >
      <TresPerspectiveCamera
        :position="[0, 0, cameraDistance]"
        :fov="70"
      />

      <OrbitControls
        v-if="enableControls"
        :enable-damping="true"
        :damping-factor="0.05"
        :enable-pan="false"
        :min-distance="2"
        :max-distance="10"
      />

      <!-- Rotating group: slow Y-axis rotation creates real 3D parallax through prism -->
      <TresGroup :rotation-y="groupRotationY">
        <!-- Sparkler core: bright center point with diffraction spikes -->
        <SparklerCore
          :energy="uniforms.u_energy"
          :audio-level="uniforms.u_audioLevel"
          :speaking-level="uniforms.u_speakingLevel"
          :color1="`#${uniforms.u_color1.getHexString()}`"
          :color2="`#${uniforms.u_color2.getHexString()}`"
          :breath-speed="uniforms.u_breathSpeed"
          :shake="uniforms.u_shake"
          :flash="uniforms.u_flash"
          :core-offset-x="uniforms.u_coreOffsetX"
          :core-offset-y="uniforms.u_coreOffsetY"
          :core-brightness="uniforms.u_coreBrightness"
          :scale-animation="uniforms.u_scaleAnimation"
          :spike-length="uniforms.u_spikeLength"
          :spike-rotation-speed="uniforms.u_spikeRotationSpeed"
          :flicker-speed="uniforms.u_flickerSpeed"
          :core-glow-size="uniforms.u_coreGlowSize"
        />

        <!-- Spark rays: radiating lines from center -->
        <SparkRays
          :energy="uniforms.u_energy"
          :orbit-speed="uniforms.u_orbitSpeed"
          :core-offset-x="uniforms.u_coreOffsetX"
          :core-offset-y="uniforms.u_coreOffsetY"
          :audio-level="uniforms.u_audioLevel"
          :speaking-level="uniforms.u_speakingLevel"
          :color1="`#${uniforms.u_color1.getHexString()}`"
          :color2="`#${uniforms.u_color2.getHexString()}`"
          :core-brightness="uniforms.u_coreBrightness"
          :ray-max-length="uniforms.u_rayMaxLength"
          :ray-density="uniforms.u_rayDensity"
          :flicker-speed="uniforms.u_flickerSpeed"
          :pulse-rate="uniforms.u_pulseRate"
        />

        <!-- Spark particles: flying sparks with gravity arc -->
        <SparkParticles
          :energy="uniforms.u_energy"
          :orbit-speed="uniforms.u_orbitSpeed"
          :core-offset-x="uniforms.u_coreOffsetX"
          :core-offset-y="uniforms.u_coreOffsetY"
          :audio-level="uniforms.u_audioLevel"
          :speaking-level="uniforms.u_speakingLevel"
          :color1="`#${uniforms.u_color1.getHexString()}`"
          :color2="`#${uniforms.u_color2.getHexString()}`"
          :gravity="uniforms.u_gravity"
          :particle-spread="uniforms.u_particleSpread"
          :ray-max-length="uniforms.u_rayMaxLength"
          :tangential-speed="uniforms.u_tangentialSpeed"
          :pulse-rate="uniforms.u_pulseRate"
        />
      </TresGroup>

      <EffectComposerPmndrs>
        <BloomPmndrs
          :luminance-threshold="bloomThreshold"
          :luminance-smoothing="0.5"
          :intensity="bloomIntensity"
          :mipmap-blur="true"
        />
      </EffectComposerPmndrs>
    </TresCanvas>
  </div>
</template>
