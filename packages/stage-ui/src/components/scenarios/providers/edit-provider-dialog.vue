<script setup lang="ts">
import { Button, FieldInput } from '@proj-airi/ui'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProvidersStore } from '../../../stores/providers'

const props = defineProps<{
  providerId: string
}>()

const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'deleted'): void
}>()

const open = defineModel<boolean>({ default: false })

const { t } = useI18n()
const providersStore = useProvidersStore()

const apiKey = ref('')
const baseUrl = ref('')
const isSaving = ref(false)
const isTesting = ref(false)
const testResult = ref<{ valid: boolean, reason: string } | null>(null)
const showDeleteConfirm = ref(false)

watch(open, (isOpen) => {
  if (isOpen && props.providerId) {
    const config = providersStore.getProviderConfig(props.providerId)
    apiKey.value = (config?.apiKey as string) || ''
    baseUrl.value = (config?.baseUrl as string) || ''
    testResult.value = null
    showDeleteConfirm.value = false
  }
})

async function handleSave() {
  isSaving.value = true
  try {
    const config: Record<string, unknown> = {
      ...providersStore.getProviderConfig(props.providerId),
    }
    if (apiKey.value)
      config.apiKey = apiKey.value
    if (baseUrl.value)
      config.baseUrl = baseUrl.value

    providersStore.providers[props.providerId] = config
    await providersStore.validateProvider(props.providerId, { force: true })

    emit('saved')
    open.value = false
  }
  finally {
    isSaving.value = false
  }
}

async function handleTest() {
  isTesting.value = true
  testResult.value = null
  try {
    const tempConfig: Record<string, unknown> = {
      ...providersStore.getProviderConfig(props.providerId),
    }
    if (apiKey.value)
      tempConfig.apiKey = apiKey.value
    if (baseUrl.value)
      tempConfig.baseUrl = baseUrl.value

    providersStore.providers[props.providerId] = tempConfig
    const valid = await providersStore.validateProvider(props.providerId, { force: true })
    testResult.value = {
      valid,
      reason: valid ? '' : 'Validation failed. Check your credentials and base URL.',
    }
  }
  catch (err) {
    testResult.value = {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
  finally {
    isTesting.value = false
  }
}

function handleDelete() {
  providersStore.deleteProvider(props.providerId)
  emit('deleted')
  open.value = false
}

const providerName = computed(() => {
  try {
    return providersStore.getProviderMetadata(props.providerId).localizedName || props.providerId
  }
  catch {
    return props.providerId
  }
})
</script>

<template>
  <DialogRoot :open="open" @update:open="value => open = value">
    <DialogPortal>
      <DialogOverlay
        :class="[
          'fixed inset-0 z-[9999]',
          'bg-black/50 backdrop-blur-sm',
          'data-[state=closed]:animate-fadeOut',
          'data-[state=open]:animate-fadeIn',
        ]"
      />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[9999]',
          'max-h-[85dvh] max-w-lg w-[92dvw]',
          'transform overflow-y-auto rounded-2xl',
          'bg-white p-6 shadow-xl outline-none',
          'backdrop-blur-md -translate-x-1/2 -translate-y-1/2',
          'data-[state=closed]:animate-contentHide',
          'data-[state=open]:animate-contentShow',
          'dark:bg-neutral-900',
        ]"
      >
        <DialogTitle :class="['text-lg font-semibold', 'text-neutral-900 dark:text-neutral-100']">
          {{ t('settings.pages.modules.common.providers.cloud.edit.title', { provider: providerName }) }}
        </DialogTitle>
        <DialogDescription :class="['mt-1 text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.common.providers.cloud.edit.description') }}
        </DialogDescription>

        <div :class="['mt-5 flex flex-col gap-4']">
          <FieldInput
            v-model="apiKey"
            :label="t('settings.pages.modules.common.providers.cloud.dialog.api_key')"
            :description="t('settings.pages.modules.common.providers.cloud.dialog.api_key_description')"
            type="password"
            placeholder="sk-..."
          />
          <FieldInput
            v-model="baseUrl"
            :label="t('settings.pages.modules.common.providers.cloud.dialog.base_url')"
            :description="t('settings.pages.modules.common.providers.cloud.dialog.base_url_description')"
            type="text"
            placeholder="https://api.example.com/v1/"
          />

          <!-- Test result -->
          <div
            v-if="testResult"
            :class="[
              'rounded-lg border p-3 text-sm',
              testResult.valid
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400',
            ]"
          >
            <div :class="['flex items-center gap-2']">
              <div :class="[testResult.valid ? 'i-solar:check-circle-bold-duotone' : 'i-solar:close-circle-bold-duotone', 'text-lg']" />
              <span>{{ testResult.valid ? t('settings.pages.modules.common.providers.cloud.edit.test_success') : testResult.reason }}</span>
            </div>
          </div>
        </div>

        <div :class="['mt-6 flex items-center gap-3']">
          <!-- Delete section -->
          <div v-if="!showDeleteConfirm">
            <button
              type="button"
              :class="['text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300']"
              @click="showDeleteConfirm = true"
            >
              {{ t('settings.pages.modules.common.providers.cloud.edit.delete') }}
            </button>
          </div>
          <div v-else :class="['flex items-center gap-2']">
            <button
              type="button"
              :class="['rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600']"
              @click="handleDelete"
            >
              {{ t('settings.pages.modules.common.providers.cloud.edit.confirm_delete') }}
            </button>
            <button
              type="button"
              :class="['text-sm text-neutral-500 hover:text-neutral-600']"
              @click="showDeleteConfirm = false"
            >
              {{ t('settings.pages.modules.common.providers.cloud.edit.cancel_delete') }}
            </button>
          </div>

          <div :class="['ml-auto flex gap-3']">
            <Button
              variant="ghost"
              :disabled="isTesting"
              @click="handleTest"
            >
              <div v-if="isTesting" :class="['mr-2 animate-spin']">
                <div :class="['i-solar:spinner-line-duotone text-lg']" />
              </div>
              {{ t('settings.pages.modules.common.providers.cloud.edit.test') }}
            </Button>
            <DialogClose as-child>
              <Button variant="ghost">
                {{ t('settings.pages.modules.common.providers.cloud.dialog.cancel') }}
              </Button>
            </DialogClose>
            <Button
              :disabled="isSaving"
              @click="handleSave"
            >
              {{ t('settings.pages.modules.common.providers.cloud.dialog.save') }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
