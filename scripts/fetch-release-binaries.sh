#!/usr/bin/env bash
# Downloads pinned pandoc and typst release binaries into src-tauri/bin/ with
# the target-triple suffix that Tauri's bundle.externalBin expects. Linux only;
# Windows uses scripts/fetch-release-binaries.ps1.
#
# Usage: scripts/fetch-release-binaries.sh
set -euo pipefail

PANDOC_VERSION="3.10.2"
TYPST_VERSION="v0.15.1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/bin"

# --- host triple ------------------------------------------------------------
host_triple() {
  if command -v rustc >/dev/null 2>&1 && rustc --print host-tuple >/dev/null 2>&1; then
    rustc --print host-tuple
    return 0
  fi
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "x86_64-unknown-linux-gnu" ;;
    aarch64|arm64) echo "aarch64-unknown-linux-gnu" ;;
    *) echo "unknown" ;;
  esac
}

TRIPLE="$(host_triple)"

case "$TRIPLE" in
  x86_64-unknown-linux-gnu)
    PANDOC_ASSET="pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz"
    PANDOC_MEMBER="pandoc-${PANDOC_VERSION}/bin/pandoc"
    TYPST_ASSET="typst-x86_64-unknown-linux-musl.tar.xz"
    TYPST_MEMBER="typst-x86_64-unknown-linux-musl/typst"
    ;;
  aarch64-unknown-linux-gnu)
    PANDOC_ASSET="pandoc-${PANDOC_VERSION}-linux-arm64.tar.gz"
    PANDOC_MEMBER="pandoc-${PANDOC_VERSION}/bin/pandoc"
    TYPST_ASSET="typst-aarch64-unknown-linux-musl.tar.xz"
    TYPST_MEMBER="typst-aarch64-unknown-linux-musl/typst"
    ;;
  *)
    echo "error: unsupported host triple '$TRIPLE' (this script targets Linux)" >&2
    echo "       fetch the binaries manually and place them in $BIN_DIR" >&2
    exit 1
    ;;
esac

PANDOC_URL="https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/${PANDOC_ASSET}"
TYPST_URL="https://github.com/typst/typst/releases/download/${TYPST_VERSION}/${TYPST_ASSET}"

mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_extract() {
  local url="$1" member="$2" dest="$3"
  local archive
  archive="$TMP/$(basename "$url")"

  echo "downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 -o "$archive" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$archive" "$url"
  else
    echo "error: curl or wget is required" >&2
    exit 1
  fi

  case "$archive" in
    *.tar.xz) tar -xJf "$archive" -C "$TMP" "$member" ;;
    *.tar.gz) tar -xzf "$archive" -C "$TMP" "$member" ;;
    *) echo "error: unknown archive format: $archive" >&2; exit 1 ;;
  esac

  cp "$TMP/$member" "$dest"
  chmod +x "$dest"
  echo "wrote $dest"
}

fetch_extract "$PANDOC_URL" "$PANDOC_MEMBER" "$BIN_DIR/pandoc-${TRIPLE}"
fetch_extract "$TYPST_URL" "$TYPST_MEMBER" "$BIN_DIR/typst-${TRIPLE}"

echo "done. run scripts/build-release.sh to fetch-and-bundle the installer."
