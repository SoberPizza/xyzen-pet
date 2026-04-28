/**
 * Pinia store for the user's buddies — roster + active selection.
 *
 * Loads buddies from the backend via the `/buddies` REST endpoints,
 * mirrors them into an IndexedDB cache (`buddy-cache`) so reloads can
 * show the roster while the network fetch races, and exposes
 * `activeBuddy` / `activeBuddyId` for the rest of the app (VRM stage,
 * CEO-chat wake-word config). `initialize({ force })` is the single
 * entrypoint — App.vue calls it on mount; SettingsDialog retries it on
 * user demand.
 */

import type {
  BuddyCreate,
  BuddyGender,
  BuddyRead,
  BuddyStage,
  BuddyUpdate,
  RaceMetadata,
} from '../services/xyzen/buddies'

import localforage from 'localforage'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { initXyzen } from '../services/xyzen'
import { HttpError } from '../services/xyzen/http'

export type BuddyLoadErrorKind = 'auth' | 'network' | 'unknown'

export interface BuddyLoadError {
  kind: BuddyLoadErrorKind
  message: string
}

function classifyError(err: unknown): BuddyLoadError {
  if (err instanceof HttpError) {
    return {
      kind: err.status === 401 || err.status === 403 ? 'auth' : 'unknown',
      message: err.message,
    }
  }
  // `fetch` rejects with TypeError for offline / DNS / CORS-abort cases;
  // AbortError fires on our 20s timeout. Both mean the request never
  // reached the server — treat as network for UX purposes.
  if (err instanceof TypeError || (err instanceof Error && err.name === 'AbortError')) {
    return { kind: 'network', message: err.message }
  }
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

// Isolated IndexedDB instance so the buddy cache can't collide with the
// display-models store (which uses the default localforage instance).
const buddyCacheStore = localforage.createInstance({ name: 'buddy-cache' })
const BUDDY_CACHE_KEY = 'buddies:v1'

async function readBuddyCache(): Promise<Record<string, Buddy>> {
  try {
    return (await buddyCacheStore.getItem<Record<string, Buddy>>(BUDDY_CACHE_KEY)) ?? {}
  }
  catch {
    return {}
  }
}

async function writeBuddyCache(map: Record<string, Buddy>): Promise<void> {
  try {
    await buddyCacheStore.setItem(BUDDY_CACHE_KEY, map)
  }
  catch {}
}

async function clearBuddyCache(): Promise<void> {
  try {
    await buddyCacheStore.removeItem(BUDDY_CACHE_KEY)
  }
  catch {}
}

export interface Buddy {
  name: string
  nicknames?: string[]
  birthday?: string
  avatar?: string
  raceCode: string
  stage: BuddyStage
  gender: BuddyGender
  level: number
  xp: number
  totalInteractions: number
  lastInteractionAt?: string
  attributes: Record<string, unknown>

  categoryTraitCode?: string
  attributeTraitCode?: string
  raceTraitCode?: string
  genericTraitCodes: string[]

  activeAppearanceId?: string
  isActive: boolean
  race: RaceMetadata | null
}

const DEFAULT_RACE_CODE = 'egg'
const DEFAULT_STAGE: BuddyStage = 'egg'
const DEFAULT_GENDER: BuddyGender = 'unknown'

function toBuddy(row: BuddyRead): Buddy {
  return {
    name: row.name,
    nicknames: row.nicknames ?? undefined,
    birthday: row.birthday ?? undefined,
    avatar: row.avatar ?? undefined,
    raceCode: row.race_code,
    stage: row.stage,
    gender: row.gender,
    level: row.level,
    xp: row.xp,
    totalInteractions: row.total_interactions,
    lastInteractionAt: row.last_interaction_at ?? undefined,
    attributes: row.attributes ?? {},
    categoryTraitCode: row.category_trait_code ?? undefined,
    attributeTraitCode: row.attribute_trait_code ?? undefined,
    raceTraitCode: row.race_trait_code ?? undefined,
    genericTraitCodes: row.generic_trait_codes ?? [],
    activeAppearanceId: row.active_appearance_id ?? undefined,
    isActive: row.is_active,
    race: row.race ?? null,
  }
}

function buddyToCreatePayload(buddy: Buddy): BuddyCreate {
  return {
    name: buddy.name,
    race_code: buddy.raceCode || DEFAULT_RACE_CODE,
    stage: buddy.stage || DEFAULT_STAGE,
    gender: buddy.gender || DEFAULT_GENDER,
    nicknames: buddy.nicknames && buddy.nicknames.length > 0 ? buddy.nicknames : null,
    birthday: buddy.birthday ?? null,
    avatar: buddy.avatar ?? null,
    generic_trait_codes: buddy.genericTraitCodes ?? [],
    attributes: buddy.attributes ?? {},
  }
}

function buddyPatchToUpdatePayload(patch: Partial<Buddy>): BuddyUpdate {
  const update: BuddyUpdate = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.raceCode !== undefined) update.race_code = patch.raceCode
  if (patch.stage !== undefined) update.stage = patch.stage
  if (patch.gender !== undefined) update.gender = patch.gender
  if (patch.nicknames !== undefined)
    update.nicknames = patch.nicknames.length > 0 ? patch.nicknames : null
  if (patch.birthday !== undefined) update.birthday = patch.birthday ?? null
  if (patch.avatar !== undefined) update.avatar = patch.avatar ?? null
  if (patch.level !== undefined) update.level = patch.level
  if (patch.xp !== undefined) update.xp = patch.xp
  if (patch.totalInteractions !== undefined) update.total_interactions = patch.totalInteractions
  if (patch.lastInteractionAt !== undefined)
    update.last_interaction_at = patch.lastInteractionAt ?? null
  if (patch.genericTraitCodes !== undefined) update.generic_trait_codes = patch.genericTraitCodes
  if (patch.attributes !== undefined) update.attributes = patch.attributes
  return update
}

function hasBuddyRowPatch(patch: Partial<Buddy>): boolean {
  return (
    patch.name !== undefined
    || patch.raceCode !== undefined
    || patch.stage !== undefined
    || patch.gender !== undefined
    || patch.nicknames !== undefined
    || patch.birthday !== undefined
    || patch.avatar !== undefined
    || patch.level !== undefined
    || patch.xp !== undefined
    || patch.totalInteractions !== undefined
    || patch.lastInteractionAt !== undefined
    || patch.genericTraitCodes !== undefined
    || patch.attributes !== undefined
  )
}

export const useBuddyStore = defineStore('buddy', () => {
  const buddies = ref<Record<string, Buddy>>({})
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<BuddyLoadError | null>(null)
  const fromCache = ref(false)
  let initPromise: Promise<void> | null = null

  // Derived from the authoritative `is_active` flag on each buddy. The
  // backend guarantees exactly one row per user has `is_active=true`, so
  // the first match wins.
  const activeBuddyId = computed<string>(() => {
    for (const [id, b] of Object.entries(buddies.value)) {
      if (b.isActive) return id
    }
    return ''
  })
  const activeBuddy = computed(() => buddies.value[activeBuddyId.value])

  async function addBuddy(buddy: Buddy): Promise<string> {
    const { buddies: api } = await initXyzen()
    const created = await api.create(buddyToCreatePayload(buddy))
    buddies.value = { ...buddies.value, [created.id]: toBuddy(created) }
    void writeBuddyCache(buddies.value)
    return created.id
  }

  async function removeBuddy(id: string): Promise<void> {
    const { buddies: api } = await initXyzen()
    await api.delete(id)
    // Re-sync from the backend so we pick up any auto-promoted active
    // buddy (the API bumps the oldest remaining row to active when the
    // deleted one was active).
    const list = await api.list()
    const next: Record<string, Buddy> = {}
    for (const row of list) next[row.id] = toBuddy(row)
    buddies.value = next
    void writeBuddyCache(next)
  }

  async function updateBuddy(id: string, updates: Partial<Buddy>): Promise<boolean> {
    const existing = buddies.value[id]
    if (!existing)
      return false
    const { buddies: api } = await initXyzen()

    let rowAfter: BuddyRead
    if (hasBuddyRowPatch(updates))
      rowAfter = await api.update(id, buddyPatchToUpdatePayload(updates))
    else
      rowAfter = await api.get(id)

    const nextBuddy = toBuddy(rowAfter)
    buddies.value = { ...buddies.value, [id]: nextBuddy }
    void writeBuddyCache(buddies.value)
    return true
  }

  async function activateBuddy(id: string): Promise<void> {
    if (!buddies.value[id]) return
    const { buddies: api } = await initXyzen()
    const activated = await api.activate(id)
    // Locally enforce the "exactly one active" invariant. We trust the
    // backend's response for the activated row, and flip every other
    // buddy's flag off so the derived `activeBuddyId` updates atomically.
    const next: Record<string, Buddy> = {}
    for (const [bid, b] of Object.entries(buddies.value))
      next[bid] = bid === activated.id ? toBuddy(activated) : { ...b, isActive: false }
    buddies.value = next
    void writeBuddyCache(next)
  }

  function getBuddy(id: string): Buddy | undefined {
    return buddies.value[id]
  }

  async function initialize(options: { force?: boolean } = {}): Promise<void> {
    if (loaded.value && !options.force) return
    if (initPromise) return initPromise

    loading.value = true
    error.value = null
    initPromise = (async () => {
      // Paint cached data first so the UI has something to show even
      // if the backend is unreachable (offline or network fluctuation).
      const cached = await readBuddyCache()
      const hasCache = Object.keys(cached).length > 0
      if (hasCache) {
        buddies.value = cached
        fromCache.value = true
      }

      try {
        const { buddies: api } = await initXyzen()
        const list = await api.list()
        if (list.length === 0) {
          // Backend is responsible for default-Buddy creation via
          // `ensure_default_buddy` on GET /buddies/ and on WS connect.
          fromCache.value = false
          loaded.value = true
          return
        }
        const next: Record<string, Buddy> = {}
        for (const row of list)
          next[row.id] = toBuddy(row)
        buddies.value = next
        void writeBuddyCache(next)
        fromCache.value = false
        loaded.value = true
      }
      catch (err) {
        // If we at least have a cached copy the UI stays usable —
        // record the error for the Settings UI but don't throw.
        error.value = classifyError(err)
        if (hasCache) {
          loaded.value = true
          return
        }
        throw err
      }
    })().finally(() => {
      loading.value = false
      initPromise = null
    })
    return initPromise
  }

  function resetState() {
    buddies.value = {}
    loaded.value = false
    loading.value = false
    error.value = null
    fromCache.value = false
    initPromise = null
    void clearBuddyCache()
  }

  return {
    buddies,
    activeBuddy,
    activeBuddyId,
    loaded,
    loading,
    error,
    fromCache,
    addBuddy,
    removeBuddy,
    updateBuddy,
    activateBuddy,
    getBuddy,
    resetState,
    initialize,

    systemPrompt: computed(() => {
      const buddy = activeBuddy.value
      if (!buddy)
        return ''

      const traitCodes = [
        buddy.categoryTraitCode,
        buddy.attributeTraitCode,
        buddy.raceTraitCode,
        ...buddy.genericTraitCodes,
      ].filter((code): code is string => Boolean(code))

      return [
        buddy.race?.description ?? '',
        traitCodes.join(', '),
      ].filter(Boolean).join('\n')
    }),
  }
})
