export type { OrbActivity, OrbEmotion } from '../orb/types'

export interface CreatureAnimParams {
  /** 0 = flat/drooped, 1 = fully perked up */
  earAngle: number
  /** 0-1 random twitch intensity */
  earTwitch: number
  /** Tail wag cycles per second */
  tailWagSpeed: number
  /** Tail wag arc amplitude (radians) */
  tailWagAmplitude: number
  /** 0 = straight, 1 = fully curled */
  tailCurl: number
  /** Vertical bounce amplitude */
  bodyBounce: number
  /** Y-scale squash factor (< 1 squashes, > 1 stretches) */
  bodySquash: number
  /** Breathing cycle speed */
  breathSpeed: number
  /** Head tilt angle (radians, positive = right) */
  headTilt: number
  /** Eye size multiplier */
  eyeScale: number
  /** 0-1 blink frequency factor */
  eyeBlink: number
  /** Ambient particle brightness */
  auraBrightness: number
  /** Wireframe glow intensity */
  glowIntensity: number
}
