/**
 * Assembles the built-in VRM pipeline hooks (currently just the
 * view-space outline patch) into the single list `VRMModel.vue` runs
 * on every mounted VRM. Add new always-on hooks here.
 */

import type { VrmHook } from './hooks'

import { createVrmOutlineHook } from './outline'

export function resolveInternalVrmHooks(): readonly VrmHook[] {
  return [
    createVrmOutlineHook(),
  ]
}
