/**
 * Xiaozhi ESP32 WebSocket protocol types and binary frame helpers.
 *
 * The device (ESP32) acts as WebSocket server. The PC bridge connects as client.
 * Protocol flow:
 *   1. PC connects to ws://device:port/ws?token=<password>
 *   2. Device sends hello JSON (device capabilities, audio params)
 *   3. PC responds with hello JSON (session_id, protocol version, audio params)
 *   4. Audio channel is now open — binary Opus frames flow both ways
 *   5. JSON control messages (listen, stt, tts, abort, mcp, etc.) flow alongside
 */

// ── JSON message types ──────────────────────────────────────────────

export interface DeviceHello {
  type: 'hello'
  version: number
  features: { mcp?: boolean }
  transport: 'websocket'
  audio_params: {
    format: 'opus'
    sample_rate: number // typically 16000
    channels: number // 1
    frame_duration: number // 60 ms
  }
}

export interface ServerHello {
  type: 'hello'
  version: number
  transport: 'websocket'
  session_id: string
  audio_params: {
    sample_rate: number // server→device sample rate, typically 24000
    frame_duration: number // 60 ms
  }
}

export interface ListenMessage {
  session_id: string
  type: 'listen'
  state: 'start' | 'stop' | 'detect'
  mode?: 'auto' | 'manual' | 'realtime'
  text?: string // wake word text when state=detect
}

export interface SttMessage {
  session_id: string
  type: 'stt'
  text: string
}

export interface TtsMessage {
  session_id: string
  type: 'tts'
  state: 'start' | 'stop' | 'sentence_start'
  text?: string // present when state=sentence_start
}

export interface AbortMessage {
  session_id: string
  type: 'abort'
  reason?: 'wake_word_detected'
}

export interface LlmMessage {
  session_id: string
  type: 'llm'
  emotion?: string
}

export interface McpMessage {
  session_id: string
  type: 'mcp'
  payload: unknown
}

export type DeviceJsonMessage = DeviceHello | ListenMessage | AbortMessage | McpMessage
export type ServerJsonMessage = ServerHello | SttMessage | TtsMessage | LlmMessage | McpMessage

// ── Binary protocol ─────────────────────────────────────────────────

/**
 * Binary protocol version 1: raw Opus payload, no header.
 * Binary protocol version 2: 16-byte header + payload.
 *   [version:u16be][type:u16be][reserved:u32be][timestamp:u32be][payload_size:u32be][payload...]
 * Binary protocol version 3: 4-byte compact header + payload.
 *   [type:u8][reserved:u8][payload_size:u16be][payload...]
 */

export function encodeBinaryFrame(payload: Uint8Array, version: number, timestamp = 0): Buffer {
  if (version === 2) {
    const buf = Buffer.alloc(16 + payload.length)
    buf.writeUInt16BE(version, 0)
    buf.writeUInt16BE(0, 2) // type: 0 = OPUS
    buf.writeUInt32BE(0, 4) // reserved
    buf.writeUInt32BE(timestamp, 8)
    buf.writeUInt32BE(payload.length, 12)
    buf.set(payload, 16)
    return buf
  }

  if (version === 3) {
    const buf = Buffer.alloc(4 + payload.length)
    buf.writeUInt8(0, 0) // type: 0 = OPUS
    buf.writeUInt8(0, 1) // reserved
    buf.writeUInt16BE(payload.length, 2)
    buf.set(payload, 4)
    return buf
  }

  // version 1: raw payload
  return Buffer.from(payload)
}

export interface AudioFrame {
  type: number
  timestamp: number
  payload: Uint8Array
}

export function decodeBinaryFrame(data: Buffer, version: number): AudioFrame {
  if (version === 2) {
    const type = data.readUInt16BE(2)
    const timestamp = data.readUInt32BE(8)
    const payloadSize = data.readUInt32BE(12)
    const payload = data.subarray(16, 16 + payloadSize)
    return { type, timestamp, payload }
  }

  if (version === 3) {
    const type = data.readUInt8(0)
    const payloadSize = data.readUInt16BE(2)
    const payload = data.subarray(4, 4 + payloadSize)
    return { type, timestamp: 0, payload }
  }

  // version 1: entire buffer is payload
  return { type: 0, timestamp: 0, payload: data }
}
