import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import {
  localAICheckOllamaEventa,
  localAICheckPythonEventa,
  localAIConfigureOllamaEventa,
  localAIGetStatusEventa,
  localAIStartEventa,
  localAIStopEventa,
} from '@proj-airi/stage-shared/local-ai'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { detectGpu } from './gpu-detection'
import { selectProfile } from './model-profiles'
import { checkOllama, createOllamaServiceConfig, ensureOllamaModel, getOllamaServiceInfo } from './ollama-service'
import { checkPython, createCosyvoiceService, createFunasrService } from './python-services'
import { createLocalAIServiceManager } from './service-manager'

export type { LocalAIServiceConfig, LocalAIServiceManager, LocalAIServiceState } from './service-manager'

export async function setupLocalAIServiceManager() {
  const log = useLogg('main/local-ai').useGlobalConfig()
  const manager = createLocalAIServiceManager()

  const gpu = await detectGpu()
  const profile = selectProfile(gpu)
  log.withFields({ accelerator: gpu.accelerator, meetsMinimum: gpu.meetsMinimum, cudaGpuName: gpu.cudaGpuName, vramMb: gpu.vramMb }).log('GPU detection complete, selected profile')

  // Register known Python services
  manager.registerService(createFunasrService(profile))
  manager.registerService(createCosyvoiceService(profile))

  onAppBeforeQuit(async () => {
    await manager.stopAll()
  })

  // Auto-start Python services in the background. Failure is non-fatal.
  manager.start('funasr').catch((err) => {
    log.withError(err).warn('Auto-start of FunASR service failed (non-fatal)')
  })
  manager.start('cosyvoice').catch((err) => {
    log.withError(err).warn('Auto-start of CosyVoice TTS service failed (non-fatal)')
  })

  // Register Ollama as an external service for status tracking
  const ollamaInfo = getOllamaServiceInfo(profile)
  const ollamaConfig = createOllamaServiceConfig({ model: ollamaInfo.model, baseUrl: ollamaInfo.baseUrl })
  manager.registerService(ollamaConfig)

  // Check Ollama availability and ensure the model is pulled
  const ollamaStatus = await checkOllama(ollamaInfo.baseUrl)
  if (ollamaStatus.ollamaFound) {
    log.withFields({ version: ollamaStatus.version, models: ollamaStatus.models }).log('Ollama detected')
    ensureOllamaModel(ollamaInfo.model, ollamaInfo.baseUrl).then((ok) => {
      if (ok) {
        manager.start('ollama').catch((err) => {
          log.withError(err).warn('Ollama readiness check failed (non-fatal)')
        })
      }
      else {
        log.warn(`Failed to ensure Ollama model ${ollamaInfo.model} is available`)
      }
    }).catch((err) => {
      log.withError(err).warn('Failed to pull Ollama model (non-fatal)')
    })
  }
  else {
    log.warn('Ollama not detected, local LLM will not be available')
  }

  return manager
}

export function createLocalAIService(params: {
  context: ReturnType<typeof createContext>['context']
  manager: ReturnType<typeof createLocalAIServiceManager>
}) {
  defineInvokeHandler(params.context, localAIStartEventa, async (payload) => {
    await params.manager.start(payload.serviceId)
    return params.manager.getStatus(payload.serviceId)
  })

  defineInvokeHandler(params.context, localAIStopEventa, async (payload) => {
    await params.manager.stop(payload.serviceId)
    return params.manager.getStatus(payload.serviceId)
  })

  defineInvokeHandler(params.context, localAIGetStatusEventa, async () => {
    return params.manager.getAllStatuses()
  })

  defineInvokeHandler(params.context, localAICheckPythonEventa, async () => {
    return checkPython()
  })

  defineInvokeHandler(params.context, localAICheckOllamaEventa, async () => {
    return checkOllama()
  })

  defineInvokeHandler(params.context, localAIConfigureOllamaEventa, async (config) => {
    const serviceConfig = createOllamaServiceConfig(config)
    params.manager.registerService(serviceConfig)
    await params.manager.start(serviceConfig.id)
    return params.manager.getStatus(serviceConfig.id)
  })
}
