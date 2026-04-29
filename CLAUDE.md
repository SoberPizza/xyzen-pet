# Buddy — Project Guide for Claude

`@xyzen/buddy` is the VRM avatar renderer used by the Xyzen desktop app. It
runs **only** inside a Tauri webview — either as a sibling of the main Xyzen
window or as a standalone Raspberry Pi binary. It is not supported as a plain
browser tab.

Current state: the Rust side (`src-tauri/`) owns all backend comms and
heavy local logic — Silero v5 VAD, the Xyzen device-code auth flow, and
the shared settings store — and exposes a typed IPC surface to the Vue
frontend via `tauri-specta`. The voice-session FSM and buddy roster are
still scaffold stubs (`voice_*` emits only `idle → listening`,
`buddy_stub` returns a single hard-coded entry); both land with the new
remote-API rebuild. The Vue layer never calls `@tauri-apps/api/invoke`
directly — everything goes through `ipc/bindings.ts` + `ipc/client.ts`.

## Quick start

```bash
yarn install        # yarn.lock is the source of truth
yarn tauri dev      # launches the Tauri debug window (auto-starts Vite on :5174)
yarn typecheck      # vue-tsc --noEmit
yarn lint           # eslint src/ tests/
yarn test           # vitest run (jsdom)
yarn build          # vite build → dist/
yarn knip           # unused-exports check
yarn gen-bindings   # regenerate src/ipc/bindings.ts from Rust via tauri-specta

# Rust tests (from repo root):
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The Vite dev server at `:5174` is Tauri's debug load target — Tauri launches it
via `beforeDevCommand` and points `devUrl` at it. `yarn dev` on its own only
exists to satisfy that hook; do not open `http://localhost:5174` in a browser.

Pre-commit runs `eslint --fix` on staged `src/`/`tests/` files via
`simple-git-hooks` + `lint-staged` (installed by `yarn prepare`). CI is
`.github/workflows/ci.yml`.

### Raspberry Pi 5 builds

aarch64 Tauri builds live under `docker/`. First-time setup:

```bash
bash docker/libonnxruntime/fetch.sh   # pin libonnxruntime for ort/load-dynamic
docker compose run --rm build         # → src-tauri/target/release/bundle/deb/*.deb
```

The builder image is `linux/arm64` and runs natively on Apple Silicon.
Pi-side deployment uses the `runtime` profile (`docker compose --profile
runtime ...`); see `docker/README.md`. The Pi build must pass
`--no-default-features --features ort-dynamic` (default in the compose
CMD) so `ort` dlopens the bundled `libonnxruntime.so` instead of trying
to download a desktop binary.

## Stack

- **Vue 3** (Composition API, `<script setup>`) + **Pinia** for state.
- **TresJS** (`@tresjs/core`) as the Vue wrapper around **three.js**.
- **@pixiv/three-vrm** + `three-vrm-animation` for VRM 1.0 avatars and `.vrma` clips.
- **Silero v5** (via `ort` in Rust) for voice-activity detection.
- **wlipsync** for real-time viseme extraction from the audio graph.
- **Vite 8** build, **TypeScript** strict, **vitest** + jsdom for tests.
- **Tauri v2** shell (Rust). Type-safe IPC via `specta` / `tauri-specta`.

## Source layout (`src/`)

| Path                  | Role |
|-----------------------|------|
| `main.ts`             | Synchronous boot — creates Pinia + Tres, mounts `App.vue`. No backend init. |
| `App.vue`             | Overlay shell: `ThreeScene`, edit-mode drag/resize, FAB column, `#/settings` route split. |
| `ipc/bindings.ts`     | **Generated** by `yarn gen-bindings` — typed wrappers around every Rust command + event. Do not edit by hand. |
| `ipc/client.ts`       | Thin helpers (`useIpcSetting`, `useIpcEvent`) plus re-export of `commands`. The only file that imports `@tauri-apps/api/event` directly. |
| `three/`              | VRM pipeline — unchanged by the decoupling. |
| `composables/`        | `useBuddyVoiceSession` (IPC shim over the Rust voice FSM), `useVoiceMic` (browser-side mic capture). |
| `stores/`             | Pinia: `audio`, `audio-device`, `general`, `hearing`. All four back onto the Rust settings store via `useIpcSetting`, except `audio.ts` which wraps the shared `AudioContext`. |
| `components/`         | `ModuleStatusHeader.vue`, `SettingsDialog.vue`, `SettingsStandalone.vue`, `SettingsPanel/{Buddies/{BuddiesPanel, BuddyDetailsDialog}, ConnectionPanel, GeneralPanel, VisionPanel, VoicePanel}.vue`. `ConnectionPanel` drives the device-code auth flow end-to-end (`auth_start`/`auth_cancel`/`auth_sign_out`, listens on `auth://status`). `BuddiesPanel` still renders against the `buddy_stub` list; the mutation flows there remain no-ops until the new backend API lands. |
| `utils/`              | `wake-word.ts` (CJK/Latin length validation for `BuddyDetailsDialog` nickname inputs). |
| `locales/`            | `en/buddy.json`, `zh-CN/buddy.json`, `index.ts` (minimal `tBuddy(namespace, code)` lookup — used by `BuddyDetailsDialog` for stage/gender/trait labels). |
| `audio/`              | `pcm16-capture-worklet.ts` (mic-path AudioWorklet; TS file, uses `@types/audioworklet`). |

## Rust side (`src-tauri/src/`)

Crate is `buddy_lib` (see `[lib]` in `Cargo.toml`); modules are `pub` so
the integration-test crate under `src-tauri/tests/` can exercise them.
Only what's re-exported through `lib.rs` is actually wired into the Tauri
runtime.

| Path                   | Role |
|------------------------|------|
| `lib.rs`               | Tauri builder: window commands (`resize_buddy_window`, `open_buddy_settings_window`), `tracing_subscriber` init, registers every `#[tauri::command]` and `.manage()` call. |
| `bin/gen_bindings.rs`  | Small binary invoked by `yarn gen-bindings`; runs `tauri-specta::Builder::export` against `ipc::bindings_builder()`. |
| `ipc/mod.rs`           | IPC facade: defines `app_info` + `bindings_builder()` (single source of truth for the generated TS file). |
| `ipc/vad_cmd.rs`       | Commands wrapping the VAD worker (`vad_start`, `vad_stop`, `vad_push_frame`) + `silero_vad_v5.onnx` path resolution. |
| `settings/mod.rs`      | Settings store on top of `tauri-plugin-store`. Values cross IPC as JSON strings so specta emits a simple `string` type; the TS helper parses per-key. Emits `settings://changed`. |
| `voice/{mod,fsm,session}.rs` | Voice-session scaffold — `VoiceSessions` registry, `VoiceState` enum (kebab-case serde), `voice_start|stop|push_frame` commands. The real FSM (preroll, barge-in, wake gating) is deferred until the new remote API is in place. |
| `auth/mod.rs`          | Module root; re-exports `AuthSession`. |
| `auth/client.rs`       | `AuthClient` wrapping `/xyzen/api/v1/auth/buddy/{authorize,token}`; RFC 8628 device-code grant, `reqwest` with `rustls-tls`. |
| `auth/session.rs`      | `AuthStatus` FSM (`idle → pending → authenticated \| error`), `auth_start \| cancel \| sign_out \| status` commands, poll loop that owns its own `AppHandle` and emits `auth://status`. |
| `auth/settings.rs`     | Typed helpers for the four auth keys (`settings/auth/{access_token,refresh_token,backend_url,client_id}`). Mirrors `settings_set` so Vue subscribers stay in sync across windows. |
| `buddy_stub.rs`        | `buddy_get_active` / `buddy_list` — returns one hard-coded `BuddyDisplayInfo` so the avatar can render. Replaced by real data once the rebuild lands. |
| `vad/silero.rs`        | `ort` wrapper around Silero v5; carries `[2, 1, 128]` LSTM state across 512-sample windows. |
| `vad/worker.rs`        | `VadWorker` inference task + `VadFsm` (pure hysteresis state machine: 0.78 / 0.40 thresholds, 560 ms min speech, 8-frame redemption). Bounded mpsc, drop-oldest on backpressure. |
| `state.rs`             | `AppState` — holds the `VadWorker`. Settings, voice sessions, and `AuthSession` are `.manage()`'d directly by `lib.rs`. |
| `events.rs`            | Tauri event-name constants (`vad://*`, `auth://status`). Keep in sync with TS listeners. |

The packaged Silero model lives at `src-tauri/resources/silero_vad_v5.onnx`
and is bundled via `tauri.conf.json::bundle.resources`. `ipc/vad_cmd.rs`
resolves it at runtime via `app.path().resource_dir()`.

## Architectural notes

**Type-generation pipeline.** `src/ipc/bindings.ts` is auto-generated from
the Rust IPC surface by `tauri-specta`. Add `#[derive(specta::Type)]` +
`#[specta::specta]` to any new command or payload, register it in
`ipc::bindings_builder()`, then run `yarn gen-bindings`. The build script
is explicitly *not* a `build.rs` hook so incremental Rust compiles stay fast;
`bindings.ts` is committed to git so TS CI doesn't need a Rust toolchain.

**Settings persistence.** All user-visible preferences live in the Rust
settings store (`tauri-plugin-store`, JSON in the Tauri app-data dir). The
Vue stores (`general`, `audio-device`, `hearing`) expose the same Pinia
facade they always had; internally they use `useIpcSetting(key, default)`
which `invoke`s `settings_get` on mount, `settings_set` on write, and
subscribes to `settings://changed` so the main and settings windows stay in
sync without reloads.

**Voice session.** `useBuddyVoiceSession` is a thin IPC shim: on `start()`
it `invoke`s `voice_start`, opens `useVoiceMic`, and forwards each 20 ms
PCM16 frame to `voice_push_frame`. The reactive `state` ref mirrors whatever
the Rust FSM emits on `voice://state`. Today the Rust side only emits
`idle → listening` on start and drops mic frames — the real pipeline lands
with the API rebuild.

**Auth.** The buddy boots unauthenticated. `auth_start` kicks off an RFC
8628 device-code grant against `/xyzen/api/v1/auth/buddy/{authorize,token}`;
the user_code is returned synchronously so `ConnectionPanel.vue` can paint
immediately, and a spawned poll task drives `auth://status` transitions
(`idle → pending → authenticated | error`) on the server-provided
`interval` (with `slow_down` bumps per RFC 8628 §3.5). Tokens persist
through `auth/settings.rs` under `settings/auth/*` and mirror via
`settings://changed` so every window sees them. Refresh is deferred — the
server buddy router only exposes the device-code grant today, so expired
tokens mean re-running the flow.

**VAD.** VAD inference is Rust-side. The pipeline is split: `VadFsm`
(`vad/worker.rs`) is a pure hysteresis state machine that takes a
probability + window duration and returns an action
(`Continue | SpeechStart | SpeechEnd | Misfire`). `VadWorker` wraps the
FSM with the ONNX session and the bounded `mpsc` frame channel; side
effects (`silero.reset()`, event emission) stay in the task loop so
`VadFsm` can be tested with synthetic probability sequences. When the new
voice FSM is wired, mic frames flow into `vad_push_frame` from Rust
directly; today the commands are exposed but unused from Vue.

**Gesture driver.** `three/composables/vrm/gesture-driver.ts` listens for
`avatar://gesture` Tauri events via `useIpcEvent`. No emitter is wired until
the new API rebuild; the `GestureRegistry` + `DEFAULT_GESTURE_ACTIONS` API
is otherwise untouched.

**Edit mode.** Window size is persisted via `useLocalStorage('buddy-window-size')`
(not the IPC settings store — it's a per-window layout quirk, not a
preference) and pushed to Tauri via `resize_buddy_window`. VRM world-space
position lives in `three/stores/model-store.ts::modelOffset` and is applied
inside `VRMModel.vue`. Drag math converts screen pixels to world units using
the current camera FOV + distance.

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
- Any new IPC command: add it to `ipc::bindings_builder()` and regenerate
  bindings. Do not call `@tauri-apps/api`'s `invoke` directly from components
  — go through `ipc/client.ts` + `ipc/bindings.ts`.
- AudioContext is resumed on the first user gesture (`click`/`touchstart`/`keydown`)
  — autoplay-policy requirement; don't tear this out.

## Testing

**Rust.** Two-tier layout. Integration tests live in `src-tauri/tests/*.rs`
(Cargo convention) and drive the crate's public surface through
`buddy_lib::*` imports — 10 files covering the VAD hysteresis FSM
(synthetic probability sequences, no ONNX), `decode_pcm16`, `VadSignal`
serde, `AuthClient` URL layout + response shapes, `AuthStatus` wire
format, `SettingsChanged` + event names, `VoiceState` kebab-case,
`buddy_stub`, `app_info`, and a Silero load error-path (gated to
`ort-download` — see below). A handful of inline `#[cfg(test)] mod tests`
blocks remain only for genuinely private helpers:
`auth::session::oauth_message`, `auth::client::OAuthErrorBody`,
`voice::session::new_session_id`. Dev-deps: `tokio-test`, `tempfile`.

```bash
cargo test --manifest-path src-tauri/Cargo.toml                                   # desktop default (ort-download)
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features \
    --features ort-dynamic                                                        # Pi feature-set; skips silero load test
```

When adding a test that touches `Silero::load` or `Silero::infer`, gate
the file with `#![cfg(feature = "ort-download")]` — under `ort-dynamic`,
`ort` panics at session-builder time if it can't dlopen
`libonnxruntime.so`, which defeats error-path coverage.

**Frontend.** Vitest with jsdom. Tauri IPC calls inside `App.vue` go
through a swallowed-error `tauriInvoke` shim, and the `ipc/client.ts`
helpers guard on `__TAURI_INTERNALS__` so jsdom mounts don't blow up.
Tests live under `tests/` (referenced by `tsconfig` `include` and the
`lint` script); the directory is currently empty but the config is primed
for it.

## Known footguns

- Running `yarn` after `npm install` mixes lockfiles — delete `package-lock.json`
  if you're standardizing on yarn.
- VAD on ARM64: use `cargo build --no-default-features --features ort-dynamic`
  and ship a prebuilt `libonnxruntime.so.1.x` next to the binary (set
  `ORT_DYLIB_PATH` at startup). Desktop dev keeps `ort-download` by default.
- `three/components/Model/vrm-instance-cache.ts` holds hard refs to loaded
  VRMs; swapping many models in one session will leak GPU memory until the
  cache is cleared.
- `bindings.ts` is auto-generated. If you hand-edit it the next
  `yarn gen-bindings` will overwrite your changes silently — add new types
  in Rust instead.
