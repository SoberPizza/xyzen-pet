import type { ChildProcess } from 'node:child_process'

import type {
  LocalAIServiceStatus,
  LocalAIStatusResult,
} from '@proj-airi/stage-shared/local-ai'

import process from 'node:process'

import { spawn } from 'node:child_process'

import { useLogg } from '@guiiai/logg'

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

export interface LocalAIServiceEntry {
  config: LocalAIServiceConfig
  process: ChildProcess | null
  state: LocalAIServiceState
  lastError?: string
}

export interface LocalAIServiceManager {
  start: (serviceId: string) => Promise<void>
  stop: (serviceId: string) => Promise<void>
  stopAll: () => Promise<void>
  getStatus: (serviceId: string) => LocalAIServiceStatus
  getAllStatuses: () => LocalAIStatusResult
  registerService: (config: LocalAIServiceConfig) => void
}

const READINESS_PROBE_INTERVAL_MS = 1000
const READINESS_PROBE_MAX_ATTEMPTS = 60

export function createLocalAIServiceManager(): LocalAIServiceManager {
  const log = useLogg('main/local-ai').useGlobalConfig()
  const services = new Map<string, LocalAIServiceEntry>()

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
      // Early exit if process already died (e.g. Python import failure, missing model)
      if (entry.process && entry.process.exitCode !== null)
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

  return {
    start,
    stop,
    stopAll,
    getStatus,
    getAllStatuses,
    registerService,
  }
}
