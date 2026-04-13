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
import { computed, ref, watch } from 'vue'

// Color palettes for each emotion
const EMOTION_COLORS: Record<OrbEmotion, { primary: string, secondary: string }> = {
  happy: { primary: '#FFD060', secondary: '#FF8C42' },
  neutral: { primary: '#5599FF', secondary: '#77BBFF' },
  sad: { primary: '#4488DD', secondary: '#6050AA' },
  angry: { primary: '#FF5533', secondary: '#FF3366' },
  surprised: { primary: '#E0D0FF', secondary: '#FFD060' },
  think: { primary: '#A080E0', secondary: '#6090E0' },
}

// Thinking state override color
const THINKING_COLORS = { primary: '#B0A0D0', secondary: '#8070B0' }

// Emotion-driven animation parameters
interface EmotionParams {
  breathSpeed: number
  orbitSpeed: number
  shake: number
  verticalDrift: number
  coreOffsetX: number
  coreOffsetY: number
  formationBlend: number
  formationType: number
  sentinelSpread: number
  sentinelSync: number
  particleOrganize: number
  activeRatio: number
  figure8: number
  bobAmplitude: number
  trailBrightness: number
  trailDroop: number
  orbitTiltBlend: number
  sentinelPulse: number
  coreBrightness: number
  coreBobAmplitude: number
  coreBobFrequency: number
}

const EMOTION_PARAMS: Record<OrbEmotion, EmotionParams> = {
  neutral: {
    breathSpeed: 0.8,
    orbitSpeed: 1.0,
    shake: 0,
    verticalDrift: 0,
    coreOffsetX: 0,
    coreOffsetY: 0,
    formationBlend: 0,
    formationType: 0,
    sentinelSpread: 1.0,
    sentinelSync: 0,
    particleOrganize: 0,
    activeRatio: 0.5,
    figure8: 0,
    bobAmplitude: 0.06,
    trailBrightness: 1.0,
    trailDroop: 0,
    orbitTiltBlend: 0,
    sentinelPulse: 0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  happy: {
    breathSpeed: 1.5,
    orbitSpeed: 1.8,
    shake: 0,
    verticalDrift: 0.05,
    coreOffsetX: 0,
    coreOffsetY: 0.12,
    formationBlend: 0.75,
    formationType: 1,
    sentinelSpread: 1.2,
    sentinelSync: 0,
    particleOrganize: 0,
    activeRatio: 0.8,
    figure8: 0,
    bobAmplitude: 0.18,
    trailBrightness: 1.5,
    trailDroop: 0,
    orbitTiltBlend: 0,
    sentinelPulse: 0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0.08,
    coreBobFrequency: 1.5,
  },
  sad: {
    breathSpeed: 0.4,
    orbitSpeed: 0.5,
    shake: 0,
    verticalDrift: -0.08,
    coreOffsetX: 0,
    coreOffsetY: -0.06,
    formationBlend: 0.7,
    formationType: 2,
    sentinelSpread: 0.85,
    sentinelSync: 0,
    particleOrganize: 0,
    activeRatio: 0.65,
    figure8: 0,
    bobAmplitude: 0.02,
    trailBrightness: 0.5,
    trailDroop: 0.4,
    orbitTiltBlend: 0,
    sentinelPulse: 0,
    coreBrightness: 0.5,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  angry: {
    breathSpeed: 2.0,
    orbitSpeed: 2.0,
    shake: 1.0,
    verticalDrift: 0,
    coreOffsetX: 0,
    coreOffsetY: 0,
    formationBlend: 0.65,
    formationType: 3,
    sentinelSpread: 1.3,
    sentinelSync: 0,
    particleOrganize: 0,
    activeRatio: 1.0,
    figure8: 0.8,
    bobAmplitude: 0.03,
    trailBrightness: 1.8,
    trailDroop: 0,
    orbitTiltBlend: 0,
    sentinelPulse: 0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  surprised: {
    breathSpeed: 1.2,
    orbitSpeed: 1.0,
    shake: 0,
    verticalDrift: 0.03,
    coreOffsetX: 0,
    coreOffsetY: 0.05,
    formationBlend: 0.85,
    formationType: 4,
    sentinelSpread: 1.4,
    sentinelSync: 0.6,
    particleOrganize: 0,
    activeRatio: 1.0,
    figure8: 0.3,
    bobAmplitude: 0.12,
    trailBrightness: 2.0,
    trailDroop: 0,
    orbitTiltBlend: 0,
    sentinelPulse: 1.0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
  think: {
    breathSpeed: 0.5,
    orbitSpeed: 1.2,
    shake: 0,
    verticalDrift: 0,
    coreOffsetX: 0,
    coreOffsetY: 0,
    formationBlend: 0.7,
    formationType: 5,
    sentinelSpread: 1.0,
    sentinelSync: 1.0,
    particleOrganize: 0.5,
    activeRatio: 0.6,
    figure8: 0,
    bobAmplitude: 0.02,
    trailBrightness: 0.7,
    trailDroop: 0,
    orbitTiltBlend: 1.0,
    sentinelPulse: 0,
    coreBrightness: 1.0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
  },
}

// Activity modifiers -- applied on top of emotion base params
interface ActivityModifiers {
  breathSpeedMul: number
  orbitSpeedMul: number
  sentinelSpreadMul: number
  sentinelSyncOverride: number | null
  particleOrganizeOverride: number | null
  coreSwayAmplitude: number
  coreSwayFrequency: number
  coreBobAmplitude: number
  coreBobFrequency: number
  audioPulseStrength: number
}

const ACTIVITY_MODIFIERS: Record<OrbActivity, ActivityModifiers> = {
  idle: {
    breathSpeedMul: 1.0,
    orbitSpeedMul: 1.0,
    sentinelSpreadMul: 1.0,
    sentinelSyncOverride: null,
    particleOrganizeOverride: null,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0.02,
    coreBobFrequency: 0.3,
    audioPulseStrength: 0,
  },
  listening: {
    breathSpeedMul: 0.8,
    orbitSpeedMul: 0.7,
    sentinelSpreadMul: 1.15,
    sentinelSyncOverride: null,
    particleOrganizeOverride: null,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
    audioPulseStrength: 0.8,
  },
  thinking: {
    breathSpeedMul: 0.7,
    orbitSpeedMul: 0.6,
    sentinelSpreadMul: 1.0,
    sentinelSyncOverride: 1.0,
    particleOrganizeOverride: 0.7,
    coreSwayAmplitude: 0.15,
    coreSwayFrequency: 0.5,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
    audioPulseStrength: 0,
  },
  speaking: {
    breathSpeedMul: 1.2,
    orbitSpeedMul: 1.4,
    sentinelSpreadMul: 1.1,
    sentinelSyncOverride: null,
    particleOrganizeOverride: null,
    coreSwayAmplitude: 0,
    coreSwayFrequency: 0,
    coreBobAmplitude: 0,
    coreBobFrequency: 0,
    audioPulseStrength: 0.6,
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
  const { mood, energy, activity, currentEmotion, audioLevel, speakingLevel } = options

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
  const computedOrbitSpeed = ref(1.0)
  const computedBreathSpeed = ref(0.8)
  const computedSentinelSpread = ref(1.0)
  const computedSentinelSync = ref(0)
  const computedParticleOrganize = ref(0)
  const pulsePhase = ref(0)

  // Scale animation: breathing + height-based scale
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
    p.breathSpeed += (t.breathSpeed - p.breathSpeed) * lerpFactor
    p.orbitSpeed += (t.orbitSpeed - p.orbitSpeed) * lerpFactor
    p.shake += (t.shake - p.shake) * lerpFactor
    p.verticalDrift += (t.verticalDrift - p.verticalDrift) * lerpFactor
    p.coreOffsetX += (t.coreOffsetX - p.coreOffsetX) * lerpFactor
    p.coreOffsetY += (t.coreOffsetY - p.coreOffsetY) * lerpFactor
    p.formationBlend += (t.formationBlend - p.formationBlend) * lerpFactor
    p.formationType += (t.formationType - p.formationType) * lerpFactor
    p.sentinelSpread += (t.sentinelSpread - p.sentinelSpread) * lerpFactor
    p.sentinelSync += (t.sentinelSync - p.sentinelSync) * lerpFactor
    p.particleOrganize += (t.particleOrganize - p.particleOrganize) * lerpFactor
    p.activeRatio += (t.activeRatio - p.activeRatio) * lerpFactor
    p.figure8 += (t.figure8 - p.figure8) * lerpFactor
    p.bobAmplitude += (t.bobAmplitude - p.bobAmplitude) * lerpFactor
    p.trailBrightness += (t.trailBrightness - p.trailBrightness) * lerpFactor
    p.trailDroop += (t.trailDroop - p.trailDroop) * lerpFactor
    p.orbitTiltBlend += (t.orbitTiltBlend - p.orbitTiltBlend) * lerpFactor
    p.sentinelPulse += (t.sentinelPulse - p.sentinelPulse) * lerpFactor
    p.coreBrightness += (t.coreBrightness - p.coreBrightness) * lerpFactor
    p.coreBobAmplitude += (t.coreBobAmplitude - p.coreBobAmplitude) * lerpFactor
    p.coreBobFrequency += (t.coreBobFrequency - p.coreBobFrequency) * lerpFactor

    // Activity modifiers
    const elapsed = (Date.now() - startTime) / 1000
    const actMod = ACTIVITY_MODIFIERS[activity.value]

    // Core position: emotion base + activity oscillation
    const sway = actMod.coreSwayAmplitude * Math.sin(elapsed * actMod.coreSwayFrequency * Math.PI * 2)
    const bob = actMod.coreBobAmplitude * Math.sin(elapsed * actMod.coreBobFrequency * Math.PI * 2)

    // Emotion-level bob (e.g. happy bounces core up/down)
    const emotionBob = p.coreBobAmplitude * Math.sin(elapsed * p.coreBobFrequency * Math.PI * 2)

    // Speaking bounce: driven by speakingLevel directly
    const speakBounce = activity.value === 'speaking' ? speakingLevel.value * 0.1 : 0

    computedCoreOffsetX.value = p.coreOffsetX + sway
    computedCoreOffsetY.value = p.coreOffsetY + bob + emotionBob + speakBounce

    // Apply multipliers
    computedOrbitSpeed.value = p.orbitSpeed * actMod.orbitSpeedMul
    computedBreathSpeed.value = p.breathSpeed * actMod.breathSpeedMul
    computedSentinelSpread.value = p.sentinelSpread * actMod.sentinelSpreadMul
    computedSentinelSync.value = actMod.sentinelSyncOverride ?? p.sentinelSync
    computedParticleOrganize.value = actMod.particleOrganizeOverride ?? p.particleOrganize

    // Audio-driven pulse phase accumulation
    const audioInfluence = Math.max(audioLevel.value, speakingLevel.value)
    pulsePhase.value += deltaTime * (1.0 + audioInfluence * actMod.audioPulseStrength * 4.0)

    // Scale animation: breathing + height-based scale
    const heightScale = 1.0 + computedCoreOffsetY.value * 0.05
    const breathScale = 0.97 + 0.03 * Math.sin(elapsed * computedBreathSpeed.value)
    computedScaleAnimation.value = heightScale * breathScale
  }

  // Computed uniform values
  const uniforms = computed(() => ({
    u_mood: mood.value,
    u_energy: energy.value,
    u_interaction: interactionPulse.value,
    u_audioLevel: activity.value === 'listening' ? audioLevel.value : 0,
    u_speakingLevel: activity.value === 'speaking' ? speakingLevel.value : 0,
    u_baseRadius: 1.0,
    u_color1: currentColor1.value,
    u_color2: currentColor2.value,
    // Emotion-driven animation params (activity-modified)
    u_breathSpeed: computedBreathSpeed.value,
    u_orbitSpeed: computedOrbitSpeed.value,
    u_shake: currentParams.value.shake,
    u_flash: flashPulse.value,
    u_verticalDrift: currentParams.value.verticalDrift,
    // Core position
    u_coreOffsetX: computedCoreOffsetX.value,
    u_coreOffsetY: computedCoreOffsetY.value,
    // Firefly formation
    u_formationBlend: currentParams.value.formationBlend,
    u_formationType: currentParams.value.formationType,
    u_particleOrganize: computedParticleOrganize.value,
    u_pulsePhase: pulsePhase.value,
    // Sentinel behavior
    u_sentinelSpread: computedSentinelSpread.value,
    u_sentinelSync: computedSentinelSync.value,
    // Particle density
    u_activeRatio: currentParams.value.activeRatio,
    // Sentinel creative behaviors
    u_figure8: currentParams.value.figure8,
    u_bobAmplitude: currentParams.value.bobAmplitude,
    u_trailBrightness: currentParams.value.trailBrightness,
    u_trailDroop: currentParams.value.trailDroop,
    u_orbitTiltBlend: currentParams.value.orbitTiltBlend,
    u_sentinelPulse: currentParams.value.sentinelPulse,
    // Core behavior
    u_coreBrightness: currentParams.value.coreBrightness,
    // Scale animation
    u_scaleAnimation: computedScaleAnimation.value,
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
