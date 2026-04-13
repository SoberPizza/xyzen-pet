<script setup lang="ts">
/**
 * ~200 particles orbiting the sphere surface on 3D tilted paths.
 * Uses instanced point geometry with per-particle attributes.
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

import energyParticlesFrag from '../../shaders/light-orb/energy-particles.frag?raw'
import energyParticlesVert from '../../shaders/light-orb/energy-particles.vert?raw'

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

const PARTICLE_COUNT = 200

// Build particle geometry with custom attributes
function createGeometry(): BufferGeometry {
  const geo = new BufferGeometry()
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const indices = new Float32Array(PARTICLE_COUNT)
  const speeds = new Float32Array(PARTICLE_COUNT)
  const radii = new Float32Array(PARTICLE_COUNT)
  const phases = new Float32Array(PARTICLE_COUNT)
  const tilts = new Float32Array(PARTICLE_COUNT)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Positions start at origin, shader computes actual position
    positions[i * 3] = 0
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = 0

    indices[i] = i
    speeds[i] = 0.3 + Math.random() * 1.2
    radii[i] = 0.5 + Math.random() * 0.8
    phases[i] = Math.random() * Math.PI * 2
    tilts[i] = Math.random() * 2.0 - 1.0 // -1 to 1 (mapped to -PI to PI in shader)
  }

  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('a_index', new BufferAttribute(indices, 1))
  geo.setAttribute('a_speed', new BufferAttribute(speeds, 1))
  geo.setAttribute('a_radius', new BufferAttribute(radii, 1))
  geo.setAttribute('a_phase', new BufferAttribute(phases, 1))
  geo.setAttribute('a_tilt', new BufferAttribute(tilts, 1))

  return geo
}

const geometryRef = shallowRef(createGeometry())

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: energyParticlesVert,
  fragmentShader: energyParticlesFrag,
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
