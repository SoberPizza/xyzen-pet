/**
 * Streamed TTS audio playback for the buddy avatar.
 *
 * Each `audio_chunk` arrives as base64-encoded PCM16 at a given sample
 * rate. We forward the raw Int16 samples to a single `AudioWorkletNode`
 * that owns a sample queue and resamples on the fly — no per-chunk
 * `AudioBufferSourceNode` scheduling, no monotonic-clock gap risk.
 *
 * The worklet node is published to `currentAudioSource` once on creation
 * so `useVRMLipSync` can attach and read `node.volume` for the life of
 * the session. The node is reused across utterances; `dispose()` tears
 * it down when the voice session ends.
 */

import type { Ref } from 'vue'
import { watch } from 'vue'

export interface AudioDecoder {
  start: () => void
  appendChunk: (base64: string, sampleRate: number) => void
  appendPcm: (pcm: ArrayBuffer, sampleRate: number) => void
  end: () => void
  clear: () => void
  dispose: () => void
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const WORKLET_URL = '/voice-playback-worklet.js'
const WORKLET_NAME = 'voice-playback-worklet'

// addModule must resolve before `new AudioWorkletNode(...)` is called.
// Cache the load promise per AudioContext so repeated decoder
// create/dispose cycles don't re-fetch the module.
const moduleLoadCache = new WeakMap<AudioContext, Promise<void>>()

function ensureWorkletModule(ctx: AudioContext): Promise<void> {
  let promise = moduleLoadCache.get(ctx)
  if (!promise) {
    console.info('[buddy:voice:decoder] loading worklet module', WORKLET_URL)
    promise = ctx.audioWorklet
      .addModule(WORKLET_URL)
      .then(() => {
        console.info('[buddy:voice:decoder] worklet module loaded')
      })
      .catch((err) => {
        console.error('[buddy:voice:decoder] worklet module load FAILED', err)
        throw err
      })
    moduleLoadCache.set(ctx, promise)
  }
  return promise
}

export function createAudioDecoder(
  audioContext: AudioContext,
  currentAudioSource: Ref<AudioNode | undefined>,
  volume: Ref<number>,
): AudioDecoder {
  let node: AudioWorkletNode | null = null
  let gain: GainNode | null = null
  let stopVolumeWatch: (() => void) | null = null
  let nodePromise: Promise<AudioWorkletNode> | null = null
  let lastSampleRate = 0
  let disposed = false
  let firstChunkLogged = false

  function createNode(): Promise<AudioWorkletNode> {
    if (nodePromise) return nodePromise
    nodePromise = (async () => {
      console.info('[buddy:voice:decoder] creating node', {
        ctxState: audioContext.state,
        ctxRate: audioContext.sampleRate,
        volume: volume.value,
      })
      await ensureWorkletModule(audioContext)
      if (disposed) throw new Error('Decoder disposed before worklet ready')
      const next = new AudioWorkletNode(audioContext, WORKLET_NAME)
      next.port.onmessage = (event) => {
        const data = event.data
        if (data?.type === 'underrun') {
          console.warn('[buddy:voice:decoder] worklet underrun')
        }
        else {
          console.debug('[buddy:voice:decoder] worklet port', data)
        }
      }
      const nextGain = audioContext.createGain()
      nextGain.gain.value = volume.value
      next.connect(nextGain)
      nextGain.connect(audioContext.destination)
      // Lip-sync reads `node.volume` from the worklet directly, so keep
      // the worklet exposed and attenuate downstream only.
      node = next
      gain = nextGain
      currentAudioSource.value = next
      stopVolumeWatch = watch(volume, (v) => {
        if (gain) gain.gain.value = v
      })
      console.info('[buddy:voice:decoder] node ready')
      return next
    })()
    return nodePromise
  }

  function sendAudio(pcm: ArrayBuffer, sampleRate: number): void {
    if (disposed || pcm.byteLength < 2) {
      console.debug('[buddy:voice:decoder] sendAudio skipped', { disposed, bytes: pcm.byteLength })
      return
    }
    void createNode().then((n) => {
      if (disposed) return
      if (sampleRate && sampleRate !== lastSampleRate) {
        console.info('[buddy:voice:decoder] sampleRate change', { from: lastSampleRate, to: sampleRate })
        lastSampleRate = sampleRate
        n.port.postMessage({ type: 'config', sampleRate })
      }
      if (!firstChunkLogged) {
        firstChunkLogged = true
        console.info('[buddy:voice:decoder] first chunk dispatched', {
          bytes: pcm.byteLength,
          rate: sampleRate,
          ctxState: audioContext.state,
        })
      }
      // Transfer the underlying ArrayBuffer to avoid a copy. The caller
      // must not reuse this buffer after handing it to appendPcm.
      n.port.postMessage({ type: 'audio', payload: pcm }, [pcm])
    }).catch((err) => {
      console.warn('[buddy] voice playback worklet failed:', err)
    })
  }

  function start(): void {
    // Warm the worklet so the first audio chunk doesn't pay module-load
    // latency. Safe no-op after the first call.
    void createNode().catch(() => {})
  }

  function appendChunk(base64: string, sampleRate: number): void {
    if (!base64) return
    const bytes = base64ToUint8Array(base64)
    if (bytes.length < 2) return
    // Copy into its own ArrayBuffer so we can transfer it.
    const buf = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buf).set(bytes)
    sendAudio(buf, sampleRate)
  }

  function appendPcm(pcm: ArrayBuffer, sampleRate: number): void {
    if (pcm.byteLength < 2) return
    // Copy so callers can keep their original buffer alive and so we own
    // a transferable for postMessage.
    const buf = new ArrayBuffer(pcm.byteLength)
    new Uint8Array(buf).set(new Uint8Array(pcm))
    sendAudio(buf, sampleRate)
  }

  function end(): void {
    // Worklet drains its own queue; nothing to do here.
  }

  function clear(): void {
    console.info('[buddy:voice:decoder] clear')
    node?.port.postMessage({ type: 'clear' })
  }

  function dispose(): void {
    console.info('[buddy:voice:decoder] dispose')
    disposed = true
    if (stopVolumeWatch) {
      try { stopVolumeWatch() } catch {}
      stopVolumeWatch = null
    }
    if (node) {
      try { node.port.postMessage({ type: 'clear' }) } catch {}
      try { node.disconnect() } catch {}
    }
    if (gain) {
      try { gain.disconnect() } catch {}
    }
    if (currentAudioSource.value === node) {
      currentAudioSource.value = undefined
    }
    node = null
    gain = null
    nodePromise = null
    lastSampleRate = 0
  }

  return { start, appendChunk, appendPcm, end, clear, dispose }
}
