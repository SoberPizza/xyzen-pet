<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import {
  Alert,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, reactive } from 'vue'

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

          <div :class="['rounded-lg bg-neutral-100/60 p-3 text-xs text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400']">
            <p class="font-medium">
              {{ t('settings.pages.providers.provider.sensevoice-local-server.setup-title') }}
            </p>
            <ol :class="['mt-1.5 list-inside list-decimal space-y-1']">
              <li><code>pip install funasr</code></li>
              <li><code>funasr-server --model SenseVoiceSmall --port 10095</code></li>
            </ol>
          </div>
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
          v-if="credentialsReady"
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
