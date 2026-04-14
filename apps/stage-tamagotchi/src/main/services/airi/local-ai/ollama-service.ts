import type {
  LocalAICheckOllamaResult,
  LocalAIOllamaConfig,
} from '@proj-airi/stage-shared/local-ai'

import type { ModelProfile } from './model-profiles'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'

/** Check if Ollama is reachable and return version + available models. */
export async function checkOllama(baseUrl = DEFAULT_BASE_URL): Promise<LocalAICheckOllamaResult> {
  try {
    const [versionRes, modelsRes] = await Promise.all([
      fetch(`${baseUrl}/api/version`).then(r => r.json() as Promise<{ version: string }>),
      fetch(`${baseUrl}/api/tags`).then(r => r.json() as Promise<{ models: Array<{ name: string }> }>),
    ])

    return {
      ollamaFound: true,
      version: versionRes.version,
      models: modelsRes.models.map(m => m.name),
    }
  }
  catch {
    return { ollamaFound: false }
  }
}

/** Ensure a model is available in Ollama, pulling it if necessary. */
export async function ensureOllamaModel(model: string, baseUrl = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    // Check if model already exists
    const res = await fetch(`${baseUrl}/api/tags`)
    const data = await res.json() as { models: Array<{ name: string }> }
    const exists = data.models.some(m => m.name === model || m.name.startsWith(`${model}:`))
    if (exists)
      return true

    // Pull the model — this is a streaming endpoint, wait for completion
    const pullRes = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    })

    if (!pullRes.ok || !pullRes.body)
      return false

    // Consume the stream to completion
    const reader = pullRes.body.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done)
        break
    }

    return true
  }
  catch {
    return false
  }
}

/** Build the Ollama service info for the service manager (no process spawning needed). */
export function getOllamaServiceInfo(profile: ModelProfile, baseUrl = DEFAULT_BASE_URL) {
  return {
    model: profile.ollama.model,
    baseUrl,
    contextLength: profile.ollama.contextLength,
  }
}

/** Create an Ollama service config compatible with LocalAIServiceConfig for status tracking. */
export function createOllamaServiceConfig(config: LocalAIOllamaConfig) {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL
  const url = new URL(baseUrl)
  const port = Number.parseInt(url.port) || 11434

  return {
    id: 'ollama',
    // Ollama runs externally — no command to spawn
    command: '',
    args: [] as string[],
    port,
    readinessProbe: () => fetch(`${baseUrl}/api/tags`)
      .then(res => res.ok)
      .catch(() => false),
  }
}
