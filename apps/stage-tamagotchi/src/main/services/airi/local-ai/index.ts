import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import {
  localAICheckLlamaEventa,
  localAICheckPythonEventa,
  localAIConfigureLlamaEventa,
  localAIGetStatusEventa,
  localAIStartEventa,
  localAIStopEventa,
} from '@proj-airi/stage-shared/local-ai'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { detectGpu } from './gpu-detection'
import { checkLlama, createLlamaServerConfig, getDefaultLlamaConfig } from './llama-service'
import { selectProfile } from './model-profiles'
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

  // Auto-start services in the background. Failure is non-fatal (e.g. Python not installed).
  manager.start('funasr').catch((err) => {
    log.withError(err).warn('Auto-start of FunASR service failed (non-fatal)')
  })
  manager.start('cosyvoice').catch((err) => {
    log.withError(err).warn('Auto-start of CosyVoice TTS service failed (non-fatal)')
  })

  // Auto-start llama-server with profile-selected model configuration
  const defaultLlamaConfig = getDefaultLlamaConfig(profile)
  if (defaultLlamaConfig) {
    manager.registerService(defaultLlamaConfig)
    manager.start('llama-server').catch((err) => {
      log.withError(err).warn('Auto-start of llama-server failed (non-fatal)')
    })
  }
  else {
    log.warn('GGUF model not found in HuggingFace cache, skipping llama-server auto-start')
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

  defineInvokeHandler(params.context, localAICheckLlamaEventa, async () => {
    return checkLlama()
  })

  defineInvokeHandler(params.context, localAIConfigureLlamaEventa, async (config) => {
    const serviceConfig = createLlamaServerConfig(config)
    params.manager.registerService(serviceConfig)
    await params.manager.start(serviceConfig.id)
    return params.manager.getStatus(serviceConfig.id)
  })
}
