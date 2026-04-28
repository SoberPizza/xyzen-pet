<script setup lang="ts">
/*
  * - Core component for loading and displaying VRM model
  * - Load model, get some geometry data for initialisation
  * - Shader injection and rendering setting
  * - Load & initialise animation
*/

import type { VRM } from '@pixiv/three-vrm'
import type {
  Group,
  Material,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  SphericalHarmonics3,
  Texture,
} from 'three'
import type { Ref, WatchStopHandle } from 'vue'

import type {
  VrmDisposeHookContext,
  VrmFrameHookContext,
  VrmHook,
  VrmLifecycleReason,
  VrmLoadHookContext,
  VrmMaterialHookContext,
} from '../../composables/vrm/hooks'
import type { SceneBootstrap, Vec3 } from '../../stores/model-store'
import type { ManagedVrmInstance } from './vrm-instance-cache'

import { VRMUtils } from '@pixiv/three-vrm'
import { useLoop, useTresContext } from '@tresjs/core'
import { until, useMouse } from '@vueuse/core'
import {
  AnimationMixer,
  Box3,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Plane,
  Raycaster,

  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import {
  computed,
  onMounted,
  onUnmounted,
  ref,

  shallowRef,

  toRefs,
  watch,

} from 'vue'

import type { VrmDisplayConfig } from '../../composables/vrm/core'

import {
  createIblProbeController,
  injectDiffuseIBL,
  normalizeEnvMode,
  updateNprShaderSetting,
} from '../../composables/shader/ibl'
// From stage-ui-three package
import {
  clipFromVRMAnimation,
  loadVRMAnimation,
  reAnchorRootPositionTrack,
  useBlink,
  useIdleEyeSaccades,
} from '../../composables/vrm/animation'
import { DEFAULT_FIT_DIVISOR, DEFAULT_PIVOT_Y_BIAS, loadVrm } from '../../composables/vrm/core'
import { useVRMEmote } from '../../composables/vrm/expression'
import { resolveInternalVrmHooks } from '../../composables/vrm/internal-hooks'
import { useVRMLipSync } from '../../composables/vrm/lip-sync'
import {
  clearManagedVrmInstance,
  stashManagedVrmInstance,
  takeManagedVrmInstance,
} from './vrm-instance-cache'

/*
  * Props:
  * - modelSrc: model src string to load model asset
  * - idleAnimation: animation src for model
  * - loadAnimations: TBC
  * - paused: if the animation is paused
  * - nprIrrSH: Spherical Harmonics computed from the sky box, used for IBL
  *
  * - modelOffset: The placing offset of model (x, y, z)
  * - modelRotationY: The rotation of the model (y-axis)
*/
const props = withDefaults(defineProps<{
  audioContext: AudioContext
  currentAudioSource?: AudioNode
  lastCommittedModelSrc?: string
  modelSrc?: string
  idleAnimation: string
  // loadAnimations?: string[]
  paused?: boolean

  envSelect: string
  skyBoxIntensity: number
  nprIrrSH?: SphericalHarmonics3 | null

  modelOffset: Vec3
  modelRotationY: number
  lookAtTarget: Vec3
  trackingMode: string
  eyeHeight: number
  cameraPosition: Vec3
  displayConfig?: VrmDisplayConfig

  camera: PerspectiveCamera
}>(), {
  paused: false,
})
/*
  * Emits:
  * - model-core-loading-progress
  * - model-core-error
  * - model-core-ready
  *
*/
const emit = defineEmits<{
  (e: 'loadingProgress', value: number): void
  (e: 'loadStart', value: 'initial-load' | 'model-reload' | 'model-switch'): void
  (e: 'sceneBootstrap', value: SceneBootstrap): void
  (e: 'lookAtTarget', value: Vec3): void

  (e: 'error', value: unknown): void
  (e: 'loaded', value: string): void
}>()

const {
  audioContext,
  currentAudioSource,
  lastCommittedModelSrc,
  modelSrc,
  idleAnimation,
  // loadAnimations, // TBC
  paused,

  envSelect,
  skyBoxIntensity,
  nprIrrSH,

  modelOffset,
  modelRotationY,
  lookAtTarget,
  trackingMode,
  eyeHeight,
  cameraPosition,
  displayConfig,

  camera,
} = toRefs(props)

// Model and scene ref
const { scene } = useTresContext()
const vrm = shallowRef<VRM>()
const vrmGroup = shallowRef<Group>()
const modelLoaded = ref<boolean>(false)
let loadSequence = 0
// for eye tracking modes
const { x: mouseX, y: mouseY } = useMouse()
const raycaster = new Raycaster()
const mouse = new Vector2()
const mouseTarget = shallowRef<Vec3>()
let stopMouseWatch: WatchStopHandle | undefined
let stopCameraWatch: WatchStopHandle | undefined

// Animation related ref
const vrmAnimationMixer = ref<AnimationMixer>()
const { onBeforeRender, stop, start } = useLoop()

const vrmHooks: readonly VrmHook[] = resolveInternalVrmHooks()
type VrmFrameRuntimeHook = (vrm: VRM, delta: number) => void
const vrmFrameRuntimeHook = shallowRef<VrmFrameRuntimeHook>()
let disposeBeforeRenderLoop: (() => void | undefined) | undefined

// material type with optional update function for per-frame update, used for three-vrm's MToon material and custom shader materials with IBL injection
type UpdatableMaterial = Material & {
  update?: (delta: number) => void
}

// Expressions
const blink = useBlink()
const idleEyeSaccades = useIdleEyeSaccades()
const vrmEmote = ref<ReturnType<typeof useVRMEmote>>()
const vrmLipSync = useVRMLipSync(currentAudioSource, audioContext.value)

// For sky box update
const nprProgramVersion = ref(0)
// For MToon IBL
let airiIblProbe: ReturnType<typeof createIblProbeController> | null = null

function invalidatePendingLoads() {
  loadSequence += 1
  return loadSequence
}

function isLoadRequestCurrent(requestId: number) {
  return loadSequence === requestId
}

function disposeDetachedVrm(detachedVrm?: VRM, detachedGroup?: Group) {
  detachedGroup?.removeFromParent()

  if (detachedVrm)
    VRMUtils.deepDispose(detachedVrm.scene as unknown as Object3D)
}

function detachVrmGroup(detachedGroup?: Group) {
  detachedGroup?.removeFromParent()
}

function createManagedVrmInstance(instance: Omit<ManagedVrmInstance, 'modelSrc' | 'scopeKey'>): ManagedVrmInstance {
  return {
    modelSrc: modelSrc.value!,
    scopeKey: getManagedVrmScopeKey(),
    ...instance,
  }
}

function getManagedVrmScopeKey() {
  return typeof window !== 'undefined' ? window.location.href : 'unknown'
}

function getActiveManagedVrmInstance() {
  if (!modelSrc.value || !vrm.value || !vrmGroup.value || !vrmAnimationMixer.value || !vrmEmote.value)
    return undefined

  return createManagedVrmInstance({
    emote: vrmEmote.value,
    group: vrmGroup.value,
    mixer: vrmAnimationMixer.value,
    vrm: vrm.value,
  })
}

function clearActiveManagedVrmRefs() {
  vrmAnimationMixer.value = undefined
  vrmEmote.value = undefined
  vrm.value = undefined
  vrmGroup.value = undefined
}

function applyManagedVrmInstance(instance: ManagedVrmInstance) {
  vrm.value = instance.vrm
  vrmGroup.value = instance.group
  vrmAnimationMixer.value = instance.mixer
  vrmEmote.value = instance.emote
}

function destroyManagedVrmInstance(instance?: ManagedVrmInstance) {
  if (!instance)
    return

  instance.emote.dispose()
  instance.mixer.stopAllAction()
  disposeDetachedVrm(instance.vrm, instance.group)
}

function isManagedVrmInstanceReusable(instance: ManagedVrmInstance) {
  try {
    instance.group.updateMatrixWorld(true)
    instance.vrm.scene.updateMatrixWorld(true)
    instance.vrm.humanoid.update()
    return true
  }
  catch {
    return false
  }
}

function shouldDestroyVrmResources(reason: VrmLifecycleReason) {
  return reason === 'model-switch'
}

function shouldStashVrmResources(reason: VrmLifecycleReason) {
  return reason === 'component-unmount'
}

function updateManagedVrmMaterials(activeVrm: VRM | undefined, delta: number) {
  activeVrm?.materials?.forEach((material) => {
    (material as UpdatableMaterial).update?.(delta)
  })
}

function runVrmLoadHooks(context: VrmLoadHookContext) {
  for (const hook of vrmHooks) {
    hook.onLoad?.(context)
  }
}

function runVrmMaterialHooks(context: VrmMaterialHookContext) {
  for (const hook of vrmHooks) {
    hook.onMaterial?.(context)
  }
}

function runVrmFrameHooks(context: VrmFrameHookContext) {
  for (const hook of vrmHooks) {
    try {
      hook.onFrame?.(context)
    }
    catch (error) {
      console.error(error)
      emit('error', error)
    }
  }
}

function runVrmFrameRuntimeHook(vrm: VRM, delta: number) {
  try {
    vrmFrameRuntimeHook.value?.(vrm, delta)
  }
  catch (error) {
    console.error(error)
    emit('error', error)
  }
}

function runVrmDisposeHooks(context: VrmDisposeHookContext) {
  for (const hook of vrmHooks) {
    try {
      hook.onDispose?.(context)
    }
    catch (error) {
      console.error(error)
      emit('error', error)
    }
  }
}

function runVrmDisposeHooksForInstance(instance: ManagedVrmInstance | undefined, reason: VrmLifecycleReason) {
  if (!instance)
    return

  runVrmDisposeHooks({
    camera: camera.value,
    reason,
    vrm: instance.vrm,
    vrmGroup: instance.group,
  })
}

function destroyManagedVrmInstanceWithHooks(instance: ManagedVrmInstance | undefined, reason: VrmLifecycleReason) {
  if (!instance)
    return

  runVrmDisposeHooksForInstance(instance, reason)
  destroyManagedVrmInstance(instance)
}

function bindManagedVrmInstanceRenderLoop() {
  disposeBeforeRenderLoop?.()

  disposeBeforeRenderLoop = onBeforeRender(({ delta }) => {
    vrmAnimationMixer.value?.update(delta)

    const activeVrm = vrm.value
    const activeVrmGroup = vrmGroup.value
    updateManagedVrmMaterials(activeVrm, delta)

    if (activeVrm && activeVrmGroup) {
      runVrmFrameHooks({
        camera: camera.value,
        delta,
        vrm: activeVrm,
        vrmGroup: activeVrmGroup,
      })
    }

    if (activeVrm)
      runVrmFrameRuntimeHook(activeVrm, delta)

    activeVrm?.humanoid.update()
    activeVrm?.lookAt?.update?.(delta)

    blink.update(activeVrm, delta)
    idleEyeSaccades.update(activeVrm, lookAtTarget, delta)

    vrmEmote.value?.update(delta)
    vrmLipSync.update(activeVrm, delta)
    applyMorphPulses()

    activeVrm?.expressionManager?.update()
    activeVrm?.nodeConstraintManager?.update()
    activeVrm?.springBoneManager?.update(delta)
  }).off
}

function commitManagedVrmInstance(instance: ManagedVrmInstance) {
  scene.value?.add(instance.group)
  applyManagedVrmInstance(instance)
  bindManagedVrmInstanceRenderLoop()
  emit('loaded', modelSrc.value!)
  modelLoaded.value = true
}

// clean the previous vrm model loaded
function componentCleanUp(
  reason: VrmLifecycleReason,
  options: { invalidate?: boolean } = {},
) {
  const { invalidate = true } = options
  if (invalidate)
    invalidatePendingLoads()

  const activeInstance = getActiveManagedVrmInstance()
  const shouldDestroyResources = shouldDestroyVrmResources(reason)
  const clearedInstance = shouldDestroyResources ? clearManagedVrmInstance(getManagedVrmScopeKey()) : undefined

  disposeBeforeRenderLoop?.()
  disposeBeforeRenderLoop = undefined

  if (activeInstance)
    detachVrmGroup(activeInstance.group)

  if (shouldDestroyResources) {
    destroyManagedVrmInstanceWithHooks(activeInstance, reason)
    destroyManagedVrmInstanceWithHooks(clearedInstance, reason)
  }
  else if (shouldStashVrmResources(reason)) {
    destroyManagedVrmInstanceWithHooks(activeInstance ? stashManagedVrmInstance(activeInstance) : undefined, reason)
  }
  else {
    destroyManagedVrmInstanceWithHooks(activeInstance, reason)
  }

  airiIblProbe?.dispose()
  airiIblProbe = null
  clearActiveManagedVrmRefs()
  modelLoaded.value = false
}

// look at mouse
function lookAtMouse(
  mouseX: number,
  mouseY: number,
  camera: Ref<PerspectiveCamera>,
): Vec3 {
  mouse.x = (mouseX / window.innerWidth) * 2 - 1
  mouse.y = -(mouseY / window.innerHeight) * 2 + 1

  // Raycast from the mouse position
  raycaster.setFromCamera(mouse, camera.value)

  // Create a plane in front of the camera
  const cameraDirection = new Vector3()
  camera.value.getWorldDirection(cameraDirection) // Get camera's forward direction

  const plane = new Plane()
  plane.setFromNormalAndCoplanarPoint(
    cameraDirection,
    camera.value.position.clone().add(cameraDirection.multiplyScalar(1)), // 1 unit in front of the camera
  )

  const intersection = new Vector3()
  raycaster.ray.intersectPlane(plane, intersection)
  return { x: intersection.x, y: intersection.y, z: intersection.z }
}

function defaultTookAt(eyeHeight: number): Vec3 {
  return {
    x: 0,
    y: eyeHeight,
    z: -100,
  }
}

function computeBoundingBox(vrmScene: Object3D) {
  const box = new Box3()
  const childBox = new Box3()

  vrmScene.updateMatrixWorld(true)

  vrmScene.traverse((obj) => {
    if (!obj.visible)
      return

    const mesh = obj as Mesh
    if (!mesh.isMesh || !mesh.geometry)
      return

    if (mesh.name.startsWith('VRMC_springBone_collider'))
      return

    if (!mesh.geometry.boundingBox)
      mesh.geometry.computeBoundingBox()

    childBox.copy(mesh.geometry.boundingBox!)
    childBox.applyMatrix4(mesh.matrixWorld)
    box.union(childBox)
  })

  return box
}

function getEyePosition(activeVrm: VRM): number | null {
  const eye = activeVrm.humanoid?.getNormalizedBoneNode('head')
  if (!eye)
    return null

  const eyePos = new Vector3()
  eye.getWorldPosition(eyePos)
  return eyePos.y
}

function buildSceneBootstrap(activeVrm: VRM, cacheHit: boolean): SceneBootstrap {
  const bootstrapRoot = activeVrm.scene.parent ?? activeVrm.scene
  const box = computeBoundingBox(bootstrapRoot)
  const modelSize = new Vector3()
  const modelCenter = new Vector3()
  box.getSize(modelSize)
  box.getCenter(modelCenter)

  const pivotYBias = displayConfig.value?.pivotYBias ?? DEFAULT_PIVOT_Y_BIAS
  const fitDivisor = displayConfig.value?.fitDivisor ?? DEFAULT_FIT_DIVISOR
  modelCenter.y += modelSize.y * pivotYBias

  const fov = camera.value?.fov ?? 40
  const radians = (fov / 2 * Math.PI) / 180
  const initialCameraOffset = new Vector3(
    modelSize.x / 16,
    modelSize.y / 8,
    -(modelSize.y / fitDivisor) / Math.tan(radians),
  )

  const eyePositionY = getEyePosition(activeVrm) ?? modelCenter.y
  const cameraPosition = modelCenter.clone().add(initialCameraOffset)

  return {
    cacheHit,
    cameraDistance: cameraPosition.distanceTo(modelCenter),
    cameraPosition: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
    eyeHeight: eyePositionY,
    lookAtTarget: defaultTookAt(eyePositionY),
    modelOffset: {
      x: bootstrapRoot.position.x,
      y: bootstrapRoot.position.y,
      z: bootstrapRoot.position.z,
    },
    modelOrigin: { x: modelCenter.x, y: modelCenter.y, z: modelCenter.z },
    modelSize: { x: modelSize.x, y: modelSize.y, z: modelSize.z },
  }
}

function resolveVrmLoadReason(): 'initial-load' | 'model-reload' | 'model-switch' {
  if (!lastCommittedModelSrc.value)
    return 'initial-load'

  if (lastCommittedModelSrc.value !== modelSrc.value)
    return 'model-switch'

  return 'model-reload'
}

async function loadModel() {
  const requestId = invalidatePendingLoads()
  const currentLoadReason = resolveVrmLoadReason()
  let nextVrm: VRM | undefined
  let nextVrmGroup: Group | undefined
  let nextVrmAnimationMixer: AnimationMixer | undefined
  let nextVrmEmote: ReturnType<typeof useVRMEmote> | undefined
  let didCommitLoad = false

  try {
    if (!scene.value) {
      await until(() => scene.value).toBeTruthy()
      if (!isLoadRequestCurrent(requestId))
        return
    }
    if (!modelSrc.value) {
      console.warn('[buddy:vrm] VRMModel.loadModel aborted — no modelSrc')
      return
    }

    emit('loadStart', currentLoadReason)

    console.info('[buddy:vrm] VRMModel.loadModel start', {
      reason: currentLoadReason,
      modelSrc: modelSrc.value,
    })

    modelLoaded.value = false
    const reusableInstance = takeManagedVrmInstance(getManagedVrmScopeKey(), modelSrc.value)
    if (reusableInstance) {
      if (!isManagedVrmInstanceReusable(reusableInstance)) {
        destroyManagedVrmInstanceWithHooks(reusableInstance, currentLoadReason)
      }
      else {
        if (!isLoadRequestCurrent(requestId)) {
          destroyManagedVrmInstanceWithHooks(stashManagedVrmInstance(reusableInstance), currentLoadReason)
          return
        }

        nextVrm = reusableInstance.vrm
        nextVrmGroup = reusableInstance.group
        nextVrmAnimationMixer = reusableInstance.mixer
        nextVrmEmote = reusableInstance.emote

        if (!airiIblProbe && scene.value)
          airiIblProbe = createIblProbeController(scene.value)

        if (currentLoadReason === 'model-switch') {
          componentCleanUp('model-switch', { invalidate: false })
        }

        runVrmLoadHooks({
          cacheHit: true,
          camera: camera.value,
          reason: currentLoadReason,
          vrm: reusableInstance.vrm,
          vrmGroup: reusableInstance.group,
        })
        emit('sceneBootstrap', buildSceneBootstrap(reusableInstance.vrm, true))
        commitManagedVrmInstance(reusableInstance)
        didCommitLoad = true

        console.info('[buddy:vrm] VRMModel.loadModel end (cache hit)', {
          reason: currentLoadReason,
          modelSrc: modelSrc.value,
        })
        return
      }
    }

    const _vrmInfo = await loadVrm(modelSrc.value, {
      lookAt: true,
      displayConfig: displayConfig.value,
      onProgress: progress => emit(
        'loadingProgress',
        Number((100 * progress.loaded / progress.total).toFixed(2)),
      ),
    })
    if (!_vrmInfo || !_vrmInfo._vrm || !_vrmInfo._vrmGroup) {
      if (isLoadRequestCurrent(requestId)) {
        console.warn('VRM model loading failure!')
        emit('error', new Error('VRM model loading failure'))
      }
      return
    }
    const {
      _vrm,
      _vrmGroup,
    } = _vrmInfo
    nextVrm = _vrm
    nextVrmGroup = _vrmGroup

    if (!isLoadRequestCurrent(requestId)) {
      disposeDetachedVrm(nextVrm, nextVrmGroup)
      return
    }

    runVrmLoadHooks({
      cacheHit: false,
      camera: camera.value,
      reason: currentLoadReason,
      vrm: _vrm,
      vrmGroup: _vrmGroup,
    })

    /*
      * Animation setting
    */
    const animation = await loadVRMAnimation(idleAnimation.value)
    const clip = await clipFromVRMAnimation(_vrm, animation)
    if (!isLoadRequestCurrent(requestId)) {
      disposeDetachedVrm(nextVrm, nextVrmGroup)
      return
    }
    if (!clip) {
      disposeDetachedVrm(nextVrm, nextVrmGroup)
      console.warn('No VRM animation loaded')
      if (isLoadRequestCurrent(requestId))
        emit('error', new Error('No VRM animation loaded'))
      return
    }
    // Re-anchor the root position track to the model origin
    reAnchorRootPositionTrack(clip, _vrm)

    // play animation
    nextVrmAnimationMixer = new AnimationMixer(_vrm.scene)
    nextVrmAnimationMixer.clipAction(clip).play()

    nextVrmEmote = useVRMEmote(_vrm)

    /*
      * Shader setting
    */
    const isShaderMat = (m: unknown): m is ShaderMaterial => !!(m as { isShaderMaterial?: boolean } | null)?.isShaderMaterial

    function configureInjectedShaderMaterial(mat: ShaderMaterial) {
      if ('toneMapped' in mat)
        mat.toneMapped = false
      if ('envMap' in mat && mat.envMap)
        mat.envMap = null

      // NPR materials usually use sRGB textures.
      const tex = (mat as unknown as { map?: Texture }).map
      if (tex && (tex as { colorSpace?: unknown }).colorSpace !== undefined) {
        try {
          (tex as { colorSpace: typeof SRGBColorSpace }).colorSpace = SRGBColorSpace
        }
        catch (e) {
          console.warn('Failed to set colorSpace on texture:', e)
        }
      }

      injectDiffuseIBL(mat)
    }

    // MToon material sky box lightProbe setting
    if (!airiIblProbe && scene.value)
      airiIblProbe = createIblProbeController(scene.value)

    // Material traverse setting
    _vrm.scene.traverse((child) => {
      if (child instanceof Mesh && child.material) {
        const material = Array.isArray(child.material) ? child.material : [child.material]
        material.forEach((mat, materialIndex) => {
          if (mat instanceof MeshStandardMaterial || mat instanceof MeshPhysicalMaterial) {
            // Should read envMap intensity from outside props
            mat.envMapIntensity = 1.0
            mat.needsUpdate = true
          }
          else if (mat?.isMToonMaterial) {
            // --- MToon material ---
            if ('toneMapped' in mat)
              mat.toneMapped = false
          }
          else if (isShaderMat(mat)) {
            // --- Shader material, further IBL injection needed ---
            configureInjectedShaderMaterial(mat)
          }

          runVrmMaterialHooks({
            camera: camera.value,
            material: mat,
            materialIndex,
            mesh: child,
            reason: currentLoadReason,
            vrm: _vrm,
            vrmGroup: _vrmGroup,
          })
        })
      }
    })

    if (currentLoadReason === 'model-switch') {
      componentCleanUp('model-switch', { invalidate: false })
    }

    emit('sceneBootstrap', buildSceneBootstrap(_vrm, false))

    commitManagedVrmInstance(createManagedVrmInstance({
      emote: nextVrmEmote,
      group: _vrmGroup,
      mixer: nextVrmAnimationMixer,
      vrm: _vrm,
    }))
    didCommitLoad = true

    console.info('[buddy:vrm] VRMModel.loadModel end (fresh load)', {
      reason: currentLoadReason,
      modelSrc: modelSrc.value,
    })
  }
  catch (err) {
    if (!didCommitLoad) {
      if (nextVrm && nextVrmGroup) {
        runVrmDisposeHooks({
          camera: camera.value,
          reason: currentLoadReason,
          vrm: nextVrm,
          vrmGroup: nextVrmGroup,
        })
      }

      nextVrmEmote?.dispose()
      nextVrmAnimationMixer?.stopAllAction()
      disposeDetachedVrm(nextVrm, nextVrmGroup)
    }
    if (!isLoadRequestCurrent(requestId))
      return

    console.error(err)
    emit('error', err)
  }
}

onMounted(async () => {
  // watch if the model needs to be reloaded
  watch(modelSrc, (newSrc, oldSrc) => {
    if (newSrc !== oldSrc) {
      console.info('[buddy:vrm] VRMModel modelSrc changed — reloading', {
        from: oldSrc,
        to: newSrc,
      })
      loadModel()
    } else {
      console.debug('[buddy:vrm] VRMModel modelSrc watcher fired but URL unchanged', {
        modelSrc: newSrc,
      })
    }
  })

  // wait until scene is not undefined
  await until(() => scene.value).toBeTruthy()
  await loadModel()

  /*
    * Downward info flow
    * - Pinia store value updated => command take effect
  */
  // watch if the animation should be paused
  watch(paused, (isPaused) => {
    if (isPaused) {
      stop()
    }
    else {
      start()
    }
  }, { immediate: true })
  // update model position
  watch(modelOffset, () => {
    if (vrmGroup.value) {
      vrmGroup.value.position.set(
        modelOffset.value.x,
        modelOffset.value.y,
        modelOffset.value.z,
      )
    }
  }, { immediate: true, deep: true })
  // update model rotation
  watch(modelRotationY, (newRotationY) => {
    if (vrmGroup.value) {
      vrmGroup.value.rotation.y = MathUtils.degToRad(newRotationY)
    }
  }, { immediate: true })
  // update NPR sky box
  watch([envSelect, skyBoxIntensity, nprIrrSH], async () => {
    if (!vrm.value)
      return
    // force the program to flush
    nprProgramVersion.value += 1
    const mode = normalizeEnvMode(envSelect.value)

    updateNprShaderSetting(vrm.value?.scene as unknown as Object3D, {
      mode,
      intensity: skyBoxIntensity.value,
      sh: nprIrrSH.value ?? null,
    })
    airiIblProbe?.update(mode, skyBoxIntensity.value, nprIrrSH.value ?? null)
  }, { immediate: true })
  // update eye tracking mode
  watch(trackingMode, (newMode) => {
    stopCameraWatch?.()
    stopCameraWatch = undefined
    stopMouseWatch?.()
    stopMouseWatch = undefined
    if (newMode === 'camera') {
      stopCameraWatch = watch(cameraPosition, (newPosition) => {
        // watch to update look at target to camera
        emit('lookAtTarget', newPosition)
      }, { immediate: true, deep: true })
    }
    else if (newMode === 'mouse') {
      stopMouseWatch = watch([mouseX, mouseY], ([newX, newY]) => {
        mouseTarget.value = lookAtMouse(newX, newY, camera)
        // watch to update look at target to mouse
        emit('lookAtTarget', mouseTarget.value)
      }, { immediate: true, deep: true })
    }
    else {
      emit('lookAtTarget', defaultTookAt(eyeHeight.value))
    }
  }, { immediate: true })
  watch(lookAtTarget, (newTarget) => {
    idleEyeSaccades.instantUpdate(vrm.value, newTarget)
  }, { deep: true })
})

// Active one-shot morph pulses, applied inside the render loop AFTER the
// default per-frame updaters (blink/lipsync) so they win for their duration.
// When a pulse finishes we write 0 once and drop the entry, returning control
// to the default updaters on subsequent frames.
interface MorphPulse {
  name: string
  startedAt: number
  totalMs: number
  peak: number
}
const morphPulses = new Map<string, MorphPulse>()

function pulseExpression(name: string, peak: number, totalMs: number) {
  morphPulses.set(name, {
    name,
    startedAt: performance.now(),
    totalMs,
    peak,
  })
}

function applyMorphPulses() {
  const manager = vrm.value?.expressionManager
  if (!manager || morphPulses.size === 0)
    return
  const now = performance.now()
  for (const pulse of morphPulses.values()) {
    const t = Math.min(1, (now - pulse.startedAt) / pulse.totalMs)
    // Triangle envelope: ramp to peak at t=0.5, back to 0 at t=1.
    const w = (t < 0.5 ? t * 2 : (1 - t) * 2) * pulse.peak
    manager.setValue(pulse.name, w)
    if (t >= 1) {
      manager.setValue(pulse.name, 0)
      morphPulses.delete(pulse.name)
    }
  }
}

function clearAllPulses() {
  const manager = vrm.value?.expressionManager
  if (manager) {
    for (const pulse of morphPulses.values())
      manager.setValue(pulse.name, 0)
  }
  morphPulses.clear()
}

onUnmounted(() => {
  clearAllPulses()
  componentCleanUp('component-unmount')
})

if (import.meta.hot) {
  // Ensure cleanup on HMR
  import.meta.hot.dispose(() => {
    clearAllPulses()
    componentCleanUp('manual-reload')
  })
}

defineExpose({
  setExpression(expression: string, intensity = 1) {
    vrmEmote.value?.setEmotionWithResetAfter(expression, 3000, intensity)
  },
  setViseme(name: 'aa' | 'ih' | 'ou' | 'ee' | 'oh', ms = 400) {
    pulseExpression(name, 0.9, ms)
  },
  setBlink(which: 'blink' | 'blinkLeft' | 'blinkRight') {
    pulseExpression(which, 1.0, 240)
  },
  setLookAt(dir: 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight', ms = 600) {
    pulseExpression(dir, 1.0, ms)
  },
  pulseMorph(name: string, peak = 1, ms = 400) {
    pulseExpression(name, peak, ms)
  },
  setVrmFrameHook(hook?: VrmFrameRuntimeHook) {
    vrmFrameRuntimeHook.value = hook
  },
  scene: computed(() => vrm.value?.scene),
  lookAtUpdate(target: Vec3) {
    idleEyeSaccades.instantUpdate(vrm.value, target)
  },
})
</script>

<template>
  <slot v-if="modelLoaded" />
</template>
