<script setup lang="ts">
/**
 * Wagging tail: chain of small spheres + connecting line.
 * Sine-wave propagation for wag, curl amount adjustable.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props = withDefaults(defineProps<{
  tailWagSpeed?: number
  tailWagAmplitude?: number
  tailCurl?: number
  color2?: string
  glowIntensity?: number
}>(), {
  tailWagSpeed: 0.8,
  tailWagAmplitude: 0.3,
  tailCurl: 0.3,
  color2: '#0088AA',
  glowIntensity: 0.8,
})

const SEGMENT_COUNT = 5

// Tail segment sphere
const segSphereGeo = shallowRef(new SphereGeometry(0.025, 6, 4))
const segMat = shallowRef(new MeshBasicMaterial({
  color: new Color(props.color2),
  transparent: true,
  opacity: 0.8,
  blending: AdditiveBlending,
  depthWrite: false,
}))

// Connecting line
const lineGeo = shallowRef(new BufferGeometry())
const linePositions = new Float32Array(SEGMENT_COUNT * 3)
lineGeo.value.setAttribute('position', new BufferAttribute(linePositions, 3))

const lineMat = shallowRef(new LineBasicMaterial({
  color: new Color(props.color2),
  transparent: true,
  opacity: 0.5,
  blending: AdditiveBlending,
  depthWrite: false,
}))

// Segment positions as refs for TresGroup binding
const segmentPositions = ref<Array<[number, number, number]>>(
  Array.from({ length: SEGMENT_COUNT }, () => [0, 0, 0]),
)

const startTime = Date.now()

watch(() => [props.color2, props.glowIntensity] as const, ([c2, glow]) => {
  segMat.value.color.set(c2)
  segMat.value.opacity = 0.6 + glow * 0.3
  lineMat.value.color.set(c2)
  lineMat.value.opacity = 0.3 + glow * 0.2
})

const { onBeforeRender } = useLoop()

const tempPositions: Vector3[] = Array.from({ length: SEGMENT_COUNT }, () => new Vector3())

onBeforeRender(() => {
  const t = (Date.now() - startTime) / 1000

  // Build tail chain from base (attached to body back) outward
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const frac = (i + 1) / SEGMENT_COUNT
    const segLen = 0.07

    // Wag: sine wave that propagates along the tail
    const wagPhase = t * props.tailWagSpeed * Math.PI * 2 - frac * 1.5
    const wagX = Math.sin(wagPhase) * props.tailWagAmplitude * frac

    // Curl: arcs the tail upward
    const curlY = props.tailCurl * frac * frac * 0.3

    // Base direction: backward and slightly up
    const x = wagX
    const y = -0.2 + frac * (0.1 + curlY)
    const z = -0.15 - frac * segLen * SEGMENT_COUNT * 0.8

    tempPositions[i].set(x, y, z)
    linePositions[i * 3] = x
    linePositions[i * 3 + 1] = y
    linePositions[i * 3 + 2] = z
  }

  // Update line geometry
  const posAttr = lineGeo.value.getAttribute('position') as BufferAttribute
  posAttr.needsUpdate = true

  // Update segment positions
  segmentPositions.value = tempPositions.map(p => [p.x, p.y, p.z] as [number, number, number])
})

onBeforeUnmount(() => {
  segSphereGeo.value.dispose()
  lineGeo.value.dispose()
  segMat.value.dispose()
  lineMat.value.dispose()
})
</script>

<template>
  <!-- Tail base at body back -->
  <TresGroup :position="[0, -0.05, -0.2]">
    <!-- Connecting line -->
    <TresLine :geometry="lineGeo" :material="lineMat" />

    <!-- Tail segments -->
    <TresMesh
      v-for="(pos, i) in segmentPositions"
      :key="i"
      :geometry="segSphereGeo"
      :material="segMat"
      :position="pos"
    />
  </TresGroup>
</template>
