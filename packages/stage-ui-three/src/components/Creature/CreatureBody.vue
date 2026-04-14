<script setup lang="ts">
/**
 * Creature body + head: squashed sphere wireframes with holographic glow.
 * EdgesGeometry + LineSegments for the wireframe aesthetic.
 */

import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import creatureGlowFrag from '../../shaders/creature/creature-glow.frag?raw'
import creatureGlowVert from '../../shaders/creature/creature-glow.vert?raw'

const props = withDefaults(defineProps<{
  color1?: string
  color2?: string
  breathSpeed?: number
  bodyBounce?: number
  bodySquash?: number
  glowIntensity?: number
  speakingLevel?: number
}>(), {
  color1: '#00DDCC',
  color2: '#0088AA',
  breathSpeed: 0.8,
  bodyBounce: 0.0,
  bodySquash: 1.0,
  glowIntensity: 0.8,
  speakingLevel: 0,
})

// Body: slightly squashed sphere
const bodySphereGeo = new SphereGeometry(0.28, 12, 8)
bodySphereGeo.scale(1, 0.85, 0.9)
const bodyEdgesGeo = shallowRef(new EdgesGeometry(bodySphereGeo, 15))

// Head: smaller sphere on top
const headSphereGeo = new SphereGeometry(0.2, 10, 8)
const headEdgesGeo = shallowRef(new EdgesGeometry(headSphereGeo, 15))

// Wireframe material (lines)
const bodyLineMat = shallowRef(new LineBasicMaterial({
  color: new Color(props.color1),
  transparent: true,
  opacity: 0.6,
  blending: AdditiveBlending,
  depthWrite: false,
}))

const headLineMat = shallowRef(new LineBasicMaterial({
  color: new Color(props.color1),
  transparent: true,
  opacity: 0.7,
  blending: AdditiveBlending,
  depthWrite: false,
}))

// Glow shader for the solid mesh overlay
const bodyGlowMat = shallowRef(new ShaderMaterial({
  vertexShader: creatureGlowVert,
  fragmentShader: creatureGlowFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_breathSpeed: { value: props.breathSpeed },
    u_bodyBounce: { value: props.bodyBounce },
    u_bodySquash: { value: props.bodySquash },
    u_glowIntensity: { value: props.glowIntensity },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
  },
}))

const headGlowMat = shallowRef(new ShaderMaterial({
  vertexShader: creatureGlowVert,
  fragmentShader: creatureGlowFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_breathSpeed: { value: props.breathSpeed },
    u_bodyBounce: { value: 0 },
    u_bodySquash: { value: 1.0 },
    u_glowIntensity: { value: props.glowIntensity },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
  },
}))

const startTime = Date.now()

watch(() => [
  props.color1,
  props.color2,
  props.breathSpeed,
  props.bodyBounce,
  props.bodySquash,
  props.glowIntensity,
] as const, ([c1, c2, breath, bounce, squash, glow]) => {
  bodyLineMat.value.color.set(c1)
  headLineMat.value.color.set(c1)
  bodyLineMat.value.opacity = 0.4 + glow * 0.3
  headLineMat.value.opacity = 0.5 + glow * 0.3

  const bu = bodyGlowMat.value.uniforms
  bu.u_breathSpeed.value = breath
  bu.u_bodyBounce.value = bounce
  bu.u_bodySquash.value = squash
  bu.u_glowIntensity.value = glow
  bu.u_color1.value.set(c1)
  bu.u_color2.value.set(c2)

  const hu = headGlowMat.value.uniforms
  hu.u_breathSpeed.value = breath
  hu.u_glowIntensity.value = glow
  hu.u_color1.value.set(c1)
  hu.u_color2.value.set(c2)
})

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const t = (Date.now() - startTime) / 1000
  bodyGlowMat.value.uniforms.u_time.value = t
  headGlowMat.value.uniforms.u_time.value = t
})

onBeforeUnmount(() => {
  bodySphereGeo.dispose()
  bodyEdgesGeo.value.dispose()
  headSphereGeo.dispose()
  headEdgesGeo.value.dispose()
  bodyLineMat.value.dispose()
  headLineMat.value.dispose()
  bodyGlowMat.value.dispose()
  headGlowMat.value.dispose()
})
</script>

<template>
  <!-- Body group -->
  <TresGroup :position-y="-0.05">
    <!-- Wireframe lines -->
    <TresLineSegments :geometry="bodyEdgesGeo" :material="bodyLineMat" />
    <!-- Glow overlay -->
    <TresMesh :geometry="bodySphereGeo" :material="bodyGlowMat" />
  </TresGroup>

  <!-- Head group (on top of body) -->
  <TresGroup :position-y="0.32">
    <TresLineSegments :geometry="headEdgesGeo" :material="headLineMat" />
    <TresMesh :geometry="headSphereGeo" :material="headGlowMat" />
  </TresGroup>
</template>
