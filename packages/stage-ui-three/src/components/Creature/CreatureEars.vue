<script setup lang="ts">
/**
 * Two triangular ears on top of the head.
 * ConeGeometry -> EdgesGeometry + LineSegments with rotation driven by earAngle prop.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  EdgesGeometry,
  LineBasicMaterial,
} from 'three'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props = withDefaults(defineProps<{
  earAngle?: number
  earTwitch?: number
  color1?: string
  glowIntensity?: number
}>(), {
  earAngle: 0.6,
  earTwitch: 0,
  color1: '#00DDCC',
  glowIntensity: 0.8,
})

const coneGeo = new ConeGeometry(0.06, 0.16, 4)
const earEdgesGeo = shallowRef(new EdgesGeometry(coneGeo, 15))

const earMat = shallowRef(new LineBasicMaterial({
  color: new Color(props.color1),
  transparent: true,
  opacity: 0.7,
  blending: AdditiveBlending,
  depthWrite: false,
}))

// Ear rotation refs (interpolated)
const leftEarRotZ = ref(0.3)
const rightEarRotZ = ref(-0.3)

const startTime = Date.now()

watch(() => [props.color1, props.glowIntensity] as const, ([c1, glow]) => {
  earMat.value.color.set(c1)
  earMat.value.opacity = 0.5 + glow * 0.3
})

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const t = (Date.now() - startTime) / 1000

  // Ear angle: 0 = flat (outward), 1 = perked (upward)
  // Maps earAngle [0,1] to rotation [-0.6, 0.1] for left, [0.6, -0.1] for right
  const baseAngleL = 0.6 - props.earAngle * 0.7
  const baseAngleR = -0.6 + props.earAngle * 0.7

  // Twitch: quick oscillation
  const twitch = props.earTwitch * Math.sin(t * 25) * 0.1

  leftEarRotZ.value = baseAngleL + twitch
  rightEarRotZ.value = baseAngleR - twitch
})

onBeforeUnmount(() => {
  coneGeo.dispose()
  earEdgesGeo.value.dispose()
  earMat.value.dispose()
})
</script>

<template>
  <!-- Left ear -->
  <TresGroup :position="[-0.1, 0.5, 0]" :rotation-z="leftEarRotZ">
    <TresLineSegments :geometry="earEdgesGeo" :material="earMat" />
  </TresGroup>

  <!-- Right ear -->
  <TresGroup :position="[0.1, 0.5, 0]" :rotation-z="rightEarRotZ">
    <TresLineSegments :geometry="earEdgesGeo" :material="earMat" />
  </TresGroup>
</template>
