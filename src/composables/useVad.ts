/**
 * Voice-activity detector for the buddy voice session.
 *
 * Wraps `@ricky0123/vad-web` (Silero v5 VAD via onnxruntime-web) behind
 * a tiny `speech.start` / `speech.end` event interface so the rest of
 * the app doesn't need to know about Silero, wasm paths, or model
 * loading.
 *
 * The VAD opens its own MediaStream rather than sharing one with
 * `useVoiceMic` — trying to feed the same stream into two AudioWorklets
 * reliably across browsers is more pain than the extra ~3 MB of audio
 * overhead. After permission is granted once, a second `getUserMedia`
 * resolves without re-prompting.
 *
 * ASSETS: @ricky0123/vad-web ships its Silero ONNX + worklet in
 * `dist/`. Copy them into `buddy/public/vad/` so Vite serves them from
 * the static origin, or adjust `BASE_ASSET_PATH` below. See
 * https://docs.vad.ricky0123.com for the full list of files.
 */

import { readonly, ref } from 'vue'

export type VadEvent = 'speech.start' | 'speech.end'
export type VadEventHandler = (event: VadEvent) => void

export interface VadFrameProbabilities {
  isSpeech: number
  notSpeech?: number
}
export type VadFrameHandler = (probabilities: VadFrameProbabilities) => void

export interface Vad {
  isReady: Readonly<ReturnType<typeof ref<boolean>>>
  isSpeaking: Readonly<ReturnType<typeof ref<boolean>>>
  start: () => Promise<void>
  stop: () => Promise<void>
  on: (cb: VadEventHandler) => () => void
  onFrame: (cb: VadFrameHandler) => () => void
}

const BASE_ASSET_PATH = '/vad/'

interface VadHandle {
  start: () => void
  pause: () => void
  destroy: () => void
}

interface MicVADModule {
  MicVAD: {
    new: (opts: Record<string, unknown>) => Promise<VadHandle>
  }
}

let modulePromise: Promise<MicVADModule> | null = null

async function loadVadModule(): Promise<MicVADModule> {
  if (!modulePromise) {
    modulePromise = import('@ricky0123/vad-web') as unknown as Promise<MicVADModule>
  }
  return modulePromise
}

export function useVad(): Vad {
  const isReady = ref(false)
  const isSpeaking = ref(false)
  const handlers = new Set<VadEventHandler>()
  const frameHandlers = new Set<VadFrameHandler>()

  let handle: VadHandle | null = null

  function emit(event: VadEvent): void {
    for (const cb of handlers) {
      try { cb(event) }
      catch (err) { console.error('[vad] handler error:', err) }
    }
  }

  function emitFrame(p: VadFrameProbabilities): void {
    for (const cb of frameHandlers) {
      try { cb(p) }
      catch (err) { console.error('[vad] frame handler error:', err) }
    }
  }

  async function start(): Promise<void> {
    if (handle) return
    const mod = await loadVadModule()
    handle = await mod.MicVAD.new({
      baseAssetPath: BASE_ASSET_PATH,
      onnxWASMBasePath: BASE_ASSET_PATH,
      model: 'v5',
      positiveSpeechThreshold: 0.78,
      minSpeechMs: 560,
      onFrameProcessed: (p: VadFrameProbabilities) => emitFrame(p),
      onSpeechStart: () => {
        isSpeaking.value = true
        emit('speech.start')
      },
      onSpeechEnd: () => {
        isSpeaking.value = false
        emit('speech.end')
      },
      onVADMisfire: () => {
        isSpeaking.value = false
      },
      ortConfig: (ort: { env: { logLevel?: string, wasm: { numThreads?: number, proxy?: boolean } } }) => {
        ort.env.logLevel = 'error'
        ort.env.wasm.numThreads = 1
        ort.env.wasm.proxy = false
      },
    })
    handle.start()
    isReady.value = true
  }

  async function stop(): Promise<void> {
    isReady.value = false
    isSpeaking.value = false
    if (!handle) return
    try { handle.pause() } catch {}
    try { handle.destroy() } catch {}
    handle = null
  }

  function on(cb: VadEventHandler): () => void {
    handlers.add(cb)
    return () => handlers.delete(cb)
  }

  function onFrame(cb: VadFrameHandler): () => void {
    frameHandlers.add(cb)
    return () => frameHandlers.delete(cb)
  }

  return {
    isReady: readonly(isReady),
    isSpeaking: readonly(isSpeaking),
    start,
    stop,
    on,
    onFrame,
  }
}
