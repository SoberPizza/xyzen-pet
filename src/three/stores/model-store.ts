import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ScenePhase = 'pending' | 'loading' | 'binding' | 'mounted' | 'no-model' | 'error'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SceneBootstrap {
  cacheHit: boolean
  cameraDistance: number
  cameraPosition: Vec3
  eyeHeight: number
  lookAtTarget: Vec3
  modelOffset: Vec3
  modelOrigin: Vec3
  modelSize: Vec3
}

export const useModelStore = defineStore('modelStore', () => {
  const shouldUpdateViewHooks = ref(new Set<() => void>())

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView(_reason = 'unknown') {
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  // === Scene runtime orchestration ===
  const scenePhase = ref<ScenePhase>('pending')
  const sceneTransactionDepth = ref(0)
  const sceneMutationLocked = computed(() => scenePhase.value !== 'mounted' || sceneTransactionDepth.value > 0)

  function setScenePhase(phase: ScenePhase) {
    scenePhase.value = phase
  }

  function beginSceneBindingTransaction() {
    sceneTransactionDepth.value += 1
  }

  function endSceneBindingTransaction() {
    sceneTransactionDepth.value = Math.max(0, sceneTransactionDepth.value - 1)
  }

  function resetSceneBindingTransactions() {
    sceneTransactionDepth.value = 0
  }

  // === Legacy / shared controls ===
  const scale = useLocalStorage('settings/stage-ui-three/scale', 1)
  const lastCommittedModelSrc = useLocalStorage('settings/stage-ui-three/lastModelSrc', '')

  // === Model lifecycle / bootstrap ===
  const modelSize = useLocalStorage('settings/stage-ui-three/modelSize', { x: 0, y: 0, z: 0 })
  const modelOrigin = useLocalStorage('settings/stage-ui-three/modelOrigin', { x: 0, y: 0, z: 0 })
  const eyeHeight = useLocalStorage('settings/stage-ui-three/eyeHeight', 0)

  // === User scene settings ===
  const modelOffset = useLocalStorage('settings/stage-ui-three/modelOffset', { x: 0, y: 0, z: 0 })
  const modelRotationY = useLocalStorage('settings/stage-ui-three/modelRotationY', 0)
  const cameraFOV = useLocalStorage('settings/stage-ui-three/cameraFOV', 40)
  const trackingMode = useLocalStorage('settings/stage-ui-three/trackingMode', 'none' as 'camera' | 'mouse' | 'none')

  // === View state ===
  const cameraPosition = useLocalStorage('settings/stage-ui-three/camera-position', { x: 0, y: 0, z: -1 })
  const cameraDistance = useLocalStorage('settings/stage-ui-three/cameraDistance', 0)
  const lookAtTarget = useLocalStorage('settings/stage-ui-three/lookAtTarget', { x: 0, y: 0, z: 0 })

  function resetModelStore() {
    scenePhase.value = 'pending'
    sceneTransactionDepth.value = 0

    lastCommittedModelSrc.value = ''
    modelSize.value = { x: 0, y: 0, z: 0 }
    modelOrigin.value = { x: 0, y: 0, z: 0 }
    modelOffset.value = { x: 0, y: 0, z: 0 }
    modelRotationY.value = 0

    cameraFOV.value = 40
    cameraPosition.value = { x: 0, y: 0, z: 0 }
    cameraDistance.value = 0

    lookAtTarget.value = { x: 0, y: 0, z: 0 }
    trackingMode.value = 'none'
    eyeHeight.value = 0
  }

  // === Environment / lighting / render settings ===
  const directionalLightPosition = useLocalStorage('settings/stage-ui-three/scenes/scene/directional-light/position', { x: 0, y: 0, z: -1 })
  const directionalLightTarget = useLocalStorage('settings/stage-ui-three/scenes/scene/directional-light/target', { x: 0, y: 0, z: 0 })
  const directionalLightRotation = useLocalStorage('settings/stage-ui-three/scenes/scene/directional-light/rotation', { x: 0, y: 0, z: 0 })
  const directionalLightIntensity = useLocalStorage('settings/stage-ui-three/scenes/scene/directional-light/intensity', 2.02)
  const directionalLightColor = useLocalStorage('settings/stage-ui-three/scenes/scene/directional-light/color', '#fffbf5')

  const hemisphereSkyColor = useLocalStorage('settings/stage-ui-three/scenes/scene/hemisphere-light/sky-color', '#FFFFFF')
  const hemisphereGroundColor = useLocalStorage('settings/stage-ui-three/scenes/scene/hemisphere-light/ground-color', '#222222')
  const hemisphereLightIntensity = useLocalStorage('settings/stage-ui-three/scenes/scene/hemisphere-light/intensity', 0.4)

  const ambientLightColor = useLocalStorage('settings/stage-ui-three/scenes/scene/ambient-light/color', '#FFFFFF')
  const ambientLightIntensity = useLocalStorage('settings/stage-ui-three/scenes/scene/ambient-light/intensity', 0.6)

  // Rendering quality
  const renderScale = useLocalStorage('settings/stage-ui-three/renderScale', Math.min(window.devicePixelRatio, 2))
  const multisampling = useLocalStorage('settings/stage-ui-three/multisampling', 4)

  // environment related setting (simplified - no skyBox)
  const envSelect = useLocalStorage('settings/stage-ui-three/envEnabled', 'hemisphere' as 'hemisphere' | 'skyBox')
  const skyBoxIntensity = useLocalStorage('settings/stage-ui-three/skyBoxIntensity', 0.1)

  return {
    scenePhase,
    sceneTransactionDepth,
    sceneMutationLocked,

    scale,
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
    renderScale,
    multisampling,

    envSelect,
    skyBoxIntensity,

    onShouldUpdateView,
    shouldUpdateView,
    setScenePhase,
    beginSceneBindingTransaction,
    endSceneBindingTransaction,
    resetSceneBindingTransactions,

    resetModelStore,
  }
})
