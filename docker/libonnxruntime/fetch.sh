#!/usr/bin/env bash
# Pulls a pinned aarch64 libonnxruntime.so for Pi builds. Paired with
# `ort = "=2.0.0-rc.10"` in src-tauri/Cargo.toml; bump ORT_VERSION in
# lockstep if the crate is upgraded. SHA256 comes from the release page at
# https://github.com/microsoft/onnxruntime/releases/tag/v${ORT_VERSION}.
set -euo pipefail

ORT_VERSION="${ORT_VERSION:-1.19.2}"
ORT_SHA256="${ORT_SHA256:-}"  # optional — set to enforce checksum

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="onnxruntime-linux-aarch64-${ORT_VERSION}.tgz"
URL="https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${ARCHIVE}"
TARGET_SO="libonnxruntime.so.${ORT_VERSION}"

if [[ -f "${HERE}/${TARGET_SO}" ]]; then
  echo "already have ${TARGET_SO}; skipping fetch"
  exit 0
fi

cd "${HERE}"
echo "fetching ${URL}"
curl -fsSL -o "${ARCHIVE}" "${URL}"

if [[ -n "${ORT_SHA256}" ]]; then
  echo "${ORT_SHA256}  ${ARCHIVE}" | shasum -a 256 -c -
fi

tar -xzf "${ARCHIVE}"
cp "onnxruntime-linux-aarch64-${ORT_VERSION}/lib/${TARGET_SO}" "${TARGET_SO}"
cp "onnxruntime-linux-aarch64-${ORT_VERSION}/LICENSE" LICENSE

rm -rf "onnxruntime-linux-aarch64-${ORT_VERSION}" "${ARCHIVE}"
echo "staged ${HERE}/${TARGET_SO}"
