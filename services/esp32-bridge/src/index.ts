import { XiaozhiBridge } from './bridge.js'

const DEVICE_URL = process.env.DEVICE_URL || 'ws://192.168.31.214:8080/ws'
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'xiaozhi123'
const PROTOCOL_VERSION = Number(process.env.PROTOCOL_VERSION || '1')

const url = `${DEVICE_URL}?token=${DEVICE_TOKEN}`

const bridge = new XiaozhiBridge({
  url,
  protocolVersion: PROTOCOL_VERSION,
  autoReconnect: true,
  reconnectDelay: 3000,
})

bridge.on('connected', (deviceHello) => {
  console.log(`[main] Connected! session=${bridge.currentSessionId}`)
  console.log(`[main] Device audio: ${deviceHello.audio_params.format} ${deviceHello.audio_params.sample_rate}Hz, ${deviceHello.audio_params.frame_duration}ms frames`)
  console.log(`[main] Features: mcp=${deviceHello.features.mcp}`)
})

bridge.on('disconnected', (code, reason) => {
  console.log(`[main] Disconnected: ${code} ${reason}`)
})

bridge.on('audio-channel-opened', (sessionId) => {
  console.log(`[main] Audio channel opened, session: ${sessionId}`)
})

bridge.on('audio-channel-closed', () => {
  console.log('[main] Audio channel closed')
})

bridge.on('audio', (frame) => {
  console.log(`[main] Audio frame: ${frame.payload.length} bytes, ts=${frame.timestamp}`)
  // TODO: forward to ASR service
})

bridge.on('listen', (msg) => {
  console.log(`[main] Listen: state=${msg.state}, mode=${msg.mode ?? 'n/a'}, text=${msg.text ?? ''}`)
  // state=detect → wake word detected, text has the wake word
  // state=start  → device started listening (VAD triggered or button press)
  // state=stop   → device stopped listening (VAD silence or button release)
})

bridge.on('abort', (msg) => {
  console.log(`[main] Abort: reason=${msg.reason ?? 'none'}`)
})

bridge.on('mcp', (payload) => {
  console.log('[main] MCP:', JSON.stringify(payload))
})

bridge.on('error', (err) => {
  console.error('[main] Error:', err.message)
})

// Start connection
console.log(`[main] ESP32 Bridge starting...`)
console.log(`[main] Device: ${DEVICE_URL}`)
console.log(`[main] Protocol version: ${PROTOCOL_VERSION}`)
bridge.connect()

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[main] Shutting down...')
  bridge.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  bridge.disconnect()
  process.exit(0)
})
