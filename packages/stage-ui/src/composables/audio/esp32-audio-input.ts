import type { ESP32BridgeListenState, ESP32BridgeStatus } from '@proj-airi/stage-shared/esp32-bridge'

import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import {
  esp32BridgeAudioEventa,
  esp32BridgeListenEventa,
  esp32BridgeStatusChangeEventa,
} from '@proj-airi/stage-shared/esp32-bridge'
import { ref } from 'vue'

/**
 * Composable that bridges ESP32 audio data from the Electron main process
 * into a ReadableStream compatible with the hearing pipeline's `externalAudioStream`.
 *
 * ESP32 sends Opus frames to main process, which decodes them to PCM16 and
 * forwards via IPC. This composable receives those PCM16 buffers and provides:
 * - A ReadableStream<ArrayBuffer> for the STT pipeline
 * - An isSpeech ref driven by ESP32's hardware VAD (listen events)
 */
export function useESP32AudioInput() {
  const isSpeech = ref(false)
  const isConnected = ref(false)
  const connectionStatus = ref<ESP32BridgeStatus>({ state: 'disconnected' })

  let streamController: ReadableStreamDefaultController<ArrayBuffer> | null = null
  let audioStream: ReadableStream<ArrayBuffer> | null = null
  let cleanupListeners: (() => void) | null = null

  function createAudioStream(): ReadableStream<ArrayBuffer> {
    if (audioStream)
      return audioStream

    audioStream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        streamController = controller
      },
      cancel() {
        streamController = null
      },
    })

    return audioStream
  }

  /** Feed PCM16 audio data into the stream (called from IPC listener) */
  function feedAudio(pcm16: Int16Array) {
    if (!streamController)
      return
    // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
    const copy = new ArrayBuffer(pcm16.byteLength)
    new Int16Array(copy).set(pcm16)
    streamController.enqueue(copy)
  }

  /** Handle ESP32 VAD listen state changes */
  function handleListenState(state: ESP32BridgeListenState) {
    if (state.state === 'start' || state.state === 'detect') {
      isSpeech.value = true
    }
    else if (state.state === 'stop') {
      isSpeech.value = false
    }
  }

  /** Handle ESP32 connection status changes */
  function handleStatusChange(status: ESP32BridgeStatus) {
    connectionStatus.value = status
    isConnected.value = status.state === 'connected'

    if (status.state === 'disconnected' || status.state === 'error') {
      isSpeech.value = false
    }
  }

  /**
   * Start listening for ESP32 audio and VAD events via Eventa IPC.
   * Only call this in Electron renderer context.
   */
  function start() {
    const { context } = createContext((window as any).electron.ipcRenderer)

    const offAudio = context.on(esp32BridgeAudioEventa, (event) => {
      if (event.body)
        feedAudio(event.body.pcm16)
    })

    const offListen = context.on(esp32BridgeListenEventa, (event) => {
      if (event.body)
        handleListenState(event.body)
    })

    const offStatus = context.on(esp32BridgeStatusChangeEventa, (event) => {
      if (event.body)
        handleStatusChange(event.body)
    })

    cleanupListeners = () => {
      offAudio()
      offListen()
      offStatus()
    }

    createAudioStream()
  }

  function dispose() {
    cleanupListeners?.()
    cleanupListeners = null

    if (streamController) {
      try {
        streamController.close()
      }
      catch {
        // Stream already closed
      }
      streamController = null
    }

    audioStream = null
    isSpeech.value = false
    isConnected.value = false
    connectionStatus.value = { state: 'disconnected' }
  }

  return {
    isSpeech,
    isConnected,
    connectionStatus,
    audioStream: {
      get stream() { return audioStream ?? createAudioStream() },
    },
    start,
    dispose,
    feedAudio,
    handleListenState,
    handleStatusChange,
  }
}
