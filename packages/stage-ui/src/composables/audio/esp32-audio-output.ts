import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import {
  esp32BridgeSendAudioEventa,
  esp32BridgeSendTtsStateEventa,
} from '@proj-airi/stage-shared/esp32-bridge'

/** Convert an AudioBuffer (float32 [-1,1]) to mono PCM16. */
function audioBufferToPCM16(buffer: AudioBuffer): Int16Array {
  const channelData = buffer.getChannelData(0)
  const pcm16 = new Int16Array(channelData.length)
  for (let i = 0; i < channelData.length; i++)
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(channelData[i] * 32767)))
  return pcm16
}

/**
 * Composable that sends TTS audio to an ESP32 device via IPC.
 *
 * The renderer converts AudioBuffer → PCM16 and sends it to the main process,
 * which handles Opus encoding and WebSocket delivery.
 * Only usable in Electron renderer context.
 */
export function useESP32AudioOutput() {
  let invokeSendAudio: ((payload: { pcm16: Int16Array, sampleRate: number }) => Promise<void>) | undefined
  let invokeSendTtsState: ((payload: { state: 'start' | 'stop' | 'sentence_start', text?: string }) => Promise<void>) | undefined

  function init() {
    if (invokeSendAudio)
      return

    try {
      const { context } = createContext((window as any).electron.ipcRenderer)
      invokeSendAudio = defineInvoke(context, esp32BridgeSendAudioEventa)
      invokeSendTtsState = defineInvoke(context, esp32BridgeSendTtsStateEventa)
    }
    catch {
      // Not in Electron context
    }
  }

  /** Send an AudioBuffer as PCM16 to ESP32 via the main process. */
  async function sendAudio(audioBuffer: AudioBuffer): Promise<void> {
    init()
    if (!invokeSendAudio)
      return
    const pcm16 = audioBufferToPCM16(audioBuffer)
    await invokeSendAudio({ pcm16, sampleRate: audioBuffer.sampleRate })
  }

  /** Signal TTS playback state to ESP32 device. */
  async function sendTtsState(state: 'start' | 'stop' | 'sentence_start', text?: string): Promise<void> {
    init()
    if (!invokeSendTtsState)
      return
    await invokeSendTtsState({ state, text })
  }

  function dispose() {
    invokeSendAudio = undefined
    invokeSendTtsState = undefined
  }

  return {
    sendAudio,
    sendTtsState,
    dispose,
  }
}
