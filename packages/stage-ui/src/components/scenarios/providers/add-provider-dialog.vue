<script setup lang="ts">
import type { ProviderMetadata } from '../../../stores/providers'

import { Button, FieldInput } from '@proj-airi/ui'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProvidersStore } from '../../../stores/providers'

const props = defineProps<{
  category: 'chat' | 'speech' | 'transcription'
  availableProviders: ProviderMetadata[]
}>()

const emit = defineEmits<{
  (e: 'added', providerId: string): void
}>()

const open = defineModel<boolean>({ default: false })

const { t } = useI18n()
const providersStore = useProvidersStore()

const selectedProviderId = ref('')
const apiKey = ref('')
const baseUrl = ref('')
const isSaving = ref(false)

const selectedProvider = ref<ProviderMetadata | null>(null)

watch(selectedProviderId, (id) => {
  const provider = props.availableProviders.find(p => p.id === id)
  selectedProvider.value = provider || null
  if (provider) {
    const defaults = provider.defaultOptions?.() || {}
    baseUrl.value = (defaults.baseUrl as string) || ''
    apiKey.value = ''
  }
})

watch(open, (isOpen) => {
  if (!isOpen) {
    selectedProviderId.value = ''
    apiKey.value = ''
    baseUrl.value = ''
    isSaving.value = false
    selectedProvider.value = null
  }
})

async function handleSave() {
  if (!selectedProviderId.value)
    return

  isSaving.value = true

  try {
    const providerId = selectedProviderId.value

    providersStore.initializeProvider(providerId)

    const config: Record<string, unknown> = {}
    if (apiKey.value)
      config.apiKey = apiKey.value
    if (baseUrl.value)
      config.baseUrl = baseUrl.value

    providersStore.providers[providerId] = {
      ...providersStore.getProviderConfig(providerId),
      ...config,
    }

    providersStore.markProviderAdded(providerId)

    await providersStore.validateProvider(providerId, { force: true })

    emit('added', providerId)
    open.value = false
  }
  finally {
    isSaving.value = false
  }
}
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
          {{ t('settings.pages.modules.common.providers.cloud.dialog.title') }}
        </DialogTitle>
        <DialogDescription :class="['mt-1 text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.common.providers.cloud.dialog.description') }}
        </DialogDescription>

        <div :class="['mt-5 flex flex-col gap-4']">
          <!-- Provider selection -->
          <div>
            <label :class="['mb-1.5 block text-sm font-medium', 'text-neutral-700 dark:text-neutral-300']">
              {{ t('settings.pages.modules.common.providers.cloud.dialog.select_provider') }}
            </label>
            <div :class="['grid gap-2', availableProviders.length > 4 ? 'max-h-48 overflow-y-auto' : '']">
              <button
                v-for="provider in availableProviders"
                :key="provider.id"
                type="button"
                :class="[
                  'flex items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors',
                  selectedProviderId === provider.id
                    ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                    : 'border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:border-neutral-600',
                ]"
                @click="selectedProviderId = provider.id"
              >
                <div
                  v-if="provider.icon"
                  :class="[provider.icon, 'text-xl shrink-0']"
                />
                <div
                  v-else-if="provider.iconColor"
                  :class="[provider.iconColor, 'text-xl shrink-0']"
                />
                <div :class="['flex flex-col min-w-0']">
                  <span :class="['text-sm font-medium truncate', 'text-neutral-800 dark:text-neutral-200']">
                    {{ provider.localizedName || provider.name }}
                  </span>
                  <span :class="['text-xs truncate', 'text-neutral-400 dark:text-neutral-500']">
                    {{ provider.localizedDescription || provider.description }}
                  </span>
                </div>
              </button>
            </div>
          </div>

          <!-- Configuration fields -->
          <template v-if="selectedProvider">
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
              :placeholder="(selectedProvider.defaultOptions?.()?.baseUrl as string) || 'https://api.example.com/v1/'"
            />
          </template>
        </div>

        <div :class="['mt-6 flex justify-end gap-3']">
          <DialogClose as-child>
            <Button variant="ghost">
              {{ t('settings.pages.modules.common.providers.cloud.dialog.cancel') }}
            </Button>
          </DialogClose>
          <Button
            :disabled="!selectedProviderId || isSaving"
            @click="handleSave"
          >
            <div v-if="isSaving" :class="['mr-2 animate-spin']">
              <div :class="['i-solar:spinner-line-duotone text-lg']" />
            </div>
            {{ t('settings.pages.modules.common.providers.cloud.dialog.save') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
