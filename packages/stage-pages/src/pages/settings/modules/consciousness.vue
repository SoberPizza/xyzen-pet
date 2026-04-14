<script setup lang="ts">
import type {
  LocalAICheckLlamaResult,
  LocalAILlamaServerConfig,
  LocalAIServiceStatus,
  LocalAIStatusResult,
} from '@proj-airi/stage-shared/local-ai'
import type { RemovableRef } from '@vueuse/core'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  localAICheckLlamaEventa,
  localAIConfigureLlamaEventa,
  localAIGetStatusEventa,
  localAIStopEventa,
} from '@proj-airi/stage-shared/local-ai'
import { AddProviderDialog, Alert, EditProviderDialog, ErrorContainer, RadioCardManySelect, RadioCardSimple } from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const { localChatProviders, cloudChatProviders, allCloudChatProviders, configuredProviders } = storeToRefs(providersStore)
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }
const {
  activeProvider,
  activeModel,
  customModelName,
  modelSearchQuery,
  supportsModelListing,
  providerModels,
  isLoadingActiveProviderModels,
  activeProviderModelError,
} = storeToRefs(consciousnessStore)

const { t } = useI18n()
const { trackProviderClick } = useAnalytics()

const showAddDialog = ref(false)
const showEditDialog = ref(false)
const editingProviderId = ref('')

// llama-server service management (Electron only)
const isElectron = typeof window !== 'undefined' && isElectronWindow(window)
const llamaCheck = ref<LocalAICheckLlamaResult | null>(null)
const isCheckingLlama = ref(false)
const isTogglingLlamaService = ref(false)
const llamaServiceStatus = ref<LocalAIServiceStatus | null>(null)
const llamaError = ref<string | null>(null)

function ensureLlamaProvider() {
  if (!providers.value['llama-cpp-local'])
    providers.value['llama-cpp-local'] = {}
}

const llamaConfig = reactive({
  get modelPath() { return providers.value['llama-cpp-local']?.modelPath || '' },
  set modelPath(v: string) {
    ensureLlamaProvider()
    providers.value['llama-cpp-local'].modelPath = v
  },
  get port() { return providers.value['llama-cpp-local']?.port || 8080 },
  set port(v: number) {
    ensureLlamaProvider()
    providers.value['llama-cpp-local'].port = v
  },
  get contextLength() { return providers.value['llama-cpp-local']?.contextLength || 2048 },
  set contextLength(v: number) {
    ensureLlamaProvider()
    providers.value['llama-cpp-local'].contextLength = v
  },
  get gpuLayers() { return providers.value['llama-cpp-local']?.gpuLayers ?? -1 },
  set gpuLayers(v: number) {
    ensureLlamaProvider()
    providers.value['llama-cpp-local'].gpuLayers = v
  },
})

let invokeLlamaCheck: (() => Promise<LocalAICheckLlamaResult>) | undefined
let invokeLlamaConfigure: ((payload: LocalAILlamaServerConfig) => Promise<LocalAIServiceStatus>) | undefined
let invokeStop: ((payload: { serviceId: string }) => Promise<LocalAIServiceStatus>) | undefined
let invokeGetStatus: (() => Promise<LocalAIStatusResult>) | undefined
let llamaStatusPollTimer: ReturnType<typeof setInterval> | undefined

if (isElectron) {
  const { context } = createContext((window as any).electron.ipcRenderer)
  invokeLlamaCheck = defineInvoke(context, localAICheckLlamaEventa)
  invokeLlamaConfigure = defineInvoke(context, localAIConfigureLlamaEventa)
  invokeStop = defineInvoke(context, localAIStopEventa)
  invokeGetStatus = defineInvoke(context, localAIGetStatusEventa)
}

const isLlamaServiceRunning = computed(() => llamaServiceStatus.value?.state === 'running')
const isLlamaServiceStarting = computed(() => llamaServiceStatus.value?.state === 'starting')
const showLlamaServerControls = computed(() => activeProvider.value === 'llama-cpp-local' && isElectron)

async function refreshLlamaStatus() {
  if (!invokeGetStatus)
    return
  try {
    const result = await invokeGetStatus()
    llamaServiceStatus.value = result.services.find(s => s.serviceId === 'llama-server') ?? null
  }
  catch (err) {
    console.warn('[Consciousness] Failed to get llama-server status:', err)
  }
}

async function checkLlamaEnv() {
  if (!invokeLlamaCheck)
    return
  isCheckingLlama.value = true
  try {
    llamaCheck.value = await invokeLlamaCheck()
  }
  catch (err) {
    console.warn('[Consciousness] Failed to check llama-server:', err)
  }
  finally {
    isCheckingLlama.value = false
  }
}

async function handleStartLlamaService() {
  if (!invokeLlamaConfigure)
    return
  if (!llamaConfig.modelPath.trim()) {
    llamaError.value = t('settings.pages.modules.consciousness.sections.section.local-llm.error-no-model-path', 'Model path is required')
    return
  }
  llamaError.value = null
  isTogglingLlamaService.value = true
  try {
    llamaServiceStatus.value = await invokeLlamaConfigure({
      modelPath: llamaConfig.modelPath,
      port: llamaConfig.port,
      contextLength: llamaConfig.contextLength,
      gpuLayers: llamaConfig.gpuLayers,
    })
    // Sync provider baseUrl with configured port
    syncLlamaBaseUrl()
  }
  catch (err) {
    llamaError.value = errorMessageFrom(err) ?? 'Failed to start llama-server'
    console.error('[Consciousness] Failed to start llama-server:', err)
  }
  finally {
    isTogglingLlamaService.value = false
  }
}

async function handleStopLlamaService() {
  if (!invokeStop)
    return
  llamaError.value = null
  isTogglingLlamaService.value = true
  try {
    llamaServiceStatus.value = await invokeStop({ serviceId: 'llama-server' })
  }
  catch (err) {
    llamaError.value = errorMessageFrom(err) ?? 'Failed to stop llama-server'
    console.error('[Consciousness] Failed to stop llama-server:', err)
  }
  finally {
    isTogglingLlamaService.value = false
  }
}

function syncLlamaBaseUrl() {
  ensureLlamaProvider()
  providers.value['llama-cpp-local'].baseUrl = `http://localhost:${llamaConfig.port}/v1/`
}

watch(activeProvider, async (provider, oldProvider) => {
  if (!provider)
    return

  if (oldProvider !== undefined && oldProvider !== provider) {
    activeModel.value = ''
  }

  await consciousnessStore.loadModelsForProvider(provider)

  // Start llama status polling when llama-cpp-local is selected
  if (provider === 'llama-cpp-local' && isElectron) {
    checkLlamaEnv()
    refreshLlamaStatus()
    if (!llamaStatusPollTimer) {
      llamaStatusPollTimer = setInterval(refreshLlamaStatus, 3000)
    }
  }
  else if (llamaStatusPollTimer) {
    clearInterval(llamaStatusPollTimer)
    llamaStatusPollTimer = undefined
  }
}, { immediate: true })

onUnmounted(() => {
  if (llamaStatusPollTimer)
    clearInterval(llamaStatusPollTimer)
})

function updateCustomModelName(value: string) {
  customModelName.value = value
}

function handleDeleteProvider(providerId: string) {
  if (activeProvider.value === providerId) {
    activeProvider.value = ''
    activeModel.value = ''
  }
  providersStore.deleteProvider(providerId)
}

function handleEditProvider(providerId: string) {
  editingProviderId.value = providerId
  showEditDialog.value = true
}

function handleProviderAdded(providerId: string) {
  activeProvider.value = providerId
}

function handleProviderDeleted() {
  if (editingProviderId.value === activeProvider.value) {
    activeProvider.value = ''
    activeModel.value = ''
  }
}
</script>

<template>
  <div :class="['rounded-xl bg-neutral-50 p-4 dark:bg-[rgba(0,0,0,0.3)]', 'flex flex-col gap-4']">
    <div>
      <div :class="['flex flex-col gap-4']">
        <!-- Local Providers -->
        <div v-if="localChatProviders.length > 0">
          <h2 :class="['text-lg text-neutral-500 md:text-2xl dark:text-neutral-500']">
            {{ t('settings.pages.modules.common.providers.local.title') }}
          </h2>
          <div :class="['max-w-full mt-2']">
            <fieldset
              :class="['flex flex-row gap-4 min-w-0 of-x-scroll scroll-smooth']"
              :style="{ 'scrollbar-width': 'none' }"
              role="radiogroup"
            >
              <RadioCardSimple
                v-for="metadata in localChatProviders"
                :id="metadata.id"
                :key="metadata.id"
                v-model="activeProvider"
                name="provider"
                :value="metadata.id"
                :title="metadata.localizedName || 'Unknown'"
                :description="metadata.localizedDescription"
                @click="trackProviderClick(metadata.id, 'consciousness')"
              >
                <template #bottomRight>
                  <div
                    :class="[
                      'rounded px-2 py-0.5 text-xs font-medium',
                      configuredProviders[metadata.id]
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400',
                    ]"
                  >
                    {{ configuredProviders[metadata.id] ? t('settings.pages.modules.common.providers.local.available') : t('settings.pages.modules.common.providers.local.unavailable') }}
                  </div>
                </template>
              </RadioCardSimple>
            </fieldset>
          </div>
        </div>

        <!-- llama-server controls (shown when llama-cpp-local is selected in Electron) -->
        <div v-if="showLlamaServerControls" :class="['flex flex-col gap-3']">
          <h2 :class="['text-lg text-neutral-500 md:text-2xl dark:text-neutral-500']">
            {{ t('settings.pages.modules.consciousness.sections.section.local-llm.title') }}
          </h2>

          <!-- Environment check -->
          <div :class="['rounded-lg bg-neutral-100/60 p-3 text-xs dark:bg-neutral-800/40']">
            <p :class="['font-medium text-neutral-600 dark:text-neutral-300']">
              {{ t('settings.pages.modules.consciousness.sections.section.local-llm.env-check') }}
            </p>
            <div :class="['mt-1.5']">
              <template v-if="isCheckingLlama">
                <span :class="['text-neutral-500 dark:text-neutral-400']">
                  {{ t('settings.pages.modules.consciousness.sections.section.local-llm.checking') }}
                </span>
              </template>
              <template v-else-if="llamaCheck?.llamaServerFound">
                <span :class="['text-green-600 dark:text-green-400']">
                  {{ t('settings.pages.modules.consciousness.sections.section.local-llm.env-ready', { version: llamaCheck.version ?? '' }) }}
                </span>
              </template>
              <template v-else>
                <span :class="['text-amber-600 dark:text-amber-400']">
                  {{ t('settings.pages.modules.consciousness.sections.section.local-llm.env-not-ready') }}
                </span>
              </template>
            </div>
          </div>

          <!-- Model configuration -->
          <FieldInput
            v-model="llamaConfig.modelPath"
            :label="t('settings.pages.modules.consciousness.sections.section.local-llm.model-path-label')"
            placeholder="/path/to/model.gguf"
          />
          <div :class="['grid grid-cols-3 gap-3']">
            <FieldInput
              v-model.number="llamaConfig.port"
              :label="t('settings.pages.modules.consciousness.sections.section.local-llm.port-label')"
              type="number"
              placeholder="8080"
            />
            <FieldInput
              v-model.number="llamaConfig.contextLength"
              :label="t('settings.pages.modules.consciousness.sections.section.local-llm.context-length-label')"
              type="number"
              placeholder="2048"
            />
            <FieldInput
              v-model.number="llamaConfig.gpuLayers"
              :label="t('settings.pages.modules.consciousness.sections.section.local-llm.gpu-layers-label')"
              type="number"
              placeholder="-1"
            />
          </div>

          <!-- Service status and controls -->
          <div
            :class="['rounded-lg border p-3', {
              'border-green-200/80 bg-green-50/60 dark:border-green-700/40 dark:bg-green-900/20': isLlamaServiceRunning,
              'border-amber-200/80 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/20': isLlamaServiceStarting,
              'border-neutral-200/80 bg-neutral-50/60 dark:border-neutral-700/40 dark:bg-neutral-800/40': !isLlamaServiceRunning && !isLlamaServiceStarting,
            }]"
          >
            <div :class="['flex items-center justify-between']">
              <div :class="['flex items-center gap-2']">
                <span
                  :class="['inline-block h-2 w-2 rounded-full', {
                    'bg-green-500': isLlamaServiceRunning,
                    'bg-amber-500 animate-pulse': isLlamaServiceStarting,
                    'bg-red-500': llamaServiceStatus?.state === 'error',
                    'bg-neutral-400': !llamaServiceStatus || llamaServiceStatus.state === 'stopped',
                  }]"
                />
                <span
                  :class="['text-sm font-medium', {
                    'text-green-700 dark:text-green-300': isLlamaServiceRunning,
                    'text-amber-700 dark:text-amber-300': isLlamaServiceStarting,
                    'text-red-700 dark:text-red-300': llamaServiceStatus?.state === 'error',
                    'text-neutral-600 dark:text-neutral-400': !llamaServiceStatus || llamaServiceStatus.state === 'stopped',
                  }]"
                >
                  <template v-if="isLlamaServiceRunning">
                    {{ t('settings.pages.modules.consciousness.sections.section.local-llm.service-running') }}
                  </template>
                  <template v-else-if="isLlamaServiceStarting">
                    {{ t('settings.pages.modules.consciousness.sections.section.local-llm.service-starting') }}
                  </template>
                  <template v-else-if="llamaServiceStatus?.state === 'error'">
                    {{ llamaServiceStatus.lastError ?? t('settings.pages.modules.consciousness.sections.section.local-llm.service-error') }}
                  </template>
                  <template v-else>
                    {{ t('settings.pages.modules.consciousness.sections.section.local-llm.service-stopped') }}
                  </template>
                </span>
              </div>

              <Button
                v-if="!isLlamaServiceStarting"
                :disabled="isLlamaServiceRunning
                  ? isTogglingLlamaService
                  : isTogglingLlamaService || isCheckingLlama || !llamaCheck?.llamaServerFound || !llamaConfig.modelPath.trim()"
                size="sm"
                :variant="isLlamaServiceRunning ? 'secondary' : 'primary'"
                @click="isLlamaServiceRunning ? handleStopLlamaService() : handleStartLlamaService()"
              >
                {{ isLlamaServiceRunning
                  ? t('settings.pages.modules.consciousness.sections.section.local-llm.stop-service')
                  : t('settings.pages.modules.consciousness.sections.section.local-llm.start-service')
                }}
              </Button>
            </div>
          </div>

          <!-- Error display -->
          <Alert v-if="llamaError" type="error">
            <template #title>
              {{ t('settings.pages.modules.consciousness.sections.section.local-llm.service-error') }}
            </template>
            <template #content>
              {{ llamaError }}
            </template>
          </Alert>

          <!-- Setup instructions (when llama-server not found) -->
          <div
            v-if="llamaCheck && !llamaCheck.llamaServerFound"
            :class="['rounded-lg bg-neutral-100/60 p-3 text-xs text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400']"
          >
            <p :class="['font-medium']">
              {{ t('settings.pages.modules.consciousness.sections.section.local-llm.setup-instructions') }}
            </p>
            <ol :class="['mt-1.5 list-inside list-decimal space-y-1']">
              <li><code>brew install llama.cpp</code></li>
              <li>{{ t('settings.pages.modules.consciousness.sections.section.local-llm.download-model') }}</li>
            </ol>
          </div>
        </div>

        <!-- Cloud Providers -->
        <div>
          <h2 :class="['text-lg text-neutral-500 md:text-2xl dark:text-neutral-500']">
            {{ t('settings.pages.modules.common.providers.cloud.title') }}
          </h2>
          <div :class="['text-neutral-400 dark:text-neutral-400']">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.description') }}</span>
          </div>
          <div :class="['max-w-full mt-2']">
            <fieldset
              v-if="cloudChatProviders.length > 0"
              :class="['flex flex-row gap-4 min-w-0 of-x-scroll scroll-smooth']"
              :style="{ 'scrollbar-width': 'none' }"
              role="radiogroup"
            >
              <RadioCardSimple
                v-for="metadata in cloudChatProviders"
                :id="metadata.id"
                :key="metadata.id"
                v-model="activeProvider"
                name="provider"
                :value="metadata.id"
                :title="metadata.localizedName || 'Unknown'"
                :description="metadata.localizedDescription"
                @click="trackProviderClick(metadata.id, 'consciousness')"
              >
                <template #topRight>
                  <div :class="['flex items-center gap-1']">
                    <button
                      type="button"
                      :class="['rounded bg-neutral-100 p-1 text-neutral-600 transition-colors dark:bg-neutral-800/60 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700/60']"
                      @click.stop.prevent="handleEditProvider(metadata.id)"
                    >
                      <div :class="['text-base i-solar:pen-bold-duotone']" />
                    </button>
                    <button
                      type="button"
                      :class="['rounded bg-neutral-100 p-1 text-neutral-600 transition-colors dark:bg-neutral-800/60 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700/60']"
                      @click.stop.prevent="handleDeleteProvider(metadata.id)"
                    >
                      <div :class="['text-base i-solar:trash-bin-trash-bold-duotone']" />
                    </button>
                  </div>
                </template>

                <template v-if="configuredProviders[metadata.id] === false" #bottomRight>
                  <div :class="['rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-medium dark:bg-amber-900/30 dark:text-amber-300']">
                    {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.health_check_failed') }}
                  </div>
                </template>
              </RadioCardSimple>
              <button
                type="button"
                :class="[
                  'relative min-w-50 w-fit rounded-xl p-4',
                  'border-2 border-neutral-100 bg-white',
                  'dark:border-neutral-900 dark:bg-neutral-900/20',
                  'hover:border-primary-500/30 dark:hover:border-primary-400/30',
                  'flex flex-col items-center justify-center',
                  'transition-all duration-200 ease-in-out',
                ]"
                @click="showAddDialog = true"
              >
                <div :class="['text-2xl text-neutral-500 dark:text-neutral-500 i-solar:add-circle-line-duotone']" />
                <div
                  :class="['absolute inset-0 z--1 bg-dotted-neutral-200/80 dark:bg-dotted-neutral-700/50']"
                  :style="{ 'background-size': '10px 10px', 'mask-image': 'linear-gradient(165deg, white 30%, transparent 50%)' }"
                />
              </button>
            </fieldset>
            <div v-else>
              <button
                type="button"
                :class="['flex w-full items-center gap-3 rounded-lg p-4', 'border-2 border-dashed border-neutral-200 dark:border-neutral-800', 'bg-neutral-50 dark:bg-neutral-800', 'transition-colors duration-200 ease-in-out']"
                @click="showAddDialog = true"
              >
                <div :class="['text-2xl text-primary-500 dark:text-primary-400 i-solar:add-circle-line-duotone']" />
                <div :class="['flex flex-col']">
                  <span :class="['font-medium']">{{ t('settings.pages.modules.common.providers.cloud.no_providers') }}</span>
                  <span :class="['text-sm text-neutral-400 dark:text-neutral-500']">{{ t('settings.pages.modules.common.providers.cloud.no_providers_description') }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Model selection section -->
    <div v-if="activeProvider && supportsModelListing">
      <div :class="['flex flex-col gap-4']">
        <div>
          <h2 :class="['text-lg md:text-2xl']">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
          </h2>
          <div :class="['flex flex-col items-start gap-1 text-neutral-400 md:flex-row md:items-center md:justify-between dark:text-neutral-400']">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}</span>
            <span v-if="activeModel" :class="['text-sm text-neutral-400 font-medium dark:text-neutral-400']">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.current_model_label') }} {{ activeModel }}</span>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="isLoadingActiveProviderModels" :class="['flex items-center justify-center py-4']">
          <div :class="['mr-2 animate-spin']">
            <div :class="['text-xl i-solar:spinner-line-duotone']" />
          </div>
          <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.loading') }}</span>
        </div>

        <!-- Error state -->
        <template v-else-if="activeProviderModelError">
          <ErrorContainer
            :title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.error')"
            :error="activeProviderModelError"
          />
          <div :class="['mt-2']">
            <label :class="['mb-1 block text-sm font-medium']">
              {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_name') }}
            </label>
            <input
              v-model="activeModel" type="text"
              :class="['w-full border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900']"
              :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
            >
          </div>
        </template>

        <!-- No models available -->
        <template v-else-if="providerModels.length === 0 && !isLoadingActiveProviderModels && !activeProviderModelError">
          <Alert type="warning">
            <template #title>
              {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models') }}
            </template>
            <template #content>
              {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models_description') }}
            </template>
          </Alert>
          <RadioCardManySelect
            v-model="activeModel"
            v-model:search-query="modelSearchQuery"
            :items="[]"
            :searchable="true"
            :allow-custom="true"
            :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder')"
            :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
            :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: modelSearchQuery })"
            :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
            :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder')"
            :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
            :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
            @update:custom-value="updateCustomModelName"
          />
        </template>

        <template v-else-if="providerModels.length > 0">
          <RadioCardManySelect
            v-model="activeModel"
            v-model:search-query="modelSearchQuery"
            :items="providerModels"
            :searchable="true"
            :allow-custom="true"
            :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder')"
            :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
            :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: modelSearchQuery })"
            :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
            :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder')"
            :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
            :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
            expanded-class="mb-12"
            @update:custom-value="updateCustomModelName"
          />
        </template>
      </div>
    </div>

    <!-- Provider doesn't support model listing -->
    <div v-else-if="activeProvider && !supportsModelListing">
      <div :class="['flex flex-col gap-4']">
        <div>
          <h2 :class="['text-lg text-neutral-500 md:text-2xl dark:text-neutral-400']">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
          </h2>
          <div :class="['text-neutral-400 dark:text-neutral-500']">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}</span>
          </div>
        </div>

        <div :class="['flex items-center gap-3 border border-primary-200 rounded-lg bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-900/20']">
          <div :class="['text-2xl text-primary-500 dark:text-primary-400 i-solar:info-circle-line-duotone']" />
          <div :class="['flex flex-col']">
            <span :class="['font-medium']">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.not_supported') }}</span>
            <span :class="['text-sm text-primary-600 dark:text-primary-400']">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.not_supported_description') }}</span>
          </div>
        </div>

        <div :class="['mt-2']">
          <label :class="['mb-1 block text-sm font-medium']">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_name') }}
          </label>
          <input
            v-model="activeModel" type="text"
            :class="['w-full border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900']"
            :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
          >
        </div>
      </div>
    </div>
  </div>

  <!-- Dialogs -->
  <AddProviderDialog
    v-model="showAddDialog"
    category="chat"
    :available-providers="allCloudChatProviders"
    @added="handleProviderAdded"
  />
  <EditProviderDialog
    v-model="showEditDialog"
    :provider-id="editingProviderId"
    @deleted="handleProviderDeleted"
  />

  <div
    v-motion
    :class="['text-neutral-200/50 dark:text-neutral-600/20 pointer-events-none']"
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
    size-60
    flex items-center justify-center
  >
    <div :class="['text-60 i-solar:ghost-bold-duotone']" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.consciousness.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
