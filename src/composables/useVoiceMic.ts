/**
 * Streaming microphone capture for the buddy voice session.
 *
 * Opens `getUserMedia`, wires the track into a shared `AudioContext`
 * via an `AudioWorkletNode` that emits PCM16 frames at 16 kHz mono.
 * The worklet also sends matching Float32 frames so downstream code
 * (VAD, meters) can operate on the same samples without a second
 * resample pass.
 */

import { readonly, ref, shallowRef } from 'vue'
import workletUrl from '../audio/pcm16-capture-worklet.js?worker&url'
import { useSettingsAudioDevice } from '../stores/audio-device'

export interface VoiceMicFrame {
  /** Int16 PCM, length 320 (20 ms @ 16 kHz), little-endian in host order. */
  pcm16: Int16Array
  /** Matching Float32 mono frame, same length. */
  float: Float32Array
}

export type VoiceMicFrameHandler = (frame: VoiceMicFrame) => void

export interface VoiceMic {
  isActive: Readonly<ReturnType<typeof ref<boolean>>>
  level: Readonly<ReturnType<typeof ref<number>>>
  isSupported: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
  onFrame: (cb: VoiceMicFrameHandler) => () => void
}

const isSupported = typeof window !== 'undefined'
  && typeof navigator !== 'undefined'
  && !!navigator.mediaDevices
  && typeof window.AudioContext !== 'undefined'

export function useVoiceMic(): VoiceMic {
  const isActive = ref(false)
  const level = ref(0)
  const handlers = new Set<VoiceMicFrameHandler>()

  const audioContext = shallowRef<AudioContext | null>(null)
  const mediaStream = shallowRef<MediaStream | null>(null)
  const sourceNode = shallowRef<MediaStreamAudioSourceNode | null>(null)
  const workletNode = shallowRef<AudioWorkletNode | null>(null)

  async function start(): Promise<void> {
    if (!isSupported) throw new Error('AudioWorklet is not supported in this environment.')
    if (isActive.value) return

    const deviceId = useSettingsAudioDevice().selectedInputDeviceId
    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId }
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    const ctx = new AudioContext()
    try {
      await ctx.audioWorklet.addModule(workletUrl)
    }
    catch (err) {
      stream.getTracks().forEach(t => t.stop())
      await ctx.close().catch(() => {})
      throw err
    }

    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm16-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })

    node.port.onmessage = (event: MessageEvent<{ pcm16: ArrayBuffer, float: ArrayBuffer }>) => {
      const pcm = new Int16Array(event.data.pcm16)
      const fl = new Float32Array(event.data.float)
      let sum = 0
      for (let i = 0; i < fl.length; i++) sum += fl[i] * fl[i]
      level.value = Math.sqrt(sum / fl.length)
      const frame: VoiceMicFrame = { pcm16: pcm, float: fl }
      for (const cb of handlers) {
        try { cb(frame) }
        catch (err) { console.error('[voice-mic] handler error:', err) }
      }
    }

    src.connect(node)

    mediaStream.value = stream
    audioContext.value = ctx
    sourceNode.value = src
    workletNode.value = node
    isActive.value = true
  }

  async function stop(): Promise<void> {
    if (!isActive.value) return
    isActive.value = false
    level.value = 0

    const node = workletNode.value
    const src = sourceNode.value
    const stream = mediaStream.value
    const ctx = audioContext.value
    workletNode.value = null
    sourceNode.value = null
    mediaStream.value = null
    audioContext.value = null

    if (node) {
      try { node.port.onmessage = null } catch {}
      try { node.disconnect() } catch {}
    }
    if (src) {
      try { src.disconnect() } catch {}
    }
    if (stream) {
      stream.getTracks().forEach((t) => {
        try { t.stop() } catch {}
      })
    }
    if (ctx) {
      try { await ctx.close() } catch {}
    }
  }

  function onFrame(cb: VoiceMicFrameHandler): () => void {
    handlers.add(cb)
    return () => handlers.delete(cb)
  }

  return {
    isActive: readonly(isActive),
    level: readonly(level),
    isSupported,
    start,
    stop,
    onFrame,
  }
}
