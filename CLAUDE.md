# Buddy — Project Guide for Claude

`@xyzen/buddy` is the VRM avatar renderer used by the Xyzen desktop app. It was
extracted from the upstream `pet/airi` project and is normally mounted inside a
Tauri window; the browser surface at `localhost:5174` is **dev-only**.

## Quick start

```bash
yarn install        # or pnpm / npm — yarn.lock is the source of truth
yarn dev            # Vite on http://localhost:5174 (port is pinned in vite.config.ts)
yarn typecheck      # vue-tsc --noEmit
yarn lint           # eslint src/ tests/
yarn test           # vitest run (jsdom)
yarn build          # outputs to dist/
yarn knip           # unused-exports check
```

The dev server is Tauri's debug load target. Standalone browser use is supported
but several features (window resize IPC, Tauri-sibling credentials) silently
no-op without `window.__TAURI__`.

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
| `runtime/`            | `config.ts` (resolver) + `providers/` (`tauriSibling`, `devicePairing`, `types`). |
| `components/`         | `SettingsDialog`, `SettingsStandalone`, `SettingsPreviewPopover`, `BuddyDetailsDialog`, `modules/`. |
| `audio/`              | `pcm16-capture-worklet.js` (AudioWorklet node loaded by the mic path). |
| `locales/`            | `en`, `zh-CN`, `index.ts`. |
| `utils/wake-word.ts`  | Wake-word detection helper. |

Static assets:
- `public/vad/` — `ort-wasm-simd-threaded.jsep.{mjs,wasm}`, Silero ONNX model, etc.
- `public/voice-playback-worklet.js` — playback-side worklet.

## Architectural notes

**Credential chain.** `runtime/config.ts` walks `defaultProviders()` in order
(`tauriSibling` → `devicePairing`) and picks the first that yields a
`{baseUrl, token}` snapshot. Providers own token rotation via `onChange`;
`setToken`/`setBackendUrl` are deprecated no-ops.

**Backend bootstrap.** `services/xyzen/index.ts` is fire-and-forget: it kicks
off a `/xyzen/api/health` probe, opens an SSE stream to
`/xyzen/api/v1/buddy/events`, and reconnects on token or base-URL change. The
Vue app mounts regardless of backend state — expect `Failed to initialize
Xyzen backend` in the console when running standalone.

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
renders `SettingsStandalone`; the default route renders the overlay.
Tauri opens settings in a dedicated window via `open_buddy_settings_window`;
outside Tauri, `SettingsDialog` opens as an in-app modal.

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

Vitest with jsdom. The `isTauri` guard in `App.vue` lets mounts under jsdom
skip Tauri IPC cleanly. Tests live under `tests/` (referenced by `tsconfig`
`include` and the `lint` script).

## Known footguns

- Running `yarn` after `npm install` mixes lockfiles — delete `package-lock.json`
  if you're standardizing on yarn.
- The custom VAD middleware only runs in dev; production builds rely on the
  `public/vad/` files being served from whatever host the bundle is loaded from.
- `vrm-instance-cache.ts` holds hard refs to loaded VRMs; swapping many models
  in one session will leak GPU memory until the cache is cleared.
