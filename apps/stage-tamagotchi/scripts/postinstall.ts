/* eslint-disable no-console */

import process from 'node:process'

import { execFile, spawn as nodeSpawn } from 'node:child_process'

const FUNASR_MODELS = [
  'iic/SenseVoiceSmall',
  'iic/speech_fsmn_vad_zh-cn-16k-common-pytorch',
]

// NOTICE: macOS system Python (3.9) ships with LibreSSL instead of OpenSSL,
// causing urllib3 to emit NotOpenSSLWarning on every invocation.
// PYTHONWARNINGS env var doesn't support dotted module paths, so we prepend
// a warnings.filterwarnings call to any -c script that imports network libs.
const SUPPRESS_URLLIB3_WARN = `import warnings; warnings.filterwarnings('ignore', message='.*LibreSSL.*'); `

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

// --- FunASR ---

async function findPython(): Promise<string> {
  for (const candidate of ['python3', 'python']) {
    try {
      const { stdout } = await exec(candidate, ['--version'])
      if (stdout.toLowerCase().includes('python 3') || stdout.toLowerCase().includes('python3')) {
        console.log(`[postinstall] Found ${candidate}: ${stdout.trim()}`)
        return candidate
      }
    }
    catch {
      // candidate not available, try next
    }
  }

  console.error('[postinstall] Python 3 is required but not found.')
  console.error('[postinstall] Please install Python 3 and ensure it is on your PATH.')
  process.exit(1)
}

async function ensureFunasrInstalled(python: string): Promise<void> {
  try {
    // funasr imports torch at module level, so this check validates both
    await exec(python, ['-c', `${SUPPRESS_URLLIB3_WARN}import funasr; print(funasr.__version__)`])
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
import warnings; warnings.filterwarnings('ignore', message='.*LibreSSL.*')
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

async function prepareFunasr(): Promise<void> {
  console.log('[postinstall] Preparing FunASR environment...')
  const python = await findPython()
  await ensureFunasrInstalled(python)
  await downloadModels(python)
  console.log('[postinstall] FunASR preparation complete.')
}

// --- CosyVoice TTS ---

async function ensureCosyVoiceInstalled(python: string): Promise<void> {
  try {
    await exec(python, ['-c', `${SUPPRESS_URLLIB3_WARN}from cosyvoice.cli.cosyvoice import CosyVoice; print('cosyvoice installed')`])
    console.log('[postinstall] cosyvoice is already installed, skipping pip install.')
    return
  }
  catch {
    // not installed
  }

  console.log('[postinstall] Installing cosyvoice dependencies via pip...')
  try {
    await spawn(python, ['-m', 'pip', 'install', '--progress-bar', 'on', 'cosyvoice', 'soundfile', 'modelscope'])
    console.log('[postinstall] cosyvoice pip install completed.')
  }
  catch (error) {
    console.error('[postinstall] Failed to install cosyvoice dependencies:', error)
    console.warn('[postinstall] CosyVoice TTS will not be available.')
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

async function prepareCosyVoice(): Promise<void> {
  console.log('[postinstall] Preparing CosyVoice TTS environment...')
  const python = await findPython()
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
  const modelRepo = 'Qwen/Qwen3-1.7B-GGUF'
  const modelFile = 'Qwen3-1.7B-Q4_K_M.gguf'
  console.log(`[postinstall] Downloading Qwen3-1.7B GGUF model...`)
  try {
    // Use huggingface_hub to download the specific GGUF file
    await spawn(python, ['-c', `
import warnings; warnings.filterwarnings('ignore', message='.*LibreSSL.*')
from huggingface_hub import hf_hub_download
path = hf_hub_download(repo_id='${modelRepo}', filename='${modelFile}')
print(f'Model downloaded to: {path}', flush=True)
`.trim()])
    console.log(`[postinstall] Qwen3-1.7B GGUF model is cached.`)
  }
  catch (error) {
    console.error(`[postinstall] Failed to download Qwen3-1.7B GGUF model:`, error)
    console.warn('[postinstall] Local LLM (llama-server with Qwen3) will not be available.')
  }
}

async function ensureHuggingfaceHub(python: string): Promise<void> {
  try {
    await exec(python, ['-c', `${SUPPRESS_URLLIB3_WARN}import huggingface_hub; print(huggingface_hub.__version__)`])
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
  await prepareFunasr()
  await prepareCosyVoice()
  await prepareLlamaCpp()

  // Download Qwen3-1.7B GGUF model for llama-server
  const python = await findPython()
  await ensureHuggingfaceHub(python)
  await downloadQwen3Model(python)
}

main()
