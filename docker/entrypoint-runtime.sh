#!/usr/bin/env bash
# Launch Buddy inside the runtime container. Expects the Pi host to expose a
# Wayland or Xorg session under /run/user/1000/ and PulseAudio at
# /run/user/1000/pulse — both are bind-mounted by docker-compose.yml.
set -euo pipefail

: "${XDG_RUNTIME_DIR:=/run/user/1000}"
export XDG_RUNTIME_DIR

# Pick Wayland first, fall back to X11. Fail loudly if neither socket is
# mounted — Tauri will otherwise produce a cryptic GTK error.
if [[ -S "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY:-wayland-0}" ]]; then
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
  export GDK_BACKEND="${GDK_BACKEND:-wayland}"
elif [[ -n "${DISPLAY:-}" && -S "/tmp/.X11-unix/X${DISPLAY#:}" ]]; then
  export GDK_BACKEND="${GDK_BACKEND:-x11}"
else
  echo "entrypoint-runtime: no Wayland or X11 socket found under ${XDG_RUNTIME_DIR} or /tmp/.X11-unix" >&2
  echo "entrypoint-runtime: check the bind mounts in docker-compose.yml's runtime service" >&2
  exit 1
fi

# PulseAudio: prefer a host socket; ALSA via /dev/snd is the last-resort
# fallback and is wired as a device in compose.
if [[ -S "${XDG_RUNTIME_DIR}/pulse/native" ]]; then
  export PULSE_SERVER="${PULSE_SERVER:-unix:${XDG_RUNTIME_DIR}/pulse/native}"
fi

exec /usr/local/bin/buddy "$@"
