// @vitest-environment jsdom
// Table row/column/cell/header/delete registry commands (plan 06 task 6.2,
// issue #62). Each command is a TipTap wrapper (or a small ProseMirror
// transaction) exercised through the shared registry (runEditorCommand /
// editorCommandActive), with the editor built from the same table extensions
// the app loads so the schema and selection handling behave exactly as in the
// real component.
import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CellSelection } from "@tiptap/pm/tables";
import { GfmTable, TABLE_CELL_MIN_WIDTH } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  cellAlignOf,
  editorCommandActive,
  headerRowOf,
  inTable,
  runEditorCommand,
} from "../editorCommands";
import type { EditorCommandId } from "../editorCommands";

const TABLE_IDS: EditorCommandId[] = [
  "rowInsertAbove",
  "rowInsertBelow",
  "rowDelete",
  "colInsertLeft",
  "colInsertRight",
  "colDelete",
  "cellAlignLeft",
  "cellAlignCenter",
  "cellAlignRight",
  "headerRowToggle",
  "cellMerge",
  "cellClear",
  "tableDelete",
];

// A 3x3 table with a header row and unique text in every cell.
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
      GfmTable.configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` (which lives in a
// cell) so table commands act on a deterministic position.
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
// occurrence of `text`, plus the position of its table. A cell position's
// parent is the row (so node(-1) is the table), the shape prosemirror-tables
// expects.
function cellOf(
  editor: Editor,
  text: string,
): { tablePos: number; cellPos: number } {
  let found: { tablePos: number; cellPos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    const $p = editor.state.doc.resolve(pos + idx);
    found = { tablePos: $p.before(1), cellPos: $p.before(3) };
    return false;
  });
  if (!found) throw new Error(`cell text not found: ${text}`);
  return found;
}

// Select the range of cells between the two cells (inclusive) containing the
// given texts.
function selectCells(editor: Editor, a: string, b: string): void {
  const { cellPos: anchor } = cellOf(editor, a);
  const { cellPos: head } = cellOf(editor, b);
  const sel = CellSelection.create(editor.state.doc, anchor, head);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

function tableJson(editor: Editor): JSONContent | undefined {
  return editor.getJSON().content?.find((n) => n.type === "table");
}

function rowsOf(editor: Editor): JSONContent[] {
  return tableJson(editor)?.content ?? [];
}

function cellTypes(editor: Editor, row: number): string[] {
  return (rowsOf(editor)[row]?.content ?? []).map((c) => c.type!);
}

// The plain text of a cell, concatenating the inline text of every block
// inside it (undefined when the cell holds no text, e.g. an empty paragraph).
function cellText(editor: Editor, row: number, col: number): string | undefined {
  const cell = rowsOf(editor)[row]?.content?.[col];
  let text: string | undefined;
  for (const block of cell?.content ?? []) {
    for (const n of block.content ?? []) {
      if (n.type === "text" && typeof n.text === "string") {
        text = text === undefined ? n.text : `${text}${n.text}`;
      }
    }
  }
  return text;
}

function alignAttr(editor: Editor): Array<string | null> | null {
  const align = tableJson(editor)?.attrs?.align;
  if (!Array.isArray(align)) return null;
  return align as Array<string | null>;
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

describe("table registry commands (plan 06 task 6.2, issue #62)", () => {
  it("registers every table command id exactly once", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    for (const id of TABLE_IDS) {
      expect(ids.filter((x) => x === id), id).toHaveLength(1);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const cmd of EDITOR_COMMANDS) {
      expect(typeof cmd.run).toBe("function");
      expect(cmd.label.length).toBeGreaterThan(0);
    }
  });

  it("inTable reports the selection's table membership", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a1");
    expect(inTable(editor)).toBe(true);
    editor.destroy();

    const plain = makeEditor("Just a paragraph");
    cursorAfter(plain, "paragraph");
    expect(inTable(plain)).toBe(false);
    plain.destroy();
  });

  describe("rowInsertAbove / rowInsertBelow", () => {
    it("inserts an empty body row above the selected row", () => {
      const editor = makeEditor();
      cursorAfter(editor, "a1");
      expect(editorCommandActive(editor, "rowInsertAbove")).toBe(true);
      expect(runEditorCommand(editor, "rowInsertAbove")).toBe(true);
      expect(rowsOf(editor)).toHaveLength(4);
      // New row is row index 1 (pushed below the header), all plain cells.
      expect(cellTypes(editor, 0)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
      expect(cellTypes(editor, 1)).toEqual(["tableCell", "tableCell", "tableCell"]);
      expect(cellText(editor, 1, 0)).toBeUndefined();
      // Existing rows shifted down.
      expect(cellText(editor, 2, 0)).toBe("a1");
      expect(cellText(editor, 3, 0)).toBe("b1");
      editor.destroy();
    });

    it("inserts an empty body row below the selected row", () => {
      const editor = makeEditor();
      cursorAfter(editor, "b1");
      expect(editorCommandActive(editor, "rowInsertBelow")).toBe(true);
      expect(runEditorCommand(editor, "rowInsertBelow")).toBe(true);
      expect(rowsOf(editor)).toHaveLength(4);
      expect(cellTypes(editor, 3)).toEqual(["tableCell", "tableCell", "tableCell"]);
      expect(cellText(editor, 3, 0)).toBeUndefined();
      // The selected (last) row stays in place above the new one.
      expect(cellText(editor, 2, 0)).toBe("b1");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "rowInsertAbove")).toBe(false);
      expect(editorCommandActive(editor, "rowInsertBelow")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "rowInsertAbove")).toBe(false);
      expect(runEditorCommand(editor, "rowInsertBelow")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("rowDelete", () => {
    it("removes the selected row", () => {
      const editor = makeEditor();
      cursorAfter(editor, "a1");
      expect(editorCommandActive(editor, "rowDelete")).toBe(true);
      expect(runEditorCommand(editor, "rowDelete")).toBe(true);
      expect(rowsOf(editor)).toHaveLength(2);
      expect(cellText(editor, 1, 0)).toBe("b1");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "rowDelete")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "rowDelete")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("colInsertLeft / colInsertRight", () => {
    it("inserts an empty column to the left of the selected column", () => {
      const editor = makeEditor();
      cursorAfter(editor, "h2");
      expect(editorCommandActive(editor, "colInsertLeft")).toBe(true);
      expect(runEditorCommand(editor, "colInsertLeft")).toBe(true);
      expect(rowsOf(editor).map((r) => r.content?.length)).toEqual([4, 4, 4]);
      // New empty column at index 1 (left of h2, right of h1).
      expect(cellText(editor, 0, 0)).toBe("h1");
      expect(cellText(editor, 0, 1)).toBeUndefined();
      expect(cellText(editor, 0, 2)).toBe("h2");
      editor.destroy();
    });

    it("inserts an empty column to the right of the selected column", () => {
      const editor = makeEditor();
      cursorAfter(editor, "h1");
      expect(editorCommandActive(editor, "colInsertRight")).toBe(true);
      expect(runEditorCommand(editor, "colInsertRight")).toBe(true);
      expect(rowsOf(editor).map((r) => r.content?.length)).toEqual([4, 4, 4]);
      // New empty column at index 1 (right of h1).
      expect(cellText(editor, 0, 0)).toBe("h1");
      expect(cellText(editor, 0, 1)).toBeUndefined();
      expect(cellText(editor, 0, 2)).toBe("h2");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "colInsertLeft")).toBe(false);
      expect(editorCommandActive(editor, "colInsertRight")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "colInsertLeft")).toBe(false);
      expect(runEditorCommand(editor, "colInsertRight")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("colDelete", () => {
    it("removes the selected column", () => {
      const editor = makeEditor();
      cursorAfter(editor, "h2");
      expect(editorCommandActive(editor, "colDelete")).toBe(true);
      expect(runEditorCommand(editor, "colDelete")).toBe(true);
      expect(rowsOf(editor).map((r) => r.content?.length)).toEqual([2, 2, 2]);
      expect(cellText(editor, 0, 0)).toBe("h1");
      expect(cellText(editor, 0, 1)).toBe("h3");
      expect(cellText(editor, 1, 0)).toBe("a1");
      expect(cellText(editor, 1, 1)).toBe("a3");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "colDelete")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "colDelete")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("cell alignment", () => {
    const ALIGNED_MD =
      "| A | B |\n" +
      "|:---|---:|\n" +
      "| 1 | 2 |\n";

    it("reads the alignment of the column under the cursor", () => {
      const editor = makeEditor(ALIGNED_MD);
      cursorAfter(editor, "A");
      expect(cellAlignOf(editor)).toBe("left");
      cursorAfter(editor, "B");
      expect(cellAlignOf(editor)).toBe("right");
      expect(editorCommandActive(editor, "cellAlignRight")).toBe(true);
      expect(editorCommandActive(editor, "cellAlignLeft")).toBe(false);
      expect(editorCommandActive(editor, "cellAlignCenter")).toBe(false);
      editor.destroy();
    });

    it("returns null outside a table and for mixed multi-column selections", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(cellAlignOf(editor)).toBe(null);

      const mixed = makeEditor(ALIGNED_MD);
      selectCells(mixed, "A", "B");
      expect(cellAlignOf(mixed)).toBe(null);
      editor.destroy();
      mixed.destroy();
    });

    it("sets a column to center and persists it as the GFM spec", () => {
      const editor = makeEditor(ALIGNED_MD);
      cursorAfter(editor, "1");
      expect(runEditorCommand(editor, "cellAlignCenter")).toBe(true);
      // Column 0 flips left -> center; column 1 keeps its right spec.
      expect(alignAttr(editor)).toEqual(["center", "right"]);
      expect(cellAlignOf(editor)).toBe("center");
      expect(editorCommandActive(editor, "cellAlignCenter")).toBe(true);
      const out = md(editor);
      expect(out).toContain(":-:");
      // Fixed point: re-serializing the re-parsed output changes nothing.
      expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
      editor.destroy();
    });

    it("sets a column to right", () => {
      const editor = makeEditor(ALIGNED_MD);
      cursorAfter(editor, "A");
      expect(runEditorCommand(editor, "cellAlignRight")).toBe(true);
      expect(alignAttr(editor)).toEqual(["right", "right"]);
      expect(cellAlignOf(editor)).toBe("right");
      editor.destroy();
    });

    it("aligns every column a multi-cell selection touches", () => {
      const editor = makeEditor(ALIGNED_MD);
      selectCells(editor, "A", "B");
      expect(runEditorCommand(editor, "cellAlignCenter")).toBe(true);
      expect(alignAttr(editor)).toEqual(["center", "center"]);
      expect(cellAlignOf(editor)).toBe("center");
      expect(editorCommandActive(editor, "cellAlignCenter")).toBe(true);
      editor.destroy();
    });

    it("explicitly writes the left spec when replacing another alignment", () => {
      const editor = makeEditor(ALIGNED_MD);
      cursorAfter(editor, "B");
      expect(runEditorCommand(editor, "cellAlignLeft")).toBe(true);
      // Column 1 flips right -> left (explicit "left" spec, serialized as the
      // left marker); column 0 keeps its left spec.
      expect(alignAttr(editor)).toEqual(["left", "left"]);
      const out = md(editor);
      // Both columns serialize as the left marker (:-), not the default (-).
      expect(out).toContain("| :- | :- |");
      expect(cellAlignOf(editor)).toBe("left");
      expect(editorCommandActive(editor, "cellAlignLeft")).toBe(true);
      editor.destroy();
    });

    it("is a no-op (no dispatch) when the columns already read as the target", () => {
      // A never-set column reads as left (the GFM default), so "align left"
      // on it dispatches nothing, matching the block alignment commands.
      const editor = makeEditor();
      cursorAfter(editor, "a1");
      expect(cellAlignOf(editor)).toBe("left");
      let transactions = 0;
      const onTransaction = (): void => {
        transactions += 1;
      };
      editor.on("transaction", onTransaction);
      expect(runEditorCommand(editor, "cellAlignLeft")).toBe(true);
      editor.off("transaction", onTransaction);
      expect(transactions).toBe(0);
      expect(alignAttr(editor)).toEqual([null, null, null]);
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      for (const id of ["cellAlignLeft", "cellAlignCenter", "cellAlignRight"] as const) {
        expect(editorCommandActive(editor, id)).toBe(false);
        const before = md(editor);
        expect(runEditorCommand(editor, id)).toBe(false);
        expect(md(editor)).toBe(before);
      }
      editor.destroy();
    });
  });

  describe("headerRowToggle", () => {
    it("reports the header-row state from any row", () => {
      const editor = makeEditor();
      cursorAfter(editor, "b2");
      expect(headerRowOf(editor)).toBe(true);
      expect(editorCommandActive(editor, "headerRowToggle")).toBe(true);
      editor.destroy();
    });

    it("turns the first row off into a body row (GFM: header is row 0)", () => {
      const editor = makeEditor();
      // Cursor in a body row: TipTap's own toggleHeaderRow would act on the
      // selected row; this command must act on the first row instead.
      cursorAfter(editor, "b1");
      expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
      expect(cellTypes(editor, 0)).toEqual(["tableCell", "tableCell", "tableCell"]);
      expect(cellTypes(editor, 1)).toEqual(["tableCell", "tableCell", "tableCell"]);
      expect(headerRowOf(editor)).toBe(false);
      expect(editorCommandActive(editor, "headerRowToggle")).toBe(false);
      // Toggling back restores the header row.
      expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
      expect(cellTypes(editor, 0)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
      expect(headerRowOf(editor)).toBe(true);
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(headerRowOf(editor)).toBe(null);
      expect(editorCommandActive(editor, "headerRowToggle")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "headerRowToggle")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("cellMerge", () => {
    it("is only active for a multi-cell selection", () => {
      const editor = makeEditor();
      cursorAfter(editor, "a1");
      expect(editorCommandActive(editor, "cellMerge")).toBe(false);
      selectCells(editor, "a1", "a2");
      expect(editorCommandActive(editor, "cellMerge")).toBe(true);
      editor.destroy();
    });

    it("merges the selected cells (colspan) and keeps the row consistent", () => {
      const editor = makeEditor();
      selectCells(editor, "a1", "a2");
      expect(runEditorCommand(editor, "cellMerge")).toBe(true);
      // The a-row (index 1: a1, a2, a3) becomes one colspan-2 cell plus a3.
      const row = rowsOf(editor)[1];
      expect(row.content).toHaveLength(2);
      expect(row.content?.[0]?.attrs?.colspan).toBe(2);
      expect(cellText(editor, 1, 1)).toBe("a3");
      // The merged cell keeps both cells' blocks (prosemirror-tables appends
      // non-empty content): "a1" then "a2", one paragraph each.
      const merged = row.content?.[0]?.content ?? [];
      expect(merged.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
      expect(cellText(editor, 1, 0)).toBe("a1a2");
      // Other rows are untouched.
      expect(cellText(editor, 0, 0)).toBe("h1");
      expect(cellText(editor, 2, 0)).toBe("b1");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      const before = md(editor);
      expect(runEditorCommand(editor, "cellMerge")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("cellClear", () => {
    it("clears the cell under the cursor to an empty paragraph", () => {
      const editor = makeEditor();
      cursorAfter(editor, "a1");
      expect(editorCommandActive(editor, "cellClear")).toBe(true);
      expect(runEditorCommand(editor, "cellClear")).toBe(true);
      expect(cellText(editor, 1, 0)).toBeUndefined();
      // Sibling cells are untouched.
      expect(cellText(editor, 1, 1)).toBe("a2");
      expect(cellText(editor, 2, 0)).toBe("b1");
      editor.destroy();
    });

    it("clears every cell a multi-cell selection covers", () => {
      const editor = makeEditor();
      selectCells(editor, "a1", "a3");
      expect(runEditorCommand(editor, "cellClear")).toBe(true);
      expect(cellText(editor, 1, 0)).toBeUndefined();
      expect(cellText(editor, 1, 1)).toBeUndefined();
      expect(cellText(editor, 1, 2)).toBeUndefined();
      // The next row is untouched.
      expect(cellText(editor, 2, 0)).toBe("b1");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "cellClear")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "cellClear")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("tableDelete", () => {
    it("removes the whole table block", () => {
      const editor = makeEditor();
      cursorAfter(editor, "a2");
      expect(editorCommandActive(editor, "tableDelete")).toBe(true);
      expect(runEditorCommand(editor, "tableDelete")).toBe(true);
      expect(tableJson(editor)).toBeUndefined();
      expect(md(editor)).not.toContain("|");
      editor.destroy();
    });

    it("is a no-op outside a table", () => {
      const editor = makeEditor("Just a paragraph");
      cursorAfter(editor, "paragraph");
      expect(editorCommandActive(editor, "tableDelete")).toBe(false);
      const before = md(editor);
      expect(runEditorCommand(editor, "tableDelete")).toBe(false);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });
});
