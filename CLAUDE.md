# Buddy — Project Guide for Claude

`@xyzen/buddy` is the VRM avatar renderer used by the Xyzen desktop app. It
runs **only** inside a Tauri webview — either as a sibling of the main Xyzen
window or as a standalone Raspberry Pi binary. It is not supported as a plain
browser tab.

Current state: all remote-API code has been removed. The Rust side
(`src-tauri/`) owns every piece of backend comms and heavy local logic, and
exposes a thin IPC surface to the Vue frontend. The new Xyzen API is being
rebuilt — today Rust only ships stubs (settings store, voice-session
skeleton, placeholder buddy info) so the frontend can render and the IPC
contract is in place for the rebuild.

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
| `components/`         | `ModuleStatusHeader.vue`, `SettingsDialog.vue`, `SettingsStandalone.vue`, `SettingsPanel/{BuddiesPanel (under Buddies/), BuddyDetailsDialog (under Buddies/), ConnectionPanel, GeneralPanel, VisionPanel, VoicePanel}.vue`. Buddies + Connection are UI shells — they render against Rust stubs (`buddy_list`, `app_info`) but the rich data + mutation flows are no-ops until the new backend API lands. |
| `utils/`              | `wake-word.ts` (CJK/Latin length validation for `BuddyDetailsDialog` nickname inputs). |
| `locales/`            | `en/buddy.json`, `zh-CN/buddy.json`, `index.ts` (minimal `tBuddy(namespace, code)` lookup — used by `BuddyDetailsDialog` for stage/gender/trait labels). |
| `audio/`              | `pcm16-capture-worklet.ts` (mic-path AudioWorklet; TS file, uses `@types/audioworklet`). |

## Rust side (`src-tauri/src/`)

| Path                   | Role |
|------------------------|------|
| `lib.rs`               | Tauri builder: window commands, `tracing_subscriber` init, registers every `#[tauri::command]` and `.manage()` call. |
| `bin/gen_bindings.rs`  | Small binary invoked by `yarn gen-bindings`; runs `tauri-specta::Builder::export` against `ipc::bindings_builder()`. |
| `ipc/mod.rs`           | IPC facade: defines `app_info` + `bindings_builder()` (single source of truth for the generated TS file). |
| `ipc/vad_cmd.rs`       | Commands wrapping the VAD worker (`vad_start`, `vad_stop`, `vad_push_frame`). |
| `settings/mod.rs`      | Settings store on top of `tauri-plugin-store`. Values cross IPC as JSON strings so specta emits a simple `string` type; the TS helper parses per-key. |
| `voice/{mod,fsm,session}.rs` | Voice-session scaffold — `VoiceSessions` registry, `VoiceState` enum, `voice_start|stop|push_frame` commands. The real FSM (preroll, barge-in, wake gating) is deferred until the new remote API is in place. |
| `buddy_stub.rs`        | `buddy_get_active` / `buddy_list` — returns one hard-coded `BuddyDisplayInfo` so the avatar can render. Replaced by real data once the rebuild lands. |
| `vad/silero.rs`        | `ort` wrapper around Silero v5; carries LSTM state across 512-sample windows. |
| `vad/worker.rs`        | Inference task + hysteresis FSM (0.78 / 0.40 thresholds, 560 ms min speech, 8-frame redemption). Bounded mpsc, drop-oldest on backpressure. |
| `state.rs`             | `AppState` — currently only holds the `VadWorker`. Settings + voice sessions are `.manage()`'d directly by their modules. |
| `events.rs`            | Tauri event-name constants (`vad://*`). Keep in sync with TS listeners. |

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

**VAD.** VAD inference is Rust-side. When the new voice FSM is wired, mic
frames will flow into `vad_push_frame` from Rust directly; today the
`vad_start` / `vad_stop` / `vad_push_frame` commands are exposed but unused
from Vue.

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

Vitest with jsdom. Tauri IPC calls inside `App.vue` go through a swallowed-
error `tauriInvoke` shim, and the `ipc/client.ts` helpers guard on
`__TAURI_INTERNALS__` so jsdom mounts don't blow up. Tests live under
`tests/` (referenced by `tsconfig` `include` and the `lint` script); the
directory is currently empty but the config is primed for it. Rust unit
tests live inline with `#[cfg(test)] mod tests { ... }` blocks (see
`settings/mod.rs`, `voice/session.rs`).

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
