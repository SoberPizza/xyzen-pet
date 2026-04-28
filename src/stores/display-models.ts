import { defineStore } from 'pinia'

import type { BuddyStage } from '../services/xyzen/buddies'
import type { AnimationDriver } from '../three/composables/vrm/animation-driver'
import type { VrmDisplayConfig } from '../three/composables/vrm/core'

import { driver as buddyEggDriver } from '../three/assets/vrm/models/buddy_egg/animation-driver'
import { driver as jiuweiDriver } from '../three/assets/vrm/models/Jiuwei/animation-driver'

/**
 * A bundled VRM model keyed by (raceCode, stage). Every buddy's stage VRM
 * resolves through this registry — there is no user-upload path, so the
 * dev team owns every model shipped with the app.
 */
export interface BundledVrmModel {
  raceCode: string
  stage: BuddyStage
  url: string
  name: string
  previewImage?: string
  animationDriver?: AnimationDriver
  /** Per-model overrides for initial camera framing / orientation. */
  displayConfig?: VrmDisplayConfig
}

const BUNDLED_MODELS: BundledVrmModel[] = [
  {
    raceCode: 'egg',
    stage: 'egg',
    url: new URL('../three/assets/vrm/models/buddy_egg/buddy_egg.vrm', import.meta.url).href,
    name: 'Buddy Egg',
    animationDriver: buddyEggDriver,
    // Egg is compact + non-humanoid: show the back of the shell by default,
    // pull the camera back so the whole body fits, and skip the chest-bias
    // pivot so it sits centered in the 240×320 overlay.
    displayConfig: { initialYawDeg: 180, fitDivisor: 2, pivotYBias: 0 },
  },
  {
    raceCode: 'jiuwei',
    stage: 'juvenile',
    url: new URL('../three/assets/vrm/models/Jiuwei/Jiuwei.vrm', import.meta.url).href,
    previewImage: new URL('../three/assets/vrm/models/Jiuwei/Jiuwei.png', import.meta.url).href,
    name: 'Jiuwei',
    animationDriver: jiuweiDriver,
  },
]

function keyFor(raceCode: string, stage: BuddyStage): string {
  return `${raceCode}:${stage}`
}

const BUNDLED_INDEX = new Map<string, BundledVrmModel>(
  BUNDLED_MODELS.map(m => [keyFor(m.raceCode, m.stage), m]),
)

export const useDisplayModelsStore = defineStore('display-models', () => {
  function getVrmByRaceStage(raceCode: string | undefined, stage: BuddyStage | undefined): BundledVrmModel | undefined {
    if (!raceCode || !stage) {
      console.debug('[buddy:vrm] registry lookup skipped — missing raceCode or stage', { raceCode, stage })
      return undefined
    }
    const key = keyFor(raceCode, stage)
    const match = BUNDLED_INDEX.get(key)
    if (match) {
      console.info('[buddy:vrm] registry hit', { key, name: match.name, url: match.url })
    } else {
      console.warn('[buddy:vrm] registry miss — no bundled VRM for race×stage', {
        key,
        available: [...BUNDLED_INDEX.keys()],
      })
    }
    return match
  }

  return {
    bundledModels: BUNDLED_MODELS,
    getVrmByRaceStage,
  }
})
