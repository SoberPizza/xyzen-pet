import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

function calculateVolumeWithLinearNormalize(analyser: AnalyserNode) {
  const dataBuffer = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(dataBuffer)

  const volumeSum = dataBuffer
    .map(v => v ** 1.2)
    .map(v => v * 1.2)
    .reduce((acc, cur) => acc + cur, 0)

  return (volumeSum / dataBuffer.length / 100)
}

function calculateVolumeWithMinMaxNormalize(analyser: AnalyserNode) {
  const dataBuffer = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(dataBuffer)

  const amplifiedVolumeVector = dataBuffer.map(v => v ** 1.5)

  const min = Math.min(...amplifiedVolumeVector)
  const max = Math.max(...amplifiedVolumeVector)
  const range = max - min

  let normalizedVolumeVector
  if (range === 0) {
    normalizedVolumeVector = amplifiedVolumeVector.map(() => 0)
  }
  else {
    normalizedVolumeVector = amplifiedVolumeVector.map(v => (v - min) / range)
  }

  const volumeSum = normalizedVolumeVector.reduce((acc, cur) => acc + cur, 0)

  return volumeSum / dataBuffer.length
}

function calculateVolume(analyser: AnalyserNode, mode: 'linear' | 'minmax' = 'linear') {
  switch (mode) {
    case 'linear':
      return calculateVolumeWithLinearNormalize(analyser)
    case 'minmax':
      return calculateVolumeWithMinMaxNormalize(analyser)
  }
}

export const useAudioContext = defineStore('audio-context', () => {
  const audioContext = shallowRef<AudioContext>(new AudioContext())

  return {
    audioContext,
    calculateVolume,
  }
})
