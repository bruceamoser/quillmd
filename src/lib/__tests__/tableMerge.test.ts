// @vitest-environment jsdom
// Merged + width-carrying tables (plan 06 task 6.6, issue #66): GFM has no
// colspan/rowspan and cannot encode column widths, so a table with merged
// cells or a dragged divider serializes as a canonical HTML <table> block
// (one tag per line, a <colgroup> carrying widths + non-left alignment,
// markdown phrasing embedded verbatim in the cells) and parses back into a
// live TipTap table. Anything not in the canonical shape stays opaque HTML
// (norm-002 passthrough). Round-trip means markdown -> TipTap JSON ->
// markdown: canonical inputs must be byte-stable (the serializer is its own
// fixed point) and re-parsing must be semantically identical.
import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CellSelection } from "@tiptap/pm/tables";
import { GfmTable, TABLE_CELL_MIN_WIDTH } from "../../components/Editor";
import { createDocument, saveDocument } from "../pipeline";
import {
  markdownToTiptap,
  parseMergedTableHtml,
  tiptapToMarkdown,
} from "../pm";

// A canonical merged table: 2 columns, the header spans both (colspan),
// column 0 has a user-set width and center alignment, column 1 is unset.
const CANONICAL = [
  "<table>",
  "<colgroup>",
  '<col style="width: 200px; text-align: center">',
  "<col>",
  "</colgroup>",
  "<tr>",
  '<th colspan="2">A</th>',
  "</tr>",
  "<tr>",
  "<td>1</td>",
  "<td>2</td>",
  "</tr>",
  "</table>",
].join("\n");

function tableJson(markdown: string): JSONContent | undefined {
  return markdownToTiptap(markdown).content?.find((n) => n.type === "table");
}

function cellAttrs(
  json: JSONContent | undefined,
  row: number,
  col: number,
): Record<string, unknown> | undefined {
  return (json?.content?.[row]?.content ?? [])[col]?.attrs;
}

function cellTextOf(
  json: JSONContent | undefined,
  row: number,
  col: number,
): string {
  const cell = (json?.content?.[row]?.content ?? [])[col];
  let text = "";
  for (const block of cell?.content ?? []) {
    for (const n of block.content ?? []) {
      if (n.type === "text" && typeof n.text === "string") text += n.text;
    }
  }
  return text;
}

// The same table extensions the app editor loads (Editor.tsx), so the
// schema, cellMerge, and colwidth handling behave exactly as in the app.
function makeEditor(markdown: string): Editor {
  return new Editor({
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

// The absolute position of the cell (start of the cell node) containing the
// first occurrence of `text`.
function cellOf(editor: Editor, text: string): number {
  let found = 0;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    const $p = editor.state.doc.resolve(pos + idx);
    found = $p.before(3);
    return false;
  });
  if (found === 0) throw new Error(`cell text not found: ${text}`);
  return found;
}

function selectCells(editor: Editor, a: string, b: string): void {
  const sel = CellSelection.create(editor.state.doc, cellOf(editor, a), cellOf(editor, b));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

function editorTableJson(editor: Editor): JSONContent | undefined {
  return editor.getJSON().content?.find((n) => n.type === "table");
}

describe("merged-table HTML emit (plan 06 task 6.6)", () => {
  it("emits the canonical HTML form for a colspan merge", () => {
    const doc = makeEditor("| a | b |\n|---|---|\n| x | y |\n");
    selectCells(doc, "x", "y");
    doc.chain().focus().mergeCells().run();
    const json = editorTableJson(doc);
    expect(cellAttrs(json, 1, 0)?.colspan).toBe(2);
    expect(tiptapToMarkdown(doc.getJSON())).toBe(
      [
        "<table>",
        "<colgroup>",
        "<col>",
        "<col>",
        "</colgroup>",
        "<tr>",
        "<th>a</th>",
        "<th>b</th>",
        "</tr>",
        "<tr>",
        '<td colspan="2">x<br>y</td>',
        "</tr>",
        "</table>",
        "",
      ].join("\n"),
    );
  });

  it("emits the canonical HTML form for a rowspan merge", () => {
    const doc = makeEditor("| a | b |\n|---|---|\n| x | y |\n| u | v |\n");
    selectCells(doc, "x", "u");
    doc.chain().focus().mergeCells().run();
    const html = tiptapToMarkdown(doc.getJSON());
    expect(html).toContain('<td rowspan="2">x<br>u</td>');
    expect(html).not.toContain("colspan");
    expect(html).toContain("<td>y</td>");
    expect(html).toContain("<td>v</td>");
  });

  it("emits colgroup widths for user-set colwidths", () => {
    const doc = makeEditor("| h1 | h2 |\n|---|---|\n| a | b |\n");
    // The columnResizing plugin's effect on a drag of column 0's divider:
    // colwidth on the cells starting at that column.
    const tr = doc.state.tr;
    doc.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        if (doc.state.doc.resolve(pos).index() === 0) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [123] });
        }
        return true;
      }
      return true;
    });
    doc.view.dispatch(tr);
    expect(tiptapToMarkdown(doc.getJSON())).toBe(
      [
        "<table>",
        "<colgroup>",
        '<col style="width: 123px">',
        "<col>",
        "</colgroup>",
        "<tr>",
        "<th>h1</th>",
        "<th>h2</th>",
        "</tr>",
        "<tr>",
        "<td>a</td>",
        "<td>b</td>",
        "</tr>",
        "</table>",
        "",
      ].join("\n"),
    );
  });

  it("carries non-left alignment on the <col> of a merged table", () => {
    // A spanning cell has no unambiguous per-column home for a GFM spec, so
    // the colgroup carries the alignment instead.
    const doc = makeEditor("| a | b |\n|---|---|\n| x | y |\n");
    selectCells(doc, "x", "y");
    doc.chain().focus().mergeCells().run();
    const json = editorTableJson(doc);
    (json!.attrs as Record<string, unknown>).align = ["left", "right"];
    const html = tiptapToMarkdown(doc.getJSON());
    expect(html).toContain('<col style="text-align: right">');
    expect(html).toContain("<col>\n");
  });

  it("keeps plain tables in GFM form (no spans, no widths)", () => {
    expect(
      tiptapToMarkdown(markdownToTiptap("| a | b |\n|---|---|\n| x | y |\n")),
    ).toBe("| a | b |\n| - | - |\n| x | y |\n");
  });

  it("is a fixed point on its own merged-table output", () => {
    const once = tiptapToMarkdown(markdownToTiptap(CANONICAL + "\n"));
    expect(once).toBe(CANONICAL + "\n");
    expect(tiptapToMarkdown(markdownToTiptap(once))).toBe(once);
  });
});

describe("merged-table HTML parse (plan 06 task 6.6)", () => {
  it("parses colspan, th/td, and cell phrasing into a live table", () => {
    const json = tableJson(CANONICAL + "\n");
    expect(json?.type).toBe("table");
    const rows = json?.content ?? [];
    expect(rows[0]?.content?.map((c) => c.type)).toEqual(["tableHeader"]);
    expect(rows[1]?.content?.map((c) => c.type)).toEqual([
      "tableCell",
      "tableCell",
    ]);
    expect(cellAttrs(json, 0, 0)?.colspan).toBe(2);
    expect(cellAttrs(json, 0, 0)?.rowspan).toBe(1);
    expect(cellTextOf(json, 0, 0)).toBe("A");
    expect(cellTextOf(json, 1, 0)).toBe("1");
    expect(cellTextOf(json, 1, 1)).toBe("2");
  });

  it("attaches colgroup widths as per-cell colwidth (null for unset)", () => {
    const json = tableJson(CANONICAL + "\n");
    // The colspan-2 header spans both columns (200 + unset), the plain cells
    // get one entry for their own column; an all-unset span stays null.
    expect(cellAttrs(json, 0, 0)?.colwidth).toEqual([200, 0]);
    expect(cellAttrs(json, 1, 0)?.colwidth).toEqual([200]);
    expect(cellAttrs(json, 1, 1)?.colwidth).toBeNull();
  });

  it("attaches colgroup alignment to the table (left is null)", () => {
    const json = tableJson(CANONICAL + "\n");
    expect((json?.attrs as { align: Array<string | null> }).align).toEqual([
      "center",
      null,
    ]);
  });

  it("re-attaches widths under a rowspan (columns claimed from above)", () => {
    const src = [
      "<table>",
      "<colgroup>",
      '<col style="width: 100px">',
      '<col style="width: 200px">',
      "</colgroup>",
      "<tr>",
      '<td rowspan="2">tall</td>',
      "<td>top</td>",
      "</tr>",
      "<tr>",
      "<td>bottom</td>",
      "</tr>",
      "</table>",
    ].join("\n");
    const json = tableJson(src + "\n");
    expect(cellAttrs(json, 0, 0)?.rowspan).toBe(2);
    expect(cellAttrs(json, 0, 0)?.colwidth).toEqual([100]);
    expect(cellAttrs(json, 0, 1)?.colwidth).toEqual([200]);
    expect(cellAttrs(json, 1, 0)?.colwidth).toEqual([200]);
    // Re-serializing is a fixed point.
    expect(tiptapToMarkdown(markdownToTiptap(src + "\n"))).toBe(src + "\n");
  });

  it("parses a merged table without a colgroup (all widths unset, left)", () => {
    const src = [
      "<table>",
      "<tr>",
      '<th colspan="2">A</th>',
      "</tr>",
      "<tr>",
      "<td>1</td>",
      "<td>2</td>",
      "</tr>",
      "</table>",
    ].join("\n");
    const json = tableJson(src + "\n");
    expect(cellAttrs(json, 0, 0)?.colspan).toBe(2);
    expect(cellAttrs(json, 0, 0)?.colwidth).toBeNull();
    expect((json?.attrs as { align: Array<string | null> }).align).toEqual([
      null,
      null,
    ]);
    // A missing colgroup is normalized to the canonical form on save (the
    // emit always carries one), and the result is a fixed point.
    const out = tiptapToMarkdown(markdownToTiptap(src + "\n"));
    expect(out).toBe(
      src.replace(
        "<table>\n<tr>",
        "<table>\n<colgroup>\n<col>\n<col>\n</colgroup>\n<tr>",
      ) + "\n",
    );
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("re-parses embedded markdown phrasing through the shared path", () => {
    const src = [
      "<table>",
      "<tr>",
      "<th>x</th>",
      "</tr>",
      "<tr>",
      "<td>**bold** and `code` and *em* and [link](https://example.com/)</td>",
      "</tr>",
      "</table>",
    ].join("\n");
    const markSets = (json: JSONContent | undefined): Array<string[]> => {
      const inlines = (
        json?.content?.[1]?.content?.[0]?.content?.[0]?.content ?? []
      ) as Array<{ marks?: Array<{ type: string }> }>;
      return inlines.map((n) => (n.marks ?? []).map((m) => m.type));
    };
    const json = tableJson(src + "\n");
    expect(markSets(json)).toEqual([
      ["bold"],
      [],
      ["code"],
      [],
      ["italic"],
      [],
      ["link"],
    ]);
    // No spans/widths, so the table prefers the GFM form on save
    // (source-of-truth preference); the phrasing must round-trip
    // semantically.
    const out = tiptapToMarkdown(markdownToTiptap(src + "\n"));
    expect(out).toContain("**bold** and `code` and *em* and [link](https://example.com/)");
    expect(markSets(tableJson(out))).toEqual(markSets(json));
  });

  it("round-trips the canonical table byte-for-byte", () => {
    const md = CANONICAL + "\n";
    const out = tiptapToMarkdown(markdownToTiptap(md));
    expect(out).toBe(md);
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("rejects non-canonical <table> blocks (they stay opaque HTML)", () => {
    const foreign = [
      "<table>",
      "<tbody>",
      "<tr>",
      '<td colspan="2">A</td>',
      "</tr>",
      "</tbody>",
      "</table>",
    ].join("\n");
    expect(parseMergedTableHtml(foreign)).toBeNull();
    // Stays the opaque html passthrough, byte-for-byte.
    const doc = markdownToTiptap(foreign + "\n");
    expect(doc.content?.[0]?.type).toBe("codeBlock");
    expect(tiptapToMarkdown(doc)).toBe(foreign + "\n");

    // A cell-level style is not canonical (widths live on the colgroup).
    expect(
      parseMergedTableHtml(
        "<table>\n<tr>\n<td style=\"width: 5px\">x</td>\n</tr>\n</table>",
      ),
    ).toBeNull();
    // A duplicated span attribute is malformed.
    expect(
      parseMergedTableHtml(
        '<table>\n<tr>\n<td colspan="2" colspan="3">x</td>\n</tr>\n</table>',
      ),
    ).toBeNull();
    // An empty row is malformed.
    expect(parseMergedTableHtml("<table>\n<tr>\n</tr>\n</table>")).toBeNull();
    // A duplicated style key is malformed.
    expect(
      parseMergedTableHtml(
        "<table>\n<colgroup>\n<col style=\"width: 10px; width: 20px\">\n</colgroup>\n<tr>\n<td>x</td>\n</tr>\n</table>",
      ),
    ).toBeNull();
    // A trailing line after </table> is not a single block.
    expect(
      parseMergedTableHtml("<table>\n<tr>\n<td>x</td>\n</tr>\n</table>\nx"),
    ).toBeNull();
  });

  it("splices a canonical merged table as one html block (pipeline)", () => {
    const model = createDocument("# Head\n\n" + CANONICAL + "\n\nTail\n");
    const json = markdownToTiptap(model.source);
    // Edit one cell in the merged table.
    const table = json.content?.find((n) => n.type === "table");
    const cell = table?.content?.[1]?.content?.[1];
    const para = cell?.content?.[0];
    para!.content = [{ type: "text", text: "22" }];
    const result = saveDocument(model, tiptapToMarkdown(json));
    expect(result.kind).toBe("splice");
    expect(result.text).toContain("<td>22</td>");
    expect(result.text).toContain('<th colspan="2">A</th>');
    expect(result.text).toContain("# Head\n");
    expect(result.text).toContain("Tail\n");
  });
});

describe("merged-table editor behavior (plan 06 task 6.6)", () => {
  it("mergeCells turns a GFM table into the HTML form on save", () => {
    const doc = makeEditor("| a | b |\n|---|---|\n| x | y |\n");
    selectCells(doc, "x", "y");
    expect(doc.chain().focus().mergeCells().run()).toBe(true);
    const out = tiptapToMarkdown(doc.getJSON());
    expect(out).toContain('<td colspan="2">x<br>y</td>');
    expect(out).not.toContain("|");
  });

  it("a dragged divider (colwidth) round-trips through the colgroup", () => {
    const doc = makeEditor("| a | b |\n|---|---|\n| x | y |\n");
    // Emulate the columnResizing plugin's updateColumnWidth for a drag of
    // column 0's divider: colwidth on the cells starting at that column,
    // zero-filled across the span (the other column is left untouched).
    const tr = doc.state.tr;
    doc.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        if (doc.state.doc.resolve(pos).index() === 0) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [300] });
        }
        return true;
      }
      return true;
    });
    doc.view.dispatch(tr);
    const out = tiptapToMarkdown(doc.getJSON());
    expect(out).toContain('<col style="width: 300px">');
    // Reload: the colgroup re-attaches the same colwidths (WYSIWYG parity)
    // and the output is a fixed point.
    const json = tableJson(out);
    expect(cellAttrs(json, 0, 0)?.colwidth).toEqual([300]);
    expect(cellAttrs(json, 1, 0)?.colwidth).toEqual([300]);
    expect(cellAttrs(json, 1, 1)?.colwidth).toBeNull();
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("loads a canonical table into a live editable table", () => {
    const doc = makeEditor(CANONICAL + "\n");
    const json = editorTableJson(doc);
    expect(json?.type).toBe("table");
    expect(cellAttrs(json, 0, 0)?.colspan).toBe(2);
    // The cell text is real text (editable), not an opaque block.
    expect(cellTextOf(json, 1, 1)).toBe("2");
    expect(doc.isEditable).toBe(true);
  });
});
