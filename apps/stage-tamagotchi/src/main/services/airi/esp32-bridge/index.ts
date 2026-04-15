import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ESP32BridgeStatus } from '@proj-airi/stage-shared/esp32-bridge'

import { Buffer } from 'node:buffer'

import OpusScript from 'opusscript'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { XiaozhiBridge } from '@proj-airi/esp32-bridge/bridge'
import {
  esp32BridgeAudioEventa,
  esp32BridgeConnectEventa,
  esp32BridgeDisconnectEventa,
  esp32BridgeGetStatusEventa,
  esp32BridgeListenEventa,
  esp32BridgeSendAudioEventa,
  esp32BridgeSendTtsStateEventa,
  esp32BridgeStatusChangeEventa,
} from '@proj-airi/stage-shared/esp32-bridge'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

export function createESP32BridgeService(params: {
  context: ReturnType<typeof createContext>['context']
}) {
  const log = useLogg('main/esp32-bridge').useGlobalConfig()

  let bridge: XiaozhiBridge | null = null
  let opusDecoder: OpusScript | null = null
  let opusEncoder: OpusScript | null = null
  let serverSampleRate: 8000 | 12000 | 16000 | 24000 | 48000 = 24000
  let serverFrameDuration = 60
  let currentStatus: ESP32BridgeStatus = { state: 'disconnected' }

  function updateStatus(status: ESP32BridgeStatus) {
    currentStatus = status
    params.context.emit(esp32BridgeStatusChangeEventa, status)
  }

  function cleanupBridge() {
    if (bridge) {
      bridge.removeAllListeners()
      bridge.disconnect()
      bridge = null
    }
    if (opusDecoder) {
      opusDecoder = null
    }
    if (opusEncoder) {
      opusEncoder = null
    }
  }

  defineInvokeHandler(params.context, esp32BridgeConnectEventa, async (config) => {
    cleanupBridge()

    const url = `${config.deviceUrl}?token=${config.deviceToken}`
    log.withFields({ url, protocolVersion: config.protocolVersion }).log('Connecting to ESP32 device')

    updateStatus({ state: 'connecting' })

    bridge = new XiaozhiBridge({
      url,
      protocolVersion: config.protocolVersion,
      autoReconnect: true,
      reconnectDelay: 3000,
    })

    bridge.on('ws-connected', () => {
      log.log('WebSocket connected, waiting for device to start listening...')
      updateStatus({ state: 'connected' })
    })

    bridge.on('connected', (deviceHello) => {
      log.withFields({
        sessionId: bridge!.currentSessionId,
        audioFormat: deviceHello.audio_params.format,
        sampleRate: deviceHello.audio_params.sample_rate,
        frameDuration: deviceHello.audio_params.frame_duration,
      }).log('ESP32 audio channel opened')

      const rate = deviceHello.audio_params.sample_rate as 8000 | 12000 | 16000 | 24000 | 48000
      serverSampleRate = rate
      serverFrameDuration = deviceHello.audio_params.frame_duration

      // Initialize Opus decoder with device's sample rate (typically 16000 Hz mono)
      opusDecoder = new OpusScript(rate, deviceHello.audio_params.channels)

      // Initialize Opus encoder for sending TTS audio to the device
      opusEncoder = new OpusScript(rate, deviceHello.audio_params.channels, OpusScript.Application.AUDIO)

      updateStatus({
        state: 'active',
        sessionId: bridge!.currentSessionId,
        deviceAudioParams: {
          format: deviceHello.audio_params.format,
          sampleRate: deviceHello.audio_params.sample_rate,
          channels: deviceHello.audio_params.channels,
          frameDuration: deviceHello.audio_params.frame_duration,
        },
      })
    })

    bridge.on('disconnected', (code, reason) => {
      log.withFields({ code, reason }).log('ESP32 device disconnected')
      opusDecoder = null
      updateStatus({ state: 'disconnected' })
    })

    bridge.on('audio', (frame) => {
      if (!opusDecoder)
        return

      try {
        // Decode Opus frame to PCM16
        const pcmBuffer = opusDecoder.decode(Buffer.from(frame.payload))
        if (pcmBuffer) {
          const pcm16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2)
          params.context.emit(esp32BridgeAudioEventa, { pcm16 })
        }
      }
      catch (err) {
        log.withFields({ error: err }).warn('Failed to decode Opus frame')
      }
    })

    bridge.on('listen', (msg) => {
      log.withFields({ state: msg.state, mode: msg.mode, text: msg.text }).log('ESP32 listen state changed')
      params.context.emit(esp32BridgeListenEventa, {
        state: msg.state,
        mode: msg.mode,
        text: msg.text,
      })
    })

    bridge.on('error', (err) => {
      log.withFields({ error: err.message }).warn('ESP32 bridge error')
      updateStatus({
        state: 'error',
        lastError: err.message,
      })
    })

    bridge.connect()

    return currentStatus
  })

  defineInvokeHandler(params.context, esp32BridgeDisconnectEventa, async () => {
    log.log('Disconnecting ESP32 device')
    cleanupBridge()
    updateStatus({ state: 'disconnected' })
    return currentStatus
  })

  defineInvokeHandler(params.context, esp32BridgeGetStatusEventa, async () => {
    return currentStatus
  })

  /** Resample PCM16 from srcRate to dstRate using linear interpolation. */
  function resamplePCM16(input: Int16Array, srcRate: number, dstRate: number): Int16Array {
    if (srcRate === dstRate)
      return input
    const ratio = srcRate / dstRate
    const outLen = Math.round(input.length / ratio)
    const output = new Int16Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio
      const low = Math.floor(srcIdx)
      const high = Math.min(low + 1, input.length - 1)
      const frac = srcIdx - low
      output[i] = Math.round(input[low] * (1 - frac) + input[high] * frac)
    }
    return output
  }

  defineInvokeHandler(params.context, esp32BridgeSendAudioEventa, async ({ pcm16, sampleRate }) => {
    if (!bridge || !opusEncoder) {
      log.warn('Cannot send audio: bridge or encoder not ready')
      return
    }

    // Resample to server rate if needed
    const resampled = resamplePCM16(pcm16, sampleRate, serverSampleRate)

    // Split into frames and encode
    const frameSamples = Math.round(serverSampleRate * serverFrameDuration / 1000)
    for (let offset = 0; offset < resampled.length; offset += frameSamples) {
      const end = Math.min(offset + frameSamples, resampled.length)
      const frame = resampled.subarray(offset, end)

      // Pad last frame if shorter than expected
      let frameToEncode: Int16Array
      if (frame.length < frameSamples) {
        frameToEncode = new Int16Array(frameSamples)
        frameToEncode.set(frame)
      }
      else {
        frameToEncode = frame
      }

      try {
        const encoded = opusEncoder.encode(Buffer.from(frameToEncode.buffer, frameToEncode.byteOffset, frameToEncode.byteLength), frameSamples)
        if (encoded)
          bridge.sendAudio(new Uint8Array(encoded))
      }
      catch (err) {
        log.withFields({ error: err }).warn('Failed to encode Opus frame for TTS output')
      }
    }
  })

  defineInvokeHandler(params.context, esp32BridgeSendTtsStateEventa, async ({ state, text }) => {
    if (!bridge) {
      log.warn('Cannot send TTS state: bridge not connected')
      return
    }
    bridge.sendTtsState(state, text)
  })

  onAppBeforeQuit(async () => {
    cleanupBridge()
  })

  log.log('ESP32 bridge service initialized')
}
