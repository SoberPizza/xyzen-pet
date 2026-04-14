/* eslint-disable no-console */

import { spawn as nodeSpawn } from 'node:child_process'

/** Streaming spawn — pipes stdout/stderr to the terminal so the user sees real-time progress. */
function spawn(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 600_000,
      shell: process.platform === 'win32',
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

async function main() {
  console.log('[postinstall] Installing Electron app dependencies...')
  await spawn('electron-builder', ['install-app-deps'])
  console.log('[postinstall] Electron app dependencies installed.')
}

main()
