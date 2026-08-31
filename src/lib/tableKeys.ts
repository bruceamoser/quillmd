// Table keyboard navigation (plan 06 task 6.5, issue #65): Tab and Shift+Tab
// move the selection cell by cell in reading order (Word/Docs behavior), Tab
// in the last cell appends a row (the 99-row guard, plan 06 §3), and Escape
// exits the table — the block-exit key of spec §2.1.5, which also drops the
// floating table toolbar (its visibility is the selection's). The WYSIWYG key
// handler (Editor.tsx handleEditorKeyDown) dispatches here while the
// selection is inside a table; outside a table every function returns false
// so the existing Tab/Shift+Tab list/quote handling and the browser defaults
// are untouched.
//
// The grid math rides on prosemirror-tables' TableMap, the same convention
// selectedRect and the CellSelection constructor use: map positions are
// relative to the table's content start ($cell.start(-1) for a cell
// position), so an absolute cell position is tableStart + mapPos. A cursor /
// text selection covers the single cell under the caret; a CellSelection
// covers its whole rect, and Tab/Shift+Tab move the rect one column / one
// row at a time (clamped at the table edges), mirroring Word.

import type { Editor as CoreEditor } from "@tiptap/core";
import {
  CellSelection,
  TableMap,
  addRow,
  isInTable,
  selectedRect,
} from "@tiptap/pm/tables";
import { TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { TABLE_MAX } from "./tables";

// Moves the selection one cell (or, for a CellSelection, one grid column /
// row) in reading order. Tab in the bottom-right cell appends a row — in the
// same transaction, so the append plus the move is one undo step — and moves
// into it, guarded by TABLE_MAX rows. Returns true when the event was
// consumed (always, inside a table: at the boundaries the key is swallowed
// instead of letting the browser move focus out of the editor).
export function tableTab(editor: CoreEditor, backward: boolean): boolean {
  const state = editor.state;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const { left, top, right, bottom, tableStart, map } = rect;
  const width = map.width;
  const height = map.height;

  let newLeft = left;
  let newTop = top;
  let newRight = right;
  let newBottom = bottom;

  if (backward) {
    if (left > 0) {
      newLeft = left - 1;
      newRight = right - 1;
    } else if (top > 0) {
      newTop = top - 1;
      newBottom = bottom - 1;
      if (!(state.selection instanceof CellSelection)) {
        // A cursor wraps to the last cell of the previous row (reading
        // order); a cell selection shifts up keeping its columns.
        newLeft = width - 1;
        newRight = width;
      }
    } else {
      // First cell: nothing before it, swallow the key.
      return true;
    }
  } else if (right < width) {
    newLeft = left + 1;
    newRight = right + 1;
  } else if (bottom < height) {
    if (state.selection instanceof CellSelection) {
      // A cell selection wraps to the next row keeping its columns.
      newTop = top + 1;
      newBottom = bottom + 1;
    } else {
      // A cursor wraps to the first cell of the next row (reading order).
      newLeft = 0;
      newTop = top + 1;
      newRight = 1;
      newBottom = bottom + 1;
    }
  } else {
    // Bottom-right cell: Tab appends a row (max TABLE_MAX rows) and moves
    // into it. addRow mutates the transaction; the selection move below
    // rides the same dispatch.
    if (height >= TABLE_MAX) return true;
    const tr = state.tr;
    addRow(tr, rect, bottom);
    const table = tr.doc.nodeAt(tableStart - 1);
    if (!table) return true;
    const nextMap = TableMap.get(table);
    if (state.selection instanceof CellSelection) {
      newLeft = left;
      newTop = top + 1;
      newRight = right;
      newBottom = bottom + 1;
    } else {
      newLeft = 0;
      newTop = bottom;
      newRight = 1;
      newBottom = bottom + 1;
    }
    dispatchCellMove(editor, tr, tableStart, nextMap, newLeft, newTop, newRight, newBottom);
    return true;
  }

  const sel = state.selection;
  if (sel instanceof CellSelection) {
    const anchor = tableStart + map.map[newTop * width + newLeft];
    const head = tableStart + map.map[(newBottom - 1) * width + (newRight - 1)];
    editor.view.dispatch(
      state.tr.setSelection(CellSelection.create(state.doc, anchor, head)).scrollIntoView(),
    );
  } else {
    // A cursor lands at the start of the target cell's first block.
    const cellPos = tableStart + map.map[newTop * width + newLeft];
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, cellPos + 1)).scrollIntoView(),
    );
  }
  return true;
}

// Sets a selection covering the new rect (a CellSelection of its corner
// cells, or a cursor at the first cell's start) on the given transaction.
function dispatchCellMove(
  editor: CoreEditor,
  tr: Transaction,
  tableStart: number,
  map: TableMap,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const doc = tr.doc;
  if (editor.state.selection instanceof CellSelection) {
    const anchor = tableStart + map.map[top * map.width + left];
    const head = tableStart + map.map[(bottom - 1) * map.width + (right - 1)];
    tr.setSelection(CellSelection.create(doc, anchor, head));
  } else {
    const cellPos = tableStart + map.map[top * map.width + left];
    tr.setSelection(TextSelection.create(doc, cellPos + 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
}

// Escape inside a table: the cursor moves to the block after the table
// (creating a paragraph when the table is the last block, the same exit the
// ArrowDown-at-table-end handler performs), so the selection leaves the table
// and the floating table toolbar hides. Returns true when consumed.
export function tableEscape(editor: CoreEditor): boolean {
  const state = editor.state;
  if (!isInTable(state)) return false;
  const { tableStart, table } = selectedRect(state);
  const after = tableStart - 1 + table.nodeSize;
  const tr = state.tr;
  const nodeAfter = state.doc.nodeAt(after);
  if (nodeAfter && nodeAfter.type.name === "paragraph") {
    tr.setSelection(TextSelection.create(state.doc, after + 1));
  } else {
    const empty = state.schema.nodes.paragraph.createChecked();
    if (!empty) return false;
    tr.insert(after, empty);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
