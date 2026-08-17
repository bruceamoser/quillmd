# Sidecar binaries (pandoc + typst)

Release builds bundle pandoc and typst as Tauri sidecars (see
`bundle.externalBin` in `tauri.release.conf.json`) so end users get a single
installer with no toolchain required. The sidecars are enabled only for release
builds, so dev/`cargo build` keeps working with zero bundled tools (the convert
module falls back to `$PATH`).

The actual executables are **not committed** (pandoc is ~200MB across
platforms). Place them here before a release build, named with the target
triple suffix Tauri expects:

| Tool   | Linux                                 | Windows                                    |
|--------|---------------------------------------|--------------------------------------------|
| pandoc | `bin/pandoc-x86_64-unknown-linux-gnu` | `bin/pandoc-x86_64-pc-windows-msvc.exe`    |
| typst  | `bin/typst-x86_64-unknown-linux-gnu`  | `bin/typst-x86_64-pc-windows-msvc.exe`     |

Your target triple is printed by:

```bash
rustc --print host-tuple
```

Do not fetch these by hand. Run the pinned download script instead:

- Linux/macOS: `scripts/fetch-release-binaries.sh`
- Windows: `powershell -ExecutionPolicy Bypass -File scripts/fetch-release-binaries.ps1`

The script downloads the pinned release binaries and renames them into this
directory with the correct triple suffix.

At runtime, Tauri copies each sidecar next to the app binary and strips the
triple suffix, so the app resolves them as plain `pandoc` / `pandoc.exe`. The
Rust convert module resolves sidecars first and falls back to `$PATH` (dev).
