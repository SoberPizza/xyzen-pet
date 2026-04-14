import type { GpuDetectionResult } from './gpu-detection'

export interface ModelProfile {
  ollama: { model: string, contextLength: number }
  funasr: { model: string, device: string }
  cosyvoice: { device: string }
}

export const CPU_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:1.7b', contextLength: 4096 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu' },
}

export const METAL_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:1.7b', contextLength: 4096 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu' },
}

export const CUDA_GPU_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:4b', contextLength: 16384 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cuda' },
}

export function selectProfile(gpu: GpuDetectionResult): ModelProfile {
  if (gpu.accelerator === 'metal')
    return METAL_PROFILE
  if (gpu.accelerator === 'cuda' && gpu.meetsMinimum)
    return CUDA_GPU_PROFILE
  return CPU_PROFILE
}
