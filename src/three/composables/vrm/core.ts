import type { VRM, VRMCore } from '@pixiv/three-vrm'
import type { Mesh, Object3D, Scene } from 'three'

import { VRMUtils } from '@pixiv/three-vrm'
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import { Box3, Group, MathUtils, Quaternion, Vector3 } from 'three'

import { useVRMLoader } from './loader'

interface GLTFUserdata {
  vrm?: VRM
  vrmCore?: VRMCore
  [key: string]: unknown
}

/**
 * Per-model overrides for default camera framing and initial orientation.
 * Declared per bundled VRM in `display-models.ts` and plumbed down through
 * `VRMModel` → `loadVrm()` / `buildSceneBootstrap()` so the same math runs
 * on fresh loads and cache hits.
 */
export interface VrmDisplayConfig {
  /** Initial yaw (degrees) applied after the faceFront→−Z alignment. 180 faces the back of the model at the camera. */
  initialYawDeg?: number
  /** Divisor used in the camera-distance calc: `distance = (modelSize.y / fitDivisor) / tan(fov/2)`. Default 3. */
  fitDivisor?: number
  /** Vertical pivot bias as a fraction of modelSize.y, biasing the framing upward. Default 0.2 (1/5). */
  pivotYBias?: number
}

export const DEFAULT_FIT_DIVISOR = 3
export const DEFAULT_PIVOT_Y_BIAS = 0.2

export async function loadVrm(model: string, options?: {
  scene?: Scene
  lookAt?: boolean
  onProgress?: (progress: ProgressEvent<EventTarget>) => void | Promise<void>
  displayConfig?: VrmDisplayConfig
}): Promise<{
  _vrm: VRM
  _vrmGroup: Group
  modelCenter: Vector3
  modelSize: Vector3
  initialCameraOffset: Vector3
} | undefined> {
  const loader = useVRMLoader()
  const gltf = await loader.loadAsync(model, progress => options?.onProgress?.(progress))

  const userData = gltf.userData as GLTFUserdata
  if (!userData.vrm) {
    return
  }

  const _vrm = userData.vrm

  // calling these functions greatly improves the performance
  VRMUtils.removeUnnecessaryVertices(_vrm.scene)
  VRMUtils.combineSkeletons(_vrm.scene)

  // Disable frustum culling
  _vrm.scene.traverse((object: Object3D) => {
    object.frustumCulled = false
  })

  // Add look at quaternion proxy to the VRM; which is needed to play the look at animation
  if (options?.lookAt && _vrm.lookAt) {
    const lookAtQuatProxy = new VRMLookAtQuaternionProxy(_vrm.lookAt)
    lookAtQuatProxy.name = 'lookAtQuaternionProxy'
    _vrm.scene.add(lookAtQuatProxy)
  }

  const _vrmGroup = new Group()
  _vrmGroup.add(_vrm.scene)
  // Add to scene
  if (options?.scene) {
    options.scene.add(_vrmGroup)
  }

  // Preset the facing direction
  const targetDirection = new Vector3(0, 0, -1) // Default facing direction
  const lookAt = _vrm.lookAt
  const quaternion = new Quaternion()
  if (lookAt) {
    const facingDirection = lookAt.faceFront
    quaternion.setFromUnitVectors(facingDirection.normalize(), targetDirection.normalize())
    _vrmGroup.quaternion.premultiply(quaternion)
    _vrmGroup.updateMatrixWorld(true)
  }
  else {
    console.warn('No look-at target found in VRM model')
  }

  // Optional initial yaw — applied *after* the faceFront→−Z alignment so it
  // rotates relative to the model's intended forward axis (e.g. 180° shows
  // the back of the model to the camera by default).
  const initialYawDeg = options?.displayConfig?.initialYawDeg ?? 0
  if (initialYawDeg !== 0) {
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(initialYawDeg))
    _vrmGroup.quaternion.premultiply(yaw)
  }

  (_vrm as VRM).springBoneManager?.reset()
  _vrmGroup.updateMatrixWorld(true)

  function computeBoundingBox(vrm: Object3D) {
    const box = new Box3()
    const childBox = new Box3()

    vrm.updateMatrixWorld(true)

    vrm.traverse((obj) => {
      if (!obj.visible)
        return
      const mesh = obj as Mesh
      if (!mesh.isMesh)
        return
      if (!mesh.geometry)
        return
      // This traverse mesh console print will be important for future debugging
      // console.debug("mesh node: ", mesh)

      // Selectively filter out VRM spring bone colliders
      if (mesh.name.startsWith('VRMC_springBone_collider'))
        return

      const geometry = mesh.geometry
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox()
      }

      childBox.copy(geometry.boundingBox!)
      childBox.applyMatrix4(mesh.matrixWorld)

      box.union(childBox)
    })

    return box
  }

  const box = computeBoundingBox(_vrm.scene)
  const modelSize = new Vector3()
  const modelCenter = new Vector3()
  box.getSize(modelSize)
  box.getCenter(modelCenter)

  // Per-model framing knobs. Defaults reproduce the humanoid-centric framing
  // used before these were introduced (chest-biased pivot + upper-2/3 fit).
  const pivotYBias = options?.displayConfig?.pivotYBias ?? DEFAULT_PIVOT_Y_BIAS
  const fitDivisor = options?.displayConfig?.fitDivisor ?? DEFAULT_FIT_DIVISOR

  modelCenter.y += modelSize.y * pivotYBias // Pivot bias (e.g. chest-align for humanoids)

  // Compute the initial camera position (once per loaded model)
  // Camera distance on −Z satisfies: (modelSize.y / fitDivisor) = distance * tan(fov/2)
  const fov = 40 // default fov = 40 degrees
  const radians = (fov / 2 * Math.PI) / 180
  const initialCameraOffset = new Vector3(
    modelSize.x / 16,
    modelSize.y / 8, // default y value
    -(modelSize.y / fitDivisor) / Math.tan(radians), // default z value
  )

  return {
    _vrm,
    _vrmGroup,
    modelCenter,
    modelSize,
    initialCameraOffset,
  }
}
