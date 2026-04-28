<script setup lang="ts">
/*
  * - Root vue component for VRM rendering
  * - Simplified from stage-ui-three: no SkyBox, no post-processing, no trace
  * - Uses useElementSize instead of Screen component
*/

import type { VRM } from '@pixiv/three-vrm'
import type { TresContext } from '@tresjs/core'
import type { DirectionalLight, Texture, WebGLRenderer } from 'three'

import type { SceneBootstrap, ScenePhase, Vec3 } from '../stores/model-store'
import type { VrmDisplayConfig } from '../composables/vrm/core'
import type { VrmLifecycleReason } from '../composables/vrm/hooks'

import { TresCanvas } from '@tresjs/core'
import { useElementSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import {
  ACESFilmicToneMapping,
  Euler,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'

// From stage-ui-three package
import { useRenderTargetRegionAtClientPoint } from '../composables/render-target'
// pinia store
import { useModelStore } from '../stores/model-store'
import { OrbitControls } from './Controls'
import { VRMModel } from './Model'

const props = withDefaults(defineProps<{
  audioContext: AudioContext
  currentAudioSource?: AudioNode
  modelSrc?: string
  showAxes?: boolean
  idleAnimation?: string
  paused?: boolean
  displayConfig?: VrmDisplayConfig
}>(), {
  showAxes: false,
  idleAnimation: new URL('../assets/vrm/animations/idle_loop.vrma', import.meta.url).href,
  paused: false,
})

const emit = defineEmits<{
  (e: 'loadModelProgress', value: number): void
  (e: 'error', value: unknown): void
}>()

type ModelPhase = 'no-model' | 'loading' | 'ready' | 'error'
type SceneTraceTransactionReason = 'component-unmount' | 'initial-load' | 'model-reload' | 'model-switch' | 'no-model' | 'subtree-remount' | 'unknown'

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const modelStore = useModelStore()
const {
  beginSceneBindingTransaction,
  endSceneBindingTransaction,
  resetSceneBindingTransactions,
  setScenePhase,
} = modelStore
const {
  scenePhase,
  sceneTransactionDepth,

  lastCommittedModelSrc,
  modelSize,
  modelOrigin,
  modelOffset,
  modelRotationY,

  cameraFOV,
  cameraPosition,
  cameraDistance,

  directionalLightPosition,
  directionalLightTarget,
  directionalLightRotation,
  directionalLightIntensity,
  directionalLightColor,

  ambientLightIntensity,
  ambientLightColor,

  hemisphereSkyColor,
  hemisphereGroundColor,
  hemisphereLightIntensity,

  lookAtTarget,
  trackingMode,
  eyeHeight,
  envSelect,
  skyBoxIntensity,
  renderScale,
} = storeToRefs(modelStore)

type VrmFrameRuntimeHook = (vrm: VRM, delta: number) => void

const modelRef = ref<InstanceType<typeof VRMModel>>()
const vrmFrameRuntimeHook = shallowRef<VrmFrameRuntimeHook>()

const camera = shallowRef(new PerspectiveCamera())
const controlsRef = shallowRef<InstanceType<typeof OrbitControls>>()
const tresCanvasRef = shallowRef<TresContext>()
const dirLightRef = ref<InstanceType<typeof DirectionalLight>>()
const activeModelSrc = ref<string>()
const bindingRevision = ref(0)
const pendingCommittedModelSrc = ref<string>()
const pendingCommittedModelRevision = ref<number>()
const pendingSceneBootstrap = shallowRef<SceneBootstrap>()
const latestSceneTransactionReason = ref<SceneTraceTransactionReason>('unknown')

// Container for sizing (replaces Screen component)
const containerRef = ref<HTMLDivElement>()
const { width: containerWidth, height: containerHeight } = useElementSize(containerRef)

function toVector3(value: Vec3) {
  return new Vector3(value.x, value.y, value.z)
}

function toVec3(value: Vector3): Vec3 {
  return { x: value.x, y: value.y, z: value.z }
}

function clearPendingCommittedModel() {
  pendingCommittedModelSrc.value = undefined
  pendingCommittedModelRevision.value = undefined
}

function invalidateBindingRevision() {
  bindingRevision.value += 1
  clearPendingCommittedModel()
}

function applySceneBootstrap(value: SceneBootstrap) {
  const reason = latestSceneTransactionReason.value
  const previousOrigin = toVector3(modelOrigin.value)
  const previousCameraOffset = toVector3(cameraPosition.value).sub(previousOrigin)
  const previousTargetOffset = toVector3(lookAtTarget.value).sub(previousOrigin)
  const nextOrigin = toVector3(value.modelOrigin)
  const bootstrapCameraOffset = toVector3(value.cameraPosition).sub(nextOrigin)

  modelOrigin.value = { ...value.modelOrigin }
  modelSize.value = { ...value.modelSize }
  eyeHeight.value = value.eyeHeight

  if (reason === 'initial-load' || reason === 'unknown' || reason === 'no-model' || reason === 'model-switch') {
    modelOffset.value = { ...value.modelOffset }
    cameraDistance.value = value.cameraDistance
    cameraPosition.value = { ...value.cameraPosition }
    lookAtTarget.value = { ...value.lookAtTarget }
    return
  }

  const effectiveCameraDistance = cameraDistance.value > 1e-6 ? cameraDistance.value : value.cameraDistance
  cameraDistance.value = effectiveCameraDistance

  const nextCameraDirection = previousCameraOffset.lengthSq() > 1e-6
    ? previousCameraOffset.normalize()
    : bootstrapCameraOffset.lengthSq() > 1e-6
      ? bootstrapCameraOffset.normalize()
      : new Vector3(0, 0, -1)

  cameraPosition.value = toVec3(nextOrigin.clone().addScaledVector(nextCameraDirection, effectiveCameraDistance))

  if (previousTargetOffset.lengthSq() > 1e-6) {
    lookAtTarget.value = toVec3(nextOrigin.clone().add(previousTargetOffset))
    return
  }

  lookAtTarget.value = { ...value.lookAtTarget }
}

const { readRenderTargetRegionAtClientPoint, disposeRenderTarget } = useRenderTargetRegionAtClientPoint({
  getRenderer: () => tresCanvasRef.value?.renderer.instance as WebGLRenderer | undefined,
  getScene: () => tresCanvasRef.value?.scene.value,
  getCamera: () => camera.value,
  getCanvas: () => tresCanvasRef.value?.renderer.instance.domElement,
})

/*
  * Handle upward info flow
  * - Sub components emit info => update pinia store
*/
// === OrbitControls ===
function onOrbitControlsCameraChanged(value: {
  newCameraPosition: Vec3
  newCameraDistance: number
}) {
  const posChanged = Math.abs(cameraPosition.value.x - value.newCameraPosition.x) > 1e-6
    || Math.abs(cameraPosition.value.y - value.newCameraPosition.y) > 1e-6
    || Math.abs(cameraPosition.value.z - value.newCameraPosition.z) > 1e-6
  if (posChanged) {
    cameraPosition.value = value.newCameraPosition
  }
  const distChanged = Math.abs(cameraDistance.value - value.newCameraDistance) > 1e-6
  if (distChanged) {
    cameraDistance.value = value.newCameraDistance
  }
}
const controlsReady = ref(false)
const isCompletingBinding = ref(false)

//  === VRMModel ===
const canvasReady = ref(false)
const modelPhase = ref<ModelPhase>(props.modelSrc ? 'loading' : 'no-model')

function beginSceneBindingCycle(reason: SceneTraceTransactionReason) {
  latestSceneTransactionReason.value = reason
  invalidateBindingRevision()
  resetSceneBindingTransactions()
  beginSceneBindingTransaction()
  setScenePhase('loading')
}

function beginSceneRebind(reason: SceneTraceTransactionReason = 'subtree-remount') {
  latestSceneTransactionReason.value = reason
  invalidateBindingRevision()

  if (sceneTransactionDepth.value === 0) {
    beginSceneBindingTransaction()
  }

  setScenePhase('loading')
}

function commitLastCommittedModelSrc(expectedRevision: number, nextPhase: ScenePhase) {
  if (nextPhase !== 'mounted')
    return

  if (expectedRevision !== bindingRevision.value)
    return

  if (!pendingCommittedModelSrc.value || pendingCommittedModelRevision.value !== expectedRevision)
    return

  if (!activeModelSrc.value || pendingCommittedModelSrc.value !== activeModelSrc.value)
    return

  if (props.modelSrc !== activeModelSrc.value)
    return

  lastCommittedModelSrc.value = pendingCommittedModelSrc.value
  clearPendingCommittedModel()
}

function toSceneLoadTransactionReason(reason: VrmLifecycleReason): SceneTraceTransactionReason {
  switch (reason) {
    case 'initial-load':
    case 'model-reload':
    case 'model-switch':
      return reason
    default:
      return 'unknown'
  }
}

function resolveScenePhaseAfterBinding(): ScenePhase {
  if (!canvasReady.value)
    return 'pending'

  if (!props.modelSrc)
    return 'no-model'

  if (modelPhase.value === 'error')
    return 'error'

  if (modelPhase.value === 'ready')
    return 'mounted'

  return 'loading'
}

async function completeSceneBinding(expectedRevision = bindingRevision.value) {
  if (isCompletingBinding.value)
    return
  isCompletingBinding.value = true

  try {
    setScenePhase('binding')

    if (pendingSceneBootstrap.value) {
      applySceneBootstrap(pendingSceneBootstrap.value)
      pendingSceneBootstrap.value = undefined
    }

    await nextTick()

    if (expectedRevision !== bindingRevision.value)
      return

    controlsRef.value?.update()

    if (sceneTransactionDepth.value > 0) {
      endSceneBindingTransaction()
    }

    const nextPhase = resolveScenePhaseAfterBinding()
    setScenePhase(nextPhase)
    commitLastCommittedModelSrc(expectedRevision, nextPhase)
  }
  finally {
    isCompletingBinding.value = false
  }
}

function onOrbitControlsReady() {
  controlsReady.value = true

  if (modelPhase.value === 'ready' && scenePhase.value !== 'mounted')
    void completeSceneBinding()
}

const controlEnable = computed(() => {
  return controlsReady.value
    && modelPhase.value === 'ready'
    && scenePhase.value === 'mounted'
    && sceneTransactionDepth.value === 0
})

function onVRMModelLoadStart(reason: VrmLifecycleReason) {
  modelPhase.value = 'loading'
  pendingSceneBootstrap.value = undefined
  beginSceneBindingCycle(toSceneLoadTransactionReason(reason))
}

function onVRMSceneBootstrap(value: SceneBootstrap) {
  pendingSceneBootstrap.value = value
}

function onVRMModelLookAtTarget(value: Vec3) {
  lookAtTarget.value.x = value.x
  lookAtTarget.value.y = value.y
  lookAtTarget.value.z = value.z
}

function onVRMModelLoaded(value: string) {
  activeModelSrc.value = value
  pendingCommittedModelSrc.value = value
  pendingCommittedModelRevision.value = bindingRevision.value
  modelPhase.value = 'ready'
  void completeSceneBinding(bindingRevision.value)
}

function onVRMModelError(error: unknown) {
  invalidateBindingRevision()
  pendingSceneBootstrap.value = undefined
  modelPhase.value = props.modelSrc ? 'error' : 'no-model'
  resetSceneBindingTransactions()
  setScenePhase(props.modelSrc ? 'error' : 'no-model')
  emit('error', error)
}

// === Tres Canvas ===
let environmentTexture: Texture | undefined

function installSceneEnvironment(context: TresContext) {
  const renderer = context.renderer.instance as WebGLRenderer | undefined
  const scene = context.scene.value
  if (!renderer || !scene)
    return

  const pmrem = new PMREMGenerator(renderer)
  const roomEnv = new RoomEnvironment()
  environmentTexture = pmrem.fromScene(roomEnv, 0.04).texture
  scene.environment = environmentTexture
  roomEnv.traverse((obj) => {
    const mesh = obj as { material?: { dispose?: () => void }, geometry?: { dispose?: () => void } }
    mesh.material?.dispose?.()
    mesh.geometry?.dispose?.()
  })
  pmrem.dispose()
}

function disposeSceneEnvironment() {
  const scene = tresCanvasRef.value?.scene.value
  if (scene && scene.environment === environmentTexture)
    scene.environment = null
  environmentTexture?.dispose()
  environmentTexture = undefined
}

function onTresReady(context: TresContext) {
  tresCanvasRef.value = context
  canvasReady.value = true
  installSceneEnvironment(context)
  setScenePhase(resolveScenePhaseAfterBinding())
}

onUnmounted(() => {
  invalidateBindingRevision()
  canvasReady.value = false
  disposeSceneEnvironment()
  tresCanvasRef.value = undefined
  activeModelSrc.value = undefined
  pendingSceneBootstrap.value = undefined
  resetSceneBindingTransactions()
  setScenePhase('pending')
  disposeRenderTarget()
})

function applyVrmFrameRuntimeHook() {
  modelRef.value?.setVrmFrameHook(vrmFrameRuntimeHook.value)
}

watch(() => props.modelSrc, (modelSrc, prevSrc) => {
  console.info('[buddy:vrm] ThreeScene modelSrc watcher', {
    prev: prevSrc,
    next: modelSrc,
    changed: prevSrc !== modelSrc,
  })
  modelPhase.value = modelSrc ? 'loading' : 'no-model'

  if (!modelSrc) {
    invalidateBindingRevision()
    activeModelSrc.value = undefined
    pendingSceneBootstrap.value = undefined
    resetSceneBindingTransactions()
  }

  setScenePhase(resolveScenePhaseAfterBinding())
}, { immediate: true })

watch(modelRef, (next, prev) => {
  if (next)
    applyVrmFrameRuntimeHook()

  if (prev && !next) {
    modelPhase.value = props.modelSrc ? 'loading' : 'no-model'
    setScenePhase(props.modelSrc ? 'loading' : 'no-model')
  }
}, { flush: 'sync' })

watch(controlsRef, (next, prev) => {
  if (prev && !next) {
    controlsReady.value = false

    if (props.modelSrc && !!activeModelSrc.value)
      beginSceneRebind()
  }
}, { flush: 'sync' })

// === Directional Light ===
watch(
  [modelPhase, dirLightRef],
  ([phase, dirLight]) => {
    if (phase !== 'ready' || !dirLight)
      return

    try {
      dirLight.parent?.add(dirLight.target)
      dirLight.target.position.set(
        directionalLightTarget.value.x,
        directionalLightTarget.value.y,
        directionalLightTarget.value.z,
      )
      dirLight.target.updateMatrixWorld()
    }
    catch (error) {
      console.error('[ThreeScene] Failed to setup directional light:', error)
    }
  },
  { immediate: true },
)

const resolvedComponentState = computed<'pending' | 'loading' | 'mounted'>(() => {
  if (scenePhase.value === 'pending')
    return 'pending'

  if (scenePhase.value === 'loading' || scenePhase.value === 'binding')
    return 'loading'

  return 'mounted'
})

watch(resolvedComponentState, (to) => {
  componentState.value = to
}, { immediate: true })

function updateDirLightTarget(newRotation: { x: number, y: number, z: number }) {
  const light = dirLightRef.value
  if (!light)
    return

  const { x: rx, y: ry, z: rz } = newRotation
  const lightPosition = new Vector3(
    directionalLightPosition.value.x,
    directionalLightPosition.value.y,
    directionalLightPosition.value.z,
  )
  const origin = new Vector3(0, 0, 0)
  const euler = new Euler(
    MathUtils.degToRad(rx),
    MathUtils.degToRad(ry),
    MathUtils.degToRad(rz),
    'XYZ',
  )
  const initialForward = origin.clone().sub(lightPosition).normalize()
  const newForward = initialForward.applyEuler(euler).normalize()
  const distance = lightPosition.distanceTo(origin)
  const target = lightPosition.clone().addScaledVector(newForward, distance)

  light.target.position.copy(target)

  light.target.updateMatrixWorld()

  directionalLightTarget.value = { x: target.x, y: target.y, z: target.z }
}

watch(directionalLightRotation, (newRotation) => {
  updateDirLightTarget(newRotation)
}, { deep: true })

defineExpose({
  setExpression: (expression: string, intensity = 1) => {
    modelRef.value?.setExpression(expression, intensity)
  },
  setViseme: (name: 'aa' | 'ih' | 'ou' | 'ee' | 'oh', ms?: number) => {
    modelRef.value?.setViseme(name, ms)
  },
  setBlink: (which: 'blink' | 'blinkLeft' | 'blinkRight') => {
    modelRef.value?.setBlink(which)
  },
  setLookAt: (dir: 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight', ms?: number) => {
    modelRef.value?.setLookAt(dir, ms)
  },
  pulseMorph: (name: string, peak?: number, ms?: number) => {
    modelRef.value?.pulseMorph(name, peak, ms)
  },
  setVrmFrameHook: (hook?: VrmFrameRuntimeHook) => {
    vrmFrameRuntimeHook.value = hook
    applyVrmFrameRuntimeHook()
  },
  canvasElement: () => {
    return tresCanvasRef.value?.renderer.instance.domElement
  },
  camera: () => camera.value,
  renderer: () => tresCanvasRef.value?.renderer.instance,
  scene: () => modelRef.value?.scene,
  readRenderTargetRegionAtClientPoint,
})
</script>

<template>
  <div
    ref="containerRef"
    style="width: 100%; height: 100%; position: relative;"
  >
    <TresCanvas
      v-if="containerWidth > 0 && containerHeight > 0"
      :width="containerWidth"
      :height="containerHeight"
      :camera="camera"
      :antialias="true"
      :alpha="true"
      :dpr="renderScale"
      :tone-mapping="ACESFilmicToneMapping"
      :tone-mapping-exposure="1"
      :clear-alpha="0"
      @ready="onTresReady"
    >
      <OrbitControls
        ref="controlsRef"
        :control-enable="controlEnable"
        :model-size="modelSize"
        :camera-position="cameraPosition"
        :camera-target="modelOrigin"
        :camera-f-o-v="cameraFOV"
        :camera-distance="cameraDistance"
        @orbit-controls-camera-changed="onOrbitControlsCameraChanged"
        @orbit-controls-ready="onOrbitControlsReady"
      />
      <TresHemisphereLight
        :color="hemisphereSkyColor"
        :ground-color="hemisphereGroundColor"
        :position="[0, 1, 0]"
        :intensity="hemisphereLightIntensity"
        cast-shadow
      />
      <TresAmbientLight
        :color="ambientLightColor"
        :intensity="ambientLightIntensity"
        cast-shadow
      />
      <TresDirectionalLight
        ref="dirLightRef"
        :color="directionalLightColor"
        :position="[directionalLightPosition.x, directionalLightPosition.y, directionalLightPosition.z]"
        :intensity="directionalLightIntensity"
        cast-shadow
      />
      <VRMModel
        ref="modelRef"
        :audio-context="props.audioContext"
        :current-audio-source="props.currentAudioSource"
        :last-committed-model-src="lastCommittedModelSrc"
        :model-src="props.modelSrc"
        :idle-animation="props.idleAnimation"
        :paused="props.paused"
        :env-select="envSelect"
        :sky-box-intensity="skyBoxIntensity"
        :model-offset="modelOffset"
        :model-rotation-y="modelRotationY"
        :look-at-target="lookAtTarget"
        :tracking-mode="trackingMode"
        :eye-height="eyeHeight"
        :camera-position="cameraPosition"
        :display-config="props.displayConfig"
        :camera="camera"
        @loading-progress="(val: number) => emit('loadModelProgress', val)"
        @load-start="onVRMModelLoadStart"
        @scene-bootstrap="onVRMSceneBootstrap"
        @look-at-target="onVRMModelLookAtTarget"
        @error="onVRMModelError"
        @loaded="onVRMModelLoaded"
      />
      <TresAxesHelper
        v-if="props.showAxes"
        :size="1"
      />
    </TresCanvas>
  </div>
</template>
