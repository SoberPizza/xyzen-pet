# Docker dev environment for Raspberry Pi 5 (Pi OS Bookworm Lite)

Two images, both `linux/arm64`:

- **`buddy-builder`** — Rust 1.77 + Node 20 + Tauri system deps. Produces the
  aarch64 Buddy binary and a `.deb` under
  `src-tauri/target/release/bundle/deb/`.
- **`buddy-runtime`** — slim Debian Bookworm with just the runtime shared
  libs + the compiled binary. Runs on the Pi itself, attached to the host's
  Wayland and PulseAudio sockets.

## Prereqs

- Docker Desktop ≥ 4.30 on Apple Silicon (native arm64 — no QEMU).
- Fetch the pinned `libonnxruntime.so` before the first build:

  ```bash
  bash docker/libonnxruntime/fetch.sh
  ```

  This matches the ABI expected by `ort = "=2.0.0-rc.10"` in
  `src-tauri/Cargo.toml`. Re-run with `ORT_VERSION=... ./fetch.sh` if the
  `ort` crate is upgraded.

## Build the binary

```bash
docker compose run --rm build
# → src-tauri/target/release/bundle/deb/buddy_*_arm64.deb
# → src-tauri/target/release/buddy
```

`cargo` and `node_modules` live in named volumes (`buddy-cargo-*`,
`buddy-node-modules`) so the macOS host's `src-tauri/target/` stays untouched
— you can keep running `yarn tauri dev` natively on the Mac in parallel.

For ad-hoc work:

```bash
docker compose run --rm shell
> cargo check --no-default-features --features ort-dynamic
```

## Ship to the Pi

1. Copy the binary + the Silero model into the compose build context:

   ```bash
   mkdir -p docker/artifacts
   cp src-tauri/target/release/buddy docker/artifacts/
   cp src-tauri/resources/silero_vad_v5.onnx docker/artifacts/
   ```

2. Build the runtime image and save a tarball:

   ```bash
   docker compose --profile runtime build runtime
   docker save buddy-runtime:latest | pigz > buddy-runtime.tar.gz
   ```

3. On the Pi:

   ```bash
   scp buddy-runtime.tar.gz pi@buddy.local:
   ssh pi@buddy.local 'gunzip -c buddy-runtime.tar.gz | docker load'
   # then, from a checkout of this repo on the Pi:
   docker compose --profile runtime up runtime
   ```

   The Pi host must be running a Wayland compositor (labwc/wayfire) or an
   Xorg session on uid 1000 — Pi OS Lite is headless by default, so install
   one first.

## Troubleshooting

- **`no Wayland or X11 socket found`** — the compositor isn't running, or
  the uid in the container doesn't match the host. Check `ls -la
  /run/user/1000/wayland-0` on the Pi.
- **`libonnxruntime.so: cannot open shared object file`** — the fetch
  script didn't run, or the version in `libonnxruntime/` doesn't match
  whatever the `ort` crate expects. Check `ldd /usr/local/bin/buddy` inside
  the runtime container.
- **Frontend assets 404** — the `public/vad/*.wasm` / `.onnx` files must be
  bundled into the Tauri webview; Vite's `base: './'` + `frontendDist:
  '../dist'` (see `tauri.conf.json`) handles this in a release build. If
  you're debugging against a dev server on the Pi, the custom VAD
  middleware only runs during `yarn dev` — not relevant for the `.deb`.
