import type { GpuDetectionResult } from './gpu-detection'

export interface ModelProfile {
  llama: { repo: string, filename: string, contextLength: number, gpuLayers: number }
  funasr: { model: string, device: string }
  cosyvoice: { device: string }
}

export const CPU_PROFILE: ModelProfile = {
  llama: { repo: 'unsloth/Qwen3-1.7B-GGUF', filename: 'Qwen3-1.7B-Q4_K_M.gguf', contextLength: 4096, gpuLayers: 0 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu' },
}

export const METAL_PROFILE: ModelProfile = {
  llama: { repo: 'unsloth/Qwen3-1.7B-GGUF', filename: 'Qwen3-1.7B-Q4_K_M.gguf', contextLength: 4096, gpuLayers: 99 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu' },
}

// TODO: replace placeholder model names with validated larger GPU models
export const CUDA_GPU_PROFILE: ModelProfile = {
  llama: { repo: 'unsloth/Qwen3-8B-GGUF', filename: 'Qwen3-8B-Q4_K_M.gguf', contextLength: 8192, gpuLayers: 99 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cuda' },
  cosyvoice: { device: 'cuda' },
}

export function selectProfile(gpu: GpuDetectionResult): ModelProfile {
  if (gpu.accelerator === 'metal')
    return METAL_PROFILE
  if (gpu.accelerator === 'cuda' && gpu.meetsMinimum)
    return CUDA_GPU_PROFILE
  return CPU_PROFILE
}
