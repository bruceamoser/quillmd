# Plan 10 — View Menu, Settings & Document Operations (P4)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P4/view-settings`
Depends on: P0 (native confirm), P1 (zoom/wrap/marks), P5 (themes) ·
Unblocks: — (closes the menu-surface gap)

## 1. Problem

The View menu today is just four view-mode toggles. Word/Docs View menus
carry zoom, wrap, full screen, navigation pane, rulers (n/a), and document
layout options; Docs Tools carries settings. QuillMD also lacks an app
settings surface (everything is hardcoded defaults), a "full screen" mode,
and the final File/Tools items (document properties was plan 01; this plan
takes Settings, Full Screen, and the remaining Tools items).

## 2. Scope

1. **View menu (complete)**
   - View modes: WYSIWYG / Source / Split / Preview (existing, re-grouped).
   - Zoom In / Zoom Out / Reset (P1 commands).
   - Word Wrap toggle (P1).
   - Show Formatting Marks toggle (P1).
   - Navigation Pane (plan 09) / Explorer toggle (existing `Ctrl+Shift+E`).
   - **Full Screen** (F11): hide menu bar, toolbar, status bar, side rails —
     editor only; F11 or Esc exits. (Word/Docs parity.)
   - Theme submenu (plan 05).
   - Editor font (plan 04: editor chrome font/size).
2. **Settings dialog** (File/Tools > Settings, `Ctrl+,`) — in-app, tabs:
   - **General:** default view mode, default EOL (lf/crlf/auto — currently
     per-doc detection only; default applies to new docs), spellcheck on/off
     default, asset folder preference (same folder vs `assets/`, plan 08),
     default asset collision behavior (never — fixed: suffix).
   - **Appearance:** theme default, editor font/size, show line numbers in
     source (new, cheap CodeMirror option), UI scale (100/110/125%, applied
     as root font-size).
   - **Editor:** tab key behavior (indent vs 4 spaces — currently inserts;
     make configurable), auto-close brackets/markers (TipTap input rules
     toggle), paste as plain text by default (off).
   - **Advanced:** open app config dir, reset settings to defaults, show
     version/paths (about info).
   - Storage: single JSON in app config dir (`settings.json`) via Rust
     commands `read_settings`/`write_settings`; defaults module in
     `src/lib/settings.ts`; settings apply live where possible (theme,
     wrap, font) and on-next-doc where not (EOL default).
3. **Tools menu** (new top-level menu, Docs "Tools" parity)
   - Word Count (plan 09).
   - Spelling… (plan 09).
   - Clear Formatting (existing command, moved here + Format keeps it).
   - Clear Document (plan 09).
   - Settings… (this plan).
4. **File menu finalization** — verify every File item maps to a native
   dialog after P0 (checklist), add **Print… → Export PDF** alias (Word
   users' muscle memory; just dispatches the PDF export with the save
   dialog) — labeled "Print (PDF)…".
5. **About QuillMD** (Help menu) — version, build hash, sidecar versions
   (pandoc/typst from the Rust convert module), links (GitHub, docs),
   "Check for updates" disabled with tooltip "manual releases on GitHub"
   (no auto-update in v2 — documented).
6. **Shortcuts dialog refresh** — Help > Shortcuts lists every new shortcut
   from plans 01-09 (generated from the registry where possible, so it
   can't drift).

Out of scope: auto-update pipeline, per-window settings, profile/multi-user
settings, key remapping UI (shortcuts fixed; remapping parked).

## 3. Design notes

- **Settings plumbing (one pattern, used by all):** `useSettings()` hook in
  React (reads once, subscribes to a `settings-changed` Tauri event) +
  `updateSettings(patch)` that writes via Rust and emits the event. Every
  feature in 01-09 that needs a preference consumes this hook — no ad-hoc
  localStorage (except the existing per-doc view-mode, which stays).
- **Full screen:** CSS class on the app root hiding chrome +
  `document.documentElement.requestFullscreen` (Tauri supports; Esc handled
  by the browser/OS); fallback to chrome-hide-only if fullscreen API is
  blocked. F11 shortcut registered in `menu.rs`.
- **Rust commands:** `read_settings`, `write_settings` (JSON file, atomic
  write via the existing atomic module, default-merge on read so new keys
  appear on upgrade), `get_sidecar_versions` (runs `pandoc --version` /
  `typst --version`, parses first line; 500 ms timeout).
- **Shortcuts dialog:** the `EDITOR_COMMANDS` registry already carries
  `shortcut` strings; the dialog renders the registry + the app-level
  shortcuts (menu-owned) from a single `src/lib/shortcuts.ts` table. This
  is the single source of truth — the Help menu and this dialog read it.
- **EOL default:** new (untitled) docs use the setting; existing per-doc
  detection unchanged.

## 4. Acceptance criteria

1. View menu shows all items; F11 enters/exits full screen (Esc works);
   zoom/wrap/marks toggles behave per plan 01/02.
2. Settings dialog: change theme + editor font → applies live to the open
   doc; restart app → values persist; "Reset to defaults" restores.
3. Settings file lives in the app config dir, is valid JSON, and unknown
   keys are preserved on write (forward-compat test).
4. Tools menu: Word Count / Spelling / Clear Formatting / Clear Document /
   Settings all dispatch correctly (test per item).
5. File > Print (PDF)… opens the PDF export save dialog and produces a PDF.
6. About shows real version + pandoc/typst versions (assert non-empty in
   the acceptance harness).
7. Shortcuts dialog lists ≥25 shortcuts, all present in the `shortcuts.ts`
   table (no drift: test that every registry `shortcut` appears).
8. Full regression: M1-M6 + P0-P3 suites green.

## 5. Tasks (each → sub-issue)

1. **Settings infrastructure** — settings.json schema + defaults, Rust
   commands, `useSettings` hook, settings-changed event; unit tests
   (merge, forward-compat, atomic write).
2. **Settings dialog** — tabbed UI, all General/Appearance/Editor/Advanced
   fields, live-apply wiring.
3. **View menu completion + Full Screen** — menu items, F11, CSS chrome
   hide, fullscreen API + fallback.
4. **Tools menu** — menu in `menu.rs`, dispatch wiring, About + sidecar
   versions.
5. **Shortcuts table + dialog** — `shortcuts.ts` single source, dialog
   UI, drift test.
6. **Acceptance** — `p4-view-settings` harness section; full regression
   run; Windows manual pass.
