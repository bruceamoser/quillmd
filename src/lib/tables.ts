// Table insertion (plan 06 task 6.3, issue #63). The size-picker popover and
// the "Insert table…" dialog both funnel their picks through insertTableAt so
// every surface (toolbar, menu, dialog) inserts the identical table. The
// inserted model re-serializes to GFM through the converter (pm.ts); a
// header-row pick makes the first row a tableHeader row, which pm.ts writes
// as the GFM header + delimiter row.

import type { Editor as CoreEditor } from "@tiptap/core";

// The hover picker's grid extent (plan 06 §3): a 10×10 grid, like Word/Docs.
export const TABLE_PICKER_SIZE = 10;

// The dialog's exact-size bounds (plan 06 §2.1): GFM has no size limit, but
// an editor is a poor fit for unbounded grids, so the fields are clamped to
// 1..99 per dimension (the same 99-row guard the Tab-append behavior uses).
export const TABLE_MIN = 1;
export const TABLE_MAX = 99;

export interface TableInsertSpec {
  rows: number;
  cols: number;
  withHeaderRow: boolean;
}

// Validates a requested table size: whole numbers within 1..99 per dimension.
// Anything else (NaN, fractional, out of range) is rejected.
export function isValidTableSize(rows: number, cols: number): boolean {
  const ok = (n: number): boolean =>
    Number.isInteger(n) && n >= TABLE_MIN && n <= TABLE_MAX;
  return ok(rows) && ok(cols);
}

// Inserts a rows×cols table at the editor's current position. The header-row
// pick makes the first row header cells (the GFM header row). Returns false
// (no document change) for an invalid size or a failed insert.
export function insertTableAt(editor: CoreEditor, spec: TableInsertSpec): boolean {
  if (!isValidTableSize(spec.rows, spec.cols)) return false;
  return editor
    .chain()
    .focus()
    .insertTable({ rows: spec.rows, cols: spec.cols, withHeaderRow: spec.withHeaderRow })
    .run();
}
