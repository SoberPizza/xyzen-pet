/**
 * Voice-activity detector shim.
 *
 * The detector itself runs in Rust (`src-tauri/src/vad/`) using the Silero v5
 * ONNX model, so this composable is a thin adapter:
 *   1. Captures mic PCM via the same `pcm16-capture-worklet` used by the
 *      voice session (20 ms Int16 frames @ 16 kHz).
 *   2. Ships each frame to Rust via `vad_push_frame`.
 *   3. Listens for `vad://speech-{start,end}` Tauri events and flips the
 *      reactive state + fires registered handlers.
 *
 * The public `Vad` surface is unchanged so `useBuddyVoiceSession` doesn't
 * need to move.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { readonly, ref } from 'vue'
import workletUrl from '../audio/pcm16-capture-worklet.js?worker&url'

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

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

export function useVad(): Vad {
  const isReady = ref(false)
  const isSpeaking = ref(false)
  const handlers = new Set<VadEventHandler>()
  const frameHandlers = new Set<VadFrameHandler>()
  let unlisteners: UnlistenFn[] = []

  let audioContext: AudioContext | null = null
  let mediaStream: MediaStream | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null

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

  async function installEventListeners(): Promise<void> {
    const stopListeners: UnlistenFn[] = []
    stopListeners.push(await listen<null>('vad://speech-start', () => {
      isSpeaking.value = true
      emit('speech.start')
    }))
    stopListeners.push(await listen<null>('vad://speech-end', () => {
      isSpeaking.value = false
      emit('speech.end')
    }))
    // Frame probabilities are gated behind BUDDY_VAD_DEBUG_FRAMES in Rust;
    // wiring the listener here is cheap and lets consumers opt-in.
    stopListeners.push(await listen<{ is_speech: number }>('vad://frame', (evt) => {
      emitFrame({ isSpeech: evt.payload.is_speech })
    }))
    stopListeners.push(await listen<{ message: string }>('vad://error', (evt) => {
      console.error('[vad] rust worker error:', evt.payload.message)
      isReady.value = false
    }))
    unlisteners = stopListeners
  }

  function clearEventListeners(): void {
    for (const un of unlisteners) {
      try { un() } catch {}
    }
    unlisteners = []
  }

  async function start(): Promise<void> {
    if (!isTauri()) throw new Error('VAD requires the Tauri IPC bridge.')
    if (isReady.value) return

    await installEventListeners()
    await invoke('vad_start')

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const ctx = new AudioContext()
    await ctx.audioWorklet.addModule(workletUrl)
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm16-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })

    node.port.onmessage = (event: MessageEvent<{ pcm16: ArrayBuffer }>) => {
      const bytes = new Uint8Array(event.data.pcm16)
      void invoke('vad_push_frame', { pcm16: bytes }).catch(() => {})
    }
    src.connect(node)

    audioContext = ctx
    mediaStream = stream
    sourceNode = src
    workletNode = node
    isReady.value = true
  }

  async function stop(): Promise<void> {
    isReady.value = false
    isSpeaking.value = false

    if (workletNode) {
      try { workletNode.port.onmessage = null } catch {}
      try { workletNode.disconnect() } catch {}
      workletNode = null
    }
    if (sourceNode) {
      try { sourceNode.disconnect() } catch {}
      sourceNode = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => {
        try { t.stop() } catch {}
      })
      mediaStream = null
    }
    if (audioContext) {
      try { await audioContext.close() } catch {}
      audioContext = null
    }
    clearEventListeners()
    if (isTauri()) {
      try { await invoke('vad_stop') } catch {}
    }
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
