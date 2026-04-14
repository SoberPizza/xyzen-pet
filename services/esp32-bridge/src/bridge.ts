import type {
  AbortMessage,
  AudioFrame,
  DeviceHello,
  ListenMessage,
  ServerHello,
} from './protocol.js'

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { WebSocket } from 'ws'

import { decodeBinaryFrame, encodeBinaryFrame } from './protocol.js'

export interface BridgeOptions {
  /** Full WebSocket URL, e.g. ws://192.168.31.214:8080/ws?token=xiaozhi123 */
  url: string
  /** Protocol version to negotiate (default: 1) */
  protocolVersion?: number
  /** Sample rate for server→device audio (default: 24000) */
  serverSampleRate?: number
  /** Frame duration in ms (default: 60) */
  frameDuration?: number
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number
}

export interface BridgeEvents {
  /** WebSocket connection established (token accepted, ready for hello handshake) */
  'ws-connected': []
  /** Device hello received and audio channel opened */
  'connected': [deviceHello: DeviceHello]
  /** WebSocket closed */
  'disconnected': [code: number, reason: string]
  /** Audio channel is open (hello handshake completed) */
  'audio-channel-opened': [sessionId: string]
  /** Audio channel closed */
  'audio-channel-closed': []
  /** Opus audio frame received from device */
  'audio': [frame: AudioFrame]
  /** Device started/stopped listening */
  'listen': [msg: ListenMessage]
  /** Device sent abort */
  'abort': [msg: AbortMessage]
  /** Device sent MCP message */
  'mcp': [payload: unknown]
  /** Any JSON message from device (raw) */
  'json': [msg: Record<string, unknown>]
  /** Error */
  'error': [err: Error]
}

export class XiaozhiBridge extends EventEmitter<BridgeEvents> {
  private ws: WebSocket | null = null
  private sessionId = ''
  private protocolVersion: number
  private serverSampleRate: number
  private frameDuration: number
  private channelOpen = false
  private deviceHello: DeviceHello | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalClose = false

  constructor(private options: BridgeOptions) {
    super()
    this.protocolVersion = options.protocolVersion ?? 1
    this.serverSampleRate = options.serverSampleRate ?? 24000
    this.frameDuration = options.frameDuration ?? 60
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get audioChannelOpen(): boolean {
    return this.channelOpen
  }

  get currentSessionId(): string {
    return this.sessionId
  }

  connect(): void {
    this.intentionalClose = false
    this.cleanup()

    console.log(`[bridge] Connecting to ${this.options.url}`)
    const ws = new WebSocket(this.options.url)
    this.ws = ws

    ws.on('open', () => {
      console.log('[bridge] WebSocket connected, waiting for device to start listening...')
      this.emit('ws-connected')
    })

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        this.handleBinaryFrame(data)
      }
      else {
        this.handleTextFrame(data.toString('utf-8'))
      }
    })

    ws.on('close', (code, reason) => {
      const reasonStr = reason.toString('utf-8')
      console.log(`[bridge] WebSocket closed: ${code} ${reasonStr}`)

      if (this.channelOpen) {
        this.channelOpen = false
        this.emit('audio-channel-closed')
      }

      this.emit('disconnected', code, reasonStr)
      this.ws = null
      this.deviceHello = null

      if (!this.intentionalClose && (this.options.autoReconnect ?? true)) {
        const delay = this.options.reconnectDelay ?? 3000
        console.log(`[bridge] Reconnecting in ${delay}ms...`)
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
      }
    })

    ws.on('error', (err) => {
      console.error('[bridge] WebSocket error:', err.message)
      this.emit('error', err)
    })
  }

  disconnect(): void {
    this.intentionalClose = true
    this.cleanup()
  }

  /** Send an Opus audio frame to the device */
  sendAudio(opusPayload: Uint8Array, timestamp = 0): boolean {
    if (!this.channelOpen || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    const frame = encodeBinaryFrame(opusPayload, this.protocolVersion, timestamp)
    this.ws.send(frame)
    return true
  }

  /** Send STT result to device */
  sendStt(text: string): void {
    this.sendJson({ session_id: this.sessionId, type: 'stt', text })
  }

  /** Signal TTS state to device */
  sendTtsState(state: 'start' | 'stop' | 'sentence_start', text?: string): void {
    const msg: Record<string, unknown> = { session_id: this.sessionId, type: 'tts', state }
    if (text !== undefined)
      msg.text = text
    this.sendJson(msg)
  }

  /** Send LLM emotion to device */
  sendEmotion(emotion: string): void {
    this.sendJson({ session_id: this.sessionId, type: 'llm', emotion })
  }

  /** Send MCP message to device */
  sendMcp(payload: unknown): void {
    this.sendJson({ session_id: this.sessionId, type: 'mcp', payload })
  }

  /** Send arbitrary JSON to device */
  sendJson(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      return
    this.ws.send(JSON.stringify(obj))
  }

  // ── Private ──────────────────────────────────────────────────────

  private handleTextFrame(text: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text)
    }
    catch {
      console.error('[bridge] Failed to parse JSON:', text)
      return
    }

    this.emit('json', msg)

    const type = msg.type as string
    if (type === 'hello') {
      this.handleDeviceHello(msg as unknown as DeviceHello)
    }
    else if (type === 'listen') {
      this.emit('listen', msg as unknown as ListenMessage)
    }
    else if (type === 'abort') {
      this.emit('abort', msg as unknown as AbortMessage)
    }
    else if (type === 'mcp') {
      this.emit('mcp', msg.payload)
    }
  }

  private handleDeviceHello(hello: DeviceHello): void {
    console.log('[bridge] Received device hello:', JSON.stringify(hello))
    this.deviceHello = hello

    // Negotiate protocol version: use device's version if we don't override
    const version = this.protocolVersion || hello.version || 1
    this.protocolVersion = version
    this.sessionId = randomUUID()

    const serverHello: ServerHello = {
      type: 'hello',
      version,
      transport: 'websocket',
      session_id: this.sessionId,
      audio_params: {
        sample_rate: this.serverSampleRate,
        frame_duration: this.frameDuration,
      },
    }

    console.log('[bridge] Sending server hello:', JSON.stringify(serverHello))
    this.ws!.send(JSON.stringify(serverHello))

    this.channelOpen = true
    this.emit('connected', hello)
    this.emit('audio-channel-opened', this.sessionId)
  }

  private handleBinaryFrame(data: Buffer): void {
    if (!this.channelOpen)
      return
    const frame = decodeBinaryFrame(data, this.protocolVersion)
    this.emit('audio', frame)
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
    if (this.channelOpen) {
      this.channelOpen = false
      this.emit('audio-channel-closed')
    }
  }
}
