/* eslint-disable no-console */

import process from 'node:process'

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FUNASR_MODELS = [
  'iic/SenseVoiceSmall',
  'iic/speech_fsmn_vad_zh-cn-16k-common-pytorch',
]

// NOTICE: PyPI downloads from China are extremely slow without a mirror.
// Using TUNA mirror which is one of the most reliable Chinese PyPI mirrors.
const PYPI_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple'

const MIN_PYTHON_VERSION = [3, 10] as const
const PYTHON_VERSION_RE = /Python\s+(\d+)\.(\d+)/i

// NOTICE: setup.ts runs from the service directory via pnpm postinstall.
// We use the script's own location to reliably locate the service root.
const SCRIPT_DIR = typeof __dirname !== 'undefined' ? __dirname : dirname(new URL(import.meta.url).pathname)
const SERVICE_ROOT = SCRIPT_DIR
const VENV_DIR = join(SERVICE_ROOT, '.venv')

/** Quiet exec — buffers output, good for quick checks. */
function exec(command: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 600_000 }, (error, stdout, stderr) => {
      if (error)
        reject(error)
      else
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** Streaming spawn — pipes stdout/stderr to the terminal so the user sees real-time progress. */
function spawn(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 600_000,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0)
        resolve()
      else
        reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

// --- Python venv ---

/** Find a system Python >= MIN_PYTHON_VERSION. */
async function findSystemPython(): Promise<string> {
  for (const candidate of ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python']) {
    try {
      const { stdout } = await exec(candidate, ['--version'])
      const match = stdout.match(PYTHON_VERSION_RE)
      if (!match)
        continue
      const [major, minor] = [Number(match[1]), Number(match[2])]
      if (major < MIN_PYTHON_VERSION[0] || (major === MIN_PYTHON_VERSION[0] && minor < MIN_PYTHON_VERSION[1])) {
        console.warn(`[setup] ${candidate} is ${stdout.trim()}, need >= ${MIN_PYTHON_VERSION.join('.')}. Skipping.`)
        continue
      }
      console.log(`[setup] Found ${candidate}: ${stdout.trim()}`)
      return candidate
    }
    catch {
      // candidate not available, try next
    }
  }

  console.error(`[setup] Python >= ${MIN_PYTHON_VERSION.join('.')} is required but not found.`)
  console.error('[setup] Please install Python 3.10+ and ensure it is on your PATH.')
  console.error('[setup] macOS: brew install python@3.12')
  process.exit(1)
}

/** Return the venv python path. On Windows it lives in Scripts/, everywhere else bin/. */
function getVenvPython(): string {
  return process.platform === 'win32'
    ? join(VENV_DIR, 'Scripts', 'python')
    : join(VENV_DIR, 'bin', 'python')
}

/** Create a venv (if it doesn't already exist) and return the venv python path. */
async function ensureVenv(): Promise<string> {
  const venvPython = getVenvPython()

  if (existsSync(venvPython)) {
    console.log(`[setup] Python venv already exists at ${VENV_DIR}`)
    return venvPython
  }

  const systemPython = await findSystemPython()
  console.log(`[setup] Creating Python venv at ${VENV_DIR} ...`)
  await spawn(systemPython, ['-m', 'venv', VENV_DIR])
  console.log('[setup] Python venv created.')

  // Upgrade pip inside the venv
  await spawn(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', '-i', PYPI_MIRROR])

  return venvPython
}

// --- pip install ---

async function pipInstall(python: string): Promise<void> {
  try {
    // Quick check: if funasr is already importable, skip the full install
    await exec(python, ['-c', `import funasr; print(funasr.__version__)`])
    console.log('[setup] Python dependencies already installed, skipping pip install.')
    return
  }
  catch {
    // not installed or missing dependencies
  }

  const requirementsFile = join(SERVICE_ROOT, 'requirements.txt')
  console.log('[setup] Installing Python dependencies from requirements.txt...')
  try {
    await spawn(python, ['-m', 'pip', 'install', '--progress-bar', 'on', '-i', PYPI_MIRROR, '-r', requirementsFile])
    console.log('[setup] pip install completed.')
  }
  catch (error) {
    console.error('[setup] Failed to install dependencies:', error)
    process.exit(1)
  }
}

// --- Model downloads ---

function downloadModelScript(model: string): string {
  // NOTICE: modelscope ProgressCallback API uses update(chunk_size) and end(),
  // see modelscope/hub/callback.py for the interface.
  return `
import os; os.environ['MODELSCOPE_HUB_FILE_LOCK'] = 'false'
import time
from modelscope.hub.snapshot_download import snapshot_download
from modelscope.hub.callback import ProgressCallback

class PrintProgress(ProgressCallback):
    def __init__(self, filename, file_size):
        super().__init__(filename, file_size)
        self._downloaded = 0
        self._last_print = 0
    def update(self, chunk_size):
        self._downloaded += chunk_size
        now = time.time()
        if now - self._last_print < 2.0:
            return
        self._last_print = now
        if self.file_size and self.file_size > 0:
            pct = self._downloaded * 100 / self.file_size
            mb_down = self._downloaded / 1048576
            mb_total = self.file_size / 1048576
            print(f'  {self.filename}: {pct:.0f}% ({mb_down:.1f}/{mb_total:.1f} MB)', flush=True)
        else:
            print(f'  {self.filename}: {self._downloaded / 1048576:.1f} MB', flush=True)
    def end(self):
        if self.file_size and self.file_size > 0:
            print(f'  {self.filename}: done ({self.file_size / 1048576:.1f} MB)', flush=True)
        else:
            print(f'  {self.filename}: done', flush=True)

snapshot_download('${model}', progress_callbacks=[PrintProgress])
`.trim()
}

async function downloadFunasrModels(python: string): Promise<void> {
  for (const model of FUNASR_MODELS) {
    console.log(`[setup] Downloading model: ${model} ...`)
    try {
      // NOTICE: pnpm runs postinstall without a real TTY, so tqdm progress bars
      // are hidden. We write a helper script that hooks into modelscope's
      // ProgressCallback to print file-level progress to stdout, which is
      // inherited by the spawn and visible in the terminal.
      await spawn(python, ['-c', downloadModelScript(model)])
      console.log(`[setup] Model ${model} is cached.`)
    }
    catch (error) {
      console.error(`[setup] Failed to download model ${model}:`, error)
      process.exit(1)
    }
  }
}

// --- CosyVoice ---

// NOTICE: The PyPI "cosyvoice" package (by lucasjinreal) is broken — it references
// cosyvoice.cli but never ships the module. The official FunAudioLLM/CosyVoice repo
// is not pip-installable. We clone it into a vendor directory and install deps separately.

function getCosyVoiceVendorDir(): string {
  return join(SERVICE_ROOT, 'vendor', 'CosyVoice')
}

async function cloneCosyVoice(python: string): Promise<void> {
  const vendorDir = getCosyVoiceVendorDir()

  const matchaTTSDir = join(vendorDir, 'third_party', 'Matcha-TTS')

  // Check if already cloned and functional
  try {
    await exec(python, ['-c', `
import sys; sys.path.insert(0, '${vendorDir}'); sys.path.insert(0, '${matchaTTSDir}')
from cosyvoice.cli.cosyvoice import CosyVoice; print('cosyvoice installed')
`.trim()])
    console.log('[setup] CosyVoice (vendor) is already set up, skipping.')
    return
  }
  catch {
    // not set up yet
  }

  // Remove broken PyPI cosyvoice if present (it conflicts with the real one)
  try {
    await exec(python, ['-m', 'pip', 'show', 'cosyvoice'])
    console.log('[setup] Removing broken PyPI cosyvoice package to avoid conflicts...')
    await spawn(python, ['-m', 'pip', 'uninstall', '-y', 'cosyvoice'])
  }
  catch {
    // not installed, good
  }

  // Clone official CosyVoice repo
  console.log('[setup] Cloning FunAudioLLM/CosyVoice into vendor directory...')
  try {
    if (!existsSync(dirname(vendorDir))) {
      mkdirSync(dirname(vendorDir), { recursive: true })
    }
    if (existsSync(vendorDir)) {
      // Pull latest if already cloned
      await spawn('git', ['-C', vendorDir, 'pull', '--ff-only'])
    }
    else {
      await spawn('git', ['clone', '--progress', '--filter=blob:none', '--depth=1', 'https://github.com/FunAudioLLM/CosyVoice.git', vendorDir])
    }

    // NOTICE: CosyVoice depends on third_party/Matcha-TTS (provides the `matcha` module).
    // This is a git submodule that must be initialized after cloning.
    if (!existsSync(join(matchaTTSDir, 'matcha'))) {
      console.log('[setup] Initializing CosyVoice Matcha-TTS submodule...')
      await spawn('git', ['-C', vendorDir, 'submodule', 'update', '--init', '--depth=1', 'third_party/Matcha-TTS'])
    }
  }
  catch (error) {
    console.error('[setup] Failed to clone CosyVoice repo:', error)
    console.warn('[setup] CosyVoice TTS will not be available.')
  }
}

async function downloadCosyVoiceModel(python: string): Promise<void> {
  const model = 'iic/CosyVoice-300M-SFT'
  console.log(`[setup] Downloading CosyVoice model: ${model} ...`)
  try {
    await spawn(python, ['-c', downloadModelScript(model)])
    console.log(`[setup] CosyVoice model ${model} is cached.`)
  }
  catch (error) {
    console.error(`[setup] Failed to download CosyVoice model ${model}:`, error)
    console.warn('[setup] CosyVoice TTS will not be available.')
  }
}

// --- Main ---

async function main() {
  console.log('[setup] Setting up local AI Python services...')

  // Create a dedicated venv so pip installs don't hit PEP 668 restrictions
  const python = await ensureVenv()

  // Install all Python dependencies from requirements.txt
  await pipInstall(python)

  // Download FunASR models
  console.log('[setup] Preparing FunASR environment...')
  await downloadFunasrModels(python)
  console.log('[setup] FunASR preparation complete.')

  // Clone CosyVoice and download its model
  console.log('[setup] Preparing CosyVoice TTS environment...')
  await cloneCosyVoice(python)
  await downloadCosyVoiceModel(python)
  console.log('[setup] CosyVoice TTS preparation complete.')

  console.log('[setup] Local AI Python services setup complete.')
}

main()
