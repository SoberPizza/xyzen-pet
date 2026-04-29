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
yarn build          # vite build → dist/
yarn knip           # unused-exports check
```

The Vite dev server at `:5174` is Tauri's debug load target — Tauri launches it
via `beforeDevCommand` and points `devUrl` at it. `yarn dev` on its own only
exists to satisfy that hook; do not open `http://localhost:5174` in a browser.

Pre-commit runs `eslint --fix` on staged `src/`/`tests/` files via
`simple-git-hooks` + `lint-staged` (installed by `yarn prepare`). CI is
`.github/workflows/ci.yml`.

## Stack

- **Vue 3** (Composition API, `<script setup>`) + **Pinia** for state.
- **TresJS** (`@tresjs/core`) as the Vue wrapper around **three.js**.
- **@pixiv/three-vrm** + `three-vrm-animation` for VRM 1.0 avatars and `.vrma` clips.
- **Silero v5** (via `ort` in Rust) for voice-activity detection. The
  browser captures mic PCM16 and ships frames to Rust over Tauri IPC.
- **wlipsync** for real-time viseme extraction from the audio graph.
- **Vite 8** build, **TypeScript** strict, **vitest** + jsdom for tests.

## Source layout (`src/`)

| Path                  | Role |
|-----------------------|------|
| `main.ts`             | Boot: `initXyzen()` (non-blocking) → mount Vue app with Pinia + TresJS. |
| `App.vue`             | Overlay shell: `ThreeScene`, edit-mode drag/resize, FAB column, `#/settings` route split. |
| `three/`              | VRM pipeline. `components/{ThreeScene.vue, Model/VRMModel.vue, Controls/OrbitControls.vue}`, `composables/vrm/{animation, animation-driver, core, expression, gesture-driver, hooks, internal-hooks, lip-sync, loader, outline, utils/eye-motions}`, `composables/shader/ibl.ts`, `composables/render-target.ts`, `stores/model-store.ts`, `assets/{vrm/, lip-sync-profile.json}`. |
| `services/`           | Xyzen backend client — flat module: `index.ts` (entrypoint/`initXyzen`), `http.ts`, `sse.ts`, `voice-ws.ts`, `buddies.ts`, `ceo-chat.ts`, `event-bus.ts`, `audio-decoder.ts`, `types.ts`. The three transports (`http`, `sse`, `voice-ws`) are thin shims over Tauri IPC — the real clients live in Rust under `src-tauri/src/net/`. |
| `composables/`        | `useBuddyVoiceSession`, `useXyzenBridge`, `useVad`, `useVoiceMic`. |
| `stores/`             | Pinia: `audio`, `audio-device`, `buddy`, `buddy-state`, `ceo-chat`, `display-models`, `general`, `hearing`, `settings`, plus `constants/{emotions,trait-prompts}.ts`. |
| `runtime/`            | `config.ts` (provider-chain resolver) + `providers/{tauriSibling,types}`. |
| `components/`         | `ModuleStatusHeader.vue`, `SettingsDialog.vue`, `SettingsStandalone.vue`, `SettingsPanel/{BuddiesPanel, BuddyDetailsDialog, ConnectionPanel, GeneralPanel, VisionPanel, VoicePanel}.vue`. |
| `audio/`              | `pcm16-capture-worklet.js` (mic-path AudioWorklet). |
| `locales/`            | `en/`, `zh-CN/`, `index.ts`. |
| `utils/wake-word.ts`  | Wake-word detection helper. |

Static assets:
- `public/voice-playback-worklet.js` — playback-side worklet.

## Rust side (`src-tauri/src/`)

| Path                  | Role |
|-----------------------|------|
| `lib.rs`              | Tauri builder, `tracing_subscriber` init, window commands (`resize_buddy_window`, `open_buddy_settings_window`). |
| `state.rs`            | `AppState` managed via `app.manage()` — holds `AuthState`, `HttpClient`, `SseClient`, `VoiceWsClient`, `VadWorker` as `Arc`s. |
| `auth.rs`             | Credential cache (`AuthCredentials { token, base_url }`) behind `tokio::sync::RwLock`. Fed by TS `tauriSibling` via `set_auth_credentials`. |
| `net/http.rs`         | `reqwest` + rustls-tls client; auto-prefixes `/xyzen/api/v1`, attaches `Bearer`, 20 s timeout, 401 single-flight retry. |
| `net/sse.rs`          | Streaming `reqwest` + hand-rolled line framer; 500 ms → 30 s jittered backoff, sticky `auth_failed`. |
| `net/voice_ws.rs`     | `tokio-tungstenite` WS client; JSON control + binary PCM in/out. TTS chunks go out via `tauri::ipc::Channel<Vec<u8>>` (zero-copy). |
| `vad/silero.rs`       | `ort` wrapper around Silero v5; carries LSTM state across 512-sample windows. |
| `vad/worker.rs`       | Inference task + hysteresis FSM (0.78 / 0.40 thresholds, 560 ms min speech, 8-frame redemption). Bounded mpsc with drop-oldest on backpressure. |
| `ipc/{auth,http,sse,voice,vad}_cmd.rs` | `#[tauri::command]` surface — the only entrypoints the webview talks to. |
| `events.rs`           | Event-name constants (`xyzen://*`, `vad://*`). Keep in sync with TS listeners. |
| `error.rs`            | `AppError` (serializes to `Result<_, String>` for IPC). |

The packaged Silero model lives at `src-tauri/resources/silero_vad_v5.onnx`
and is bundled via `tauri.conf.json::bundle.resources`. `ipc/vad_cmd.rs`
resolves it at runtime via `app.path().resource_dir()`.

## Architectural notes

**Credential chain.** `runtime/config.ts` walks `defaultProviders()` and picks
the first that yields a `{baseUrl, token}` snapshot. The only provider today
is `tauriSibling` (receives the Casdoor JWT from the Xyzen shell over IPC);
providers own the credential lifecycle and rotate via `onChange` — there is
no imperative setter. Every snapshot is also pushed to Rust via
`invoke('set_auth_credentials')` so the HTTP/SSE/WS clients share one cache.

**Backend bootstrap.** `services/index.ts::initXyzen()` is fire-and-forget:
it kicks off a `/xyzen/api/health` probe (emits `XyzenHealthChecked` on the
bus), opens an SSE stream to `/xyzen/api/v1/buddy/events`, and reconnects on
token or base-URL change. The HTTP/SSE clients are TS shims; the network work
happens in Rust. `main.ts` awaits `initXyzen()` inside a `try/catch` and
mounts the Vue app either way, so the avatar still renders if the Rust
bridge hasn't pushed credentials yet. `getLastHealth()` exposes the most
recent probe result for subscribers that mount after it resolved.

**Voice session.** `useBuddyVoiceSession` composes mic capture
(`pcm16-capture-worklet`) + VAD + the voice WS. Mic PCM16 frames go to Rust
via `invoke('xyzen_voice_ws_send_frame', { pcm16 })`; TTS audio comes back
on a `tauri::ipc::Channel<ArrayBuffer>` opened by `VoiceWsClient.connect()`.
`useXyzenBridge` routes SSE events (TTS audio, emotions, gestures, text
chunks, activity/state) into the VRM pipeline via `ThreeScene`'s exposed
methods (`setExpression`, `setViseme`, `setBlink`, `setLookAt`, `pulseMorph`)
and into `buddyStateStore`.

**VAD.** `useVad` still captures mic audio via the `pcm16-capture-worklet`
but forwards each 20 ms Int16 frame to Rust via `invoke('vad_push_frame')`.
Rust runs Silero v5 (`ort` crate) and emits `vad://speech-start` /
`vad://speech-end` events that the composable re-exposes through its
existing handler interface.

**Gesture driver.** `three/composables/vrm/gesture-driver.ts` merges
`DEFAULT_GESTURE_ACTIONS` with the active model's per-model registry
(`activeAnimationDriver.gestures`). The registry getter re-runs per dispatch
and flushes the cooldown map when the driver identity changes so the first
gesture on a newly swapped VRM isn't blocked.

**Edit mode.** Window size is persisted via `useLocalStorage('buddy-window-size')`
and pushed to Tauri via `resize_buddy_window`; VRM world-space position lives
in `three/stores/model-store.ts::modelOffset` and is applied inside
`VRMModel.vue`. Drag math converts screen pixels to world units using the
current camera FOV + distance.

**Settings window.** The same bundle serves two surfaces. `#/settings`
renders `SettingsStandalone`; the default route renders the overlay shell
and the `SettingsDialog` modal (panels under `SettingsPanel/` mount lazily
per active tab). Tauri opens settings in a dedicated window via
`open_buddy_settings_window`.

## Vite quirks (already wired in `vite.config.ts`)

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
the `lint` script); the directory is currently empty but the config is
primed for it.

## Known footguns

- Running `yarn` after `npm install` mixes lockfiles — delete `package-lock.json`
  if you're standardizing on yarn.
- VAD on ARM64: use `cargo build --no-default-features --features ort-dynamic`
  and ship a prebuilt `libonnxruntime.so.1.x` next to the binary (set
  `ORT_DYLIB_PATH` at startup). Desktop dev keeps `ort-download` by default.
- `three/components/Model/vrm-instance-cache.ts` holds hard refs to loaded
  VRMs; swapping many models in one session will leak GPU memory until the
  cache is cleared.
