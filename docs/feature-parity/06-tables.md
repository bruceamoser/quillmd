# Plan 06 — Full Table Editing (P2)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P2/tables`
Depends on: P1 (registry) · Unblocks: P3 (table context menu dispatches
these commands)

## 1. Problem

Tables insert as a fixed 3×3 grid and that's the end of the story: no
row/column operations, no cell alignment, no header controls, no sizing.
Word's Insert > Table + table toolbar and Docs' table menu are the reference.
GFM tables are the round-trip target, so every operation must re-serialize
to valid GFM.

## 2. Scope

1. **Insert** — table size picker popover (10×10 grid hover-select, like
   Word/Docs) replacing the fixed 3×3 command; "Insert table…" dialog with
   rows/columns/headers checkboxes for precise sizes.
2. **Row operations** — insert row above/below; delete row; (move row
   up/down as stretch).
3. **Column operations** — insert column left/right; delete column; (move
   column as stretch).
4. **Cell operations** — merge (stretch; GFM has no merge → render as
   colspan HTML, documented degradation), clear cell contents, cell
   alignment L/C/R (per-column, stored as GFM alignment spec
   `:---`/`:---:`/`---:`), header row on/off (first row bold-header
   convention).
5. **Table toolbar (floating)** — appears when the selection is inside a
   table (Word's contextual tab, Docs' toolbar): the row/column/cell
   commands as compact buttons + alignment + delete table.
6. **Keyboard** — `Tab` moves cell→cell (last cell + Tab appends a row,
   Word/Docs behavior), `Shift+Tab` back.
7. **Column width (stretch)** — GFM can't encode widths; store as an HTML
   `<colgroup>` in the serialized table when the user drags a divider
   (documented: widths survive round-trip via colgroup, render in
   WYSIWYG/Preview, ignored by strict GFM consumers).

Out of scope: table borders/shading (theme-level), nested tables (GFM
doesn't support), table captions (deferred with plan 00 deferrals).

## 3. Design notes

- **Commands** (registry ids): `tableInsert` (params), `rowInsertAbove`,
  `rowInsertBelow`, `rowDelete`, `colInsertLeft`, `colInsertRight`,
  `colDelete`, `cellAlignLeft/Center/Right`, `headerRowToggle`,
  `tableDelete`, `cellMerge` (stretch), `cellClear`. TipTap's table
  extension already provides most primitives; the work is exposing them,
  the size-picker UI, and **GFM re-serialization fidelity** (see next).
- **GFM serialization is the risk.** TipTap renders tables as HTML
  (`<table>`); the clean-path save pipeline must emit GFM. Implementation:
  a table-aware transformer in the serializer that walks
  `table > tableRow > tableCell` nodes and emits GFM (header row,
  alignment row, escaped pipes `|` in cells, multi-line cells unsupported →
  collapse to `<br>` HTML in cell, documented). Parse path already handles
  GFM via remark-gfm. Round-trip test matrix: 1×1, 3×3, header/no-header,
  all alignment combos, cells containing `|`, `*`, `[]`, backticks,
  multi-line content.
- **Floating toolbar:** positioned above the table's bounding rect (from
  ProseMirror `nodeDOM`), hidden on selection-leave; reuses the shared
  toolbar button renderer.
- **Size picker:** hover grid popover (CSS grid, 10×10, tooltip "5 × 3");
  click inserts at cursor; dialog variant for >10 or with headers.
- **Tab-to-append:** on last cell, Tab inserts a row (max 99 rows guard).

## 4. Acceptance criteria

1. 10×10 picker inserts exactly the hovered size; 7×2 with header produces
   valid GFM with header row in the saved file.
2. Every row/column op produces valid GFM on save (linted by the existing
   remark parser — no parse errors) and renders identically on reopen.
3. Column alignment set via toolbar persists as GFM alignment spec and
   re-applies on reopen.
4. Tab/Shift+Tab navigate cells; last-cell Tab appends a row; Escape
   unfocuses the table.
5. Delete table (menu + context menu via P3) removes the whole block,
   undoable.
6. Cell containing `a | b` round-trips with escaped pipe (`a \| b`).
7. Floating toolbar appears/disappears on table focus correctly (interaction
   test).
8. All existing suites green; new GFM table fixture suite green.

## 5. Tasks (each → sub-issue)

1. **GFM table serializer + parser hardening** — transformer, escape rules,
   fixture matrix (the de-risking task; do first).
2. **Registry: row/column/cell/header/delete commands** — TipTap wrappers,
   unit tests per command.
3. **Table size picker + Insert dialog** — hover popover, dialog, menu/
   toolbar wiring.
4. **Floating table toolbar** — positioning, button set, focus handling.
5. **Cell alignment + header row + keyboard nav** — alignment spec
   serialization, Tab/Shift+Tab, append-row.
6. **Merge + colgroup widths** (stretch) — colspan HTML emit, drag divider
   handler, round-trip via colgroup.
7. **Acceptance** — `p2-tables` harness section; GFM lint in CI for table
   fixtures.
