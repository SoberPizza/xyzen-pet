import type { LocalAICheckPythonResult } from '@proj-airi/stage-shared/local-ai'

import type { ModelProfile } from './model-profiles'
import type { LocalAIServiceConfig } from './service-manager'

import process from 'node:process'

import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { useLogg } from '@guiiai/logg'
import { app } from 'electron'

// NOTICE: app.getAppPath() behavior varies between dev and production:
// - dev (electron-vite): usually returns project root (where package.json is)
// - production: returns the asar/app directory
// Python server scripts now live in services/local-ai-python/servers/ at the monorepo root.
// We walk up from appPath to find the monorepo root (contains pnpm-workspace.yaml).
export function findMonorepoRoot(): string {
  let dir = app.getAppPath()
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')))
      return dir
    dir = join(dir, '..')
  }
  // Fallback: assume appPath is two levels deep (apps/stage-tamagotchi)
  return join(app.getAppPath(), '..', '..')
}

function resolveScriptPath(scriptName: string): string {
  const monorepoRoot = findMonorepoRoot()
  const candidates = [
    join(monorepoRoot, 'services', 'local-ai-python', 'servers', scriptName),
    // Legacy fallback for production builds that may bundle scripts locally
    join(app.getAppPath(), 'scripts', scriptName),
  ]

  const log = useLogg('main/local-ai').useGlobalConfig()
  log.withFields({ appPath: app.getAppPath(), isDev: is.dev, monorepoRoot, candidates }).log(`Resolving ${scriptName} path`)

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

// Resolve the venv python created by services/local-ai-python postinstall.
// Falls back to system `python3` if the venv doesn't exist.
function getVenvPython(): string {
  const monorepoRoot = findMonorepoRoot()
  // NOTICE: On Windows, Node.js spawn() without shell requires the .exe extension
  // to resolve the executable. Without it the process silently fails or picks up
  // a different Python from PATH.
  const venvSubpath = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']
  const candidates = [
    join(monorepoRoot, 'services', 'local-ai-python', '.venv', ...venvSubpath),
    // Legacy fallback
    join(app.getAppPath(), '.venv', ...venvSubpath),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

// NOTICE: The official CosyVoice (FunAudioLLM) is cloned into
// services/local-ai-python/vendor/CosyVoice during setup. We add it to
// PYTHONPATH so `from cosyvoice.cli.cosyvoice` resolves correctly.
function getCosyVoiceVendorDir(): string | null {
  const monorepoRoot = findMonorepoRoot()
  const candidates = [
    join(monorepoRoot, 'services', 'local-ai-python', 'vendor', 'CosyVoice'),
    // Legacy fallback
    join(app.getAppPath(), 'vendor', 'CosyVoice'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate
  }
  return null
}

export function createCosyvoiceService(profile: ModelProfile): LocalAIServiceConfig {
  return {
    id: 'cosyvoice',
    get command() { return getVenvPython() },
    get args() {
      return [
        resolveScriptPath('cosyvoice-server.py'),
        '--port',
        '10097',
        '--device',
        profile.cosyvoice.device,
      ]
    },
    port: 10097,
    readinessProbe: () => fetch('http://localhost:10097/health')
      .then(r => r.ok)
      .catch(() => false),
    get env(): Record<string, string> {
      const vendorDir = getCosyVoiceVendorDir()
      if (!vendorDir)
        return {}
      // NOTICE: CosyVoice also needs third_party/Matcha-TTS on PYTHONPATH for the `matcha` module.
      const matchaTTSDir = join(vendorDir, 'third_party', 'Matcha-TTS')
      const paths = [vendorDir, matchaTTSDir]
      const existing = process.env.PYTHONPATH || ''
      if (existing)
        paths.push(existing)
      return { PYTHONPATH: paths.join(process.platform === 'win32' ? ';' : ':') }
    },
  }
}

export function createFunasrService(profile: ModelProfile): LocalAIServiceConfig {
  return {
    id: 'funasr',
    get command() { return getVenvPython() },
    get args() {
      // NOTICE: Server-side FSMN VAD is disabled (--vad-model defaults to '' in the
      // server). Client-side Silero VAD gates audio so only speech segments reach
      // the server. We omit --vad-model entirely because Node.js spawn() on Windows
      // drops empty-string arguments, causing argparse to misparse the command line.
      return [
        resolveScriptPath('funasr-server.py'),
        '--model',
        profile.funasr.model,
        '--device',
        profile.funasr.device,
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
}

export function checkPython(): Promise<LocalAICheckPythonResult> {
  return new Promise((resolve) => {
    // postinstall already ensures Python + funasr are available; this is a lightweight runtime check
    const pythonCmd = getVenvPython()
    exec(`${pythonCmd} -c "import funasr; print(funasr.__version__)"`, (error, stdout) => {
      if (error) {
        resolve({ pythonFound: false, funasrFound: false })
      }
      else {
        resolve({ pythonFound: true, funasrFound: true, funasrVersion: stdout.trim() })
      }
    })
  })
}
