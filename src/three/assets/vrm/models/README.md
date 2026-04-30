# Bundled VRM models

Every VRM shipped with the app is authored by the dev team and selected by
filename. The Xyzen backend composes that filename from the active buddy's
`race_code` and `stage` (see
`service/buddy/info_api.py::_compose_vrm_model`):

```python
# authoritative rule
vrm_model = f"{buddy.race_code}_{buddy.stage.value}.vrm"
```

That string arrives on `BuddyCoreDTO.vrm_model` via `/api/v1/buddy/me`, and
the frontend resolves it to one of the folders here. There is no
user-upload path.

## Stage vocabulary

`BuddyStage` (`service/app/models/buddy.py`) admits exactly three values:

- `infant`
- `mature`
- `elder`

These are the only legal `<stage>` tokens in a VRM filename.

## Folder layout

Each model is a folder here, named per the rule above with the `.vrm`
extension stripped:

    <race_code>_<stage>/
      <race_code>_<stage>.vrm     # filename must equal folder name
      <race_code>_<stage>.png     # optional preview thumbnail
      animation-driver.ts         # optional — per-model gesture overrides

So a buddy with `race_code="lihuan"` and `stage="infant"` resolves to
`lihuan_infant/lihuan_infant.vrm`. Use letters, digits, and
hyphens/underscores only — no spaces. Thumbnail: 512×512 PNG with
transparent background works well.

## Per-model animation driver (optional)

The backend emits a generic gesture vocabulary (`wave`, `nod`, `yawn`, …);
the frontend owns playback. `animation-driver.ts` lets you override how a
gesture plays on *this specific model* — useful for non-humanoid rigs,
model-specific blendshape names, or dialing intensity/timing to match a
character's temperament. Gestures you don't list fall through to the
global `DEFAULT_GESTURE_ACTIONS` registry.

```ts
// <race_code>_<stage>/animation-driver.ts
import type { AnimationDriver } from '../../../../composables/vrm/animation-driver'

export const driver: AnimationDriver = {
  raceCode: 'lihuan',
  stage: 'infant',
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

Bundling a new VRM today is just two steps:

1. Drop the folder in `src/three/assets/vrm/models/` named per the rule
   above (`<race_code>_<stage>/`).
2. If the rig needs custom gestures, add `animation-driver.ts` exporting
   an `AnimationDriver` (see
   `src/three/composables/vrm/animation-driver.ts`) whose `raceCode`
   and `stage` fields match the folder name.

Selection and registration are automatic. `registry.ts` next to this
file globs every `<folder>/<folder>.vrm` plus its sibling
`animation-driver.ts` at build time (`import.meta.glob`, eager) and
exposes `resolveVrmAsset(vrm_model)` keyed on the bare filename. So
"register a model" just means "drop the folder" — `App.vue` picks up
the backend-supplied `BuddyCoreDTO.vrm_model` string via
`buddy_get_me` and routes it through the resolver.

## Licensing

VRMs frequently carry attribution or no-commercial-use clauses. Bundling
ships the model to every user, so verify the license on VRoid Hub / Booth /
wherever the model came from before adding it.
