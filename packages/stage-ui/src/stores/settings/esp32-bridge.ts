import type { ESP32BridgeStatus } from '@proj-airi/stage-shared/esp32-bridge'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsESP32Bridge = defineStore('settings-esp32-bridge', () => {
  const deviceUrl = useLocalStorageManualReset<string>('settings/esp32-bridge/device-url', 'ws://192.168.31.214:8080/ws')
  const deviceToken = useLocalStorageManualReset<string>('settings/esp32-bridge/device-token', 'xiaozhi123')
  const protocolVersion = useLocalStorageManualReset<number>('settings/esp32-bridge/protocol-version', 1)

  const connectionStatus = ref<ESP32BridgeStatus>({ state: 'disconnected' })

  function resetState() {
    deviceUrl.reset()
    deviceToken.reset()
    protocolVersion.reset()
    connectionStatus.value = { state: 'disconnected' }
  }

  return {
    deviceUrl,
    deviceToken,
    protocolVersion,
    connectionStatus,
    resetState,
  }
})
