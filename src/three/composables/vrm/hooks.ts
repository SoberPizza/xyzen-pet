/**
 * Shared lifecycle-hook contract for VRM pipeline extensions.
 *
 * `VrmHook` is the interface both internal hooks (see
 * `internal-hooks.ts`) and external integrations implement to observe
 * VRM load / material / frame / dispose events. `VRMModel.vue` runs
 * each hook at the matching point in the lifecycle, passing the
 * relevant `*HookContext` with the live VRM, group, camera, and a
 * `reason` describing why the hook fired (initial-load, model-switch,
 * HMR reload, unmount).
 */

import type { VRM } from '@pixiv/three-vrm'
import type { Group, Material, Mesh, PerspectiveCamera } from 'three'

export type VrmLifecycleReason = 'initial-load' | 'model-reload' | 'model-switch' | 'component-unmount' | 'manual-reload'

export interface VrmLoadHookContext {
  camera: PerspectiveCamera
  cacheHit: boolean
  reason: VrmLifecycleReason
  vrm: VRM
  vrmGroup: Group
}

export interface VrmMaterialHookContext {
  camera: PerspectiveCamera
  material: Material
  materialIndex: number
  mesh: Mesh
  reason: VrmLifecycleReason
  vrm: VRM
  vrmGroup: Group
}

export interface VrmFrameHookContext {
  camera: PerspectiveCamera
  delta: number
  vrm: VRM
  vrmGroup: Group
}

export interface VrmDisposeHookContext {
  camera: PerspectiveCamera
  reason: VrmLifecycleReason
  vrm: VRM
  vrmGroup: Group
}

export interface VrmHook {
  onDispose?: (context: VrmDisposeHookContext) => void
  onFrame?: (context: VrmFrameHookContext) => void
  onLoad?: (context: VrmLoadHookContext) => void
  onMaterial?: (context: VrmMaterialHookContext) => void
}
