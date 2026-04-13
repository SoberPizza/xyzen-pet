<script setup lang="ts">
/**
 * Holographic Spirit Pet scene orchestrator.
 *
 * Composes: SpiritCore (3 depth layers), EnergyParticles, OrbitalWisps,
 * GroundShadow, GroundGrid, camera, and bloom post-processing.
 */

import type { OrbActivity, OrbEmotion } from '../../composables/orb/types'

import { OrbitControls } from '@tresjs/cientos'
import { TresCanvas } from '@tresjs/core'
import { BloomPmndrs, EffectComposerPmndrs } from '@tresjs/post-processing'
import { onBeforeUnmount, onMounted, toRefs } from 'vue'

import EnergyParticles from './EnergyParticles.vue'
import GroundGrid from './GroundGrid.vue'
import GroundShadow from './GroundShadow.vue'
import OrbitalWisps from './OrbitalWisps.vue'
import SpiritCore from './SpiritCore.vue'

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
}>(), {
  mood: 0.3,
  energy: 0.8,
  activity: 'idle',
  currentEmotion: 'neutral',
  rawAudioLevel: 0,
  rawSpeakingLevel: 0,
  cameraDistance: 4,
  enableControls: false,
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

// Shared props for SpiritCore layers
function spiritCoreProps() {
  return {
    energy: uniforms.value.u_energy,
    interaction: uniforms.value.u_interaction,
    audioLevel: uniforms.value.u_audioLevel,
    speakingLevel: uniforms.value.u_speakingLevel,
    color1: `#${uniforms.value.u_color1.getHexString()}`,
    color2: `#${uniforms.value.u_color2.getHexString()}`,
    breathSpeed: uniforms.value.u_breathSpeed,
    shake: uniforms.value.u_shake,
    flash: uniforms.value.u_flash,
    coreOffsetX: uniforms.value.u_coreOffsetX,
    coreOffsetY: uniforms.value.u_coreOffsetY,
    coreBrightness: uniforms.value.u_coreBrightness,
    scaleAnimation: uniforms.value.u_scaleAnimation,
  }
}

let rafId: number | null = null

function frameLoop() {
  updateAudioLevel(props.rawAudioLevel)
  updateSpeakingLevel(props.rawSpeakingLevel)
  updateColors(1 / 60)
  rafId = requestAnimationFrame(frameLoop)
}

onMounted(() => {
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
      clear-color="transparent"
      :alpha="true"
      window-size
    >
      <TresPerspectiveCamera
        :position="[0, 0, cameraDistance]"
        :fov="50"
      />

      <OrbitControls
        v-if="enableControls"
        :enable-damping="true"
        :damping-factor="0.05"
        :enable-pan="false"
        :min-distance="2"
        :max-distance="10"
      />

      <!-- Ground shadow (NormalBlending, rendered first) -->
      <GroundShadow
        :energy="uniforms.u_energy"
        :breath-speed="uniforms.u_breathSpeed"
        :core-offset-x="uniforms.u_coreOffsetX"
        :core-offset-y="uniforms.u_coreOffsetY"
        :color1="`#${uniforms.u_color1.getHexString()}`"
      />

      <!-- Ground grid (perspective reference) -->
      <GroundGrid
        :core-offset-x="uniforms.u_coreOffsetX"
        :color1="`#${uniforms.u_color1.getHexString()}`"
      />

      <!-- Multi-layer SpiritCore: back (soft depth halo) -->
      <SpiritCore
        v-bind="spiritCoreProps()"
        :z-offset="-0.3"
        :opacity-scale="0.3"
        :scale-multiplier="1.15"
      />

      <!-- Multi-layer SpiritCore: main (crisp primary body) -->
      <SpiritCore
        v-bind="spiritCoreProps()"
        :z-offset="0"
        :opacity-scale="1.0"
        :scale-multiplier="1.0"
      />

      <!-- Multi-layer SpiritCore: front (bright highlight) -->
      <SpiritCore
        v-bind="spiritCoreProps()"
        :z-offset="0.15"
        :opacity-scale="0.5"
        :scale-multiplier="0.8"
      />

      <!-- Energy particles orbiting around sphere -->
      <EnergyParticles
        :energy="uniforms.u_energy"
        :orbit-speed="uniforms.u_orbitSpeed"
        :core-offset-x="uniforms.u_coreOffsetX"
        :core-offset-y="uniforms.u_coreOffsetY"
        :audio-level="uniforms.u_audioLevel"
        :speaking-level="uniforms.u_speakingLevel"
        :color1="`#${uniforms.u_color1.getHexString()}`"
        :color2="`#${uniforms.u_color2.getHexString()}`"
      />

      <!-- Orbital wisps with trails -->
      <OrbitalWisps
        :energy="uniforms.u_energy"
        :orbit-speed="uniforms.u_orbitSpeed"
        :core-offset-x="uniforms.u_coreOffsetX"
        :core-offset-y="uniforms.u_coreOffsetY"
        :audio-level="uniforms.u_audioLevel"
        :speaking-level="uniforms.u_speakingLevel"
        :color1="`#${uniforms.u_color1.getHexString()}`"
        :color2="`#${uniforms.u_color2.getHexString()}`"
      />

      <EffectComposerPmndrs>
        <BloomPmndrs
          :luminance-threshold="0.4"
          :luminance-smoothing="0.3"
          :intensity="0.5"
        />
      </EffectComposerPmndrs>
    </TresCanvas>
  </div>
</template>
