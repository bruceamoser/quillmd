// @vitest-environment jsdom
// Table keyboard navigation (plan 06 task 6.5, issue #65): Tab / Shift+Tab
// move the selection cell to cell in reading order (a CellSelection moves as
// a block, clamped at the table edges), Tab in the bottom-right cell appends
// a row (one undo step) guarded at TABLE_MAX rows, and Escape exits the table
// (cursor after the table, so the floating toolbar hides). Exercised through
// the component's editorProps.handleKeyDown (handleEditorKeyDown), the same
// binding the WYSIWYG view installs, with the same table extensions the app
// loads so the schema and selection handling behave exactly as in production.
//
// The alignment-spec half of task 6.5 (cellAlignLeft/Center/Right writing the
// table's align attribute, serialized as the `:---` delimiter row) and the
// header-row half (headerRowToggle on row 0) are the task 6.2 registry
// commands, covered by tableCommands.test.ts and gfmTables.test.ts; the
// round-trip assertion below pins them end to end through a save.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CellSelection, cellAround } from "@tiptap/pm/tables";
import { GfmTable, TABLE_CELL_MIN_WIDTH } from "../../components/Editor";
import { handleEditorKeyDown } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { inTable, runEditorCommand } from "../editorCommands";
import { TABLE_MAX } from "../tables";
import { tableTab, tableEscape } from "../tableKeys";

const TABLE_MD =
  "| h1 | h2 | h3 |\n" +
  "|---|---|---|\n" +
  "| a1 | a2 | a3 |\n" +
  "| b1 | b2 | b3 |\n";

function makeEditor(markdown = TABLE_MD): Editor {
  return new Editor({
    // Same table extensions as the app editor (Editor.tsx).
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      GfmTable.configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` (which lives in a
// cell) so key handling acts on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

// The absolute position directly before the cell node containing the first
// occurrence of `text`. A cell position's parent is the row, the shape
// prosemirror-tables expects.
function cellPosOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    found = editor.state.doc.resolve(pos + idx).before(3);
    return false;
  });
  if (found === -1) throw new Error(`cell text not found: ${text}`);
  return found;
}

// Select the range of cells between the two cells (inclusive) containing the
// given texts.
function selectCells(editor: Editor, a: string, b: string): void {
  const sel = CellSelection.create(
    editor.state.doc,
    cellPosOf(editor, a),
    cellPosOf(editor, b),
  );
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

// Emits the keydown and runs it through the component's
// editorProps.handleKeyDown (handleEditorKeyDown), the same binding the
// WYSIWYG view installs.
function press(
  editor: Editor,
  key: string,
  opts: { ctrl?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  handleEditorKeyDown(editor, event);
  return event;
}

// The text of the cell under the cursor (undefined outside a table).
function cursorCellText(editor: Editor): string | undefined {
  const $cell = cellAround(editor.state.selection.$from);
  if (!$cell) return undefined;
  const cell = editor.state.doc.nodeAt($cell.pos);
  if (!cell) return undefined;
  let text = "";
  cell.descendants((node) => {
    if (node.isText) text += node.text;
    return true;
  });
  return text;
}

// The texts of the first and last cell of the current CellSelection
// (undefined when the selection is not a cell selection).
function selectionCellTexts(
  editor: Editor,
): [string, string] | undefined {
  const sel = editor.state.selection;
  if (!(sel instanceof CellSelection)) return undefined;
  const textOf = (cellPos: number): string => {
    const cell = editor.state.doc.nodeAt(cellPos)!;
    let text = "";
    cell.descendants((node) => {
      if (node.isText) text += node.text;
      return true;
    });
    return text;
  };
  return [textOf(sel.$anchorCell.pos), textOf(sel.$headCell.pos)];
}

function rowsOf(editor: Editor): JSONContent[] {
  const table = editor.getJSON().content?.find((n) => n.type === "table");
  return table?.content ?? [];
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

let editors: Editor[] = [];

beforeEach(() => {
  editors = [];
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
});

function trackedEditor(markdown = TABLE_MD): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

describe("Tab / Shift+Tab cell navigation (plan 06 task 6.5, issue #65)", () => {
  it("Tab moves the cursor to the next cell in the row", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "a1");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(cursorCellText(editor)).toBe("a2");
    editor.destroy();
  });

  it("Tab wraps to the first cell of the next row at the row end", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "a3");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(cursorCellText(editor)).toBe("b1");
    editor.destroy();
  });

  it("Shift+Tab moves the cursor to the previous cell", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "a2");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(cursorCellText(editor)).toBe("a1");
    editor.destroy();
  });

  it("Shift+Tab wraps to the last cell of the previous row at the row start", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "b1");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(cursorCellText(editor)).toBe("a3");
    editor.destroy();
  });

  it("Shift+Tab in the first cell is swallowed (no move, no focus loss)", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "h1");
    const event = press(editor, "Tab", { shift: true });
    expect(event.defaultPrevented).toBe(true);
    expect(cursorCellText(editor)).toBe("h1");
    expect(inTable(editor)).toBe(true);
    editor.destroy();
  });

  it("Tab in the last cell appends a row and moves into it", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "b3");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(rowsOf(editor)).toHaveLength(4);
    // The new row is a body row and the cursor sits in its first cell.
    expect(rowsOf(editor)[3].content?.map((c) => c.type!)).toEqual([
      "tableCell",
      "tableCell",
      "tableCell",
    ]);
    expect(cursorCellText(editor)).toBe("");
    // The existing rows are untouched and the table still serializes as GFM:
    // header + delimiter + 3 body rows = 5 pipe lines (the new row is empty,
    // so the serializer pads its cells; the line count is what matters).
    expect(md(editor)).toContain("| b1 | b2 | b3 |");
    const pipeLines = md(editor)
      .split("\n")
      .filter((line) => line.trimStart().startsWith("|")).length;
    expect(pipeLines).toBe(5);
    // AC2: the appended row is valid GFM and re-parses to the same 4-row
    // table (renders identically on reopen).
    const reparsed = markdownToTiptap(md(editor));
    const reparsedRows =
      reparsed.content?.find((n) => n.type === "table")?.content ?? [];
    expect(reparsedRows).toHaveLength(4);
    editor.destroy();
  });

  it("Tab-append keeps the alignment spec on the table", () => {
    const editor = trackedEditor(
      "| L | R |\n" +
        "|:--|--:|\n" +
        "| 1 | 2 |\n" +
        "| 3 | 4 |\n",
    );
    cursorAfter(editor, "4");
    press(editor, "Tab");
    // Source table is 3 rows (header + 2 body); the append makes 4.
    expect(rowsOf(editor)).toHaveLength(4);
    expect(md(editor)).toContain("| :- | -: |");
    editor.destroy();
  });

  it("Tab in the last cell is a no-op at the TABLE_MAX row guard", () => {
    const header = "| h1 | h2 |";
    const spec = "|---|---|";
    const body = Array.from(
      { length: TABLE_MAX - 1 },
      (_, i) => `| r${i}c0 | r${i}c1 |`,
    ).join("\n");
    const editor = trackedEditor(`${header}\n${spec}\n${body}\n`);
    expect(rowsOf(editor)).toHaveLength(TABLE_MAX);
    cursorAfter(editor, `r${TABLE_MAX - 2}c1`);
    const event = press(editor, "Tab");
    expect(event.defaultPrevented).toBe(true);
    expect(rowsOf(editor)).toHaveLength(TABLE_MAX);
    expect(cursorCellText(editor)).toBe(`r${TABLE_MAX - 2}c1`);
    editor.destroy();
  });

  it("is a no-op outside a table (list Tab nesting is untouched)", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "two");
    const event = press(editor, "Tab");
    // The list handler (not the table handler) consumes the key.
    expect(event.defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n  - two\n");
    editor.destroy();
  });

  it("tableTab reports false outside a table without touching the doc", () => {
    const editor = trackedEditor("Just a paragraph");
    cursorAfter(editor, "paragraph");
    expect(tableTab(editor, false)).toBe(false);
    expect(tableTab(editor, true)).toBe(false);
    expect(tableEscape(editor)).toBe(false);
    expect(md(editor)).toBe("Just a paragraph\n");
    editor.destroy();
  });
});

describe("Tab / Shift+Tab with a cell selection (issue #65)", () => {
  it("Tab moves the selection one column right", () => {
    const editor = trackedEditor();
    selectCells(editor, "a1", "a2");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(selectionCellTexts(editor)).toEqual(["a2", "a3"]);
    editor.destroy();
  });

  it("Shift+Tab moves the selection one column left", () => {
    const editor = trackedEditor();
    selectCells(editor, "a2", "a3");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(selectionCellTexts(editor)).toEqual(["a1", "a2"]);
    editor.destroy();
  });

  it("Tab at the right edge shifts the selection down a row (columns kept)", () => {
    const editor = trackedEditor();
    selectCells(editor, "a2", "a3");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(selectionCellTexts(editor)).toEqual(["b2", "b3"]);
    editor.destroy();
  });

  it("Tab on the bottom-right selection appends a row and moves into it", () => {
    const editor = trackedEditor();
    selectCells(editor, "b2", "b3");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(rowsOf(editor)).toHaveLength(4);
    // The selection now spans the two rightmost cells of the new row.
    expect(selectionCellTexts(editor)).toEqual(["", ""]);
    editor.destroy();
  });

  it("Shift+Tab at the left edge shifts the selection up a row", () => {
    const editor = trackedEditor();
    selectCells(editor, "b1", "b2");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(selectionCellTexts(editor)).toEqual(["a1", "a2"]);
    editor.destroy();
  });

  it("Shift+Tab in the top-left cell is swallowed", () => {
    const editor = trackedEditor();
    selectCells(editor, "h1", "h2");
    const event = press(editor, "Tab", { shift: true });
    expect(event.defaultPrevented).toBe(true);
    expect(selectionCellTexts(editor)).toEqual(["h1", "h2"]);
    editor.destroy();
  });
});

describe("Escape exits the table (issue #65)", () => {
  it("moves the cursor to the paragraph after the table", () => {
    const editor = trackedEditor(`${TABLE_MD}\nAfter the table.\n`);
    cursorAfter(editor, "a2");
    const event = press(editor, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(inTable(editor)).toBe(false);
    expect(cursorCellText(editor)).toBeUndefined();
    // The cursor is in the "After the table." paragraph. (textContent, not
    // .text: the latter is null on non-Text nodes like paragraphs.)
    const $from = editor.state.selection.$from;
    expect($from.parent.textContent).toBe("After the table.");
    expect(md(editor)).toContain("After the table.");
    editor.destroy();
  });

  it("creates a paragraph after the table when it is the last block", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "b3");
    const event = press(editor, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(inTable(editor)).toBe(false);
    // A paragraph now follows the table and holds the cursor.
    const last = editor.getJSON().content?.[editor.getJSON().content!.length - 1];
    expect(last?.type).toBe("paragraph");
    const $from = editor.state.selection.$from;
    expect($from.parent.type.name).toBe("paragraph");
    // The table still serializes as GFM.
    expect(md(editor)).toContain("| h1 | h2 | h3 |");
    editor.destroy();
  });

  it("works from a cell selection too", () => {
    const editor = trackedEditor(`${TABLE_MD}\nTail.\n`);
    selectCells(editor, "a1", "b3");
    expect(press(editor, "Escape").defaultPrevented).toBe(true);
    expect(inTable(editor)).toBe(false);
    const $from = editor.state.selection.$from;
    expect($from.parent.textContent).toBe("Tail.");
    editor.destroy();
  });

  it("is a no-op outside a table", () => {
    const editor = trackedEditor("Just a paragraph");
    cursorAfter(editor, "paragraph");
    const event = press(editor, "Escape");
    expect(event.defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Just a paragraph\n");
    editor.destroy();
  });
});

describe("alignment spec + header row end to end (task 6.5 serialization)", () => {
  it("toolbar-set alignment persists as the GFM spec and re-applies on reopen", () => {
    const editor = trackedEditor();
    // Align the middle column center via the registry command (the toolbar
    // button dispatches this same command, TableToolbar.tsx).
    cursorAfter(editor, "h2");
    expect(runEditorCommand(editor, "cellAlignCenter")).toBe(true);
    const out = md(editor);
    expect(out).toContain(":-:");
    // Reopen: parse the saved markdown back into a fresh editor and the
    // alignment must re-apply.
    const reopened = makeEditor(out);
    const align = reopened.getJSON().content?.[0]?.attrs?.align;
    expect(align).toEqual([null, "center", null]);
    // Fixed point: save again, nothing changes.
    expect(tiptapToMarkdown(reopened.getJSON())).toBe(out);
    editor.destroy();
    reopened.destroy();
  });

  it("header-row toggle re-serializes as a GFM header row", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "b1");
    expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
    // All rows are body cells now; GFM has no header-less table, so the
    // first row serializes as the header (documented degradation) and the
    // document re-parses with no dropped row.
    expect(md(editor)).toContain("| h1 | h2 | h3 |");
    const reopened = makeEditor(md(editor));
    expect(rowsOf(reopened)).toHaveLength(3);
    editor.destroy();
    reopened.destroy();
  });
});
