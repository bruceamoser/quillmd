# QuillMD

WYSIWYG markdown editor with **native markdown persistence** — the `.md` file on disk is the only source of truth. Cross-platform: **Windows + Linux**. Local-only: no cloud, no accounts, no telemetry.

## Core principles

1. The markdown file is the source of truth. No proprietary formats, ever.
2. Round-trip fidelity: open → save = byte-identical (for clean fixtures, per the normalization manifest).
3. Full markdown feature set, not a subset: CommonMark + GFM + Pandoc extensions (front matter, footnotes, definition lists, sub/sup, highlight).
4. Works identically on Windows and Linux.

## Features

- WYSIWYG editing with markdown-aware affordances (slash commands, click-to-edit, task lists, tables, code blocks)
- Four view modes: WYSIWYG, Source (CodeMirror), Split, Preview — `Ctrl+/` toggles
- Clean-path save pipeline: unmodified docs are written back verbatim; edited docs re-serialize only the changed blocks
- Unified markdown-text undo (undo past a save restores pre-save bytes)
- Crash-recovery snapshots + atomic writes + external-change detection (never blind-overwrite)
- Import/export via Pandoc: PDF (Typst engine), DOCX, EPUB, TXT (raw or plain)

## Requirements

| Node.js | ≥ 20 | ≥ 20 (nodejs.org LTS) |
| Rust | stable (via rustup) | stable — [rustup-init.exe](https://rustup.rs) |
| MSVC Build Tools | — | VS 2022 *Desktop development with C++* workload (Tauri needs `link.exe`) |
| Pandoc | ≥ 3.0 (for import/export; optional for editing) | ≥ 3.0 — `choco install pandoc` or [pandoc.org](https://pandoc.org) |
| Typst | latest (for PDF export; optional) | latest — [releases](https://github.com/typst/typst/releases) |
| System libs | `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libdbus-1-dev`, `build-essential` | WebView2 (preinstalled on Win 10/11) |

**Windows:** run `powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1` — it checks every prerequisite, reports what's missing, and prints install commands. If you installed Rust *after* opening your terminal, **reopen the terminal** (PATH isn't refreshed in the current session) — that's the #1 cause of "failed to run cargo metadata" on Windows.

## Installation (from source)

```bash
git clone https://github.com/bruceamoser/quillmd.git
cd quillmd
npm install
```

Install Pandoc (and Typst for PDF export):

- **Linux (Debian/Ubuntu):** `sudo apt install pandoc` — Typst: [releases](https://github.com/typst/typst/releases) (put `typst` on PATH)
- **Windows:** `choco install pandoc` or [pandoc.org](https://pandoc.org) — Typst: [releases](https://github.com/typst/typst/releases)
- **Linux system deps:** `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libdbus-1-dev build-essential`

## Running (development)

```bash
npm run tauri dev
```

Launches the app with hot reload. Uses the native file dialogs, real filesystem layer, and Pandoc conversion.

Browser-only mode (no Tauri, for quick UI checks): `npm run dev` then open the printed URL. File open/save falls back to browser file input + downloads; conversion is unavailable.

## Building (release binaries)

Release builds ship **self-contained installers** that bundle pandoc + typst
as Tauri sidecars, so end users install nothing else: no Node, no Rust, no
MSVC, no pandoc/typst on PATH. Editing markdown works with zero external tools;
the sidecars are used only for import/export (PDF, DOCX, EPUB).

Build the release bundles:

```bash
# Linux / macOS: fetch pinned sidecars, then bundle
bash scripts/build-release.sh

# Windows (PowerShell): fetch pinned sidecars, then bundle the MSI
powershell -ExecutionPolicy Bypass -File scripts/fetch-release-binaries.ps1
npm run tauri build
```

`scripts/build-release.sh` downloads pinned pandoc/typst binaries into
`src-tauri/bin/` (via `scripts/fetch-release-binaries.sh`) and then runs
`npm run tauri build`. If the sidecars are absent, the build still succeeds and
the app falls back to the system `$PATH` at runtime (dev behavior).

Produces:

- **Linux:** `src-tauri/target/release/quillmd` (binary) + `.deb` + `.AppImage`
- **Windows:** `src-tauri/target/release/quillmd.exe` + `.msi` installer
  (`QuillMD-<version>-x64.msi`)

Run the binary directly, or install the bundle. The `.deb` declares its system
dependencies; the `.AppImage` is fully self-contained. Fresh-machine verification
steps are in [docs/packaging.md](docs/packaging.md).

## Tests

```bash
npm test                    # frontend: 55 vitest tests (pipeline, undo, round-trip)
cd src-tauri && cargo test  # Rust: 35 tests (fs layer, conversion, safety)
```

Round-trip fidelity is tested against a 50-fixture corpus in `fixtures/` — every clean fixture must round-trip byte-identically.

## Key bindings

| Shortcut | Action |
|---|---|
| `Ctrl+B` / `Ctrl+I` | Bold / italic on selection |
| `Ctrl+K` | Link on selection |
| `Ctrl+Shift+X` / `Ctrl+E` | Strikethrough / inline code |
| `Ctrl+/` or `F12` | Toggle WYSIWYG ↔ Source |
| `Shift+Enter` | Hard line break |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `/` at block start | Slash-command insert menu |

## Project docs

- **Spec:** [spec.md](spec.md) — requirements, acceptance criteria, architecture
- **Council:** [COUNCIL.md](COUNCIL.md) — five-lens software review charter
- **Council rounds:** [docs/council-rounds.md](docs/council-rounds.md)
- **Packaging:** [docs/packaging.md](docs/packaging.md) - installer build + fresh-machine checklist

## Status

- ✅ M1 — Rust filesystem layer (atomic writes, hash-guard, encoding, snapshots, file watch)
- ✅ M2 — Markdown engine + clean-path save pipeline (43/43 fixture round-trip)
- ✅ M3 — Pandoc import/export (PDF, DOCX, EPUB, TXT)
- ⏳ **M5 — Self-contained installers (bundle pandoc+typst; MSI + AppImage/deb)** — the "install for a user" milestone, per Bruce 2026-08-17

> **For end users:** QuillMD ships as a single installer published on GitHub Releases — download, install, done. No Node, Rust, or dev tools required. Running from source is for development only.

**Downloads:** https://github.com/bruceamoser/quillmd/releases (Windows `.msi`/`.exe`, Linux `.AppImage`/`.deb` — pandoc + typst bundled).

## License

Private (internal).
