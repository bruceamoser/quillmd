# Plan 01 — App Shell & Native File Dialogs (P0)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P0/shell`
Depends on: — · Unblocks: P1-P4 (every feature that touches disk)

## 1. Problem

The app's file operations still use `window.prompt()` for path input (Open,
Save As, Export, Import) and `window.confirm()/alert()` for decisions. On a
desktop app this reads as broken — and it blocks drag-and-drop of folders,
multi-file open, and proper cancel/confirm UX. The Explorer already uses the
native folder picker (`@tauri-apps/plugin-dialog`), so the plugin is present;
the rest of the shell just never adopted it.

Target menu (Word/Docs parity): File > New / New from template / Open /
Open Folder / Recent / Make a copy / Save / Save As / Close / Close All /
Info (document properties) / Export / Import — all driven by native dialogs.

## 2. Scope

In scope:

1. **Native dialog everywhere** (Tauri path):
   - `Open` → `open({ multiple: true, filters: markdown filters })` — multi-file open, each file becomes a tab.
   - `Open Folder` → existing `open({ directory: true })` (keep, wire from File menu too).
   - `Save As` / `Save` (untitled) → `save({ defaultPath, filters })`.
   - `Export` → `save({ defaultPath: <stem>.<ext>, filters })` per format.
   - `Import DOCX` → `open({ filters: docx })` for source, `save` for output .md.
   - Confirmations (unsaved close, reload-on-external-change, snapshot restore, clear document) → native `message({ type: 'warning'|'info'|'error' })` with buttons; keep `window.confirm` only as browser-dev fallback.
2. **File > New** → untitled tab in WYSIWYG mode, in-memory until first save (Save goes to `save()` dialog).
3. **File > New from template** → small built-in template set (Blank, Meeting Notes, Blog Post, README, Project Plan, Proposal Skeleton) rendered into a new untitled tab. Templates live in `src/templates/*.md` bundled with the app; user templates can later come from `~/.config/quillmd/templates` (stretch, same issue).
4. **File > Make a copy** → `save()` dialog to pick the new .md path, writes current text, opens it as a new tab.
5. **File > Close / Close All** → Close = current tab (unsaved → confirm dialog); Close All = confirm listing dirty tabs.
6. **File > Info (document properties)** → native-style in-app panel (not a dialog): path, size on disk, word/char/line counts, encoding, EOL, BOM, created/modified (from OS), snapshot status. Reuse existing computed values from `DocState` + one new Rust command `file_stat(path) -> {size, created, modified}`.
7. **Drag & drop**: drop .md files (multi) and folders onto the window → open in tabs / open folder in Explorer. (Word/Docs both support; cheap once dialogs exist.)
8. **Recent Files** stays (have it) but gains per-item "Open" and right-click "Reveal in file manager" (via `plugin-opener`) — stretch, same issue.

Out of scope: autosave, file watching UI (Rust `watch.rs` exists; surface
later with P3), templates-as-gallery UI beyond the simple list.

## 3. Design notes

- All dialog calls go through a new `src/lib/dialogs.ts` module:
  `pickOpenFile(): string[] | null`, `pickOpenFolder()`, `pickSavePath(defaultName, filter): string | null`,
  `confirmMessage({title, message, kind, buttons})` — with the Tauri vs
  browser fallback switch in one place. `App.tsx` stops importing
  `window.prompt` paths.
- Filters: markdown = `*.md, *.markdown, *.mdown, *.mkd`; docx = `*.docx`;
  export filters per format (`.pdf`, `.docx`, `.epub`, `.txt`).
- `defaultPath` for Save As / Export: derived from the current doc path
  (Word behavior); for untitled docs, default filename `untitled-N.md`.
- Multi-open: `addDoc` already handles per-path state; open each picked file,
  activate the last. Errors per file go to the status bar, never abort the batch.
- Untitled docs: `DocState` keyed by a synthetic path `:new:<n>`; `dirty`
  semantics unchanged; first Save calls the save dialog and re-keys the doc.
- Rust: add `file_stat` command (std `fs::metadata` + `created`/`modified`,
  both platforms); no other Rust changes.
- Drag & drop: Tauri `onDragDropEvent` (Tauri 2 core API — no new plugin);
  resolve dropped URLs to paths, reuse `openPath`/`listDir`.

## 4. Acceptance criteria

1. On Windows and Linux builds: every file operation (Open, Open Folder,
   Save As, Export ×4, Import) uses the OS dialog. `grep window.prompt src/`
   returns zero hits in the Tauri code path.
2. `Ctrl+O` opens the native dialog; multi-select opens one tab per file.
3. New / New from template produce a working untitled tab; first Ctrl+S opens
   the save dialog and the tab re-keys to the chosen path.
4. Make a copy produces a real second file on disk, both tabs independent.
5. Close/Close All confirm with the native dialog only when dirty.
6. Info panel shows correct size/counts/EOL for a known fixture file.
7. Dropping 2 .md files + 1 folder opens 2 tabs and switches the Explorer
   root to the folder.
8. Existing M1-M6 tests green; clean-path round-trip test unchanged and green.

## 5. Tasks (each → sub-issue)

1. **dialogs.ts module** — Tauri dialog wrappers + browser fallbacks; unit-test the fallback selection logic (browser mode returns simulated values).
2. **Wire File menu** — Open (multi), Save As, Export, Import through dialogs.ts; delete prompt() paths; update `App.tsx` handlers.
3. **New + New from template** — template set in `src/templates/`, untitled-doc lifecycle (synthetic path, re-key on save), File menu + `Ctrl+N` shortcut.
4. **Make a copy + Close + Close All** — menu items, dirty-check via native confirm.
5. **Info (document properties)** — `file_stat` Rust command + properties panel UI (right-side flyout or status-bar popover).
6. **Drag & drop open** — `onDragDropEvent` handling for files and folders; status-bar feedback per dropped item.
7. **Acceptance + tests** — vitest for dialogs.ts, interaction test for multi-open, acceptance-harness section `p0-shell`; run on Linux, manual checklist on Windows box.

## 6. Manual acceptance checklist (Windows box)

The headless suites (`npm test`, `tests/acceptance-test.sh p0-shell`) run
everywhere, but native dialogs and accelerators can only be observed on a
real desktop. After `npm run tauri build` on a Windows 10/11 machine, run
`tests\acceptance-test.sh p0-shell` (Git Bash) and then check §4 by hand:

- [ ] **AC1 — OS dialogs.** File > Open, Open Folder, Save As, Save
      (untitled), Export ×4 (PDF/DOCX/EPUB/TXT), Import DOCX, Make a Copy
      each open an OS dialog (not an in-window prompt). Cancelling each one
      leaves the app state unchanged.
- [ ] **AC2 — Ctrl+O multi-select.** Ctrl+O (and File > Open...) opens the
      native open dialog; select 2–3 .md files at once → one tab per file in
      the TabBar, the last picked file is the active tab. A non-markdown file
      mixed into the selection is filtered by the dialog's Markdown filter.
- [ ] **AC3 — New / template / first save.** Ctrl+N opens a working untitled
      tab; File > New from Template > <any template> seeds the content. First
      Ctrl+S on an untitled tab opens the native save dialog; after choosing
      a path the tab title becomes the chosen file name and the file exists
      on disk with the edited bytes.
- [ ] **AC4 — Make a copy.** File > Make a Copy opens a save dialog seeded
      with `<stem>-copy.md`; after saving, a second file exists on disk and
      both tabs edit independently (type in each; save; verify both files).
- [ ] **AC5 — Close / Close All confirm only when dirty.** Close a clean tab
      → no dialog. Edit a tab, then File > Close → native warning dialog
      (OK/Cancel); Cancel keeps the tab, OK closes it. Close All with mixed
      dirty/clean tabs → one native dialog listing the dirty tabs.
- [ ] **AC6 — Info panel.** Open a known fixture (e.g.
      `fixtures\clean\headings.md`), File > Info → size matches
      `dir`/Properties, word/char/line counts match, EOL shows CRLF for a
      CRLF file, OS modified timestamp matches file properties.
- [ ] **AC7 — Drag & drop.** Drag 2 .md files + 1 folder onto the window →
      2 new tabs, Explorer root switches to the folder, status bar shows one
      line per dropped item.
- [ ] **AC8 — Regressions.** `npm test` green on the Windows box (round-trip
      fixtures, CRLF); `tests\acceptance-test.sh core` green with the built
      binary (`QUILLMD_BIN` or default target path).
