<script setup lang="ts">
/**
 * Holographic Fox Spirit creature scene orchestrator.
 *
 * Composes: CreatureBody, CreatureEars, CreatureTail, CreatureEyes, CreatureAura,
 * camera, and bloom post-processing.
 *
 * Optimized for Pepper's Ghost prism projection: high contrast on black background.
 */

import type { OrbActivity, OrbEmotion } from '../../composables/orb/types'

import { OrbitControls } from '@tresjs/cientos'
import { TresCanvas } from '@tresjs/core'
import { BloomPmndrs, EffectComposerPmndrs } from '@tresjs/post-processing'
import { computed, onBeforeUnmount, onMounted, ref, toRefs } from 'vue'

import CreatureAura from './CreatureAura.vue'
import CreatureBody from './CreatureBody.vue'
import CreatureEars from './CreatureEars.vue'
import CreatureEyes from './CreatureEyes.vue'
import CreatureTail from './CreatureTail.vue'

import { useCreatureBehavior } from '../../composables/creature/use-creature-behavior'
import { useOrbAudioReactive } from '../../composables/orb/use-orb-audio-reactive'

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
  cameraDistance: 0.5,
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
  animParams,
  colors,
  triggerInteraction,
  updateAnimation,
} = useCreatureBehavior({
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

const bloomIntensity = computed(() => props.pepperGhost ? 0.5 : 0.3)
const bloomThreshold = computed(() => props.pepperGhost ? 0.5 : 0.6)

// Slow Y-axis rotation for holographic depth perception
const groupRotationY = ref(0)
const ROTATION_SPEED = 0.2

let rafId: number | null = null
let lastTime = 0

function frameLoop(now: number) {
  const dt = lastTime ? (now - lastTime) / 1000 : 1 / 60
  lastTime = now

  updateAudioLevel(props.rawAudioLevel)
  updateSpeakingLevel(props.rawSpeakingLevel)
  updateAnimation(dt)

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
        :position="[0, 0.15, cameraDistance]"
        :fov="60"
      />

      <OrbitControls
        v-if="enableControls"
        :enable-damping="true"
        :damping-factor="0.05"
        :enable-pan="false"
        :min-distance="0.8"
        :max-distance="5"
      />

      <!-- Rotating group for holographic parallax -->
      <TresGroup :rotation-y="groupRotationY">
        <CreatureBody
          :color1="`#${colors.color1.getHexString()}`"
          :color2="`#${colors.color2.getHexString()}`"
          :breath-speed="animParams.breathSpeed"
          :body-bounce="animParams.bodyBounce"
          :body-squash="animParams.bodySquash"
          :glow-intensity="animParams.glowIntensity"
          :speaking-level="speakingLevel"
        />

        <CreatureEars
          :ear-angle="animParams.earAngle"
          :ear-twitch="animParams.earTwitch"
          :color1="`#${colors.color1.getHexString()}`"
          :glow-intensity="animParams.glowIntensity"
        />

        <CreatureTail
          :tail-wag-speed="animParams.tailWagSpeed"
          :tail-wag-amplitude="animParams.tailWagAmplitude"
          :tail-curl="animParams.tailCurl"
          :color2="`#${colors.color2.getHexString()}`"
          :glow-intensity="animParams.glowIntensity"
        />

        <CreatureEyes
          :eye-scale="animParams.eyeScale"
          :eye-blink="animParams.eyeBlink"
          :color1="`#${colors.color1.getHexString()}`"
        />

        <CreatureAura
          :aura-brightness="animParams.auraBrightness"
          :color1="`#${colors.color1.getHexString()}`"
          :color2="`#${colors.color2.getHexString()}`"
          :energy="energy"
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
