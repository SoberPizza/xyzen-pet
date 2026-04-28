import type { AnimationDriver } from '../../../../composables/vrm/animation-driver'

/**
 * Jiuwei — humanoid VRM for the Jiuwei race at the Juvenile stage.
 * Friendlier default mood than the global baseline: slightly warmer
 * waves and a longer, more relaxed yawn. Everything unspecified here
 * falls back to `DEFAULT_GESTURE_ACTIONS` in `gesture-driver.ts`.
 */
export const driver: AnimationDriver = {
  raceCode: 'jiuwei',
  stage: 'juvenile',
  gestures: {
    wave: {
      actions: [
        { kind: 'expression', name: 'happy', intensity: 0.9 },
        { kind: 'look', dir: 'lookRight', ms: 500 },
      ],
      cooldownMs: 700,
    },
    yawn: {
      actions: [
        { kind: 'morph', name: 'aa', peak: 0.95, ms: 1100 },
        { kind: 'expression', name: 'relaxed', intensity: 0.7 },
      ],
    },
    bow: {
      actions: [
        { kind: 'look', dir: 'lookDown', ms: 900 },
        { kind: 'expression', name: 'relaxed', intensity: 0.7 },
      ],
    },
  },
}
