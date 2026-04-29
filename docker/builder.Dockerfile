# syntax=docker/dockerfile:1.6
# Builder image: produces an aarch64 Tauri binary + .deb for Raspberry Pi 5
# running Pi OS Bookworm (Lite). Runs natively on Apple Silicon; cross-builds
# from x86_64 work under `docker buildx` with QEMU but are much slower.
FROM --platform=linux/arm64 debian:bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/rustup/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config curl ca-certificates git file xz-utils \
      libwebkit2gtk-4.1-dev \
      libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libgtk-3-dev \
      libssl-dev \
      libasound2-dev \
      libpulse-dev \
    && rm -rf /var/lib/apt/lists/*

# Node 20 via NodeSource + yarn via corepack. Matches yarn.lock (project SoT).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && rm -rf /var/lib/apt/lists/*

# Rust pinned to the rust-version from src-tauri/Cargo.toml. Bump here when
# that field moves.
ARG RUST_VERSION=1.77.0
RUN curl -fsSL https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --default-toolchain "${RUST_VERSION}" \
                 --profile minimal --target aarch64-unknown-linux-gnu \
    && rustc --version

RUN cargo install tauri-cli --version "^2" --locked

# libonnxruntime.so staged by docker/libonnxruntime/fetch.sh. Dlopened at
# runtime by the `ort/load-dynamic` feature; no dev headers required.
COPY libonnxruntime/ /opt/onnxruntime/
RUN set -eux; \
    so="$(ls /opt/onnxruntime/libonnxruntime.so.* 2>/dev/null | head -n1)"; \
    if [ -z "${so}" ]; then \
      echo "error: no libonnxruntime.so.* in docker/libonnxruntime/" >&2; \
      echo "run 'bash docker/libonnxruntime/fetch.sh' before building" >&2; \
      exit 1; \
    fi; \
    install -m 0755 "${so}" /usr/local/lib/; \
    ln -sf "$(basename "${so}")" /usr/local/lib/libonnxruntime.so; \
    ldconfig

WORKDIR /workspace

# Default entrypoint: full Tauri build using the ort-dynamic feature path
# documented in src-tauri/Cargo.toml. Override via `docker compose run`.
CMD ["bash", "-lc", "yarn install --frozen-lockfile && cargo tauri build --no-default-features --features ort-dynamic"]
