/* eslint-disable no-console */

import process from 'node:process'

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import models from './models.json' with { type: 'json' }

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

async function checkBrewInstalled(): Promise<boolean> {
  try {
    await exec('brew', ['--version'])
    return true
  }
  catch {
    return false
  }
}

async function installLlamaCpp(): Promise<void> {
  console.log('[setup:llama] Preparing llama.cpp environment...')

  // Check if llama-server is already available
  try {
    const { stdout } = await exec('llama-server', ['--version'])
    console.log(`[setup:llama] llama-server already installed: ${stdout.trim()}`)
    return
  }
  catch {
    // not installed, proceed
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

  // Other platforms: inform the user
  console.warn('[setup:llama] Automatic llama.cpp installation is only supported on macOS (via Homebrew).')
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

  const url = `https://huggingface.co/${repo}/resolve/main/${filename}`
  console.log(`[setup:llama] Downloading ${repo}/${filename} ...`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download model: HTTP ${response.status} ${response.statusText}`)
  }

  const totalBytes = Number(response.headers.get('content-length') || 0)
  let downloadedBytes = 0
  let lastPrintTime = 0

  // NOTICE: We use a TransformStream to track progress before piping to disk.
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
          console.log(`  ${filename}: ${pct}% (${mbDown}/${mbTotal} MB)`)
        }
        else {
          console.log(`  ${filename}: ${mbDown} MB`)
        }
      }
      controller.enqueue(chunk)
    },
  })

  const readableWithProgress = response.body.pipeThrough(progressTransform)

  // Convert web ReadableStream to Node.js Readable for fs.createWriteStream
  const { Readable } = await import('node:stream')
  const nodeReadable = Readable.fromWeb(readableWithProgress as import('node:stream/web').ReadableStream)
  const writeStream = createWriteStream(destPath)

  await pipeline(nodeReadable, writeStream)

  const mbTotal = (downloadedBytes / 1048576).toFixed(1)
  console.log(`[setup:llama] Model downloaded: ${destPath} (${mbTotal} MB)`)
}

// --- Main ---

async function main() {
  console.log('[setup:llama] Setting up llama.cpp local LLM service...')

  await installLlamaCpp()

  const { repo, filename } = models.defaultModel
  try {
    await downloadGgufModel(repo, filename)
  }
  catch (error) {
    console.error(`[setup:llama] Failed to download GGUF model:`, error)
    console.warn('[setup:llama] Local LLM (llama-server with Qwen3) will not be available.')
  }

  console.log('[setup:llama] llama.cpp setup complete.')
}

main()
