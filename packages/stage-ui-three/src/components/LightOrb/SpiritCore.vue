<script setup lang="ts">
/**
 * Volumetric sphere body rendered as a billboard quad with 2.5D sphere shader.
 * Instantiated 3x for multi-layer depth (back/main/front).
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import spiritCoreFrag from '../../shaders/light-orb/spirit-core.frag?raw'
import spiritCoreVert from '../../shaders/light-orb/spirit-core.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  interaction?: number
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
  zOffset?: number
  opacityScale?: number
  scaleMultiplier?: number
}>(), {
  energy: 0.5,
  interaction: 0,
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
  zOffset: 0,
  opacityScale: 1.0,
  scaleMultiplier: 1.0,
})

// 2x2 plane centered at origin (billboard expands in shader)
const geometryRef = shallowRef(new PlaneGeometry(2, 2))

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: spiritCoreVert,
  fragmentShader: spiritCoreFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_energy: { value: props.energy },
    u_opacityScale: { value: props.opacityScale },
    u_breathSpeed: { value: props.breathSpeed },
    u_coreBrightness: { value: props.coreBrightness },
    u_flash: { value: props.flash },
    u_audioLevel: { value: props.audioLevel },
    u_speakingLevel: { value: props.speakingLevel },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
    u_zOffset: { value: props.zOffset },
    u_scaleMultiplier: { value: props.scaleMultiplier },
    u_scaleAnimation: { value: props.scaleAnimation },
    u_shake: { value: props.shake },
    u_coreOffsetX: { value: props.coreOffsetX },
    u_coreOffsetY: { value: props.coreOffsetY },
  },
}))

const startTime = Date.now()

watch(() => [
  props.energy,
  props.opacityScale,
  props.breathSpeed,
  props.coreBrightness,
  props.flash,
  props.audioLevel,
  props.speakingLevel,
  props.color1,
  props.color2,
  props.zOffset,
  props.scaleMultiplier,
  props.scaleAnimation,
  props.shake,
  props.coreOffsetX,
  props.coreOffsetY,
] as const, ([
  energy,
  opacityScale,
  breathSpeed,
  coreBrightness,
  flash,
  audioLevel,
  speakingLevel,
  color1,
  color2,
  zOffset,
  scaleMultiplier,
  scaleAnimation,
  shake,
  coreOffsetX,
  coreOffsetY,
]) => {
  const u = materialRef.value.uniforms
  u.u_energy.value = energy
  u.u_opacityScale.value = opacityScale
  u.u_breathSpeed.value = breathSpeed
  u.u_coreBrightness.value = coreBrightness
  u.u_flash.value = flash
  u.u_audioLevel.value = audioLevel
  u.u_speakingLevel.value = speakingLevel
  u.u_color1.value.set(color1)
  u.u_color2.value.set(color2)
  u.u_zOffset.value = zOffset
  u.u_scaleMultiplier.value = scaleMultiplier
  u.u_scaleAnimation.value = scaleAnimation
  u.u_shake.value = shake
  u.u_coreOffsetX.value = coreOffsetX
  u.u_coreOffsetY.value = coreOffsetY
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
