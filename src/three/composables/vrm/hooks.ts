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
