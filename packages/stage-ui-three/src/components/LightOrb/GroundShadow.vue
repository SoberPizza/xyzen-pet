<script setup lang="ts">
/**
 * Enhanced holographic ground shadow -- larger, more prominent elliptical shadow.
 *
 * Uses NormalBlending (not Additive) since shadows must darken.
 * Tracks core offset with parallax for depth cue.
 */

import { useLoop } from '@tresjs/core'
import {
  Color,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import groundShadowFrag from '../../shaders/light-orb/ground-shadow.frag?raw'
import groundShadowVert from '../../shaders/light-orb/ground-shadow.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  breathSpeed?: number
  coreOffsetX?: number
  coreOffsetY?: number
  color1?: string
}>(), {
  energy: 0.5,
  breathSpeed: 0.8,
  coreOffsetX: 0,
  coreOffsetY: 0,
  color1: '#5599FF',
})

const geometryRef = shallowRef(new PlaneGeometry(1, 1))

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: groundShadowVert,
  fragmentShader: groundShadowFrag,
  transparent: true,
  depthWrite: false,
  blending: NormalBlending,
  uniforms: {
    u_time: { value: 0 },
    u_energy: { value: props.energy },
    u_breathSpeed: { value: props.breathSpeed },
    u_coreOffsetX: { value: props.coreOffsetX },
    u_coreOffsetY: { value: props.coreOffsetY },
    u_color1: { value: new Color(props.color1) },
  },
}))

const startTime = Date.now()

watch(() => [
  props.energy,
  props.breathSpeed,
  props.coreOffsetX,
  props.coreOffsetY,
  props.color1,
] as const, ([energy, breathSpeed, coreOffsetX, coreOffsetY, color1]) => {
  const u = materialRef.value.uniforms
  u.u_energy.value = energy
  u.u_breathSpeed.value = breathSpeed
  u.u_coreOffsetX.value = coreOffsetX
  u.u_coreOffsetY.value = coreOffsetY
  u.u_color1.value.set(color1)
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
    :position="[0, -1.2, 0]"
    :rotation="[-Math.PI / 2, 0, 0]"
  />
</template>
