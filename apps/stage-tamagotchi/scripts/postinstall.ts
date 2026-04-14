/* eslint-disable no-console */

import process from 'node:process'

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FUNASR_MODELS = [
  'iic/SenseVoiceSmall',
  'iic/speech_fsmn_vad_zh-cn-16k-common-pytorch',
]

const MIN_PYTHON_VERSION = [3, 10] as const
const PYTHON_VERSION_RE = /Python\s+(\d+)\.(\d+)/i

// NOTICE: postinstall runs from the app directory via pnpm.
// We use the script's own location (scripts/) to reliably locate the app root.
const SCRIPT_DIR = typeof __dirname !== 'undefined' ? __dirname : dirname(new URL(import.meta.url).pathname)
const APP_ROOT = dirname(SCRIPT_DIR)
const VENV_DIR = join(APP_ROOT, '.venv')

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

// --- Electron native deps ---

async function installElectronAppDeps(): Promise<void> {
  console.log('[postinstall] Installing Electron app dependencies...')
  await spawn('electron-builder', ['install-app-deps'])
  console.log('[postinstall] Electron app dependencies installed.')
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
        console.warn(`[postinstall] ${candidate} is ${stdout.trim()}, need >= ${MIN_PYTHON_VERSION.join('.')}. Skipping.`)
        continue
      }
      console.log(`[postinstall] Found ${candidate}: ${stdout.trim()}`)
      return candidate
    }
    catch {
      // candidate not available, try next
    }
  }

  console.error(`[postinstall] Python >= ${MIN_PYTHON_VERSION.join('.')} is required but not found.`)
  console.error('[postinstall] Please install Python 3.10+ and ensure it is on your PATH.')
  console.error('[postinstall] macOS: brew install python@3.12')
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
    console.log(`[postinstall] Python venv already exists at ${VENV_DIR}`)
    return venvPython
  }

  const systemPython = await findSystemPython()
  console.log(`[postinstall] Creating Python venv at ${VENV_DIR} ...`)
  await spawn(systemPython, ['-m', 'venv', VENV_DIR])
  console.log('[postinstall] Python venv created.')

  // Upgrade pip inside the venv
  await spawn(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])

  return venvPython
}

// --- FunASR ---

async function ensureFunasrInstalled(python: string): Promise<void> {
  try {
    // funasr imports torch at module level, so this check validates both
    await exec(python, ['-c', `import funasr; print(funasr.__version__)`])
    console.log('[postinstall] funasr is already installed, skipping pip install.')
    return
  }
  catch {
    // not installed or missing dependencies (e.g. torch)
  }

  console.log('[postinstall] Installing torch, funasr, and modelscope via pip...')
  try {
    await spawn(python, ['-m', 'pip', 'install', '--progress-bar', 'on', 'torch', 'torchaudio', 'funasr', 'modelscope', 'websockets'])
    console.log('[postinstall] pip install completed.')
  }
  catch (error) {
    console.error('[postinstall] Failed to install dependencies:', error)
    process.exit(1)
  }
}

async function downloadModels(python: string): Promise<void> {
  for (const model of FUNASR_MODELS) {
    console.log(`[postinstall] Downloading model: ${model} ...`)
    try {
      // NOTICE: pnpm runs postinstall without a real TTY, so tqdm progress bars
      // are hidden. We write a helper script that hooks into modelscope's
      // ProgressCallback to print file-level progress to stdout, which is
      // inherited by the spawn and visible in the terminal.
      await spawn(python, ['-c', downloadModelScript(model)])
      console.log(`[postinstall] Model ${model} is cached.`)
    }
    catch (error) {
      console.error(`[postinstall] Failed to download model ${model}:`, error)
      process.exit(1)
    }
  }
}

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

// NOTICE: pnpm postinstall runs without a TTY so tqdm progress bars are hidden.
// huggingface_hub.hf_hub_download accepts tqdm_class to override the progress bar.
function hfDownloadScript(repo: string, filename: string): string {
  return `
import time
from huggingface_hub import hf_hub_download

class PrintTqdm:
    """Minimal tqdm-compatible class that prints download progress to stdout."""
    def __init__(self, *args, **kwargs):
        self.total = kwargs.get('total', 0)
        self.desc = kwargs.get('desc', '')
        self.n = 0
        self._last_print = 0
        self.disable = kwargs.get('disable', False)
    def update(self, n=1):
        if self.disable:
            return
        self.n += n
        now = time.time()
        if now - self._last_print < 2.0:
            return
        self._last_print = now
        if self.total and self.total > 0:
            pct = self.n * 100 / self.total
            mb_down = self.n / 1048576
            mb_total = self.total / 1048576
            print(f'  {self.desc}: {pct:.0f}% ({mb_down:.1f}/{mb_total:.1f} MB)', flush=True)
        else:
            print(f'  {self.desc}: {self.n / 1048576:.1f} MB', flush=True)
    def close(self):
        if not self.disable and self.total and self.total > 0:
            print(f'  {self.desc}: done ({self.total / 1048576:.1f} MB)', flush=True)
    def __enter__(self): return self
    def __exit__(self, *args): self.close()

path = hf_hub_download(repo_id='${repo}', filename='${filename}', tqdm_class=PrintTqdm)
print(f'Model downloaded to: {path}', flush=True)
`.trim()
}

async function prepareFunasr(python: string): Promise<void> {
  console.log('[postinstall] Preparing FunASR environment...')
  await ensureFunasrInstalled(python)
  await downloadModels(python)
  console.log('[postinstall] FunASR preparation complete.')
}

// --- CosyVoice TTS ---

// NOTICE: The PyPI "cosyvoice" package (by lucasjinreal) is broken — it references
// cosyvoice.cli but never ships the module. The official FunAudioLLM/CosyVoice repo
// is not pip-installable. We clone it into a vendor directory and install deps separately.

function getCosyVoiceVendorDir(): string {
  return join(APP_ROOT, 'vendor', 'CosyVoice')
}

async function ensureCosyVoiceInstalled(python: string): Promise<void> {
  const vendorDir = getCosyVoiceVendorDir()

  // Check if already cloned and functional
  try {
    await exec(python, ['-c', `
import sys; sys.path.insert(0, '${vendorDir}')
from cosyvoice.cli.cosyvoice import CosyVoice; print('cosyvoice installed')
`.trim()])
    console.log('[postinstall] CosyVoice (vendor) is already set up, skipping.')
    return
  }
  catch {
    // not set up yet
  }

  // Remove broken PyPI cosyvoice if present (it conflicts with the real one)
  try {
    await exec(python, ['-m', 'pip', 'show', 'cosyvoice'])
    console.log('[postinstall] Removing broken PyPI cosyvoice package to avoid conflicts...')
    await spawn(python, ['-m', 'pip', 'uninstall', '-y', 'cosyvoice'])
  }
  catch {
    // not installed, good
  }

  // Clone official CosyVoice repo
  console.log('[postinstall] Cloning FunAudioLLM/CosyVoice into vendor directory...')
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
  }
  catch (error) {
    console.error('[postinstall] Failed to clone CosyVoice repo:', error)
    console.warn('[postinstall] CosyVoice TTS will not be available.')
    return
  }

  // Install macOS-compatible requirements (skip CUDA-only, deepspeed, gradio, etc.)
  // Core deps needed for inference: torch, torchaudio, conformer, modelscope,
  // onnxruntime, soundfile, transformers, HyperPyYAML, openai-whisper
  console.log('[postinstall] Installing CosyVoice Python dependencies...')
  try {
    await spawn(python, ['-m', 'pip', 'install', '--progress-bar', 'on', 'torch', 'torchaudio', 'conformer', 'modelscope', 'onnxruntime', 'soundfile', 'transformers', 'HyperPyYAML', 'openai-whisper', 'numpy<2', 'omegaconf', 'hydra-core', 'inflect', 'librosa', 'pydantic', 'pyworld', 'x-transformers', 'wetext', 'wget', 'protobuf'])
    console.log('[postinstall] CosyVoice dependencies installed.')
  }
  catch (error) {
    console.error('[postinstall] Failed to install CosyVoice dependencies:', error)
    console.warn('[postinstall] CosyVoice TTS may not work correctly.')
  }
}

async function downloadCosyVoiceModel(python: string): Promise<void> {
  const model = 'iic/CosyVoice-300M-SFT'
  console.log(`[postinstall] Downloading CosyVoice model: ${model} ...`)
  try {
    await spawn(python, ['-c', downloadModelScript(model)])
    console.log(`[postinstall] CosyVoice model ${model} is cached.`)
  }
  catch (error) {
    console.error(`[postinstall] Failed to download CosyVoice model ${model}:`, error)
    console.warn('[postinstall] CosyVoice TTS will not be available.')
  }
}

async function prepareCosyVoice(python: string): Promise<void> {
  console.log('[postinstall] Preparing CosyVoice TTS environment...')
  await ensureCosyVoiceInstalled(python)
  await downloadCosyVoiceModel(python)
  console.log('[postinstall] CosyVoice TTS preparation complete.')
}

// --- llama.cpp ---

async function checkBrewInstalled(): Promise<boolean> {
  try {
    await exec('brew', ['--version'])
    return true
  }
  catch {
    return false
  }
}

async function prepareLlamaCpp(): Promise<void> {
  console.log('[postinstall] Preparing llama.cpp environment...')

  // Check if llama-server is already available
  try {
    const { stdout } = await exec('llama-server', ['--version'])
    console.log(`[postinstall] llama-server already installed: ${stdout.trim()}`)
    return
  }
  catch {
    // not installed, proceed
  }

  // macOS: install via Homebrew
  if (process.platform === 'darwin') {
    if (!await checkBrewInstalled()) {
      console.warn('[postinstall] Homebrew not found. Skipping llama.cpp installation.')
      console.warn('[postinstall] To install manually: https://github.com/ggml-org/llama.cpp#build')
      return
    }
    try {
      console.log('[postinstall] Installing llama.cpp via Homebrew...')
      await spawn('brew', ['install', 'llama.cpp'])
      console.log('[postinstall] llama.cpp installed successfully.')
    }
    catch (error) {
      console.warn('[postinstall] Failed to install llama.cpp via Homebrew:', error)
      console.warn('[postinstall] Local LLM (llama-server) will not be available.')
    }
    return
  }

  // Other platforms: inform the user
  console.warn('[postinstall] Automatic llama.cpp installation is only supported on macOS (via Homebrew).')
  console.warn('[postinstall] To install manually: https://github.com/ggml-org/llama.cpp#build')
}

async function downloadQwen3Model(python: string): Promise<void> {
  // NOTICE: The official Qwen/Qwen3-1.7B-GGUF repo only has Q8_0 quant.
  // Q4_K_M is available from unsloth's community quants.
  const modelRepo = 'unsloth/Qwen3-1.7B-GGUF'
  const modelFile = 'Qwen3-1.7B-Q4_K_M.gguf'
  console.log(`[postinstall] Downloading Qwen3-1.7B GGUF model...`)
  try {
    // NOTICE: pnpm postinstall runs without a TTY so tqdm progress bars are hidden.
    // We pass a custom tqdm_class to print plain-text progress to stdout.
    await spawn(python, ['-c', hfDownloadScript(modelRepo, modelFile)])
    console.log(`[postinstall] Qwen3-1.7B GGUF model is cached.`)
  }
  catch (error) {
    console.error(`[postinstall] Failed to download Qwen3-1.7B GGUF model:`, error)
    console.warn('[postinstall] Local LLM (llama-server with Qwen3) will not be available.')
  }
}

async function ensureHuggingfaceHub(python: string): Promise<void> {
  try {
    await exec(python, ['-c', `import huggingface_hub; print(huggingface_hub.__version__)`])
    return
  }
  catch {
    // not installed
  }

  console.log('[postinstall] Installing huggingface_hub via pip...')
  try {
    await spawn(python, ['-m', 'pip', 'install', '--progress-bar', 'on', 'huggingface_hub'])
  }
  catch (error) {
    console.error('[postinstall] Failed to install huggingface_hub:', error)
  }
}

// --- Main ---

async function main() {
  await installElectronAppDeps()

  // Create a dedicated venv so pip installs don't hit PEP 668 restrictions
  const python = await ensureVenv()

  await prepareFunasr(python)
  await prepareCosyVoice(python)
  await prepareLlamaCpp()

  // Download Qwen3-1.7B GGUF model for llama-server
  await ensureHuggingfaceHub(python)
  await downloadQwen3Model(python)
}

main()
