import type { VRM } from '@pixiv/three-vrm'
import type { AnimationMixer, Group } from 'three'

import type { useVRMEmote } from '../../composables/vrm/expression'

export interface ManagedVrmInstance {
  emote: ReturnType<typeof useVRMEmote>
  group: Group
  mixer: AnimationMixer
  modelSrc: string
  scopeKey: string
  vrm: VRM
}

interface ManagedVrmCacheState {
  detachedByScope: Record<string, ManagedVrmInstance | undefined>
}

const hotData = import.meta.hot?.data as { managedVrmCacheState?: ManagedVrmCacheState } | undefined

const managedVrmCacheState = hotData?.managedVrmCacheState ?? { detachedByScope: {} }

if (import.meta.hot)
  import.meta.hot.data.managedVrmCacheState = managedVrmCacheState

export function takeManagedVrmInstance(scopeKey: string, modelSrc: string) {
  const cached = managedVrmCacheState.detachedByScope[scopeKey]
  if (!cached || cached.modelSrc !== modelSrc) {
    if (import.meta.env.DEV)
      console.debug('[vrm-cache] take miss', scopeKey, modelSrc)
    return undefined
  }

  delete managedVrmCacheState.detachedByScope[scopeKey]
  if (import.meta.env.DEV)
    console.debug('[vrm-cache] take hit', scopeKey, modelSrc)
  return cached
}

export function stashManagedVrmInstance(instance: ManagedVrmInstance) {
  const { scopeKey } = instance
  const previous = managedVrmCacheState.detachedByScope[scopeKey]
  managedVrmCacheState.detachedByScope[scopeKey] = instance

  if (previous === instance) {
    return undefined
  }

  if (previous) {
    if (import.meta.env.DEV)
      console.debug('[vrm-cache] stash evicted', scopeKey, instance.modelSrc)
    return previous
  }

  if (import.meta.env.DEV)
    console.debug('[vrm-cache] stash stored', scopeKey, instance.modelSrc)
  return undefined
}

export function clearManagedVrmInstance(scopeKey: string) {
  const cached = managedVrmCacheState.detachedByScope[scopeKey]
  delete managedVrmCacheState.detachedByScope[scopeKey]

  if (cached) {
    if (import.meta.env.DEV)
      console.debug('[vrm-cache] clear hit', scopeKey, cached.modelSrc)
    return cached
  }

  if (import.meta.env.DEV)
    console.debug('[vrm-cache] clear empty', scopeKey)
  return undefined
}
