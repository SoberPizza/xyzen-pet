import { errorMessageFrom } from '@moeru/std'
import { createChatProvider, createModelProvider, merge } from '@xsai-ext/providers/utils'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

const V1_SUFFIX_RE = /\/v1\/?$/

const llamaCppLocalConfigSchema = z.object({
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('http://localhost:8080/v1/'),
})

type LlamaCppLocalConfig = z.input<typeof llamaCppLocalConfigSchema>

const chatCompletionsValidators = createOpenAICompatibleValidators<LlamaCppLocalConfig>({
  checks: [ProviderValidationCheck.ChatCompletions],
  skipApiKeyCheck: true,
  schedule: {
    mode: 'interval',
    intervalMs: 15_000,
  },
})!.validateProvider ?? []

export const providerLlamaCppLocal = defineProvider<LlamaCppLocalConfig>({
  id: 'llama-cpp-local',
  order: 2,
  locality: 'local',
  name: 'llama.cpp (Local)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.llama-cpp-local.title'),
  description: 'llama.cpp local server',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.llama-cpp-local.description'),
  tasks: ['chat'],
  // NOTICE: Small local models (e.g. Qwen3-1.7B) cannot handle tool calling —
  // they output raw tool descriptions as conversation text instead of issuing
  // structured tool calls. Disable tools by default for llama.cpp local server.
  supportsTools: false,
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
      checks: [ProviderValidationCheck.ChatCompletions],
      skipApiKeyCheck: true,
      schedule: {
        mode: 'interval',
        intervalMs: 15_000,
      },
      connectivityFailureReason: ({ errorMessage }) =>
        `Failed to reach llama-server, error: ${errorMessage}.\n\nMake sure llama-server is running. You can start it from the Consciousness module settings, or manually via: llama-server --model <path-to-gguf> --port 8080`,
    }),
    // Custom /health validator replacing Connectivity + ModelList checks.
    // llama-server exposes /health but returns 404 on /v1/models.
    validateProvider: [
      ({ t }) => ({
        id: 'llama-cpp-local:check-health',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-connectivity.title'),
        schedule: {
          mode: 'interval' as const,
          intervalMs: 15_000,
        },
        validator: async (config: LlamaCppLocalConfig) => {
          const errors: Array<{ error: unknown }> = []
          // Derive /health URL from baseUrl by stripping /v1/ suffix
          const baseUrl = String(config.baseUrl ?? 'http://localhost:8080/v1/')
          const healthUrl = `${baseUrl.replace(V1_SUFFIX_RE, '')}/health`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)

          try {
            const response = await fetch(healthUrl, {
              method: 'GET',
              signal: controller.signal,
            })

            if (!response.ok) {
              const errorMessage = `llama-server health check failed: HTTP ${response.status}`
              errors.push({ error: new Error(
                `Failed to reach llama-server, error: ${errorMessage}.\n\nMake sure llama-server is running. You can start it from the Consciousness module settings, or manually via: llama-server --model <path-to-gguf> --port 8080`,
              ) })
            }
          }
          catch (e) {
            const errorMessage = errorMessageFrom(e) ?? 'Unknown error'
            errors.push({ error: new Error(
              `Failed to reach llama-server, error: ${errorMessage}.\n\nMake sure llama-server is running. You can start it from the Consciousness module settings, or manually via: llama-server --model <path-to-gguf> --port 8080`,
            ) })
          }
          finally {
            clearTimeout(timeout)
          }

          return {
            errors,
            reason: errors.length > 0 ? errors.map(item => (item.error as Error).message).join(', ') : '',
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
      // Keep ChatCompletions check from openai-compatible validators
      ...chatCompletionsValidators,
    ],
  },
})
