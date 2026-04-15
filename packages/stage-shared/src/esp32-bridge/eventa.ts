import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export interface ESP32BridgeConfig {
  deviceUrl: string
  deviceToken: string
  protocolVersion: number
}

export interface ESP32BridgeDeviceAudioParams {
  format: string
  sampleRate: number
  channels: number
  frameDuration: number
}

export interface ESP32BridgeStatus {
  /** disconnected → connecting → connected (WS open) → active (audio channel open) */
  state: 'disconnected' | 'connecting' | 'connected' | 'active' | 'error'
  sessionId?: string
  lastError?: string
  deviceAudioParams?: ESP32BridgeDeviceAudioParams
}

export interface ESP32BridgeListenState {
  state: 'start' | 'stop' | 'detect'
  mode?: 'auto' | 'manual' | 'realtime'
  text?: string
}

// Invoke events (request/response)
export const esp32BridgeConnectEventa = defineInvokeEventa<ESP32BridgeStatus, ESP32BridgeConfig>('eventa:invoke:electron:esp32-bridge:connect')
export const esp32BridgeDisconnectEventa = defineInvokeEventa<ESP32BridgeStatus>('eventa:invoke:electron:esp32-bridge:disconnect')
export const esp32BridgeGetStatusEventa = defineInvokeEventa<ESP32BridgeStatus>('eventa:invoke:electron:esp32-bridge:get-status')

// Invoke events (renderer → main): send audio/TTS state to ESP32
export const esp32BridgeSendAudioEventa = defineInvokeEventa<void, { pcm16: Int16Array, sampleRate: number }>(
  'eventa:invoke:electron:esp32-bridge:send-audio',
)
export const esp32BridgeSendTtsStateEventa = defineInvokeEventa<void, { state: 'start' | 'stop' | 'sentence_start', text?: string }>(
  'eventa:invoke:electron:esp32-bridge:send-tts-state',
)

// Push events (main → renderer)
export const esp32BridgeAudioEventa = defineEventa<{ pcm16: Int16Array }>('eventa:event:electron:esp32-bridge:audio')
export const esp32BridgeListenEventa = defineEventa<ESP32BridgeListenState>('eventa:event:electron:esp32-bridge:listen')
export const esp32BridgeStatusChangeEventa = defineEventa<ESP32BridgeStatus>('eventa:event:electron:esp32-bridge:status-change')
