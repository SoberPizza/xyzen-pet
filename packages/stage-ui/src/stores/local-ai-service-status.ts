import type { LocalAIServiceStatus, LocalAIStatusResult } from '@proj-airi/stage-shared/local-ai'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'
import { localAIGetStatusEventa } from '@proj-airi/stage-shared/local-ai'
import { useIntervalFn } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const POLL_INTERVAL_MS = 5000

export type LocalAIServiceState = LocalAIServiceStatus['state']

export const useLocalAIServiceStatusStore = defineStore('local-ai-service-status', () => {
  const services = ref<LocalAIServiceStatus[]>([])

  const isElectron = typeof window !== 'undefined' && isElectronWindow(window)

  let invokeGetStatus: (() => Promise<LocalAIStatusResult>) | undefined

  if (isElectron) {
    const { context } = createContext((window as any).electron.ipcRenderer)
    invokeGetStatus = defineInvoke(context, localAIGetStatusEventa)
  }

  async function poll() {
    if (!invokeGetStatus)
      return

    try {
      const result = await invokeGetStatus()
      services.value = result.services
    }
    catch (err) {
      console.warn('[LocalAIServiceStatus] Poll failed:', err)
    }
  }

  // Poll every 5s in Electron; no-op in web
  if (isElectron) {
    useIntervalFn(poll, POLL_INTERVAL_MS, { immediateCallback: true })
  }

  function getServiceState(serviceId: string) {
    return computed<LocalAIServiceState | undefined>(() => {
      const svc = services.value.find(s => s.serviceId === serviceId)
      return svc?.state
    })
  }

  return {
    services,
    getServiceState,
    poll,
  }
})
