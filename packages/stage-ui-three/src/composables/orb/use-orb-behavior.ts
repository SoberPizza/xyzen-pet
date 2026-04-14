/**
 * Maps orb state to light orb visual parameters (uniforms + colors).
 *
 * Three-layer animation response:
 * 1. Immediate reaction (VAD -> listening animation)
 * 2. Emotion reaction (color/motion/shape/formation transition)
 * 3. Activity modifiers (idle/listening/thinking/speaking -> distinct visual modes)
 */

import type { Ref } from 'vue'

import type { OrbActivity, OrbEmotion } from './types'

import { Color } from 'three'
import { computed, ref, triggerRef, watch } from 'vue'

// Color palettes for each emotion
const EMOTION_COLORS: Record<OrbEmotion, { primary: string, secondary: string }> = {
  happy: { primary: '#FFD060', secondary: '#FF8C42' },
  neutral: { primary: '#5599FF', secondary: '#77BBFF' },
  sad: { primary: '#3366AA', secondary: '#5040AA' },
  angry: { primary: '#FF2222', secondary: '#FF0044' },
  surprised: { primary: '#E0D0FF', secondary: '#FFD060' },
  fear: { primary: '#88CCEE', secondary: '#55AACC' },
  disgust: { primary: '#88AA44', secondary: '#667722' },
  think: { primary: '#A080E0', secondary: '#6090E0' },
}

// Thinking state override color
const THINKING_COLORS = { primary: '#B0A0D0', secondary: '#8070B0' }

// Emotion-driven animation parameters
interface EmotionParams {
  breathSpeed: number
  orbitSpeed: number
  shake: number
  coreOffsetX: number
  coreOffsetY: number
  coreOffsetZ: number
  coreBrightness: number
  coreBobAmplitude: number
  coreBobFrequency: number
  coreScaleBase: number
  // Core spike params
  spikeLength: number
  spikeRotationSpeed: number
  flickerSpeed: number
  coreGlowSize: number
  // Ray params
  rayDensity: number
  rayMaxLength: number
  pulseRate: number
}

const EMOTION_PARAMS: Record<OrbEmotion, EmotionParams> = {
  // Still candle — barely moving, rays hover near the core, serene
  neutral: {
    breathSpeed: 0.6,
    orbitSpeed: 0.4,
    shake: 0,
    coreOffsetX: 0,
    coreOffsetY: 0,
    coreOffsetZ: 0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0.01,
    coreBobFrequency: 0.3,
    coreScaleBase: 1.0,
    spikeLength: 0.5,
    spikeRotationSpeed: 0.03,
    flickerSpeed: 10.0,
    coreGlowSize: 60.0,
    rayDensity: 0.25,
    rayMaxLength: 0.6,
    pulseRate: 0.0,
  },
  // Joyful bounce — floats upward, bouncy rhythm, rays spread wide like fireworks
  happy: {
    breathSpeed: 1.8,
    orbitSpeed: 1.5,
    shake: 0,
    coreOffsetX: 0,
    coreOffsetY: 0.12,
    coreOffsetZ: 0.15,
    coreBrightness: 1.3,
    coreBobAmplitude: 0.08,
    coreBobFrequency: 2.5,
    coreScaleBase: 1.15,
    spikeLength: 0.8,
    spikeRotationSpeed: 0.25,
    flickerSpeed: 22.0,
    coreGlowSize: 50.0,
    rayDensity: 0.7,
    rayMaxLength: 2.2,
    pulseRate: 0.5,
  },
  // Wilting ember — sinks, dims, retreats into the distance, barely alive
  sad: {
    breathSpeed: 0.2,
    orbitSpeed: 0.2,
    shake: 0,
    coreOffsetX: 0,
    coreOffsetY: -0.1,
    coreOffsetZ: -0.2,
    coreBrightness: 0.3,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
    coreScaleBase: 0.7,
    spikeLength: 0.2,
    spikeRotationSpeed: 0.005,
    flickerSpeed: 3.0,
    coreGlowSize: 90.0,
    rayDensity: 0.1,
    rayMaxLength: 0.3,
    pulseRate: 0.0,
  },
  // Bristling fury — spikes explode outward, violent shake, lunges at camera, rays everywhere
  angry: {
    breathSpeed: 3.0,
    orbitSpeed: 3.5,
    shake: 1.5,
    coreOffsetX: 0,
    coreOffsetY: 0.03,
    coreOffsetZ: 0.22,
    coreBrightness: 1.6,
    coreBobAmplitude: 0.02,
    coreBobFrequency: 8.0,
    coreScaleBase: 1.3,
    spikeLength: 2.0,
    spikeRotationSpeed: 0.8,
    flickerSpeed: 55.0,
    coreGlowSize: 40.0,
    rayDensity: 1.0,
    rayMaxLength: 3.0,
    pulseRate: 3.5,
  },
  // Flash bloom — core enlarges massively, rapid spin burst, jumps toward camera
  surprised: {
    breathSpeed: 1.5,
    orbitSpeed: 2.5,
    shake: 0.15,
    coreOffsetX: 0,
    coreOffsetY: 0.06,
    coreOffsetZ: 0.25,
    coreBrightness: 1.5,
    coreBobAmplitude: 0.04,
    coreBobFrequency: 4.0,
    coreScaleBase: 1.8,
    spikeLength: 1.8,
    spikeRotationSpeed: 1.2,
    flickerSpeed: 35.0,
    coreGlowSize: 20.0,
    rayDensity: 0.9,
    rayMaxLength: 2.5,
    pulseRate: 0.0,
  },
  // Trembling retreat — contracted, shivering, cowering to one side, rapid anxious flicker
  fear: {
    breathSpeed: 2.5,
    orbitSpeed: 2.0,
    shake: 0.6,
    coreOffsetX: 0.04,
    coreOffsetY: -0.06,
    coreOffsetZ: -0.18,
    coreBrightness: 0.45,
    coreBobAmplitude: 0.015,
    coreBobFrequency: 6.0,
    coreScaleBase: 0.65,
    spikeLength: 0.25,
    spikeRotationSpeed: 0.12,
    flickerSpeed: 55.0,
    coreGlowSize: 80.0,
    rayDensity: 0.15,
    rayMaxLength: 0.35,
    pulseRate: 0.0,
  },
  // Nauseous pulse — slow heavy throbs, averts sideways, murky dim glow
  disgust: {
    breathSpeed: 0.35,
    orbitSpeed: 0.3,
    shake: 0.05,
    coreOffsetX: -0.04,
    coreOffsetY: -0.02,
    coreOffsetZ: -0.1,
    coreBrightness: 0.4,
    coreBobAmplitude: 0.03,
    coreBobFrequency: 1.2,
    coreScaleBase: 0.85,
    spikeLength: 0.3,
    spikeRotationSpeed: 0.015,
    flickerSpeed: 4.0,
    coreGlowSize: 70.0,
    rayDensity: 0.15,
    rayMaxLength: 0.5,
    pulseRate: 2.8,
  },
  // Meditative orbit — rays all visible in even distribution, very slow deliberate motion
  think: {
    breathSpeed: 0.3,
    orbitSpeed: 0.25,
    shake: 0,
    coreOffsetX: 0,
    coreOffsetY: 0.03,
    coreOffsetZ: -0.06,
    coreBrightness: 0.85,
    coreBobAmplitude: 0.005,
    coreBobFrequency: 0.4,
    coreScaleBase: 1.0,
    spikeLength: 0.6,
    spikeRotationSpeed: 0.15,
    flickerSpeed: 5.0,
    coreGlowSize: 55.0,
    rayDensity: 1.0,
    rayMaxLength: 1.8,
    pulseRate: 1.0,
  },
}

// Activity modifiers -- applied on top of emotion base params
interface ActivityModifiers {
  breathSpeedMul: number
  orbitSpeedMul: number
  coreSwayAmplitude: number
  coreSwayFrequency: number
  coreBobAmplitude: number
  coreBobFrequency: number
}

const ACTIVITY_MODIFIERS: Record<OrbActivity, ActivityModifiers> = {
  idle: {
    breathSpeedMul: 1.0,
    orbitSpeedMul: 1.0,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0.01,
    coreBobFrequency: 0.3,
  },
  listening: {
    breathSpeedMul: 0.8,
    orbitSpeedMul: 0.7,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  thinking: {
    breathSpeedMul: 0.7,
    orbitSpeedMul: 0.6,
    coreSwayAmplitude: 0.1,
    coreSwayFrequency: 0.4,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  speaking: {
    breathSpeedMul: 1.2,
    orbitSpeedMul: 1.4,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
}

export interface OrbBehaviorOptions {
  mood: Ref<number>
  energy: Ref<number>
  activity: Ref<OrbActivity>
  currentEmotion: Ref<OrbEmotion>
  audioLevel: Ref<number>
  speakingLevel: Ref<number>
}

export function useOrbBehavior(options: OrbBehaviorOptions) {
  const { energy, activity, currentEmotion, audioLevel, speakingLevel } = options

  const startTime = Date.now()

  // Interaction pulse: set to 1.0 on click/hover, decays to 0
  const interactionPulse = ref(0)
  let interactionDecayTimer: ReturnType<typeof requestAnimationFrame> | null = null

  function triggerInteraction(intensity = 1.0) {
    interactionPulse.value = intensity
    decayInteraction()
  }

  function decayInteraction() {
    if (interactionDecayTimer)
      cancelAnimationFrame(interactionDecayTimer)

    const decay = () => {
      interactionPulse.value *= 0.92
      if (interactionPulse.value < 0.01) {
        interactionPulse.value = 0
        return
      }
      interactionDecayTimer = requestAnimationFrame(decay)
    }
    interactionDecayTimer = requestAnimationFrame(decay)
  }

  // Flash pulse: surprised triggers 1.0, decays quickly
  const flashPulse = ref(0)
  let flashDecayTimer: ReturnType<typeof requestAnimationFrame> | null = null

  function triggerFlash() {
    flashPulse.value = 1.0
    if (flashDecayTimer)
      cancelAnimationFrame(flashDecayTimer)

    const decay = () => {
      flashPulse.value *= 0.88
      if (flashPulse.value < 0.01) {
        flashPulse.value = 0
        return
      }
      flashDecayTimer = requestAnimationFrame(decay)
    }
    flashDecayTimer = requestAnimationFrame(decay)
  }

  // Smoothed emotion params (interpolated per frame)
  const currentParams = ref<EmotionParams>({ ...EMOTION_PARAMS.neutral })
  const targetParams = ref<EmotionParams>({ ...EMOTION_PARAMS.neutral })

  // Smoothed color transition (~500ms ease)
  const targetColor1 = ref(new Color(EMOTION_COLORS.neutral.primary))
  const targetColor2 = ref(new Color(EMOTION_COLORS.neutral.secondary))
  const currentColor1 = ref(new Color(EMOTION_COLORS.neutral.primary))
  const currentColor2 = ref(new Color(EMOTION_COLORS.neutral.secondary))

  // Per-frame computed outputs (activity-modified)
  const computedCoreOffsetX = ref(0)
  const computedCoreOffsetY = ref(0)
  const computedCoreOffsetZ = ref(0)
  const computedOrbitSpeed = ref(1.0)
  const computedBreathSpeed = ref(0.8)

  // Scale animation: breathing + emotion base scale
  const computedScaleAnimation = ref(1.0)

  // Update targets when emotion or activity changes
  watch([currentEmotion, activity], ([emotion, act]) => {
    if (act === 'thinking') {
      targetColor1.value = new Color(THINKING_COLORS.primary)
      targetColor2.value = new Color(THINKING_COLORS.secondary)
      targetParams.value = { ...EMOTION_PARAMS.think }
    }
    else {
      const palette = EMOTION_COLORS[emotion]
      targetColor1.value = new Color(palette.primary)
      targetColor2.value = new Color(palette.secondary)
      targetParams.value = { ...EMOTION_PARAMS[emotion] }
    }

    // Surprised triggers a one-shot flash
    if (emotion === 'surprised') {
      triggerFlash()
    }
  }, { immediate: true })

  // Smooth interpolation per frame for colors, params, and activity modifiers
  function updateColors(deltaTime: number) {
    const lerpFactor = Math.min(1, deltaTime * 3) // ~500ms transition

    // Lerp colors
    currentColor1.value.lerp(targetColor1.value, lerpFactor)
    currentColor2.value.lerp(targetColor2.value, lerpFactor)

    // Lerp all emotion params
    const p = currentParams.value
    const t = targetParams.value
    const keys = Object.keys(p) as Array<keyof EmotionParams>
    for (const key of keys) {
      p[key] += (t[key] - p[key]) * lerpFactor
    }

    // Activity modifiers
    const elapsed = (Date.now() - startTime) / 1000
    const actMod = ACTIVITY_MODIFIERS[activity.value]

    // Core position: emotion base + activity oscillation
    const sway = actMod.coreSwayAmplitude * Math.sin(elapsed * actMod.coreSwayFrequency * Math.PI * 2)
    const bob = actMod.coreBobAmplitude * Math.sin(elapsed * actMod.coreBobFrequency * Math.PI * 2)

    // Emotion-level bob (e.g. happy bounces, angry vibration, fear trembling)
    const emotionBob = p.coreBobAmplitude * Math.sin(elapsed * p.coreBobFrequency * Math.PI * 2)

    // Speaking bounce: driven by speakingLevel directly
    const speakBounce = activity.value === 'speaking' ? speakingLevel.value * 0.1 : 0

    computedCoreOffsetX.value = p.coreOffsetX + sway
    computedCoreOffsetY.value = p.coreOffsetY + bob + emotionBob + speakBounce
    computedCoreOffsetZ.value = p.coreOffsetZ

    // Apply multipliers
    computedOrbitSpeed.value = p.orbitSpeed * actMod.orbitSpeedMul
    computedBreathSpeed.value = p.breathSpeed * actMod.breathSpeedMul

    // Scale animation: emotion base scale + breathing
    const breathScale = 0.97 + 0.03 * Math.sin(elapsed * computedBreathSpeed.value)
    computedScaleAnimation.value = p.coreScaleBase * breathScale

    // Force Vue to detect in-place mutations on Color objects and params
    triggerRef(currentColor1)
    triggerRef(currentColor2)
    triggerRef(currentParams)
  }

  // Computed uniform values
  const uniforms = computed(() => ({
    u_energy: energy.value,
    u_audioLevel: activity.value === 'listening' ? audioLevel.value : 0,
    u_speakingLevel: activity.value === 'speaking' ? speakingLevel.value : 0,
    u_color1: currentColor1.value,
    u_color2: currentColor2.value,
    // Emotion-driven animation params
    u_breathSpeed: computedBreathSpeed.value,
    u_orbitSpeed: computedOrbitSpeed.value,
    u_shake: currentParams.value.shake,
    u_flash: flashPulse.value,
    // Core position (Z = emotion depth for 3D parallax)
    u_coreOffsetX: computedCoreOffsetX.value,
    u_coreOffsetY: computedCoreOffsetY.value,
    u_coreOffsetZ: computedCoreOffsetZ.value,
    // Core behavior
    u_coreBrightness: currentParams.value.coreBrightness,
    u_scaleAnimation: computedScaleAnimation.value,
    // Core spike params
    u_spikeLength: currentParams.value.spikeLength,
    u_spikeRotationSpeed: currentParams.value.spikeRotationSpeed,
    u_flickerSpeed: currentParams.value.flickerSpeed,
    u_coreGlowSize: currentParams.value.coreGlowSize,
    // Ray params
    u_rayDensity: currentParams.value.rayDensity,
    u_rayMaxLength: currentParams.value.rayMaxLength,
    u_pulseRate: currentParams.value.pulseRate,
  }))

  return {
    uniforms,
    currentColor1,
    currentColor2,
    interactionPulse,
    triggerInteraction,
    updateColors,
  }
}
