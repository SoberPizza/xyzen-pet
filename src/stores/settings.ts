import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { BundledVrmModel } from './display-models'
import { useBuddyStore } from './buddy'
import { useDisplayModelsStore } from './display-models'

type StageModelRenderer = 'vrm' | 'disabled' | undefined

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useDisplayModelsStore()
  const buddyStore = useBuddyStore()

  const stageModelSelectedModel = ref<BundledVrmModel | undefined>(undefined)
  const stageModelSelectedUrl = ref<string | undefined>(undefined)
  const stageModelRenderer = ref<StageModelRenderer>(undefined)

  // Per-model gesture overrides paired with the active VRM; undefined when
  // no bundled model matches the active buddy's race × stage. `App.vue`
  // feeds this into `useVRMGestureDriver` merged on top of
  // `DEFAULT_GESTURE_ACTIONS`.
  const activeAnimationDriver = computed(() => stageModelSelectedModel.value?.animationDriver)

  const stageViewControlsEnabled = ref<boolean>(false)

  function applyModel(model: BundledVrmModel | undefined) {
    const prevUrl = stageModelSelectedUrl.value
    if (!model) {
      stageModelSelectedModel.value = undefined
      stageModelSelectedUrl.value = undefined
      stageModelRenderer.value = 'disabled'
      console.info('[buddy:vrm] stage model cleared', { prevUrl })
      return
    }
    stageModelSelectedModel.value = model
    stageModelSelectedUrl.value = model.url
    stageModelRenderer.value = 'vrm'
    console.info('[buddy:vrm] stage model applied', {
      name: model.name,
      raceCode: model.raceCode,
      stage: model.stage,
      url: model.url,
      changed: prevUrl !== model.url,
    })
  }

  function updateStageModel() {
    const buddy = buddyStore.activeBuddy
    console.debug('[buddy:vrm] updateStageModel', {
      activeBuddyId: buddyStore.activeBuddyId,
      name: buddy?.name,
      raceCode: buddy?.raceCode,
      stage: buddy?.stage,
    })
    applyModel(displayModelsStore.getVrmByRaceStage(buddy?.raceCode, buddy?.stage))
  }

  async function initializeStageModel() {
    updateStageModel()
  }

  watch(
    () => [buddyStore.activeBuddy?.raceCode, buddyStore.activeBuddy?.stage] as const,
    () => {
      updateStageModel()
    },
    { immediate: true },
  )

  async function resetState() {
    applyModel(undefined)
    stageViewControlsEnabled.value = false
  }

  return {
    stageModelRenderer,
    stageModelSelectedUrl,
    stageModelSelectedModel,
    stageViewControlsEnabled,
    activeAnimationDriver,

    initializeStageModel,
    updateStageModel,
    resetState,
  }
})
