/**
 * Maps emotion/activity state to creature animation parameters.
 *
 * Same pattern as use-orb-behavior: emotion -> param table,
 * activity modifiers, smooth lerp interpolation per frame.
 */

import type { Ref } from 'vue'

import type { CreatureAnimParams, OrbActivity, OrbEmotion } from './types'

import { Color } from 'three'
import { computed, ref, triggerRef, watch } from 'vue'

const EMOTION_COLORS: Record<OrbEmotion, { primary: string, secondary: string }> = {
  neutral: { primary: '#00DDCC', secondary: '#0088AA' },
  happy: { primary: '#FFD060', secondary: '#FF8C42' },
  sad: { primary: '#2244AA', secondary: '#334488' },
  angry: { primary: '#FF2222', secondary: '#CC0033' },
  surprised: { primary: '#E0D0FF', secondary: '#FFD060' },
  fear: { primary: '#66AACC', secondary: '#447799' },
  disgust: { primary: '#77AA33', secondary: '#557722' },
  think: { primary: '#A080E0', secondary: '#6090E0' },
}

const THINKING_COLORS = { primary: '#B0A0D0', secondary: '#8070B0' }

const EMOTION_PARAMS: Record<OrbEmotion, CreatureAnimParams> = {
  neutral: {
    earAngle: 0.6,
    earTwitch: 0.1,
    tailWagSpeed: 0.8,
    tailWagAmplitude: 0.3,
    tailCurl: 0.3,
    bodyBounce: 0.0,
    bodySquash: 1.0,
    breathSpeed: 0.8,
    headTilt: 0.0,
    eyeScale: 1.0,
    eyeBlink: 0.3,
    auraBrightness: 0.6,
    glowIntensity: 0.8,
  },
  happy: {
    earAngle: 1.0,
    earTwitch: 0.2,
    tailWagSpeed: 3.0,
    tailWagAmplitude: 0.8,
    tailCurl: 0.2,
    bodyBounce: 0.08,
    bodySquash: 0.92,
    breathSpeed: 1.5,
    headTilt: 0.05,
    eyeScale: 1.2,
    eyeBlink: 0.15,
    auraBrightness: 1.0,
    glowIntensity: 1.2,
  },
  sad: {
    earAngle: 0.15,
    earTwitch: 0.0,
    tailWagSpeed: 0.3,
    tailWagAmplitude: 0.1,
    tailCurl: 0.7,
    bodyBounce: 0.0,
    bodySquash: 1.05,
    breathSpeed: 0.3,
    headTilt: -0.1,
    eyeScale: 0.8,
    eyeBlink: 0.5,
    auraBrightness: 0.3,
    glowIntensity: 0.4,
  },
  angry: {
    earAngle: 0.9,
    earTwitch: 0.6,
    tailWagSpeed: 4.0,
    tailWagAmplitude: 0.5,
    tailCurl: 0.1,
    bodyBounce: 0.02,
    bodySquash: 0.95,
    breathSpeed: 2.5,
    headTilt: 0.0,
    eyeScale: 0.7,
    eyeBlink: 0.05,
    auraBrightness: 1.2,
    glowIntensity: 1.5,
  },
  surprised: {
    earAngle: 1.0,
    earTwitch: 0.8,
    tailWagSpeed: 2.0,
    tailWagAmplitude: 0.6,
    tailCurl: 0.0,
    bodyBounce: 0.12,
    bodySquash: 0.85,
    breathSpeed: 1.2,
    headTilt: 0.08,
    eyeScale: 1.5,
    eyeBlink: 0.0,
    auraBrightness: 1.3,
    glowIntensity: 1.3,
  },
  fear: {
    earAngle: 0.2,
    earTwitch: 0.7,
    tailWagSpeed: 0.5,
    tailWagAmplitude: 0.15,
    tailCurl: 0.9,
    bodyBounce: 0.01,
    bodySquash: 1.08,
    breathSpeed: 1.8,
    headTilt: -0.05,
    eyeScale: 1.3,
    eyeBlink: 0.6,
    auraBrightness: 0.4,
    glowIntensity: 0.5,
  },
  disgust: {
    earAngle: 0.3,
    earTwitch: 0.1,
    tailWagSpeed: 0.4,
    tailWagAmplitude: 0.1,
    tailCurl: 0.5,
    bodyBounce: 0.0,
    bodySquash: 1.02,
    breathSpeed: 0.5,
    headTilt: -0.08,
    eyeScale: 0.85,
    eyeBlink: 0.4,
    auraBrightness: 0.35,
    glowIntensity: 0.45,
  },
  think: {
    earAngle: 0.7,
    earTwitch: 0.05,
    tailWagSpeed: 0.6,
    tailWagAmplitude: 0.2,
    tailCurl: 0.4,
    bodyBounce: 0.0,
    bodySquash: 1.0,
    breathSpeed: 0.4,
    headTilt: 0.12,
    eyeScale: 0.9,
    eyeBlink: 0.2,
    auraBrightness: 0.7,
    glowIntensity: 0.9,
  },
}

interface ActivityModifiers {
  breathSpeedMul: number
  tailWagSpeedMul: number
  earAngleAdd: number
  bodyBounceAdd: number
  glowIntensityMul: number
  audioPulseStrength: number
}

const ACTIVITY_MODIFIERS: Record<OrbActivity, ActivityModifiers> = {
  idle: {
    breathSpeedMul: 1.0,
    tailWagSpeedMul: 1.0,
    earAngleAdd: 0,
    bodyBounceAdd: 0,
    glowIntensityMul: 1.0,
    audioPulseStrength: 0,
  },
  listening: {
    breathSpeedMul: 0.8,
    tailWagSpeedMul: 0.7,
    earAngleAdd: 0.2,
    bodyBounceAdd: 0,
    glowIntensityMul: 1.1,
    audioPulseStrength: 0.8,
  },
  thinking: {
    breathSpeedMul: 0.7,
    tailWagSpeedMul: 0.5,
    earAngleAdd: 0.1,
    bodyBounceAdd: 0,
    glowIntensityMul: 0.9,
    audioPulseStrength: 0,
  },
  speaking: {
    breathSpeedMul: 1.2,
    tailWagSpeedMul: 1.3,
    earAngleAdd: 0.05,
    bodyBounceAdd: 0,
    glowIntensityMul: 1.2,
    audioPulseStrength: 0.6,
  },
}

export interface CreatureBehaviorOptions {
  mood: Ref<number>
  energy: Ref<number>
  activity: Ref<OrbActivity>
  currentEmotion: Ref<OrbEmotion>
  audioLevel: Ref<number>
  speakingLevel: Ref<number>
}

export function useCreatureBehavior(options: CreatureBehaviorOptions) {
  const { activity, currentEmotion, audioLevel, speakingLevel } = options

  const startTime = Date.now()

  // Interaction pulse
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

  // Smoothed params
  const currentParams = ref<CreatureAnimParams>({ ...EMOTION_PARAMS.neutral })
  const targetParams = ref<CreatureAnimParams>({ ...EMOTION_PARAMS.neutral })

  // Smoothed colors
  const targetColor1 = ref(new Color(EMOTION_COLORS.neutral.primary))
  const targetColor2 = ref(new Color(EMOTION_COLORS.neutral.secondary))
  const currentColor1 = ref(new Color(EMOTION_COLORS.neutral.primary))
  const currentColor2 = ref(new Color(EMOTION_COLORS.neutral.secondary))

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
  }, { immediate: true })

  function updateAnimation(deltaTime: number) {
    const lerpFactor = Math.min(1, deltaTime * 3)

    // Lerp colors
    currentColor1.value.lerp(targetColor1.value, lerpFactor)
    currentColor2.value.lerp(targetColor2.value, lerpFactor)

    // Lerp all params
    const p = currentParams.value
    const t = targetParams.value
    const keys = Object.keys(p) as Array<keyof CreatureAnimParams>
    for (const key of keys) {
      p[key] += (t[key] - p[key]) * lerpFactor
    }

    // Activity modifiers
    const actMod = ACTIVITY_MODIFIERS[activity.value]
    const elapsed = (Date.now() - startTime) / 1000

    // Speaking bounce
    if (activity.value === 'speaking') {
      p.bodyBounce = Math.max(p.bodyBounce, speakingLevel.value * 0.12)
    }

    // Audio-driven ear perk
    const audioInfluence = Math.max(audioLevel.value, speakingLevel.value)
    p.earAngle = Math.min(1, p.earAngle + actMod.earAngleAdd + audioInfluence * actMod.audioPulseStrength * 0.15)

    // Interaction pulse adds bounce and glow
    if (interactionPulse.value > 0.01) {
      p.bodyBounce += interactionPulse.value * 0.15
      p.glowIntensity += interactionPulse.value * 0.5
      p.tailWagSpeed += interactionPulse.value * 2.0
    }

    // Ear twitch: random periodic trigger
    const twitchCycle = Math.sin(elapsed * 7.3) * Math.sin(elapsed * 3.1)
    p.earTwitch = p.earTwitch * (twitchCycle > 0.7 ? 1.0 : 0.0)

    // Force Vue to detect in-place mutations on Color objects and params
    triggerRef(currentColor1)
    triggerRef(currentColor2)
    triggerRef(currentParams)
  }

  // Apply activity multipliers at read time to avoid compounding every frame
  const animParams = computed(() => {
    const p = currentParams.value
    const actMod = ACTIVITY_MODIFIERS[activity.value]
    return {
      ...p,
      breathSpeed: p.breathSpeed * actMod.breathSpeedMul,
      tailWagSpeed: p.tailWagSpeed * actMod.tailWagSpeedMul,
      glowIntensity: p.glowIntensity * actMod.glowIntensityMul,
    }
  })

  const colors = computed(() => ({
    color1: currentColor1.value,
    color2: currentColor2.value,
  }))

  return {
    animParams,
    colors,
    triggerInteraction,
    updateAnimation,
  }
}
