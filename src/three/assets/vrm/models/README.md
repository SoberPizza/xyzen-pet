# Bundled VRM models

Every VRM shipped with the app is authored by the dev team and keyed by
`(raceCode, stage)` — the same identity the backend `vrm_model` catalog
uses. There is no user-upload path. The active buddy's race × stage
resolves to one of these folders at render time.

Each model is a folder here:

    <ModelFolder>/
      <ModelFolder>.vrm         # the VRM (0.x or 1.0 — three-vrm supports both)
      <ModelFolder>.png         # optional preview thumbnail
      animation-driver.ts       # optional — per-model gesture overrides

Naming: use letters, digits, and hyphens/underscores only — no spaces.
Thumbnail: 512×512 PNG with transparent background works well.

## Per-model animation driver (optional)

The backend emits a generic gesture vocabulary (`wave`, `nod`, `yawn`, …);
the frontend owns playback. `animation-driver.ts` lets you override how a
gesture plays on *this specific model* — useful for non-humanoid rigs,
model-specific blendshape names, or dialing intensity/timing to match a
character's temperament. Gestures you don't list fall through to the
global `DEFAULT_GESTURE_ACTIONS` registry.

```ts
// <ModelFolder>/animation-driver.ts
import type { AnimationDriver } from '../../../../composables/vrm/animation-driver'

export const driver: AnimationDriver = {
  raceCode: 'jiuwei',
  stage: 'juvenile',
  gestures: {
    wave: {
      actions: [
        { kind: 'expression', name: 'happy', intensity: 0.9 },
        { kind: 'look', dir: 'lookRight', ms: 500 },
      ],
    },
  },
}
```

The action kinds — `expression` / `look` / `morph` / `clip` — are defined
in `composables/vrm/gesture-driver.ts`; see `DEFAULT_GESTURE_ACTIONS`
there for authored examples covering every backend gesture name.

## Registering the model

Add one entry to `BUNDLED_MODELS` in `buddy/src/stores/display-models.ts`:

```ts
{
  raceCode: 'jiuwei',
  stage: 'juvenile',
  url: new URL('../three/assets/vrm/models/Jiuwei/Jiuwei.vrm', import.meta.url).href,
  previewImage: new URL('../three/assets/vrm/models/Jiuwei/Jiuwei.png', import.meta.url).href,
  name: 'Jiuwei',
  animationDriver: jiuweiDriver,
}
```

The pair `(raceCode, stage)` must be unique across the registry; it
matches the backend `vrm_model` catalog's `(race_code, stage)` unique
constraint. Commit the VRM, thumbnail, driver, and registration together.

## Licensing

VRMs frequently carry attribution or no-commercial-use clauses. Bundling
ships the model to every user, so verify the license on VRoid Hub / Booth /
wherever the model came from before adding it.
