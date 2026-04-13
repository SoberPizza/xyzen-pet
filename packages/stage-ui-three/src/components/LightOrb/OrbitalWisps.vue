<script setup lang="ts">
/**
 * 3 bright wisps with trailing points orbiting the core.
 * Each wisp has a head + trail points for motion trails.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import orbitalWispsFrag from '../../shaders/light-orb/orbital-wisps.frag?raw'
import orbitalWispsVert from '../../shaders/light-orb/orbital-wisps.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  orbitSpeed?: number
  coreOffsetX?: number
  coreOffsetY?: number
  audioLevel?: number
  speakingLevel?: number
  color1?: string
  color2?: string
}>(), {
  energy: 0.5,
  orbitSpeed: 1.0,
  coreOffsetX: 0,
  coreOffsetY: 0,
  audioLevel: 0,
  speakingLevel: 0,
  color1: '#5599FF',
  color2: '#77BBFF',
})
const WISP_COUNT = 3
const TRAIL_LENGTH = 12 // points per wisp (1 head + 11 trail)
const TOTAL_POINTS = WISP_COUNT * TRAIL_LENGTH

function createGeometry(): BufferGeometry {
  const geo = new BufferGeometry()
  const positions = new Float32Array(TOTAL_POINTS * 3)
  const wispIndices = new Float32Array(TOTAL_POINTS)
  const trailPositions = new Float32Array(TOTAL_POINTS)

  for (let w = 0; w < WISP_COUNT; w++) {
    for (let t = 0; t < TRAIL_LENGTH; t++) {
      const idx = w * TRAIL_LENGTH + t
      positions[idx * 3] = 0
      positions[idx * 3 + 1] = 0
      positions[idx * 3 + 2] = 0
      wispIndices[idx] = w
      trailPositions[idx] = t / (TRAIL_LENGTH - 1) // 0 = head, 1 = tail end
    }
  }

  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('a_wispIndex', new BufferAttribute(wispIndices, 1))
  geo.setAttribute('a_trailPosition', new BufferAttribute(trailPositions, 1))

  return geo
}

const geometryRef = shallowRef(createGeometry())

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: orbitalWispsVert,
  fragmentShader: orbitalWispsFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_energy: { value: props.energy },
    u_orbitSpeed: { value: props.orbitSpeed },
    u_coreOffsetX: { value: props.coreOffsetX },
    u_coreOffsetY: { value: props.coreOffsetY },
    u_audioLevel: { value: props.audioLevel },
    u_speakingLevel: { value: props.speakingLevel },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
  },
}))

const startTime = Date.now()

watch(() => [
  props.energy,
  props.orbitSpeed,
  props.coreOffsetX,
  props.coreOffsetY,
  props.audioLevel,
  props.speakingLevel,
  props.color1,
  props.color2,
] as const, ([energy, orbitSpeed, coreOffsetX, coreOffsetY, audioLevel, speakingLevel, color1, color2]) => {
  const u = materialRef.value.uniforms
  u.u_energy.value = energy
  u.u_orbitSpeed.value = orbitSpeed
  u.u_coreOffsetX.value = coreOffsetX
  u.u_coreOffsetY.value = coreOffsetY
  u.u_audioLevel.value = audioLevel
  u.u_speakingLevel.value = speakingLevel
  u.u_color1.value.set(color1)
  u.u_color2.value.set(color2)
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
  <TresPoints
    :geometry="geometryRef"
    :material="materialRef"
  />
</template>
