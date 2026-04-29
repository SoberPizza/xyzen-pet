/**
 * Pinia store for microphone / speaker device selection.
 *
 * Device ids persist in the Rust settings store so the user's mic choice
 * survives restarts and syncs between windows. Enumeration itself stays
 * browser-side — only `navigator.mediaDevices` knows the current device
 * list.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useIpcSetting } from '../ipc/client'

export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const selectedInputDeviceId = useIpcSetting<string>('settings/audio/input-device-id', '')
  const selectedOutputDeviceId = useIpcSetting<string>('settings/audio/output-device-id', '')

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
