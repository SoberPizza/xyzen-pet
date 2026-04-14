<script setup lang="ts">
/**
 * Ambient sparkle particles orbiting the creature.
 * Points with custom aura shader, additive blending.
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

import creatureAuraFrag from '../../shaders/creature/creature-aura.frag?raw'
import creatureAuraVert from '../../shaders/creature/creature-aura.vert?raw'

const props = withDefaults(defineProps<{
  auraBrightness?: number
  color1?: string
  color2?: string
  energy?: number
}>(), {
  auraBrightness: 0.6,
  color1: '#00DDCC',
  color2: '#0088AA',
  energy: 0.8,
})

const PARTICLE_COUNT = 70

function createGeometry() {
  const geo = new BufferGeometry()
  const phases = new Float32Array(PARTICLE_COUNT)
  const speeds = new Float32Array(PARTICLE_COUNT)
  const radii = new Float32Array(PARTICLE_COUNT)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    phases[i] = Math.random()
    speeds[i] = 0.3 + Math.random() * 0.8
    radii[i] = 0.4 + Math.random() * 0.5
  }

  // Dummy positions (computed in shader)
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('a_phase', new BufferAttribute(phases, 1))
  geo.setAttribute('a_speed', new BufferAttribute(speeds, 1))
  geo.setAttribute('a_radius', new BufferAttribute(radii, 1))

  return geo
}

const geometryRef = shallowRef(createGeometry())

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: creatureAuraVert,
  fragmentShader: creatureAuraFrag,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    u_time: { value: 0 },
    u_energy: { value: props.energy },
    u_auraBrightness: { value: props.auraBrightness },
    u_color1: { value: new Color(props.color1) },
    u_color2: { value: new Color(props.color2) },
  },
}))

const startTime = Date.now()

watch(() => [
  props.auraBrightness,
  props.color1,
  props.color2,
  props.energy,
] as const, ([brightness, c1, c2, en]) => {
  const u = materialRef.value.uniforms
  u.u_auraBrightness.value = brightness
  u.u_color1.value.set(c1)
  u.u_color2.value.set(c2)
  u.u_energy.value = en
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
  <TresPoints :geometry="geometryRef" :material="materialRef" />
</template>
