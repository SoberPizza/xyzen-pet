import type {
  LocalAICheckLlamaResult,
  LocalAILlamaServerConfig,
} from '@proj-airi/stage-shared/local-ai'

import type { ModelProfile } from './model-profiles'
import type { LocalAIServiceConfig } from './service-manager'

import { exec } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Resolve a model filename to its absolute path in the HuggingFace cache.
// HF cache layout: ~/.cache/huggingface/hub/models--{org}--{name}/snapshots/{hash}/{filename}
export function resolveHuggingFaceModelPath(repo: string, filename: string): string | null {
  const cacheDir = join(homedir(), '.cache', 'huggingface', 'hub', `models--${repo.replace('/', '--')}`)
  const snapshotsDir = join(cacheDir, 'snapshots')
  if (!existsSync(snapshotsDir))
    return null

  const snapshots = readdirSync(snapshotsDir)
  for (const snapshot of snapshots) {
    const candidate = join(snapshotsDir, snapshot, filename)
    if (existsSync(candidate))
      return candidate
  }
  return null
}

export function createLlamaServerConfig(options: LocalAILlamaServerConfig): LocalAIServiceConfig {
  return {
    id: 'llama-server',
    command: 'llama-server',
    args: [
      '--model',
      options.modelPath,
      '--port',
      String(options.port),
      '--ctx-size',
      String(options.contextLength),
      '--n-gpu-layers',
      String(options.gpuLayers),
      '--host',
      '127.0.0.1',
    ],
    port: options.port,
    readinessProbe: () => fetch(`http://127.0.0.1:${options.port}/health`)
      .then(res => res.ok)
      .catch(() => false),
  }
}

/** Check if llama-server binary is installed and return its version info. */
export function checkLlama(): Promise<LocalAICheckLlamaResult> {
  return new Promise((resolve) => {
    exec('which llama-server', (error, stdout) => {
      if (error) {
        resolve({ llamaServerFound: false })
        return
      }
      const llamaServerPath = stdout.trim()
      exec('llama-server --version', (versionError, versionStdout) => {
        resolve({
          llamaServerFound: true,
          llamaServerPath,
          version: versionError ? undefined : versionStdout.trim(),
        })
      })
    })
  })
}

/** Resolve model from HF cache using the given profile and return a llama-server config, or null if not found. */
export function getDefaultLlamaConfig(profile: ModelProfile): LocalAIServiceConfig | null {
  const resolvedModelPath = resolveHuggingFaceModelPath(profile.llama.repo, profile.llama.filename)
  if (!resolvedModelPath)
    return null

  return createLlamaServerConfig({
    modelPath: resolvedModelPath,
    port: 8080,
    contextLength: profile.llama.contextLength,
    gpuLayers: profile.llama.gpuLayers,
  })
}
