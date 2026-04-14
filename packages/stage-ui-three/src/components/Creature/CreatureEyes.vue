<script setup lang="ts">
/**
 * Two bright eye points on the head.
 * Small spheres with MeshBasicMaterial, blink animation via Y-scale.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props = withDefaults(defineProps<{
  eyeScale?: number
  eyeBlink?: number
  color1?: string
}>(), {
  eyeScale: 1.0,
  eyeBlink: 0.3,
  color1: '#00DDCC',
})

const eyeGeo = shallowRef(new SphereGeometry(0.025, 8, 6))
const eyeMat = shallowRef(new MeshBasicMaterial({
  color: new Color(props.color1).multiplyScalar(2.0),
  transparent: true,
  opacity: 1.0,
  blending: AdditiveBlending,
  depthWrite: false,
}))

const leftEyeScaleY = ref(1.0)
const rightEyeScaleY = ref(1.0)
const currentScale = ref(1.0)

const startTime = Date.now()

watch(() => [props.color1] as const, ([c1]) => {
  eyeMat.value.color.set(c1).multiplyScalar(2.0)
})

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const t = (Date.now() - startTime) / 1000

  currentScale.value = props.eyeScale

  // Blink: periodic Y-scale squash to near 0
  // Higher eyeBlink = more frequent blinks
  const blinkCycle = Math.sin(t * (1.0 + props.eyeBlink * 3.0))
  const blinkThreshold = 0.97 - props.eyeBlink * 0.15
  const isBlinking = blinkCycle > blinkThreshold

  const blinkScale = isBlinking ? 0.1 : 1.0
  leftEyeScaleY.value = blinkScale
  rightEyeScaleY.value = blinkScale
})

onBeforeUnmount(() => {
  eyeGeo.value.dispose()
  eyeMat.value.dispose()
})
</script>

<template>
  <!-- Left eye -->
  <TresMesh
    :geometry="eyeGeo"
    :material="eyeMat"
    :position="[-0.065, 0.35, 0.15]"
    :scale="[currentScale, currentScale * leftEyeScaleY, currentScale]"
  />

  <!-- Right eye -->
  <TresMesh
    :geometry="eyeGeo"
    :material="eyeMat"
    :position="[0.065, 0.35, 0.15]"
    :scale="[currentScale, currentScale * rightEyeScaleY, currentScale]"
  />
</template>
