import type { AnimationDriver } from '../../../../composables/vrm/animation-driver'

/**
 * buddy_egg — non-humanoid / creature-shaped VRM for the Egg race at the
 * Egg stage. Arm-based gestures (wave, clap, point) don't read well on
 * this rig, so we re-express them as face / head motion: stronger
 * mouth-morph pulses and look pulses stand in for body language.
 * Gestures without overrides here fall back to the global defaults,
 * which are already look-and-morph based.
 */
export const driver: AnimationDriver = {
  raceCode: 'egg',
  stage: 'egg',
  gestures: {
    wave: {
      actions: [
        { kind: 'expression', name: 'happy', intensity: 0.8 },
        { kind: 'morph', name: 'aa', peak: 0.5, ms: 300 },
        { kind: 'look', dir: 'lookRight', ms: 450 },
      ],
    },
    clap: {
      actions: [
        { kind: 'expression', name: 'happy', intensity: 0.9 },
        { kind: 'morph', name: 'aa', peak: 0.6, ms: 260 },
      ],
    },
    point: {
      actions: [
        { kind: 'look', dir: 'lookRight', ms: 500 },
        { kind: 'expression', name: 'surprised', intensity: 0.4 },
      ],
    },
    open_arms: {
      actions: [
        { kind: 'expression', name: 'happy', intensity: 0.7 },
        { kind: 'morph', name: 'oh', peak: 0.5, ms: 500 },
      ],
    },
    shrug: {
      actions: [
        { kind: 'expression', name: 'neutral', intensity: 1 },
        { kind: 'morph', name: 'oh', peak: 0.55, ms: 450 },
        { kind: 'look', dir: 'lookUp', ms: 350 },
      ],
    },
    tap_finger: {
      actions: [
        { kind: 'morph', name: 'ih', peak: 0.35, ms: 350 },
      ],
    },
  },
}
