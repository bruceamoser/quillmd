# Plan 03 — Right-Click Context Menus (P3)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P3/context-menus`
Depends on: P0 (dialogs), P1 (editor commands), P2 (fonts/styles/tables commands) · Unblocks: —

## 1. Problem

Right-click in the editor is the WebView default menu (Copy/Paste/Inspect).
Word and Docs both provide rich, position-aware context menus: editor text
(format submenu, link, cut/copy/paste variants), tables (row/column insert &
delete, alignment, delete table), images (edit/remove), and links (edit/open/
remove). QuillMD currently has none.

## 2. Scope

One shared **context menu component** (`src/components/ContextMenu.tsx`) with
a declarative item model (label, icon, shortcut hint, enabled, checked,
submenu, separator, danger) positioned at the cursor, scroll- and
viewport-clamped, dismissed on Escape/outside-click, and fully keyboard
navigable (arrows, Enter, Escape; submenu on right-arrow). It is the single
surface used by every surface below:

1. **Editor text menu** (WYSIWYG + source + preview, each with its own item
   set):
   - Cut / Copy / Paste / Paste as text / Select All (P1 ids).
   - **Format** submenu → Font (B/I/U/S, sub/sup, highlight, color, clear
     formatting), Paragraph (align, indent, line spacing) — P1/P2 ids.
   - **Insert** submenu → the existing Insert menu items that make sense at
     the cursor (headings, table, image, link, hr, footnote, task list).
   - **Link** (when cursor is on a link: Edit link / Open link / Remove
     link; otherwise Insert link).
   - **Emoji** (opens the existing emoji insert).
2. **Table menu** (right-click inside a table cell):
   - Insert row above / below; Insert column left / right.
   - Delete row / column / table.
   - Cell alignment (left/center/right), header row toggle.
   - All implemented as P2/P6 table commands dispatched through the same
     registry; menu items enable/disable based on cursor position.
3. **Image menu** (right-click an image node): Edit image (URL dialog via
   P0 `message`/custom input dialog), Change alt text, Replace image (file
   picker), Remove image.
4. **Link menu** (right-click a link in preview/WYSIWYG): Open (via
   `plugin-opener`), Edit, Copy address, Remove.
5. **Tab bar menu**: Close, Close Others, Close All, Pin (stretch).
6. **Explorer menu**: New file, New folder, Rename, Delete (to OS temp? no —
   confirm + `fs` command), Copy path, Reveal in file manager (`plugin-opener`),
   Collapse all.
7. **Status bar / generic**: no custom menu; keep default.

Out of scope: draggable menu items, custom menu configuration (power feature,
parked), per-item icons beyond a small SVG set.

## 3. Design notes

- `ContextMenu` takes `{ x, y, items }`; `items` built by per-surface builders
  (`buildTextMenu(editor)`, `buildTableMenu(editor)`, `buildImageMenu(node)`,
  …) so enable/disable logic is pure and unit-testable.
- ProseMirror integration: editor `contextmenu` event → resolve selection
  (empty vs range vs node) → pick builder → render. Table detection: `posAt`
  inside a `tableRow`/`tableCell`. Image: selection node is `image`.
- Source view context menu: Copy / Paste / Paste as text / Select All +
  "Open in WYSIWYG" (switches mode keeping cursor).
- Preview view: Copy (rendered markdown text), link menu, "Open in WYSIWYG".
- All destructive items (Delete table, Delete file) use the P0 native confirm
  dialog; explorer Delete moves to an app-local trash under
  `app_config_dir()/trash` with a status-bar Undo for 30 s (never direct
  unlink).
- Keyboard: menu opens on `contextmenu` and on Shift-F10 over a focused
  surface; full arrow-key navigation; screen-reader labels on every item
  (accessibility label requirement from overview).
- No new Rust commands except `fs_rename`, `fs_new_file`, `fs_new_dir`,
  `fs_trash` (small, in `commands.rs`, guarded by the existing safety module).

## 4. Acceptance criteria

1. Right-click in WYSIWYG shows the text menu with Format/Insert submenus;
   every item maps 1:1 to a registry command and behaves identically to the
   toolbar/menu trigger (vitest: same command id dispatched).
2. Right-click in a table shows the table menu; "Insert column right" on a
   3×3 table yields a valid 3×4 GFM table in the saved text; "Delete table"
   requires the native confirm and removes the block cleanly.
3. Right-click an image: Edit opens the URL input dialog; Replace uses the
   file picker; Remove deletes the node (undoable via Ctrl+Z).
4. Tab bar menu closes the right tab; Close All honors dirty confirms.
5. Explorer menu: new file/folder create real entries (verified on disk via
   Rust test), Delete lands in app trash and is undoable from the status bar,
   Reveal opens the OS file manager (Windows: Explorer focused on file;
   Linux: default file manager).
6. Menu is keyboard-navigable end-to-end (arrows/Enter/Escape) — verified by
   an interaction test.
7. All existing suites green; no behavior change for left-click editing.

## 5. Tasks (each → sub-issue)

1. **ContextMenu component** — declarative model, positioning/clamping,
   keyboard nav, a11y labels; unit + interaction tests with a mock surface.
2. **Editor text menu** — builders for WYSIWYG/source/preview, ProseMirror
   selection resolution, Format/Insert/Link submenus.
3. **Table menu + commands** — table row/column insert/delete/align commands
   (registry), header-row toggle, menu builder; GFM round-trip tests.
4. **Image menu** — edit/alt/replace/remove flows using P0 dialogs.
5. **Link menu** — open via plugin-opener, edit, copy address, remove (all
   views).
6. **Tab bar + Explorer menus** — tab close/close-others/close-all; explorer
   new/rename/trash/reveal + `fs_*` Rust commands + trash undo.
7. **Acceptance** — `p3-context` section in the harness; Windows + Linux
   manual matrix (every menu × every surface).

## 6. Manual acceptance matrix (Windows + Linux)

The headless suites (`npm test`, `tests\acceptance-test.sh p3-context` /
`npm run build` on a Windows box under Git Bash; `bash
tests/acceptance-test.sh p3-context` on Linux) run everywhere, but real
right-click menus, the native confirm dialogs, the OS file manager, and the
system clipboard can only be observed on a real desktop. After
`npm run tauri build` on a Windows 10/11 machine and on a Linux desktop, run
the `p3-context` harness subset and then check the matrix below by hand —
every menu × every surface, both platforms.

Platform notes that apply to every row:

- **Save pipeline (Windows first-class).** After any menu-driven edit,
  `Ctrl+S` a CRLF document: `git diff` on the file must be empty for an
  untouched document, and menu-made edits (a 3×4 table, a removed link, a
  resized image) must save with CRLF endings preserved.
- **Keyboard (both platforms).** Every menu: right-click opens it;
  ArrowDown/ArrowUp/Home/End move; Enter/Space activate; ArrowRight/
  ArrowLeft enter/leave submenus; Escape closes submenu-first, then the
  menu; a disabled item is grayed and skipped.
- **Native dialogs (both platforms).** Destructive picks (Delete table,
  Remove image, Explorer Delete, Close All over dirty tabs) show the native
  confirm; declining leaves the document / file untouched.

### Editor text menu

- [ ] **WYSIWYG — empty caret.** Right-click in a paragraph: Cut/Copy
      disabled, Paste/Paste as text/Select all enabled; Format and Insert
      submenus open; pick Format > Bold on a selection → the same `**…`
      the toolbar button writes; pick Insert > Heading 3 → the block
      becomes `### …`.
- [ ] **WYSIWYG — on a link.** Right-click inside a link: the Link item is
      a submenu (Open link / Edit link / Copy address / Remove link). Open
      launches the system browser (Windows: default browser; Linux:
      xdg-open default); Copy address puts the raw href on the system
      clipboard; Remove unlinks and keeps the text; the unlink is undoable
      via Ctrl+Z.
- [ ] **Source view.** Right-click in the CodeMirror source: Copy / Paste /
      Paste as text / Select All + Open in WYSIWYG; the last switches the
      tab back to WYSIWYG keeping the cursor.
- [ ] **Preview.** Right-click in the rendered preview: Copy copies the
      rendered text under the caret; on a rendered link the Link submenu
      offers Open / Edit / Copy address / Remove — Edit reopens the link
      dialog prefilled, Remove splices the markdown source (the document
      text changes, the preview re-renders); Open in WYSIWYG switches
      modes.

### Table menu

- [ ] **WYSIWYG, inside a cell.** Right-click in a 3×3 table: the table
      menu (not the text menu) with row/column insert & delete, cell
      alignment (the current alignment checked), Toggle header row, Delete
      table (danger). Insert column right → the saved file holds a valid
      3×4 GFM table; Delete table → native confirm, the block is removed
      cleanly and surrounding text survives.
- [ ] **WYSIWYG, outside a table.** The text menu still shows (the table
      menu never leaks out of the table).

### Image menu

- [ ] **WYSIWYG, on an image.** Click an image (it selects), right-click:
      Edit image (URL dialog prefilled) / Change alt text (dialog, alt
      focused) / Replace image (native file picker; the file is copied into
      the asset folder and the src updated) / Remove image (native
      confirm; Ctrl+Z restores the image byte-identically).
- [ ] **WYSIWYG, image inside a table cell.** The image menu still wins
      over the table menu.

### Tab bar menu

- [ ] **Tab strip.** Right-click a tab: Close / Close Others / Close All.
      Close closes that tab (dirty → native confirm); Close Others keeps
      the right-clicked tab and confirms the rest as one batch; Close All
      honors the dirty confirms (declining keeps every tab).

### Explorer menu

- [ ] **File row.** Right-click a file: Rename / Delete / Copy Path /
      Reveal in File Manager. Rename prompts and moves the entry; Delete →
      native confirm → the file disappears from the tree and lands in the
      app trash (not unlinked), and the status bar offers ~30 s of Undo
      (clicking it restores the file at its original path); Copy Path puts
      the full path on the system clipboard; Reveal opens **Windows:
      Explorer focused on the file** / **Linux: the default file manager
      with the file selected**.
- [ ] **Folder row.** Right-click a folder: New File / New Folder (inside
      it) plus the file-row items. New file/folder create real empty
      entries on disk (check the folder in the OS file manager).
- [ ] **Folder section (no entry).** New File / New Folder at the opened
      root + Collapse All (folds every expanded directory).
- [ ] **Reserved names (Windows).** New File / Rename to `CON`, `NUL.md`,
      `COM1`, or a trailing-dot/space name are refused with an error — on
      both platforms (the guard is platform-independent).
