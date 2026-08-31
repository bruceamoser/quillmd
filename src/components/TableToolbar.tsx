// Floating table toolbar (plan 06 task 6.4, issue #64): the contextual
// toolbar that appears while the selection is inside a table and hides as
// soon as the selection leaves (plan 06 §3, AC7). The button set is the
// task 6.2 row/column/cell command registry — insert/delete row and column,
// cell alignment, header row, merge, clear — plus delete table, grouped
// rows / columns / cell / delete, so this toolbar, the (P3) context menu,
// and the native menu all dispatch the identical commands through the
// shared registry.
//
// Positioning (plan 06 §3): the bar is absolutely positioned inside the
// editor body (the scroll container) above the table's bounding rect, which
// comes from ProseMirror nodeDOM — the table's offset in document space, so
// the bar tracks the table as rows and columns are added or removed and
// scrolls with the content (a scroll re-render keeps it pinned).
//
// Focus handling: the buttons swallow the mousedown (preventDefault, via the
// shared ToolbarButton's keepSelection) so the editor keeps its selection —
// a CellSelection included — while the command runs, instead of the click
// moving the caret to the button. Visibility itself is the selection's:
// every transaction re-renders the component, which recomputes the table
// under the selection and unmounts the bar the moment the selection leaves
// the table (including the tableDelete click, which drops the selection out
// of the table).
import { useEffect, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor as CoreEditor } from "@tiptap/core";
import { tablePosOf } from "../lib/editorCommands";
import type { EditorCommandId } from "../lib/editorCommands";
import { ToolbarButton } from "./Toolbar";

// The gap between the bar's bottom edge and the table's top edge.
export const TABLE_TOOLBAR_GAP = 8;

// The row/column/cell command set (plan 06 task 6.2, issue #62) rendered as
// compact buttons, grouped rows / columns / cell, then delete table.
const ROW_CMDS: EditorCommandId[] = ["rowInsertAbove", "rowInsertBelow", "rowDelete"];
const COL_CMDS: EditorCommandId[] = ["colInsertLeft", "colInsertRight", "colDelete"];
const CELL_CMDS: EditorCommandId[] = [
  "cellAlignLeft",
  "cellAlignCenter",
  "cellAlignRight",
  "headerRowToggle",
  "cellMerge",
  "cellClear",
];
const DELETE_CMDS: EditorCommandId[] = ["tableDelete"];

// The bar's position for a table at `tableEl`, relative to the editor body
// (the scroll container that contains both): the table's offset in document
// space (its viewport rect minus the container's, plus the container's
// current scroll), raised by TABLE_TOOLBAR_GAP above the table's top edge
// (the caller lifts the bar by its own height, so the gap lands between the
// bar's bottom edge and the table). A null container (no editor body, e.g.
// a detached test editor) reads as the viewport origin.
export function tableToolbarPosition(
  tableEl: HTMLElement,
  container: HTMLElement | null,
): { top: number; left: number } {
  const table = tableEl.getBoundingClientRect();
  const c = container ? container.getBoundingClientRect() : null;
  return {
    top: table.top - (c ? c.top : 0) + (container ? container.scrollTop : 0) - TABLE_TOOLBAR_GAP,
    left: table.left - (c ? c.left : 0) + (container ? container.scrollLeft : 0),
  };
}

export default function TableToolbar({ editor }: { editor: CoreEditor | null }) {
  // Re-render on every editor transaction: the bar's visibility is the
  // selection's (shown inside a table, hidden on leave) and row/column ops
  // resize the table, so both must track every doc and selection change.
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  // The table's viewport rect moves when the editor body scrolls; the
  // position math reads the rect at render time, so bump a render on scroll
  // to keep the bar pinned above the table. Attached only while a table is
  // under the selection — the only time the position matters.
  const tablePos = editor ? tablePosOf(editor) : null;
  const [, bumpScroll] = useState(0);
  useEffect(() => {
    if (!editor || tablePos === null) return;
    const scroller = editor.view.dom.closest(".quillmd-editor-body");
    if (!scroller) return;
    const onScroll = () => bumpScroll((n) => n + 1);
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [editor, tablePos]);

  if (!editor || tablePos === null) return null;
  // The table's bounding rect (plan 06 §3) comes from ProseMirror nodeDOM.
  const tableEl = editor.view.nodeDOM(tablePos);
  if (!(tableEl instanceof HTMLElement)) return null;
  const container = tableEl.closest<HTMLElement>(".quillmd-editor-body") ?? null;
  const { top, left } = tableToolbarPosition(tableEl, container);

  const renderGroup = (cmds: EditorCommandId[]) => (
    <>
      {cmds.map((id) => (
        <ToolbarButton key={id} editor={editor} id={id} keepSelection />
      ))}
      <span className="quillmd-table-toolbar-sep" aria-hidden="true" />
    </>
  );

  return (
    <div
      className="quillmd-table-toolbar"
      role="toolbar"
      aria-label="Table"
      style={{ top, left, transform: "translateY(-100%)" }}
    >
      {renderGroup(ROW_CMDS)}
      {renderGroup(COL_CMDS)}
      {renderGroup(CELL_CMDS)}
      {DELETE_CMDS.map((id) => (
        <ToolbarButton key={id} editor={editor} id={id} keepSelection />
      ))}
    </div>
  );
}
