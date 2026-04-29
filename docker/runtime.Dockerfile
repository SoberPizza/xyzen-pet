# syntax=docker/dockerfile:1.6
# Runtime image for Raspberry Pi 5 (Pi OS Bookworm Lite). The Pi host must
# already be running a Wayland (labwc/wayfire) or Xorg session under uid 1000;
# this image only ships the Tauri binary + its shared libs and attaches to the
# host's display + Pulse sockets via compose mounts.
FROM --platform=linux/arm64 debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-0 \
      libsoup-3.0-0 \
      libjavascriptcoregtk-4.1-0 \
      libayatana-appindicator3-1 \
      librsvg2-2 \
      libgtk-3-0 \
      libasound2 \
      libpulse0 \
      libssl3 \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Pinned libonnxruntime.so produced by docker/libonnxruntime/fetch.sh. Must
# match the version the binary was linked against in the builder stage.
COPY libonnxruntime/ /opt/onnxruntime/
RUN set -eux; \
    so="$(ls /opt/onnxruntime/libonnxruntime.so.* 2>/dev/null | head -n1)"; \
    if [ -z "${so}" ]; then \
      echo "error: no libonnxruntime.so.* in docker/libonnxruntime/" >&2; \
      exit 1; \
    fi; \
    install -m 0755 "${so}" /usr/local/lib/; \
    ln -sf "$(basename "${so}")" /usr/local/lib/libonnxruntime.so; \
    ldconfig; \
    rm -rf /opt/onnxruntime

# Runtime payload. Supplied by the compose `build` service (which writes to
# src-tauri/target/release) + a host bind mount, OR by a future CI job that
# copies the binary directly into the context.
ARG BUDDY_BINARY=artifacts/buddy
ARG SILERO_ONNX=artifacts/silero_vad_v5.onnx
COPY ${BUDDY_BINARY} /usr/local/bin/buddy
COPY ${SILERO_ONNX} /usr/share/buddy/silero_vad_v5.onnx

# uid 1000 matches the default `pi` user on Pi OS so the Wayland/Pulse
# sockets we bind-mount are readable.
RUN useradd -m -u 1000 -s /bin/bash buddy
USER buddy
WORKDIR /home/buddy

COPY entrypoint-runtime.sh /usr/local/bin/entrypoint-runtime.sh
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint-runtime.sh"]
