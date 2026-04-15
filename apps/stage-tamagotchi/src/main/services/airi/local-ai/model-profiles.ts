import type { GpuDetectionResult } from './gpu-detection'

export interface ModelProfile {
  ollama: { model: string, contextLength: number }
  funasr: { model: string, device: string }
  cosyvoice: { device: string, model: string }
  llama: { repo: string, filename: string, contextLength: number }
}

export const CPU_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:1.7b', contextLength: 4096 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu', model: 'iic/CosyVoice-300M-SFT' },
  llama: { repo: 'unsloth/Qwen3-1.7B-GGUF', filename: 'Qwen3-1.7B-Q4_K_M.gguf', contextLength: 4096 },
}

export const METAL_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:1.7b', contextLength: 4096 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cpu', model: 'iic/CosyVoice-300M-SFT' },
  llama: { repo: 'unsloth/Qwen3-1.7B-GGUF', filename: 'Qwen3-1.7B-Q4_K_M.gguf', contextLength: 4096 },
}

export const CUDA_GPU_PROFILE: ModelProfile = {
  ollama: { model: 'qwen3:4b', contextLength: 16384 },
  funasr: { model: 'iic/SenseVoiceSmall', device: 'cpu' },
  cosyvoice: { device: 'cuda', model: 'iic/CosyVoice-300M-SFT' },
  llama: { repo: 'unsloth/Qwen3-4B-GGUF', filename: 'Qwen3-4B-Q4_K_M.gguf', contextLength: 16384 },
}

export function selectProfile(gpu: GpuDetectionResult): ModelProfile {
  if (gpu.accelerator === 'metal')
    return METAL_PROFILE
  if (gpu.accelerator === 'cuda' && gpu.meetsMinimum)
    return CUDA_GPU_PROFILE
  return CPU_PROFILE
}
