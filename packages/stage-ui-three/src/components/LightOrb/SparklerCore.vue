<script setup lang="ts">
/**
 * Sparkler core: concentrated bright point with diffraction spikes.
 * Billboard quad rendered with custom shader for Pepper's Ghost projection.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import sparklerCoreFrag from '../../shaders/light-orb/sparkler-core.frag?raw'
import sparklerCoreVert from '../../shaders/light-orb/sparkler-core.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  audioLevel?: number
  speakingLevel?: number
  color1?: string
  color2?: string
  breathSpeed?: number
  shake?: number
  flash?: number
  coreOffsetX?: number
  coreOffsetY?: number
  coreBrightness?: number
  scaleAnimation?: number
  spikeLength?: number
  spikeRotationSpeed?: number
  flickerSpeed?: number
  coreGlowSize?: number
}>(), {
  energy: 0.5,
  audioLevel: 0,
  speakingLevel: 0,
  color1: '#5599FF',
  color2: '#77BBFF',
  breathSpeed: 0.8,
  shake: 0,
  flash: 0,
  coreOffsetX: 0,
  coreOffsetY: 0,
  coreBrightness: 1.0,
  scaleAnimation: 1.0,
  spikeLength: 1.0,
  spikeRotationSpeed: 0.08,
  flickerSpeed: 15.0,
  coreGlowSize: 25.0,
})

const geometryRef = shallowRef(new PlaneGeometry(2, 2))

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: sparklerCoreVert,
  fragmentShader: sparklerCoreFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_energy: { value: props.energy },
    u_breathSpeed: { value: props.breathSpeed },
    u_coreBrightness: { value: props.coreBrightness },
    u_flash: { value: props.flash },
    u_audioLevel: { value: props.audioLevel },
    u_speakingLevel: { value: props.speakingLevel },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
    u_scaleAnimation: { value: props.scaleAnimation },
    u_shake: { value: props.shake },
    u_coreOffsetX: { value: props.coreOffsetX },
    u_coreOffsetY: { value: props.coreOffsetY },
    u_spikeLength: { value: props.spikeLength },
    u_spikeRotationSpeed: { value: props.spikeRotationSpeed },
    u_flickerSpeed: { value: props.flickerSpeed },
    u_coreGlowSize: { value: props.coreGlowSize },
  },
}))

const startTime = Date.now()

watch(() => [
  props.energy,
  props.breathSpeed,
  props.coreBrightness,
  props.flash,
  props.audioLevel,
  props.speakingLevel,
  props.color1,
  props.color2,
  props.scaleAnimation,
  props.shake,
  props.coreOffsetX,
  props.coreOffsetY,
  props.spikeLength,
  props.spikeRotationSpeed,
  props.flickerSpeed,
  props.coreGlowSize,
] as const, ([
  energy,
  breathSpeed,
  coreBrightness,
  flash,
  audioLevel,
  speakingLevel,
  color1,
  color2,
  scaleAnimation,
  shake,
  coreOffsetX,
  coreOffsetY,
  spikeLength,
  spikeRotationSpeed,
  flickerSpeed,
  coreGlowSize,
]) => {
  const u = materialRef.value.uniforms
  u.u_energy.value = energy
  u.u_breathSpeed.value = breathSpeed
  u.u_coreBrightness.value = coreBrightness
  u.u_flash.value = flash
  u.u_audioLevel.value = audioLevel
  u.u_speakingLevel.value = speakingLevel
  u.u_color1.value.set(color1)
  u.u_color2.value.set(color2)
  u.u_scaleAnimation.value = scaleAnimation
  u.u_shake.value = shake
  u.u_coreOffsetX.value = coreOffsetX
  u.u_coreOffsetY.value = coreOffsetY
  u.u_spikeLength.value = spikeLength
  u.u_spikeRotationSpeed.value = spikeRotationSpeed
  u.u_flickerSpeed.value = flickerSpeed
  u.u_coreGlowSize.value = coreGlowSize
})

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  materialRef.value.uniforms.u_time.value = (Date.now() - startTime) / 1000
})

onBeforeUnmount(() => {
  geometryRef.value.dispose()
  materialRef.value.dispose()
})
</script>

<template>
  <TresMesh
    :geometry="geometryRef"
    :material="materialRef"
  />
</template>
