import type { BuddyStage } from '../../../services/buddies'
import type { GestureDescriptor } from './gesture-driver'

/**
 * Per-model animation driver.
 *
 * Paired with a VRM asset so authoring + licensing + motion move together
 * under `src/three/assets/vrm/models/<ModelId>/animation-driver.ts`. The
 * `display-models` store picks the driver up at registration time and
 * exposes it on the active model; `App.vue` feeds its gesture map into
 * `useVRMGestureDriver` merged *over* `DEFAULT_GESTURE_ACTIONS`, so a
 * driver only has to declare the gestures it wants to customize for that
 * model's rig/blendshapes/temperament.
 *
 * Unspecified gestures fall through to the default registry.
 */
export interface AnimationDriver {
  /** Race code the driver is paired with (matches `race.code` in the backend). */
  raceCode: string
  /** Growth stage the driver is paired with. */
  stage: BuddyStage
  /** Gesture overrides. Keys are `BuddyGesture` values from the backend. */
  gestures?: Readonly<Record<string, GestureDescriptor>>
}
