import type { GestureDescriptor } from './gesture-driver'

/**
 * Per-model animation driver.
 *
 * Paired with a VRM asset under
 * `src/three/assets/vrm/models/<ModelId>/animation-driver.ts`. App.vue
 * merges the driver's gestures over `DEFAULT_GESTURE_ACTIONS`, so a driver
 * only declares the gestures it wants to customize for that model's rig.
 *
 * `raceCode` + `stage` are kept as free-form strings; the old backend
 * enum was coupled to the Xyzen API and is gone. Future selection logic
 * will land alongside the rebuilt `buddy_get_active` command.
 */
export interface AnimationDriver {
  /** Race/species tag, e.g. `"egg"`, `"jiuwei"`. */
  raceCode: string
  /** Growth stage tag, e.g. `"egg"`, `"adult"`. */
  stage: string
  /** Gesture overrides. Keys match the names in `DEFAULT_GESTURE_ACTIONS`. */
  gestures?: Readonly<Record<string, GestureDescriptor>>
}
