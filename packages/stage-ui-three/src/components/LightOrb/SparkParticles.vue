<script setup lang="ts">
/**
 * ~350 spark particles shooting outward from center with gravity arc.
 * Each particle follows a radial trajectory, fading as it travels.
 * Audio-reactive spawn intensity and emission speed.
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

import sparkParticlesFrag from '../../shaders/light-orb/spark-particles.frag?raw'
import sparkParticlesVert from '../../shaders/light-orb/spark-particles.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  orbitSpeed?: number
  coreOffsetX?: number
  coreOffsetY?: number
  audioLevel?: number
  speakingLevel?: number
  color1?: string
  color2?: string
  gravity?: number
  particleSpread?: number
  rayMaxLength?: number
  tangentialSpeed?: number
  pulseRate?: number
}>(), {
  energy: 0.5,
  orbitSpeed: 1.0,
  coreOffsetX: 0,
  coreOffsetY: 0,
  audioLevel: 0,
  speakingLevel: 0,
  color1: '#5599FF',
  color2: '#77BBFF',
  gravity: 0.1,
  particleSpread: 1.0,
  rayMaxLength: 1.0,
  tangentialSpeed: 0.0,
  pulseRate: 0.0,
})

const PARTICLE_COUNT = 350

function createGeometry(): BufferGeometry {
  const geo = new BufferGeometry()
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const indices = new Float32Array(PARTICLE_COUNT)
  const phases = new Float32Array(PARTICLE_COUNT)
  const thetas = new Float32Array(PARTICLE_COUNT)
  const phis = new Float32Array(PARTICLE_COUNT)
  const speeds = new Float32Array(PARTICLE_COUNT)
  const lifetimes = new Float32Array(PARTICLE_COUNT)
  const sizes = new Float32Array(PARTICLE_COUNT)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = 0
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = 0

    indices[i] = i
    phases[i] = Math.random()
    // Uniform spherical distribution
    thetas[i] = Math.random() * Math.PI * 2
    phis[i] = Math.acos(2.0 * Math.random() - 1.0)
    speeds[i] = 0.15 + Math.random() * 0.6
    lifetimes[i] = 1.2 + Math.random() * 2.5
    // Variable sizes: most small, some large bright sparks
    sizes[i] = Math.random() < 0.15
      ? 4.0 + Math.random() * 4.0 // 15% large sparks
      : 1.5 + Math.random() * 2.5 // 85% small sparks
  }

  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('a_index', new BufferAttribute(indices, 1))
  geo.setAttribute('a_phase', new BufferAttribute(phases, 1))
  geo.setAttribute('a_theta', new BufferAttribute(thetas, 1))
  geo.setAttribute('a_phi', new BufferAttribute(phis, 1))
  geo.setAttribute('a_speed', new BufferAttribute(speeds, 1))
  geo.setAttribute('a_lifetime', new BufferAttribute(lifetimes, 1))
  geo.setAttribute('a_size', new BufferAttribute(sizes, 1))

  return geo
}

const geometryRef = shallowRef(createGeometry())

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: sparkParticlesVert,
  fragmentShader: sparkParticlesFrag,
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
    u_gravity: { value: props.gravity },
    u_particleSpread: { value: props.particleSpread },
    u_rayMaxLength: { value: props.rayMaxLength },
    u_tangentialSpeed: { value: props.tangentialSpeed },
    u_pulseRate: { value: props.pulseRate },
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
  props.gravity,
  props.particleSpread,
  props.rayMaxLength,
  props.tangentialSpeed,
  props.pulseRate,
] as const, ([
  energy,
  orbitSpeed,
  coreOffsetX,
  coreOffsetY,
  audioLevel,
  speakingLevel,
  color1,
  color2,
  gravity,
  particleSpread,
  rayMaxLength,
  tangentialSpeed,
  pulseRate,
]) => {
  const u = materialRef.value.uniforms
  u.u_energy.value = energy
  u.u_orbitSpeed.value = orbitSpeed
  u.u_coreOffsetX.value = coreOffsetX
  u.u_coreOffsetY.value = coreOffsetY
  u.u_audioLevel.value = audioLevel
  u.u_speakingLevel.value = speakingLevel
  u.u_color1.value.set(color1)
  u.u_color2.value.set(color2)
  u.u_gravity.value = gravity
  u.u_particleSpread.value = particleSpread
  u.u_rayMaxLength.value = rayMaxLength
  u.u_tangentialSpeed.value = tangentialSpeed
  u.u_pulseRate.value = pulseRate
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
