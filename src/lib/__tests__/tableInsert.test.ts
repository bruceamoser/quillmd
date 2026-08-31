// @vitest-environment jsdom
// Table size picker + "Insert table…" dialog (plan 06 task 6.3, issue #63):
// the shared insertTableAt logic the picker and dialog funnel through, the
// tableInsert / table / tableDialog registry commands, and the plan 06 AC1
// ("a 7x2 with header generates valid GFM with a header row in the saved
// file") through the clean-path save pipeline.
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { GfmTable } from "../../components/Editor";
import { createDocument, saveDocument } from "../pipeline";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  registerTableDialogListener,
  registerTablePickerListener,
  runEditorCommand,
} from "../editorCommands";
import {
  TABLE_MAX,
  TABLE_MIN,
  TABLE_PICKER_SIZE,
  insertTableAt,
  isValidTableSize,
  type TableInsertSpec,
} from "../tables";

function makeEditor(markdown?: string): Editor {
  return new Editor({
    // Same table extensions as the app editor (Editor.tsx).
    extensions: [
      StarterKit,
      GfmTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content:
      markdown === undefined ? { type: "doc", content: [] } : markdownToTiptap(markdown),
  });
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

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

describe("tables.ts size validation (issue #63)", () => {
  it("exposes the plan 06 §2.1 bounds and picker extent", () => {
    expect(TABLE_PICKER_SIZE).toBe(10);
    expect(TABLE_MIN).toBe(1);
    expect(TABLE_MAX).toBe(99);
  });

  it("accepts whole numbers within 1..99 per dimension", () => {
    for (const n of [1, 2, 10, 99]) {
      expect(isValidTableSize(n, n), `${n}x${n}`).toBe(true);
    }
    expect(isValidTableSize(1, 99)).toBe(true);
    expect(isValidTableSize(99, 1)).toBe(true);
  });

  it("rejects zero, out-of-range, fractional, and NaN sizes", () => {
    expect(isValidTableSize(0, 3)).toBe(false);
    expect(isValidTableSize(3, 0)).toBe(false);
    expect(isValidTableSize(100, 3)).toBe(false);
    expect(isValidTableSize(3, 100)).toBe(false);
    expect(isValidTableSize(2.5, 3)).toBe(false);
    expect(isValidTableSize(3, -1)).toBe(false);
    expect(isValidTableSize(Number.NaN, 3)).toBe(false);
  });
});

describe("insertTableAt (issue #63)", () => {
  let editors: Editor[] = [];

  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });

  const tracked = (markdown?: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("inserts exactly the requested size with a header row (plan 06 AC1: 7x2)", () => {
    const editor = tracked();
    expect(insertTableAt(editor, { rows: 7, cols: 2, withHeaderRow: true })).toBe(true);
    const rows = rowsOf(editor);
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row.content).toHaveLength(2);
    // The header pick makes the first row header cells.
    expect(cellTypes(editor, 0)).toEqual(["tableHeader", "tableHeader"]);
    expect(cellTypes(editor, 1)).toEqual(["tableCell", "tableCell"]);
  });

  it("inserts without a header row when the dialog pick says so", () => {
    const editor = tracked();
    expect(insertTableAt(editor, { rows: 2, cols: 3, withHeaderRow: false })).toBe(true);
    expect(rowsOf(editor)).toHaveLength(2);
    // GFM has no header-less table: the first row is body cells in the model,
    // but the serializer still writes the delimiter row (see below).
    expect(cellTypes(editor, 0)).toEqual(["tableCell", "tableCell", "tableCell"]);
    expect(cellTypes(editor, 1)).toEqual(["tableCell", "tableCell", "tableCell"]);
    const out = md(editor);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3); // header line + delimiter + 1 body row
    expect(lines[1]).toMatch(/^\|[\s\-:|]+\|$/);
  });

  it("inserts the 1x1 minimum and the 99x99 maximum", () => {
    const small = tracked();
    expect(insertTableAt(small, { rows: 1, cols: 1, withHeaderRow: true })).toBe(true);
    expect(rowsOf(small)).toHaveLength(1);
    expect(cellTypes(small, 0)).toEqual(["tableHeader"]);

    const big = tracked();
    expect(insertTableAt(big, { rows: TABLE_MAX, cols: TABLE_MAX, withHeaderRow: true })).toBe(
      true,
    );
    expect(rowsOf(big)).toHaveLength(TABLE_MAX);
    for (const row of rowsOf(big)) expect(row.content).toHaveLength(TABLE_MAX);
  });

  it("serializes the 7x2 header pick to valid GFM with a header row (AC1)", () => {
    const editor = tracked();
    insertTableAt(editor, { rows: 7, cols: 2, withHeaderRow: true });
    const out = md(editor);
    const lines = out.trim().split("\n");
    // 7 table rows + the delimiter row.
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line).toMatch(/^\|.*\|$/);
    // Line 2 is the delimiter: the GFM header row is line 1.
    expect(lines[1]).toMatch(/^\|[\s\-:|]+\|$/);
    // The re-serialized re-parsed output is a fixed point (save stability).
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("refuses invalid sizes without touching the document", () => {
    const editor = tracked("Hello world");
    const before = md(editor);
    for (const spec of [
      { rows: 0, cols: 3, withHeaderRow: true },
      { rows: 3, cols: 100, withHeaderRow: true },
      { rows: 2.5, cols: 3, withHeaderRow: true },
    ]) {
      expect(insertTableAt(editor, spec), JSON.stringify(spec)).toBe(false);
    }
    expect(md(editor)).toBe(before);
    expect(tableJson(editor)).toBeUndefined();
  });
});

describe("tableInsert registry command (issue #63)", () => {
  let editors: Editor[] = [];

  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });

  const tracked = (markdown?: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("is registered with the picker and dialog commands", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    for (const id of ["table", "tableInsert", "tableDialog"]) {
      expect(ids.filter((x) => x === id), id).toHaveLength(1);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("inserts the spec a surface picked", () => {
    const editor = tracked();
    expect(runEditorCommand(editor, "tableInsert", { rows: 4, cols: 2, withHeaderRow: true })).toBe(
      true,
    );
    expect(rowsOf(editor)).toHaveLength(4);
    expect(cellTypes(editor, 0)).toEqual(["tableHeader", "tableHeader"]);
    expect(cellTypes(editor, 3)).toEqual(["tableCell", "tableCell"]);
  });

  it("rejects non-spec params without touching the document", () => {
    const editor = tracked("Hello world");
    const before = md(editor);
    // The string/number/null params the other commands use, plus malformed
    // objects: none of them is a TableInsertSpec.
    for (const param of [
      "4x2",
      3,
      null,
      undefined,
      { rows: 4, cols: 2 },
      { rows: 4, cols: 2, withHeaderRow: "yes" },
      { rows: 4.5, cols: 2, withHeaderRow: true },
      { rows: "4", cols: 2, withHeaderRow: true },
      { cols: 2, withHeaderRow: true },
    ]) {
      expect(
        runEditorCommand(editor, "tableInsert", param as never),
        JSON.stringify(param),
      ).toBe(false);
    }
    expect(md(editor)).toBe(before);
    expect(tableJson(editor)).toBeUndefined();
  });

  it("rejects out-of-range specs without touching the document", () => {
    const editor = tracked("Hello world");
    const before = md(editor);
    expect(
      runEditorCommand(editor, "tableInsert", { rows: 100, cols: 2, withHeaderRow: true }),
    ).toBe(false);
    expect(md(editor)).toBe(before);
    expect(tableJson(editor)).toBeUndefined();
  });
});

describe("table / tableDialog request commands (issue #63)", () => {
  let editors: Editor[] = [];
  const unregisters: Array<() => void> = [];

  afterEach(() => {
    for (const off of unregisters.splice(0)) off();
    for (const e of editors.splice(0)) e.destroy();
  });

  it("the table command requests the picker (no-op without a renderer)", () => {
    const editor = makeEditor();
    editors.push(editor);
    // No toolbar mounted -> no picker renderer -> the command is a no-op.
    expect(runEditorCommand(editor, "table")).toBe(false);

    // The toolbar's listener is the single renderer: the request carries the
    // live editor so the pick inserts into the same instance.
    const seen: Editor[] = [];
    unregisters.push(registerTablePickerListener((e) => seen.push(e)));
    expect(runEditorCommand(editor, "table")).toBe(true);
    expect(seen).toEqual([editor]);
  });

  it("the tableDialog command requests the dialog (no-op without a renderer)", () => {
    const editor = makeEditor();
    editors.push(editor);
    expect(runEditorCommand(editor, "tableDialog")).toBe(false);

    const seen: Editor[] = [];
    unregisters.push(registerTableDialogListener((e) => seen.push(e)));
    expect(runEditorCommand(editor, "tableDialog")).toBe(true);
    expect(seen).toEqual([editor]);
  });
});

describe("plan 06 AC1: a 7x2 with header in the saved file", () => {
  it("splices the picked table into the document and saves valid GFM", () => {
    const source = "Before.\n\nAfter.\n";
    const model = createDocument(source);
    const editor = makeEditor(source);

    // Cursor at the end of the first paragraph; the picker pick dispatches
    // the identical command the toolbar/menus dispatch.
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Before.") {
        editor.chain().setTextSelection(pos + node.text.length).run();
        return false;
      }
      return true;
    });
    expect(runEditorCommand(editor, "tableInsert", { rows: 7, cols: 2, withHeaderRow: true })).toBe(
      true,
    );

    const saved = saveDocument(model, md(editor));
    // A new block changes the block count, so the clean path cannot splice
    // (computeBlockEdits is null) and falls back to the raw write of the
    // re-serialized document — the pipeline's designed behavior for
    // structural edits. The saved text is still the full current document.
    expect(saved.kind).toBe("raw");
    expect(saved.text).toBe(md(editor));

    // The saved text carries a 7-row, 2-column GFM table with a header row.
    const lines = saved.text.split("\n");
    const pipeLines = lines.filter((l) => l.startsWith("|"));
    expect(pipeLines).toHaveLength(8); // 7 rows + the delimiter row
    expect(pipeLines[1]).toMatch(/^\|[\s\-:|]+\|$/);
    // The untouched blocks stay byte-exact.
    expect(saved.text).toContain("Before.\n");
    expect(saved.text).toContain("After.\n");
    // The saved document re-parses as the same table shape (valid GFM).
    const reparsed = markdownToTiptap(saved.text);
    const table = (reparsed.content ?? []).find((n) => n.type === "table");
    expect(table).toBeDefined();
    expect(table?.content).toHaveLength(7);
    for (const row of table?.content ?? []) expect(row.content).toHaveLength(2);
    expect((table?.content?.[0]?.content ?? []).map((c) => c.type)).toEqual([
      "tableHeader",
      "tableHeader",
    ]);
    editor.destroy();
  });

  it("insertTableAt and the tableInsert command agree on every picker size", () => {
    // The picker can express any rows/cols in 1..10 with a header row; every
    // pick must land the identical table through either path.
    for (const rows of [1, 5, TABLE_PICKER_SIZE]) {
      for (const cols of [1, 3, TABLE_PICKER_SIZE]) {
        const spec: TableInsertSpec = { rows, cols, withHeaderRow: true };
        const direct = makeEditor();
        insertTableAt(direct, spec);
        const viaCommand = makeEditor();
        runEditorCommand(viaCommand, "tableInsert", spec);
        expect(md(viaCommand), `${rows}x${cols}`).toBe(md(direct));
        direct.destroy();
        viaCommand.destroy();
      }
    }
  });
});
