<script setup lang="ts">
/**
 * Concentric rings on ground plane for perspective reference.
 * Uses polygonOffset to avoid z-fighting with GroundShadow.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import groundGridFrag from '../../shaders/light-orb/ground-grid.frag?raw'
import groundGridVert from '../../shaders/light-orb/ground-grid.vert?raw'

const props = withDefaults(defineProps<{
  coreOffsetX?: number
  color1?: string
}>(), {
  coreOffsetX: 0,
  color1: '#5599FF',
})

const geometryRef = shallowRef(new PlaneGeometry(1, 1))

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: groundGridVert,
  fragmentShader: groundGridFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  uniforms: {
    u_time: { value: 0 },
    u_coreOffsetX: { value: props.coreOffsetX },
    u_color1: { value: new Color(props.color1) },
  },
}))

const startTime = Date.now()

watch(() => [props.coreOffsetX, props.color1] as const, ([coreOffsetX, color1]) => {
  const u = materialRef.value.uniforms
  u.u_coreOffsetX.value = coreOffsetX
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
    :position="[0, -1.19, 0]"
    :rotation="[-Math.PI / 2, 0, 0]"
  />
</template>
