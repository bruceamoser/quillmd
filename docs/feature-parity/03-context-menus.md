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
