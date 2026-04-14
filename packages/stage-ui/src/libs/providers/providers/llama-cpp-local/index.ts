import { createChatProvider, createModelProvider, merge } from '@xsai-ext/providers/utils'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

const llamaCppLocalConfigSchema = z.object({
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('http://localhost:8080/v1/'),
})

type LlamaCppLocalConfig = z.input<typeof llamaCppLocalConfigSchema>

export const providerLlamaCppLocal = defineProvider<LlamaCppLocalConfig>({
  id: 'llama-cpp-local',
  order: 2,
  locality: 'local',
  name: 'llama.cpp (Local)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.llama-cpp-local.title'),
  description: 'llama.cpp local server',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.llama-cpp-local.description'),
  tasks: ['chat'],
  icon: 'i-carbon:machine-learning-model',
  iconColor: 'i-carbon:machine-learning-model',

  createProviderConfig: ({ t }) => llamaCppLocalConfigSchema.extend({
    baseUrl: llamaCppLocalConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return merge(
      createChatProvider({ baseURL: config.baseUrl! }),
      createModelProvider({ baseURL: config.baseUrl! }),
    )
  },

  requiresCredentials: false,

  validationRequiredWhen(config) {
    return !!config.baseUrl?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
      skipApiKeyCheck: true,
      schedule: {
        mode: 'interval',
        intervalMs: 15_000,
      },
      connectivityFailureReason: ({ errorMessage }) =>
        `Failed to reach llama-server, error: ${errorMessage}.\n\nMake sure llama-server is running. You can start it from the Consciousness module settings, or manually via: llama-server --model <path-to-gguf> --port 8080`,
      modelListFailureReason: ({ errorMessage }) =>
        `Failed to list models from llama-server, error: ${errorMessage}.\n\nMake sure llama-server is running and a model is loaded.`,
    }),
  },
})
