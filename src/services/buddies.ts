/**
 * Typed client for the `/buddies` REST endpoints.
 *
 * The backend splits a buddy into two tables: identity/growth/traits on
 * `buddy`, and the unlocked skin reference on `buddy_appearance`. The actual
 * VRM asset and texture live in catalog tables (`vrm_model`,
 * `appearance_preset`) keyed by race × stage; the store composes them.
 */

import type { HttpClient } from './http'

export type BuddyStage = 'egg' | 'juvenile' | 'adult' | 'metamorphosis'

export type BuddyGender = 'unknown' | 'male' | 'female'

export interface StageHistoryEntry {
  race_code?: string
  stage?: BuddyStage
  entered_at?: string
  appearance_id?: string
  [k: string]: unknown
}

export interface RaceMetadata {
  code: string
  category: string
  attribute: string
  source: string | null
  description: string | null
  tts_voice_female: string | null
  tts_voice_male: string | null
}

export interface BuddyRead {
  id: string
  user_id: string
  name: string
  race_code: string
  stage: BuddyStage
  gender: BuddyGender
  nicknames: string[] | null
  birthday: string | null
  avatar: string | null
  level: number
  xp: number
  stage_started_at: string
  stage_history: StageHistoryEntry[]
  total_interactions: number
  last_interaction_at: string | null
  category_trait_code: string | null
  attribute_trait_code: string | null
  race_trait_code: string | null
  generic_trait_codes: string[]
  active_appearance_id: string | null
  is_active: boolean
  attributes: Record<string, unknown>
  created_at: string
  updated_at: string
  race: RaceMetadata | null
}

export interface BuddyCreate {
  name: string
  race_code?: string
  stage?: BuddyStage
  gender?: BuddyGender
  nicknames?: string[] | null
  birthday?: string | null
  avatar?: string | null
  level?: number
  xp?: number
  stage_started_at?: string
  stage_history?: StageHistoryEntry[]
  total_interactions?: number
  last_interaction_at?: string | null
  category_trait_code?: string | null
  attribute_trait_code?: string | null
  race_trait_code?: string | null
  generic_trait_codes?: string[]
  active_appearance_id?: string | null
  attributes?: Record<string, unknown>
}

export interface BuddyUpdate {
  name?: string
  race_code?: string
  stage?: BuddyStage
  gender?: BuddyGender
  nicknames?: string[] | null
  birthday?: string | null
  avatar?: string | null
  level?: number
  xp?: number
  stage_started_at?: string
  stage_history?: StageHistoryEntry[]
  total_interactions?: number
  last_interaction_at?: string | null
  category_trait_code?: string | null
  attribute_trait_code?: string | null
  race_trait_code?: string | null
  generic_trait_codes?: string[]
  active_appearance_id?: string | null
  attributes?: Record<string, unknown>
}

export interface BuddyAppearanceRead {
  id: string
  user_id: string
  buddy_id: string
  appearance_preset_id: string
  custom_overrides: Record<string, unknown> | null
  is_active: boolean
  unlocked_at: string
  created_at: string
  updated_at: string
}

export interface BuddyAppearanceCreate {
  buddy_id: string
  appearance_preset_id: string
  custom_overrides?: Record<string, unknown> | null
  is_active?: boolean
}

export interface BuddyAppearanceUpdate {
  appearance_preset_id?: string
  custom_overrides?: Record<string, unknown> | null
  is_active?: boolean
}

export interface BuddiesClient {
  list: () => Promise<BuddyRead[]>
  create: (data: BuddyCreate) => Promise<BuddyRead>
  get: (id: string) => Promise<BuddyRead>
  update: (id: string, data: BuddyUpdate) => Promise<BuddyRead>
  delete: (id: string) => Promise<void>
  activate: (id: string) => Promise<BuddyRead>

  listAppearances: (buddyId: string) => Promise<BuddyAppearanceRead[]>
  getActiveAppearance: (buddyId: string) => Promise<BuddyAppearanceRead | null>
  createAppearance: (buddyId: string, data: BuddyAppearanceCreate) => Promise<BuddyAppearanceRead>
  updateAppearance: (
    buddyId: string,
    appearanceId: string,
    data: BuddyAppearanceUpdate,
  ) => Promise<BuddyAppearanceRead>
  activateAppearance: (buddyId: string, appearanceId: string) => Promise<BuddyAppearanceRead>
  deleteAppearance: (buddyId: string, appearanceId: string) => Promise<void>
}

export function createBuddiesClient(http: HttpClient): BuddiesClient {
  return {
    list: () => http.get<BuddyRead[]>('/buddies/'),
    create: data => http.post<BuddyRead>('/buddies/', data),
    get: id => http.get<BuddyRead>(`/buddies/${id}`),
    update: (id, data) => http.patch<BuddyRead>(`/buddies/${id}`, data),
    delete: id => http.del<void>(`/buddies/${id}`),
    activate: id => http.post<BuddyRead>(`/buddies/${id}/activate`, {}),

    listAppearances: buddyId =>
      http.get<BuddyAppearanceRead[]>(`/buddies/${buddyId}/appearances`),
    getActiveAppearance: async (buddyId) => {
      try {
        return await http.get<BuddyAppearanceRead>(`/buddies/${buddyId}/appearances/active`)
      }
      catch {
        return null
      }
    },
    createAppearance: (buddyId, data) =>
      http.post<BuddyAppearanceRead>(`/buddies/${buddyId}/appearances`, data),
    updateAppearance: (buddyId, appearanceId, data) =>
      http.patch<BuddyAppearanceRead>(`/buddies/${buddyId}/appearances/${appearanceId}`, data),
    activateAppearance: (buddyId, appearanceId) =>
      http.post<BuddyAppearanceRead>(
        `/buddies/${buddyId}/appearances/${appearanceId}/activate`,
        {},
      ),
    deleteAppearance: (buddyId, appearanceId) =>
      http.del<void>(`/buddies/${buddyId}/appearances/${appearanceId}`),
  }
}
