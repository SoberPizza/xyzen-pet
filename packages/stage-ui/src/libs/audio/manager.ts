export interface AudioManagerType {
  audioContext: AudioContext
  analyser: AnalyserNode
  dataBuffer: Float32Array<ArrayBuffer>
  frameId: number | null
  onVolumeChange?: (volume: number) => void
}

export function createAudioManager(): AudioManagerType {
  const audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  const dataBuffer = new Float32Array(2048)

  // Connect analyser to destination
  analyser.connect(audioContext.destination)

  return {
    audioContext,
    analyser,
    dataBuffer,
    frameId: null,
    onVolumeChange: undefined,
  }
}

function calculateVolume(manager: AudioManagerType): number {
  manager.analyser.getFloatTimeDomainData(manager.dataBuffer)

  // Find peak volume
  let volume = 0.0
  for (let i = 0; i < manager.dataBuffer.length; i++) {
    volume = Math.max(volume, Math.abs(manager.dataBuffer[i]))
  }

  // Apply sigmoid normalization (from pixiv implementation)
  volume = 1 / (1 + Math.exp(-45 * volume + 5))
  return volume < 0.1 ? 0 : volume
}

function updateFrame(manager: AudioManagerType) {
  if (manager.onVolumeChange) {
    manager.onVolumeChange(calculateVolume(manager))
  }
  manager.frameId = requestAnimationFrame(() => updateFrame(manager))
}

export async function playAudio(manager: AudioManagerType, source: ArrayBuffer | string): Promise<void> {
  try {
    const buffer = typeof source === 'string'
      ? await (await fetch(source)).arrayBuffer()
      : source

    const audioBuffer = await manager.audioContext.decodeAudioData(buffer)
    const bufferSource = manager.audioContext.createBufferSource()

    bufferSource.buffer = audioBuffer
    bufferSource.connect(manager.analyser)
    bufferSource.start()

    return new Promise((resolve) => {
      bufferSource.onended = () => resolve()
    })
  }
  catch (error) {
    console.error('Error playing audio:', error)
    throw error
  }
}

export function startVolumeTracking(manager: AudioManagerType, callback: (volume: number) => void) {
  manager.onVolumeChange = callback
  manager.audioContext.resume()
  updateFrame(manager)
}

export function stopVolumeTracking(manager: AudioManagerType) {
  if (manager.frameId) {
    cancelAnimationFrame(manager.frameId)
    manager.frameId = null
  }
  manager.onVolumeChange = undefined
}

/**
 * Play a stream of WAV audio chunks with minimal gap between them.
 * Each ArrayBuffer from the stream should be a complete, decodable WAV.
 * The first chunk starts playing as soon as it's decoded; subsequent chunks
 * are scheduled to start exactly when the previous one ends (gapless).
 */
export async function playAudioStream(
  manager: AudioManagerType,
  stream: ReadableStream<ArrayBuffer>,
): Promise<void> {
  const reader = stream.getReader()
  // Track when the last scheduled source ends so we can append seamlessly
  let nextStartTime = manager.audioContext.currentTime
  let lastSourceEnded: Promise<void> = Promise.resolve()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const audioBuffer = await manager.audioContext.decodeAudioData(value)
      const source = manager.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(manager.analyser)

      // Schedule this chunk right after the previous one
      const startAt = Math.max(nextStartTime, manager.audioContext.currentTime)
      source.start(startAt)
      nextStartTime = startAt + audioBuffer.duration

      // Track when this source finishes so we can await all playback
      lastSourceEnded = new Promise(resolve => source.onended = () => resolve())
    }
  }
  finally {
    reader.releaseLock()
  }

  // Wait for the last chunk to finish playing
  await lastSourceEnded
}

export function disposeAudioManager(manager: AudioManagerType) {
  stopVolumeTracking(manager)
  manager.audioContext.close()
}
