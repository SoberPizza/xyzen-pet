/**
 * Pinia store for microphone / speaker device selection.
 *
 * Used by `useVoiceMic` to pick an explicit `deviceId` in the
 * `getUserMedia` constraints, and by the Settings UI to list devices.
 * Both input and output devices are tracked, but buddy only needs the
 * input selection for voice capture; output selection is reserved for
 * future use (the current playback path goes through the default
 * AudioContext destination).
 */

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const selectedInputDeviceId = useLocalStorage<string>('settings/audio/input-device-id', '')
  const selectedOutputDeviceId = useLocalStorage<string>('settings/audio/output-device-id', '')

  const audioInputs = ref<MediaDeviceInfo[]>([])
  const audioOutputs = ref<MediaDeviceInfo[]>([])

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      audioInputs.value = devices.filter(d => d.kind === 'audioinput')
      audioOutputs.value = devices.filter(d => d.kind === 'audiooutput')
    }
    catch (err) {
      console.warn('[audio-device] Failed to enumerate devices:', err)
    }
  }

  async function askPermission() {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      tempStream.getTracks().forEach(t => t.stop())
      await refreshDevices()
    }
    catch (err) {
      console.warn('[audio-device] Permission denied:', err)
    }
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      refreshDevices()
    })
  }

  function resetState() {
    selectedInputDeviceId.value = ''
    selectedOutputDeviceId.value = ''
  }

  return {
    selectedInputDeviceId,
    selectedOutputDeviceId,
    audioInputs,
    audioOutputs,

    askPermission,
    refreshDevices,
    resetState,
  }
})
