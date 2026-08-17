# Packaging & fresh-machine verification

This document covers how QuillMD release installers are built and how to prove
the "single installer, zero prerequisites" promise on a clean machine.

## What ships

The installer bundles everything the app needs:

- **pandoc** and **typst** as Tauri sidecars (`bundle.externalBin` in
  `src-tauri/tauri.conf.json`), used only for import/export (PDF, DOCX, EPUB).
- **WebView2** on Windows: modern Windows 10/11 preinstall the Evergreen
  runtime; the installer detects and prompts if it is absent.
- **WebKitGTK** on Linux: the `.AppImage` is self-contained; the `.deb`
  declares the runtime libraries as package dependencies.

Markdown editing itself needs no external tools. If a sidecar is missing, the
app errors cleanly on import/export rather than crashing.

## Build checklist

1. Fetch pinned sidecars and bundle:

   ```bash
   # Linux / macOS
   bash scripts/build-release.sh

   # Windows (PowerShell)
   powershell -ExecutionPolicy Bypass -File scripts/fetch-release-binaries.ps1
   npm run tauri build
   ```

2. Confirm artifacts exist:

   - Linux: `src-tauri/target/release/bundle/deb/*.deb`,
     `src-tauri/target/release/bundle/appimage/*.AppImage`
   - Windows: `src-tauri/target/release/bundle/msi/*.msi`

3. Confirm the sidecars are inside the bundle (Linux deb/appimage: list the
   `usr/bin/` contents; the `pandoc`/`typst` executables sit next to `quillmd`).

## Fresh-machine acceptance test (§5.19)

On a clean VM with **no** Node, Rust, cargo, MSVC, pandoc, or typst installed:

1. Install the app: double-click the `.msi` (Windows) or install the `.deb` /
   run the `.AppImage` (Linux). No PATH edits, no prerequisites.
2. Launch QuillMD. It opens to a blank editor.
3. Create a document and type markdown (headings, lists, bold, a code block).
4. Save it (`.md` file on disk). Reopen and confirm round-trip content.
5. Export PDF: it produces a valid PDF (proves the bundled `pandoc` + `typst`
   sidecars run). Also export DOCX and EPUB to confirm the full conversion path.
6. Import a DOCX: content becomes editable markdown.

Expected result: all steps succeed with only the installer, no terminal work.

## Notes on the build

- The sidecar binaries are **not committed** (pandoc is ~200MB). The fetch
  script downloads pinned versions and renames them with the target-triple
  suffix Tauri expects (see `src-tauri/bin/README.md`).
- `bundle.externalBin` is optional-aware: `scripts/build-release.sh` bundles the
  sidecars when present, and builds without them otherwise. At runtime the
  convert module resolves a bundled sidecar first, then falls back to `$PATH`.
