# Buddy — Project Guide for Claude

`@xyzen/buddy` is the VRM avatar renderer used by the Xyzen desktop app. It runs **only** inside a Tauri
webview — either as a sibling of the main Xyzen window or as a standalone RPi
binary. It is not supported as a plain browser tab.

## Quick start

```bash
yarn install        # or pnpm / npm — yarn.lock is the source of truth
yarn tauri dev      # launches the Tauri debug window (auto-starts Vite on :5174)
yarn typecheck      # vue-tsc --noEmit
yarn lint           # eslint src/ tests/
yarn test           # vitest run (jsdom)
yarn build          # outputs to dist/
yarn knip           # unused-exports check
```

The Vite dev server at `:5174` is Tauri's debug load target — Tauri launches it
via `beforeDevCommand` and points `devUrl` at it. `yarn dev` on its own only
exists to satisfy that hook; do not open `http://localhost:5174` in a browser.

## Stack

- **Vue 3** (Composition API, `<script setup>`) + **Pinia** for state.
- **TresJS** (`@tresjs/core`) as the Vue wrapper around **three.js**.
- **@pixiv/three-vrm** + `three-vrm-animation` for VRM 1.0 avatars and `.vrma` clips.
- **@ricky0123/vad-web** (onnxruntime-web) for voice-activity detection.
- **wlipsync** for real-time viseme extraction from the audio graph.
- **Vite 8** build, **TypeScript** strict, **vitest** + jsdom for tests.

## Source layout (`src/`)

| Path                  | Role |
|-----------------------|------|
| `main.ts`             | Boot: resolve config → `initXyzen()` → mount Vue app (non-blocking on backend failure). |
| `App.vue`             | Overlay shell: scene, edit-mode drag/resize, FAB column, settings route split. |
| `three/`              | VRM pipeline. `ThreeScene.vue`, `Model/VRMModel.vue`, composables (`animation`, `expression`, `gesture-driver`, `lip-sync`, `outline`, `loader`), `shader/ibl.ts`, `stores/model-store.ts`, bundled `assets/vrm/`. |
| `services/xyzen/`     | Backend client: `http.ts`, `sse.ts`, `voice-ws.ts`, `buddies.ts`, `ceo-chat.ts`, `event-bus.ts`, `audio-decoder.ts`. |
| `composables/`        | `useBuddyVoiceSession`, `useXyzenBridge`, `useVad`, `useVoiceMic`. |
| `stores/`             | Pinia: `audio`, `audio-device`, `buddy`, `buddy-state`, `ceo-chat`, `display-models`, `general`, `hearing`, `settings`, plus `constants/{emotions,trait-prompts}.ts`. |
| `runtime/`            | `config.ts` (resolver) + `providers/` (`tauriSibling`, `types`). |
| `components/`         | `SettingsDialog`, `SettingsStandalone`, `BuddyDetailsDialog`, `modules/`. |
| `audio/`              | `pcm16-capture-worklet.js` (AudioWorklet node loaded by the mic path). |
| `locales/`            | `en`, `zh-CN`, `index.ts`. |
| `utils/wake-word.ts`  | Wake-word detection helper. |

Static assets:
- `public/vad/` — `ort-wasm-simd-threaded.jsep.{mjs,wasm}`, Silero ONNX model, etc.
- `public/voice-playback-worklet.js` — playback-side worklet.

## Architectural notes

**Credential chain.** `runtime/config.ts` walks `defaultProviders()` and picks
the first that yields a `{baseUrl, token}` snapshot. The only provider today
is `tauriSibling`; providers own the credential lifecycle and rotate via
`onChange` — there is no imperative setter.

**Backend bootstrap.** `services/xyzen/index.ts` is fire-and-forget: it kicks
off a `/xyzen/api/health` probe, opens an SSE stream to
`/xyzen/api/v1/buddy/events`, and reconnects on token or base-URL change. The
Vue app mounts regardless of backend state so the avatar still renders if the
Rust bridge hasn't pushed credentials yet.

**Voice session.** `useBuddyVoiceSession` composes mic capture
(`pcm16-capture-worklet`) + VAD + the voice WS. `useXyzenBridge` routes
backend events (TTS audio, emotions, gestures) into the VRM pipeline via
`ThreeScene`'s exposed methods (`setExpression`, `setViseme`, `setBlink`,
`setLookAt`, `pulseMorph`).

**Gesture driver.** `three/composables/vrm/gesture-driver.ts` merges
`DEFAULT_GESTURE_ACTIONS` with the active model's per-model registry
(`activeAnimationDriver.gestures`). The registry getter re-runs per dispatch
and flushes the cooldown map when the driver identity changes so the first
gesture on a newly swapped VRM isn't blocked.

**Edit mode.** Window size is persisted via `useLocalStorage('buddy-window-size')`
and pushed to Tauri via `resize_buddy_window`; VRM world-space position lives
in `model-store.modelOffset` and is applied inside `VRMModel.vue`. Drag math
converts screen pixels to world units using current camera FOV + distance.

**Settings window.** The same bundle serves two surfaces. `#/settings`
renders `SettingsStandalone`; the default route renders the overlay. Tauri
opens settings in a dedicated window via `open_buddy_settings_window`.

## Vite quirks (already wired in `vite.config.ts`)

- `serveVadMjsPlugin` middleware intercepts `/vad/*.mjs` so onnxruntime-web's
  dynamic `import('…jsep.mjs')` resolves against `public/vad/` despite Vite's
  ban on importing public-folder files from source.
- `optimizeDeps.exclude: ['onnxruntime-web']` — pre-bundling rewrites the
  jsep import and 500s.
- `optimizeDeps.include: ['@ricky0123/vad-web']` — it ships CJS; without
  pre-bundling the browser throws `exports is not defined`.
- `worker: { format: 'es' }`, `base: './'` for Tauri's file:// loading.
- Alias `@` → `src/`.

## Conventions

- TypeScript strict; `moduleResolution: bundler`; path alias `@/*` → `./src/*`.
- Vue SFC with `<script setup lang="ts">`.
- Prefer Pinia stores over ad-hoc globals; use `storeToRefs` when destructuring.
- Keep backend-touching code non-blocking on init — Buddy must render an
  avatar even when Xyzen is unreachable.
- AudioContext is resumed on the first user gesture (`click`/`touchstart`/`keydown`)
  — autoplay-policy requirement; don't tear this out.

## Testing

Vitest with jsdom. Tauri IPC calls inside `App.vue` go through a swallowed-
error `tauriInvoke` shim, and `tauriSibling`'s `fetchCredentials` wraps
`invoke()` in try/catch, so jsdom mounts don't blow up when `__TAURI_INTERNALS__`
is missing. Tests live under `tests/` (referenced by `tsconfig` `include` and
the `lint` script).

## Known footguns

- Running `yarn` after `npm install` mixes lockfiles — delete `package-lock.json`
  if you're standardizing on yarn.
- The custom VAD middleware only runs in dev; production builds rely on the
  `public/vad/` files being served from whatever host the bundle is loaded from.
- `vrm-instance-cache.ts` holds hard refs to loaded VRMs; swapping many models
  in one session will leak GPU memory until the cache is cleared.
