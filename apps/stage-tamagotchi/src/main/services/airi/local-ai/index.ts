import type { ChildProcess } from 'node:child_process'

import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  LocalAICheckLlamaResult,
  LocalAICheckPythonResult,
  LocalAILlamaServerConfig,
  LocalAIServiceStatus,
  LocalAIStatusResult,
} from '@proj-airi/stage-shared/local-ai'

import process from 'node:process'

import { exec, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
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
import { app } from 'electron'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

export type LocalAIServiceState = 'stopped' | 'starting' | 'running' | 'error'

export interface LocalAIServiceConfig {
  id: string
  command: string
  args: string[]
  port: number
  /** WebSocket readiness probe; resolves true when the service is accepting connections. */
  readinessProbe?: () => Promise<boolean>
  env?: Record<string, string>
}

interface LocalAIServiceEntry {
  config: LocalAIServiceConfig
  process: ChildProcess | null
  state: LocalAIServiceState
  lastError?: string
}

const READINESS_PROBE_INTERVAL_MS = 1000
const READINESS_PROBE_MAX_ATTEMPTS = 60

// NOTICE: app.getAppPath() behavior varies between dev and production:
// - dev (electron-vite): usually returns project root (where package.json is)
// - production: returns the asar/app directory
// We try multiple candidate paths and pick the first that exists.
function resolveScriptPath(scriptName: string): string {
  const candidates = [
    join(app.getAppPath(), 'scripts', scriptName),
    // electron-vite dev may return out/main as appPath
    join(app.getAppPath(), '..', '..', 'scripts', scriptName),
  ]

  const log = useLogg('main/local-ai').useGlobalConfig()
  log.withFields({ appPath: app.getAppPath(), isDev: is.dev, candidates }).log(`Resolving ${scriptName} path`)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      log.withFields({ resolvedPath: candidate }).log(`Found ${scriptName}`)
      return candidate
    }
  }

  // Fallback to first candidate (will produce a clear error when spawn fails)
  log.withFields({ candidates }).warn(`${scriptName} not found at any candidate path`)
  return candidates[0]
}

function getFunasrServerScript(): string {
  return resolveScriptPath('funasr-server.py')
}

function getKokoroServerScript(): string {
  return resolveScriptPath('kokoro-server.py')
}

function getCosyVoiceServerScript(): string {
  return resolveScriptPath('cosyvoice-server.py')
}

const KOKORO_SERVICE: LocalAIServiceConfig = {
  id: 'kokoro',
  command: 'python3',
  get args() {
    return [
      getKokoroServerScript(),
      '--port',
      '10096',
      '--device',
      'cpu',
    ]
  },
  port: 10096,
  readinessProbe: () => fetch('http://localhost:10096/health')
    .then(r => r.ok)
    .catch(() => false),
}

const COSYVOICE_SERVICE: LocalAIServiceConfig = {
  id: 'cosyvoice',
  command: 'python3',
  get args() {
    return [
      getCosyVoiceServerScript(),
      '--port',
      '10097',
      '--device',
      'cpu',
    ]
  },
  port: 10097,
  readinessProbe: () => fetch('http://localhost:10097/health')
    .then(r => r.ok)
    .catch(() => false),
}

const FUNASR_SERVICE: LocalAIServiceConfig = {
  id: 'funasr',
  command: 'python3',
  get args() {
    // NOTICE: --vad-model is empty to disable server-side FSMN VAD.
    // Client-side Silero VAD gates audio so only speech segments reach the server.
    return [
      getFunasrServerScript(),
      '--model',
      'iic/SenseVoiceSmall',
      '--vad-model',
      '',
      '--device',
      'cpu',
      '--port',
      '10095',
    ]
  },
  port: 10095,
  readinessProbe: () => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:10095`)
    const timeout = setTimeout(() => {
      ws.close()
      resolve(false)
    }, 3000)
    ws.onopen = () => {
      clearTimeout(timeout)
      ws.close()
      resolve(true)
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      resolve(false)
    }
  }),
}

export interface LocalAIServiceManager {
  start: (serviceId: string) => Promise<void>
  stop: (serviceId: string) => Promise<void>
  stopAll: () => Promise<void>
  getStatus: (serviceId: string) => LocalAIServiceStatus
  getAllStatuses: () => LocalAIStatusResult
  checkPython: () => Promise<LocalAICheckPythonResult>
  registerService: (config: LocalAIServiceConfig) => void
  checkLlama: () => Promise<LocalAICheckLlamaResult>
}

function createLlamaServerConfig(options: LocalAILlamaServerConfig): LocalAIServiceConfig {
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

export function createLocalAIServiceManager(): LocalAIServiceManager {
  const log = useLogg('main/local-ai').useGlobalConfig()
  const services = new Map<string, LocalAIServiceEntry>()

  // Register known services
  for (const config of [FUNASR_SERVICE, KOKORO_SERVICE, COSYVOICE_SERVICE]) {
    services.set(config.id, {
      config,
      process: null,
      state: 'stopped',
    })
  }

  function getEntry(serviceId: string): LocalAIServiceEntry {
    const entry = services.get(serviceId)
    if (!entry)
      throw new Error(`Unknown local AI service: ${serviceId}`)
    return entry
  }

  async function waitForReadiness(entry: LocalAIServiceEntry): Promise<boolean> {
    const probe = entry.config.readinessProbe
    if (!probe)
      return true

    for (let i = 0; i < READINESS_PROBE_MAX_ATTEMPTS; i++) {
      if (entry.state !== 'starting')
        return false

      const ready = await probe()
      if (ready)
        return true

      await new Promise(resolve => setTimeout(resolve, READINESS_PROBE_INTERVAL_MS))
    }
    return false
  }

  async function start(serviceId: string): Promise<void> {
    const entry = getEntry(serviceId)
    if (entry.state === 'running' || entry.state === 'starting')
      return

    entry.state = 'starting'
    entry.lastError = undefined

    log.withFields({ serviceId, command: entry.config.command, args: entry.config.args }).log('Starting local AI service')

    const child = spawn(entry.config.command, entry.config.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...entry.config.env },
      detached: false,
    })

    entry.process = child

    child.stdout?.on('data', (data) => {
      const text = data.toString('utf-8').trim()
      if (text)
        log.withFields({ serviceId }).log(text)
    })

    child.stderr?.on('data', (data) => {
      const text = data.toString('utf-8').trim()
      if (text)
        log.withFields({ serviceId }).warn(text)
    })

    child.on('exit', (code, signal) => {
      log.withFields({ serviceId, code, signal }).log('Local AI service exited')
      if (entry.state !== 'stopped') {
        entry.state = 'error'
        entry.lastError = `Process exited with code ${code}, signal ${signal}`
      }
      entry.process = null
    })

    child.on('error', (err) => {
      log.withFields({ serviceId }).withError(err).error('Failed to spawn local AI service')
      entry.state = 'error'
      entry.lastError = err.message
      entry.process = null
    })

    const ready = await waitForReadiness(entry)
    if (ready && entry.state === 'starting') {
      entry.state = 'running'
      log.withFields({ serviceId, pid: child.pid }).log('Local AI service is ready')
    }
    else if (entry.state === 'starting') {
      entry.state = 'error'
      entry.lastError = 'Readiness probe timed out'
      log.withFields({ serviceId }).warn('Local AI service readiness probe timed out')
    }
  }

  async function stop(serviceId: string): Promise<void> {
    const entry = getEntry(serviceId)
    if (!entry.process)
      return

    entry.state = 'stopped'
    const child = entry.process
    entry.process = null

    child.kill('SIGTERM')

    // Wait briefly for graceful shutdown, then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5000)

      child.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  async function stopAll(): Promise<void> {
    const ids = [...services.keys()]
    await Promise.all(ids.map(id => stop(id)))
  }

  function getStatus(serviceId: string): LocalAIServiceStatus {
    const entry = getEntry(serviceId)
    return {
      serviceId: entry.config.id,
      state: entry.state,
      port: entry.config.port,
      pid: entry.process?.pid ?? null,
      lastError: entry.lastError,
    }
  }

  function getAllStatuses(): LocalAIStatusResult {
    return {
      services: [...services.values()].map(entry => ({
        serviceId: entry.config.id,
        state: entry.state,
        port: entry.config.port,
        pid: entry.process?.pid ?? null,
        lastError: entry.lastError,
      })),
    }
  }

  function checkPython(): Promise<LocalAICheckPythonResult> {
    return new Promise((resolve) => {
      // postinstall already ensures Python + funasr are available; this is a lightweight runtime check
      const tryCandidate = (cmd: string, fallback?: () => void) => {
        exec(`${cmd} -c "import funasr; print(funasr.__version__)"`, (error, stdout) => {
          if (error) {
            if (fallback)
              fallback()
            else
              resolve({ pythonFound: false, funasrFound: false })
          }
          else {
            resolve({ pythonFound: true, funasrFound: true, funasrVersion: stdout.trim() })
          }
        })
      }
      tryCandidate('python3', () => tryCandidate('python'))
    })
  }

  function registerService(config: LocalAIServiceConfig): void {
    const existing = services.get(config.id)
    if (existing?.process) {
      // Stop the running process before re-registering
      existing.process.kill('SIGTERM')
      existing.process = null
    }
    services.set(config.id, {
      config,
      process: null,
      state: 'stopped',
    })
    log.withFields({ serviceId: config.id }).log('Registered local AI service')
  }

  function checkLlama(): Promise<LocalAICheckLlamaResult> {
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

  return {
    start,
    stop,
    stopAll,
    getStatus,
    getAllStatuses,
    checkPython,
    registerService,
    checkLlama,
  }
}

export function setupLocalAIServiceManager(): LocalAIServiceManager {
  const log = useLogg('main/local-ai').useGlobalConfig()
  const manager = createLocalAIServiceManager()

  onAppBeforeQuit(async () => {
    await manager.stopAll()
  })

  // Auto-start services in the background. Failure is non-fatal (e.g. Python not installed).
  manager.start('funasr').catch((err) => {
    log.withError(err).warn('Auto-start of FunASR service failed (non-fatal)')
  })
  manager.start('kokoro').catch((err) => {
    log.withError(err).warn('Auto-start of Kokoro TTS service failed (non-fatal)')
  })
  manager.start('cosyvoice').catch((err) => {
    log.withError(err).warn('Auto-start of CosyVoice TTS service failed (non-fatal)')
  })

  // Auto-start llama-server with default Qwen3-1.7B configuration
  const defaultLlamaConfig = createLlamaServerConfig({
    modelPath: 'Qwen3-1.7B-Q4_K_M.gguf',
    port: 8080,
    contextLength: 4096,
    gpuLayers: 0,
  })
  manager.registerService(defaultLlamaConfig)
  manager.start('llama-server').catch((err) => {
    log.withError(err).warn('Auto-start of llama-server failed (non-fatal)')
  })

  return manager
}

export function createLocalAIService(params: {
  context: ReturnType<typeof createContext>['context']
  manager: LocalAIServiceManager
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
    return params.manager.checkPython()
  })

  defineInvokeHandler(params.context, localAICheckLlamaEventa, async () => {
    return params.manager.checkLlama()
  })

  defineInvokeHandler(params.context, localAIConfigureLlamaEventa, async (config) => {
    const serviceConfig = createLlamaServerConfig(config)
    params.manager.registerService(serviceConfig)
    await params.manager.start(serviceConfig.id)
    return params.manager.getStatus(serviceConfig.id)
  })
}
