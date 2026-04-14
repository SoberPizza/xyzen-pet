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
  esp32BridgeStatusChangeEventa,
} from '@proj-airi/stage-shared/esp32-bridge'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

export function createESP32BridgeService(params: {
  context: ReturnType<typeof createContext>['context']
}) {
  const log = useLogg('main/esp32-bridge').useGlobalConfig()

  let bridge: XiaozhiBridge | null = null
  let opusDecoder: OpusScript | null = null
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

      // Initialize Opus decoder with device's sample rate (typically 16000 Hz mono)
      opusDecoder = new OpusScript(
        deviceHello.audio_params.sample_rate as 8000 | 12000 | 16000 | 24000 | 48000,
        deviceHello.audio_params.channels,
      )

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

  onAppBeforeQuit(async () => {
    cleanupBridge()
  })

  log.log('ESP32 bridge service initialized')
}
