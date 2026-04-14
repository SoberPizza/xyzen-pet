<script setup lang="ts">
import type {
  LocalAICheckPythonResult,
  LocalAIServiceStatus,
  LocalAIStatusResult,
} from '@proj-airi/stage-shared/local-ai'
import type { RemovableRef } from '@vueuse/core'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  localAICheckPythonEventa,
  localAIGetStatusEventa,
  localAIStartEventa,
  localAIStopEventa,
} from '@proj-airi/stage-shared/local-ai'
import {
  Alert,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

const providerId = 'sensevoice-local-server'

const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }

providersStore.initializeProvider(providerId)

const credentials = reactive({
  get baseUrl() {
    return providers.value[providerId]?.baseUrl || 'ws://localhost:10095'
  },
  set baseUrl(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].baseUrl = value
  },
})

function ensureProviderCredentials() {
  if (!providers.value[providerId]) {
    providers.value[providerId] = {
      baseUrl: 'ws://localhost:10095',
    }
  }
}

const credentialsReady = computed(() => {
  const url = credentials.baseUrl.trim()
  return Boolean(url && (url.startsWith('ws://') || url.startsWith('wss://')))
})

const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
} = useProviderValidation(providerId)

// Local AI service management (Electron only)
const isElectron = typeof window !== 'undefined' && isElectronWindow(window)
const serviceStatus = ref<LocalAIServiceStatus | null>(null)
const pythonCheck = ref<LocalAICheckPythonResult | null>(null)
const isCheckingPython = ref(false)
const isTogglingService = ref(false)

let invokeStart: ((payload: { serviceId: string }) => Promise<LocalAIServiceStatus>) | undefined
let invokeStop: ((payload: { serviceId: string }) => Promise<LocalAIServiceStatus>) | undefined
let invokeGetStatus: (() => Promise<LocalAIStatusResult>) | undefined
let invokeCheckPython: (() => Promise<LocalAICheckPythonResult>) | undefined
let statusPollTimer: ReturnType<typeof setInterval> | undefined

if (isElectron) {
  const { context } = createContext((window as any).electron.ipcRenderer)
  invokeStart = defineInvoke(context, localAIStartEventa)
  invokeStop = defineInvoke(context, localAIStopEventa)
  invokeGetStatus = defineInvoke(context, localAIGetStatusEventa)
  invokeCheckPython = defineInvoke(context, localAICheckPythonEventa)
}

async function refreshStatus() {
  if (!invokeGetStatus)
    return
  try {
    const result = await invokeGetStatus()
    serviceStatus.value = result.services.find(s => s.serviceId === 'funasr') ?? null
  }
  catch (err) {
    console.warn('[SenseVoice] Failed to get service status:', err)
  }
}

async function checkPythonEnv() {
  if (!invokeCheckPython)
    return
  isCheckingPython.value = true
  try {
    pythonCheck.value = await invokeCheckPython()
  }
  catch (err) {
    console.warn('[SenseVoice] Failed to check Python:', err)
  }
  finally {
    isCheckingPython.value = false
  }
}

async function handleStartService() {
  if (!invokeStart)
    return
  isTogglingService.value = true
  try {
    serviceStatus.value = await invokeStart({ serviceId: 'funasr' })
  }
  catch (err) {
    console.error('[SenseVoice] Failed to start FunASR:', err)
  }
  finally {
    isTogglingService.value = false
  }
}

async function handleStopService() {
  if (!invokeStop)
    return
  isTogglingService.value = true
  try {
    serviceStatus.value = await invokeStop({ serviceId: 'funasr' })
  }
  catch (err) {
    console.error('[SenseVoice] Failed to stop FunASR:', err)
  }
  finally {
    isTogglingService.value = false
  }
}

const isServiceRunning = computed(() => serviceStatus.value?.state === 'running')
const isServiceStarting = computed(() => serviceStatus.value?.state === 'starting')

onMounted(() => {
  if (isElectron) {
    refreshStatus()
    checkPythonEnv()
    statusPollTimer = setInterval(refreshStatus, 3000)
  }
})

onUnmounted(() => {
  if (statusPollTimer)
    clearInterval(statusPollTimer)
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <div :class="['flex flex-col gap-6']">
      <ProviderSettingsContainer :class="['w-full space-y-6']">
        <ProviderBasicSettings
          :title="t('settings.pages.providers.common.section.basic.title')"
          :description="t('settings.pages.providers.common.section.basic.description')"
          :on-reset="handleResetSettings"
        >
          <FieldInput
            v-model="credentials.baseUrl"
            :label="t('settings.pages.providers.provider.sensevoice-local-server.url-label')"
            placeholder="ws://localhost:10095"
          />

          <!-- Electron: FunASR service controls -->
          <template v-if="isElectron">
            <!-- Python environment status -->
            <div :class="['rounded-lg bg-neutral-100/60 p-3 text-xs dark:bg-neutral-800/40']">
              <p :class="['font-medium text-neutral-600 dark:text-neutral-300']">
                {{ t('settings.pages.providers.provider.sensevoice-local-server.python-check') }}
              </p>
              <div :class="['mt-1.5']">
                <template v-if="isCheckingPython">
                  <span :class="['text-neutral-500 dark:text-neutral-400']">
                    {{ t('settings.pages.providers.provider.sensevoice-local-server.checking-python') }}
                  </span>
                </template>
                <template v-else-if="pythonCheck?.funasrFound">
                  <span :class="['text-green-600 dark:text-green-400']">
                    {{ t('settings.pages.providers.provider.sensevoice-local-server.env-ready', { version: pythonCheck.funasrVersion ?? '' }) }}
                  </span>
                </template>
                <template v-else>
                  <span :class="['text-amber-600 dark:text-amber-400']">
                    {{ t('settings.pages.providers.provider.sensevoice-local-server.env-not-ready') }}
                  </span>
                </template>
              </div>
            </div>

            <!-- Service status and controls -->
            <div
              :class="['rounded-lg border p-3', {
                'border-green-200/80 bg-green-50/60 dark:border-green-700/40 dark:bg-green-900/20': isServiceRunning,
                'border-amber-200/80 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/20': isServiceStarting,
                'border-neutral-200/80 bg-neutral-50/60 dark:border-neutral-700/40 dark:bg-neutral-800/40': !isServiceRunning && !isServiceStarting,
              }]"
            >
              <div :class="['flex items-center justify-between']">
                <div :class="['flex items-center gap-2']">
                  <span
                    :class="['inline-block h-2 w-2 rounded-full', {
                      'bg-green-500': isServiceRunning,
                      'bg-amber-500 animate-pulse': isServiceStarting,
                      'bg-red-500': serviceStatus?.state === 'error',
                      'bg-neutral-400': !serviceStatus || serviceStatus.state === 'stopped',
                    }]"
                  />
                  <span
                    :class="['text-sm font-medium', {
                      'text-green-700 dark:text-green-300': isServiceRunning,
                      'text-amber-700 dark:text-amber-300': isServiceStarting,
                      'text-red-700 dark:text-red-300': serviceStatus?.state === 'error',
                      'text-neutral-600 dark:text-neutral-400': !serviceStatus || serviceStatus.state === 'stopped',
                    }]"
                  >
                    <template v-if="isServiceRunning">
                      {{ t('settings.pages.providers.provider.sensevoice-local-server.service-running') }}
                    </template>
                    <template v-else-if="isServiceStarting">
                      {{ t('settings.pages.providers.provider.sensevoice-local-server.service-starting') }}
                    </template>
                    <template v-else-if="serviceStatus?.state === 'error'">
                      {{ t('settings.pages.providers.provider.sensevoice-local-server.service-error', { error: serviceStatus.lastError ?? '' }) }}
                    </template>
                    <template v-else>
                      {{ t('settings.pages.providers.provider.sensevoice-local-server.service-stopped') }}
                    </template>
                  </span>
                </div>

                <Button
                  v-if="!isServiceStarting"
                  :disabled="isTogglingService || (!pythonCheck?.funasrFound && !isServiceRunning)"
                  size="sm"
                  :variant="isServiceRunning ? 'secondary' : 'primary'"
                  @click="isServiceRunning ? handleStopService() : handleStartService()"
                >
                  {{ isServiceRunning
                    ? t('settings.pages.providers.provider.sensevoice-local-server.stop-service')
                    : t('settings.pages.providers.provider.sensevoice-local-server.start-service')
                  }}
                </Button>
              </div>
            </div>
          </template>

          <!-- Web: manual setup instructions -->
          <template v-else>
            <div :class="['rounded-lg bg-neutral-100/60 p-3 text-xs text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400']">
              <p class="font-medium">
                {{ t('settings.pages.providers.provider.sensevoice-local-server.setup-title') }}
              </p>
              <ol :class="['mt-1.5 list-inside list-decimal space-y-1']">
                <li><code>pip install funasr</code></li>
                <li><code>funasr-server --model SenseVoiceSmall --port 10095</code></li>
              </ol>
            </div>
          </template>
        </ProviderBasicSettings>

        <Alert v-if="!isValid && isValidating === 0 && validationMessage" type="error">
          <template #title>
            <div :class="['w-full flex items-center justify-between']">
              <span>{{ t('settings.dialogs.onboarding.validationFailed') }}</span>
              <button
                type="button"
                :class="[
                  'ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-600 font-medium',
                  'transition-colors dark:bg-red-800/30 hover:bg-red-200 dark:text-red-300 dark:hover:bg-red-700/40',
                ]"
                @click="forceValid"
              >
                {{ t('settings.pages.providers.common.continueAnyway') }}
              </button>
            </div>
          </template>
          <template #content>
            <div :class="['whitespace-pre-wrap break-all']">
              {{ validationMessage }}
            </div>
          </template>
        </Alert>

        <Alert v-if="isValid && isValidating === 0" type="success">
          <template #title>
            {{ t('settings.dialogs.onboarding.validationSuccess') }}
          </template>
        </Alert>

        <div
          v-if="credentialsReady && !isElectron"
          :class="[
            'flex items-center gap-2 rounded-lg border border-green-200/80 bg-green-50/60 px-3 py-2',
            'text-sm text-green-700 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-300',
          ]"
        >
          <span :class="['inline-block h-2 w-2 rounded-full bg-green-500']" />
          {{ t('settings.pages.providers.provider.sensevoice-local-server.ready') }}
        </div>
      </ProviderSettingsContainer>
    </div>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
