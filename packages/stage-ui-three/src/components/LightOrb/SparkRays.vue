<script setup lang="ts">
/**
 * ~100 radiating spark ray lines from center.
 * Each ray is a point sprite elongated into a streak via fragment shader.
 * Rays continuously spawn, grow outward, and fade.
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

import sparkRaysFrag from '../../shaders/light-orb/spark-rays.frag?raw'
import sparkRaysVert from '../../shaders/light-orb/spark-rays.vert?raw'

const props = withDefaults(defineProps<{
  energy?: number
  orbitSpeed?: number
  coreOffsetX?: number
  coreOffsetY?: number
  audioLevel?: number
  speakingLevel?: number
  color1?: string
  color2?: string
  coreBrightness?: number
  rayMaxLength?: number
  rayDensity?: number
  flickerSpeed?: number
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
  coreBrightness: 1.0,
  rayMaxLength: 1.0,
  rayDensity: 0.5,
  flickerSpeed: 15.0,
  pulseRate: 0.0,
})

const RAY_COUNT = 50

function createGeometry(): BufferGeometry {
  const geo = new BufferGeometry()
  const positions = new Float32Array(RAY_COUNT * 3)
  const indices = new Float32Array(RAY_COUNT)
  const phases = new Float32Array(RAY_COUNT)
  const angleThetas = new Float32Array(RAY_COUNT)
  const anglePhis = new Float32Array(RAY_COUNT)
  const speeds = new Float32Array(RAY_COUNT)
  const maxLengths = new Float32Array(RAY_COUNT)

  for (let i = 0; i < RAY_COUNT; i++) {
    positions[i * 3] = 0
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = 0

    indices[i] = i
    phases[i] = Math.random()
    // Uniform spherical distribution for 3D radial rays
    angleThetas[i] = Math.random() * Math.PI * 2
    anglePhis[i] = Math.acos(2.0 * Math.random() - 1.0)
    speeds[i] = 0.2 + Math.random() * 0.6
    maxLengths[i] = 0.3 + Math.random() * 0.6
  }

  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('a_index', new BufferAttribute(indices, 1))
  geo.setAttribute('a_phase', new BufferAttribute(phases, 1))
  geo.setAttribute('a_angleTheta', new BufferAttribute(angleThetas, 1))
  geo.setAttribute('a_anglePhi', new BufferAttribute(anglePhis, 1))
  geo.setAttribute('a_speed', new BufferAttribute(speeds, 1))
  geo.setAttribute('a_maxLength', new BufferAttribute(maxLengths, 1))

  return geo
}

const geometryRef = shallowRef(createGeometry())

const materialRef = shallowRef(new ShaderMaterial({
  vertexShader: sparkRaysVert,
  fragmentShader: sparkRaysFrag,
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
    u_coreBrightness: { value: props.coreBrightness },
    u_rayMaxLength: { value: props.rayMaxLength },
    u_rayDensity: { value: props.rayDensity },
    u_flickerSpeed: { value: props.flickerSpeed },
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
  props.coreBrightness,
  props.rayMaxLength,
  props.rayDensity,
  props.flickerSpeed,
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
  coreBrightness,
  rayMaxLength,
  rayDensity,
  flickerSpeed,
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
  u.u_coreBrightness.value = coreBrightness
  u.u_rayMaxLength.value = rayMaxLength
  u.u_rayDensity.value = rayDensity
  u.u_flickerSpeed.value = flickerSpeed
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
