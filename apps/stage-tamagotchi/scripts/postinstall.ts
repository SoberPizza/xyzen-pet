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

// --- Main ---

async function main() {
  await installElectronAppDeps()
  await prepareFunasr()
}

main()
