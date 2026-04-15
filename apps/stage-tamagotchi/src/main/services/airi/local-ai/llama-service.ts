import type { ModelProfile } from './model-profiles'
import type { LocalAIServiceConfig } from './service-manager'

import os, { homedir } from 'node:os'
import process from 'node:process'

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { useLogg } from '@guiiai/logg'

import { findMonorepoRoot } from './python-services'

const LLAMA_SERVER_PORT = 8080

/**
 * Recursively search for a file by name within a directory.
 * Mirrors the logic in services/local-ai-llama/setup.ts.
 */
function findFileRecursive(dir: string, name: string): string | null {
  if (!existsSync(dir))
    return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, name)
      if (found)
        return found
    }
    else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return fullPath
    }
  }
  return null
}

/**
 * Locate the llama-server binary. Checks:
 * 1. services/local-ai-llama/bin/ (downloaded by postinstall)
 * 2. PATH (macOS brew installs to /usr/local/bin or /opt/homebrew/bin)
 */
function findLlamaServerBinary(): string | null {
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const monorepoRoot = findMonorepoRoot()
  const binDir = join(monorepoRoot, 'services', 'local-ai-llama', 'bin')

  // Check local download first
  const local = findFileRecursive(binDir, exeName)
  if (local)
    return local

  // macOS/Linux: llama-server may be on PATH (installed via brew or built from source)
  if (process.platform !== 'win32')
    return 'llama-server'

  return null
}

/**
 * Resolve the path to a GGUF model file in the HuggingFace cache.
 * Cache layout: ~/.cache/huggingface/hub/models--{org}--{name}/snapshots/manual/{filename}
 */
function resolveModelPath(repo: string, filename: string): string | null {
  const cacheDir = join(
    homedir(),
    '.cache',
    'huggingface',
    'hub',
    `models--${repo.replace('/', '--')}`,
    'snapshots',
    'manual',
  )
  const modelPath = join(cacheDir, filename)
  return existsSync(modelPath) ? modelPath : null
}

/**
 * Create a LocalAIServiceConfig for llama-server, or null if the binary or model is not available.
 */
export function createLlamaService(profile: ModelProfile): LocalAIServiceConfig | null {
  const log = useLogg('main/local-ai').useGlobalConfig()

  const binary = findLlamaServerBinary()
  if (!binary) {
    log.warn('llama-server binary not found, skipping registration')
    return null
  }

  const modelPath = resolveModelPath(profile.llama.repo, profile.llama.filename)
  if (!modelPath) {
    log.withFields({ repo: profile.llama.repo, filename: profile.llama.filename })
      .warn('GGUF model not found in HuggingFace cache, skipping llama-server registration')
    return null
  }

  // Use physical CPU count for thread calculation (Electron main process has no navigator)
  const cpuCount = os.cpus().length
  const threads = Math.max(1, Math.floor(cpuCount * 0.75))

  return {
    id: 'llama-server',
    command: binary,
    args: [
      '--model',
      modelPath,
      '--port',
      String(LLAMA_SERVER_PORT),
      '--ctx-size',
      String(profile.llama.contextLength),
      '--threads',
      String(threads),
    ],
    port: LLAMA_SERVER_PORT,
    readinessProbe: () => fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/health`)
      .then(r => r.ok)
      .catch(() => false),
  }
}
