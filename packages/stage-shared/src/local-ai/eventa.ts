import { defineInvokeEventa } from '@moeru/eventa'

export interface LocalAIServiceStatus {
  serviceId: string
  state: 'stopped' | 'starting' | 'running' | 'error'
  port: number
  pid: number | null
  lastError?: string
}

export interface LocalAIStatusResult {
  services: LocalAIServiceStatus[]
}

export interface LocalAICheckPythonResult {
  pythonFound: boolean
  funasrFound: boolean
  funasrVersion?: string
}

export const localAIStartEventa = defineInvokeEventa<LocalAIServiceStatus, { serviceId: string }>('eventa:invoke:electron:local-ai:start')
export const localAIStopEventa = defineInvokeEventa<LocalAIServiceStatus, { serviceId: string }>('eventa:invoke:electron:local-ai:stop')
export const localAIGetStatusEventa = defineInvokeEventa<LocalAIStatusResult>('eventa:invoke:electron:local-ai:get-status')
export const localAICheckPythonEventa = defineInvokeEventa<LocalAICheckPythonResult>('eventa:invoke:electron:local-ai:check-python')

export interface LocalAICheckLlamaResult {
  llamaServerFound: boolean
  llamaServerPath?: string
  version?: string
}

export interface LocalAILlamaServerConfig {
  modelPath: string
  port: number
  contextLength: number
  gpuLayers: number
}

export const localAICheckLlamaEventa = defineInvokeEventa<LocalAICheckLlamaResult>('eventa:invoke:electron:local-ai:check-llama')
export const localAIConfigureLlamaEventa = defineInvokeEventa<LocalAIServiceStatus, LocalAILlamaServerConfig>('eventa:invoke:electron:local-ai:configure-llama')
