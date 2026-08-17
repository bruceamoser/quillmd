#!/usr/bin/env bash
# Release build entrypoint: fetch pinned sidecar binaries, then run the Tauri
# build. If the sidecars are absent (or the fetch failed), the build still
# succeeds by dropping the externalBin entries; convert.rs falls back to PATH.
#
# Usage: scripts/build-release.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/bin"

if ! "$SCRIPT_DIR/fetch-release-binaries.sh"; then
  echo "warning: sidecar fetch failed; continuing without bundled tools" >&2
fi

TRIPLE="$(rustc --print host-tuple 2>/dev/null || echo unknown)"

has_sidecar() {
  local tool="$1"
  [ -f "$BIN_DIR/${tool}-${TRIPLE}" ] || [ -f "$BIN_DIR/${tool}-${TRIPLE}.exe" ]
}

cd "$ROOT"
if has_sidecar pandoc && has_sidecar typst; then
  echo "bundling pandoc + typst sidecars"
  npm run tauri build -- --config src-tauri/tauri.release.conf.json
else
  echo "sidecars absent; building without externalBin (PATH fallback at runtime)"
  npm run tauri build
fi
