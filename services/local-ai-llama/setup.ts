/* eslint-disable no-console */

import process from 'node:process'

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import models from './models.json' with { type: 'json' }

const SCRIPT_DIR = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
const BIN_DIR = join(SCRIPT_DIR, 'bin')

// NOTICE: HuggingFace and GitHub are extremely slow from China without mirrors.
const HF_MIRROR = 'https://hf-mirror.com'
const GITHUB_MIRROR = 'https://ghfast.top'

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

// --- llama.cpp installation ---

/** Recursively search for a file by name within a directory. */
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
 * Exported so the Electron runtime can locate the downloaded binary.
 * Returns the path to llama-server(.exe) inside `services/local-ai-llama/bin/`,
 * or null if not downloaded.
 */
export function findLocalLlamaServer(): string | null {
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return findFileRecursive(BIN_DIR, exeName)
}

async function checkBrewInstalled(): Promise<boolean> {
  try {
    await exec('brew', ['--version'])
    return true
  }
  catch {
    return false
  }
}

/** Download a file with progress logging, returning the total bytes written. */
async function downloadFile(url: string, destPath: string, label: string): Promise<number> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body)
    throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const totalBytes = Number(response.headers.get('content-length') || 0)
  let downloadedBytes = 0
  let lastPrintTime = 0

  const progressTransform = new TransformStream({
    transform(chunk, controller) {
      downloadedBytes += chunk.byteLength
      const now = Date.now()
      if (now - lastPrintTime >= 2000) {
        lastPrintTime = now
        const mbDown = (downloadedBytes / 1048576).toFixed(1)
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(0)
          const mbTotal = (totalBytes / 1048576).toFixed(1)
          console.log(`  ${label}: ${pct}% (${mbDown}/${mbTotal} MB)`)
        }
        else {
          console.log(`  ${label}: ${mbDown} MB`)
        }
      }
      controller.enqueue(chunk)
    },
  })

  const readableWithProgress = response.body.pipeThrough(progressTransform)
  const { Readable } = await import('node:stream')
  const nodeReadable = Readable.fromWeb(readableWithProgress as import('node:stream/web').ReadableStream)
  const writeStream = createWriteStream(destPath)
  await pipeline(nodeReadable, writeStream)
  return downloadedBytes
}

/** Download pre-built llama-server CUDA binary from GitHub releases for Windows. */
async function downloadLlamaServerWindows(): Promise<void> {
  const extractDir = join(BIN_DIR, 'llama-cpp')

  // Already downloaded?
  if (findLocalLlamaServer()) {
    console.log(`[setup:llama] llama-server already downloaded: ${findLocalLlamaServer()}`)
    return
  }

  console.log('[setup:llama] Fetching latest llama.cpp release from GitHub...')
  const releaseRes = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest')
  if (!releaseRes.ok)
    throw new Error(`GitHub API returned ${releaseRes.status}`)

  const release = await releaseRes.json() as { tag_name: string, assets: Array<{ name: string, browser_download_url: string }> }
  console.log(`[setup:llama] Latest release: ${release.tag_name}`)

  // Match CUDA 12.x Windows x64 zip
  const asset = release.assets.find(a => /win.*cuda.*cu12.*x64\.zip$/i.test(a.name))
    || release.assets.find(a => /cuda.*cu12.*win.*x64\.zip$/i.test(a.name))

  if (!asset) {
    console.warn('[setup:llama] No CUDA Windows x64 build found in latest release.')
    console.warn('[setup:llama] To install manually: https://github.com/ggml-org/llama.cpp/releases')
    return
  }

  mkdirSync(extractDir, { recursive: true })
  const zipPath = join(BIN_DIR, '_download.zip')

  const downloadUrl = `${GITHUB_MIRROR}/${asset.browser_download_url}`
  console.log(`[setup:llama] Downloading ${asset.name} (via mirror) ...`)
  const bytes = await downloadFile(downloadUrl, zipPath, asset.name)
  console.log(`[setup:llama] Downloaded (${(bytes / 1048576).toFixed(1)} MB). Extracting...`)

  // Windows 10+ ships with tar.exe that handles zip files
  await spawn('tar', ['-xf', zipPath, '-C', extractDir])
  unlinkSync(zipPath)

  const exe = findLocalLlamaServer()
  if (exe)
    console.log(`[setup:llama] llama-server installed: ${exe}`)
  else
    console.warn('[setup:llama] llama-server.exe not found after extraction')
}

async function installLlamaCpp(): Promise<void> {
  console.log('[setup:llama] Preparing llama.cpp environment...')

  // Check if llama-server is already available on PATH
  try {
    const { stdout } = await exec('llama-server', ['--version'])
    console.log(`[setup:llama] llama-server already on PATH: ${stdout.trim()}`)
    return
  }
  catch {
    // not on PATH, proceed
  }

  // Check if already downloaded locally
  if (findLocalLlamaServer()) {
    console.log(`[setup:llama] llama-server already downloaded: ${findLocalLlamaServer()}`)
    return
  }

  // Windows: download CUDA binary from GitHub releases
  if (process.platform === 'win32') {
    try {
      await downloadLlamaServerWindows()
    }
    catch (error) {
      console.warn('[setup:llama] Failed to download llama-server for Windows:', error)
      console.warn('[setup:llama] To install manually: https://github.com/ggml-org/llama.cpp/releases')
    }
    return
  }

  // macOS: install via Homebrew
  if (process.platform === 'darwin') {
    if (!await checkBrewInstalled()) {
      console.warn('[setup:llama] Homebrew not found. Skipping llama.cpp installation.')
      console.warn('[setup:llama] To install manually: https://github.com/ggml-org/llama.cpp#build')
      return
    }
    try {
      console.log('[setup:llama] Installing llama.cpp via Homebrew...')
      await spawn('brew', ['install', 'llama.cpp'])
      console.log('[setup:llama] llama.cpp installed successfully.')
    }
    catch (error) {
      console.warn('[setup:llama] Failed to install llama.cpp via Homebrew:', error)
      console.warn('[setup:llama] Local LLM (llama-server) will not be available.')
    }
    return
  }

  // Linux: inform the user
  console.warn('[setup:llama] Automatic llama.cpp installation is not supported on Linux yet.')
  console.warn('[setup:llama] To install manually: https://github.com/ggml-org/llama.cpp#build')
}

// --- GGUF model download (pure Node.js, no Python dependency) ---

/**
 * Download a GGUF model file from HuggingFace using Node.js fetch + streams.
 * Writes to the HF cache standard path so `resolveHuggingFaceModelPath()` can find it.
 * Cache layout: ~/.cache/huggingface/hub/models--{org}--{name}/snapshots/manual/{filename}
 */
async function downloadGgufModel(repo: string, filename: string): Promise<void> {
  const cacheDir = join(
    homedir(),
    '.cache',
    'huggingface',
    'hub',
    `models--${repo.replace('/', '--')}`,
    'snapshots',
    'manual',
  )
  const destPath = join(cacheDir, filename)

  if (existsSync(destPath)) {
    console.log(`[setup:llama] Model already cached: ${destPath}`)
    return
  }

  mkdirSync(cacheDir, { recursive: true })

  const url = `${HF_MIRROR}/${repo}/resolve/main/${filename}`
  console.log(`[setup:llama] Downloading ${repo}/${filename} ...`)

  const bytes = await downloadFile(url, destPath, filename)
  console.log(`[setup:llama] Model downloaded: ${destPath} (${(bytes / 1048576).toFixed(1)} MB)`)
}

// --- Main ---

async function main() {
  console.log('[setup:llama] Setting up llama.cpp local LLM service...')

  await installLlamaCpp()

  const modelsToDownload = [models.defaultModel, models.cudaModel]
  for (const { repo, filename } of modelsToDownload) {
    try {
      await downloadGgufModel(repo, filename)
    }
    catch (error) {
      console.error(`[setup:llama] Failed to download ${repo}/${filename}:`, error)
      console.warn(`[setup:llama] Model ${filename} will not be available.`)
    }
  }

  console.log('[setup:llama] llama.cpp setup complete.')
}

main()
