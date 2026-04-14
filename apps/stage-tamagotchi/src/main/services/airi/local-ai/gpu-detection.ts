import process from 'node:process'

import { exec } from 'node:child_process'

export interface GpuDetectionResult {
  accelerator: 'cuda' | 'metal' | 'cpu'
  cudaGpuName?: string
  vramMb?: number
  meetsMinimum: boolean
}

let cached: GpuDetectionResult | null = null

// Detect GPU capabilities. Result is cached for the session lifetime.
export async function detectGpu(): Promise<GpuDetectionResult> {
  if (cached)
    return cached

  cached = await detectGpuUncached()
  return cached
}

async function detectGpuUncached(): Promise<GpuDetectionResult> {
  // macOS Apple Silicon → Metal acceleration
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { accelerator: 'metal', meetsMinimum: true }
  }

  // Linux/Windows → probe nvidia-smi for CUDA GPU info
  if (process.platform === 'linux' || process.platform === 'win32') {
    try {
      const result = await runNvidiaSmi()
      if (result)
        return result
    }
    catch {
      // nvidia-smi failed or timed out → fall through to CPU
    }
  }

  return { accelerator: 'cpu', meetsMinimum: false }
}

function runNvidiaSmi(): Promise<GpuDetectionResult | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 3000)

    const child = exec(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      (error, stdout) => {
        clearTimeout(timeout)
        if (error || !stdout.trim()) {
          resolve(null)
          return
        }

        // Parse CSV lines: "GPU Name, VRAM_MB" per GPU. Pick the one with most VRAM.
        let bestName = ''
        let bestVram = 0

        for (const line of stdout.trim().split('\n')) {
          const parts = line.split(',').map(s => s.trim())
          if (parts.length < 2)
            continue
          const name = parts[0]
          const vram = Number.parseInt(parts[1], 10)
          if (!Number.isNaN(vram) && vram > bestVram) {
            bestName = name
            bestVram = vram
          }
        }

        if (bestVram === 0) {
          resolve(null)
          return
        }

        resolve({
          accelerator: 'cuda',
          cudaGpuName: bestName,
          vramMb: bestVram,
          meetsMinimum: bestVram >= 8192,
        })
      },
    )
  })
}
