// @vitest-environment jsdom
// GFM table serializer + parser hardening (plan 06 task 6.1, issue #61).
//
// The round-trip matrix from plan 06 §3: 1x1, 3x3, header/no-header, all
// alignment combos, cells containing `|`, `*`, `[]`, backticks, and
// multi-line content. "Round-trip" means markdown -> TipTap JSON ->
// markdown: the re-parsed document must be semantically identical (AST
// equality, positions stripped), and canonical inputs must be byte-stable
// (the serializer is its own fixed point).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { GfmTable, TABLE_CELL_MIN_WIDTH } from "../../components/Editor";
import { createDocument, saveDocument } from "../pipeline";
import { parseToAst } from "../markdown";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "..", "..", "fixtures", "clean", "gfm-tables.md"),
  "utf8",
);

// Strip mdast positions so structurally identical trees compare equal.
function astOf(markdown: string): unknown {
  return JSON.parse(
    JSON.stringify(parseToAst(markdown), (k, v) => (k === "position" ? undefined : v)),
  );
}

function rt(markdown: string): string {
  return tiptapToMarkdown(markdownToTiptap(markdown));
}

function expectSemanticRoundTrip(markdown: string): void {
  const out = rt(markdown);
  expect(astOf(out)).toEqual(astOf(markdown));
  // The serializer must be a fixed point: re-serializing the re-parsed
  // output changes nothing (save -> reopen -> save stability).
  expect(rt(out)).toBe(out);
}

const ALIGNMENTS = [null, "left", "center", "right"] as const;

describe("GFM table round-trip (plan 06 task 6.1)", () => {
  it("round-trips a 1x1 table", () => {
    const src = "| a |\n|---|\n| b |\n";
    expectSemanticRoundTrip(src);
    expect(rt(src)).toBe("| a |\n| - |\n| b |\n");
  });

  it("round-trips a 3x3 table", () => {
    const src =
      "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";
    expectSemanticRoundTrip(src);
  });

  it("keeps the header row as header cells on parse", () => {
    const json = markdownToTiptap(
      "| h1 | h2 |\n|---|---|\n| a | b |\n",
    );
    const table = json.content?.[0];
    expect(table?.type).toBe("table");
    const rows = table?.content ?? [];
    expect(rows.map((r) => (r.content ?? []).map((c) => c.type))).toEqual([
      ["tableHeader", "tableHeader"],
      ["tableCell", "tableCell"],
    ]);
  });

  it("serializes a headerless TipTap table as valid GFM (first row becomes the header)", () => {
    // GFM has no header-less table: the first row is always the header row.
    // A table built without a header row must still serialize to GFM that
    // parses back as a 2-row table (no dropped row, no parse error).
    const json = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { align: [null, null] },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = tiptapToMarkdown(json);
    const ast = astOf(out) as {
      children: Array<{ type: string; children: unknown[] }>;
    };
    expect(ast.children[0].type).toBe("table");
    expect(ast.children[0].children).toHaveLength(2);
    expect(out).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n");
  });

  it("preserves every 2-column alignment combination", () => {
    for (const a of ALIGNMENTS) {
      for (const b of ALIGNMENTS) {
        const spec = (al: string | null) =>
          al === "left" ? ":---" : al === "center" ? ":---:" : al === "right" ? "---:" : "---";
        const src = `| A | B |\n|${spec(a)}|${spec(b)}|\n| 1 | 2 |\n`;
        const out = rt(src);
        const ast = astOf(out) as { children: Array<{ align: unknown[] }> };
        expect(ast.children[0].align, `align [${a}, ${b}]`).toEqual([a, b]);
        expect(rt(out)).toBe(out);
      }
    }
  });

  it("preserves mixed 3-column alignment byte-stably", () => {
    const src = "| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n";
    const out = rt(src);
    expect(astOf(out)).toEqual(astOf(src));
    expect(out).toBe("| L  |  C  |  R |\n| :- | :-: | -: |\n| 1  |  2  |  3 |\n");
    expect(rt(out)).toBe(out);
  });

  it("round-trips cells containing a pipe (escaped on save, unescaped in the model)", () => {
    const src = "| a | b |\n|---|---|\n| a \\| b | c |\n";
    expectSemanticRoundTrip(src);
    const out = rt(src);
    expect(out).toContain("a \\| b");
    const json = markdownToTiptap(src);
    const firstBodyCell = (json.content?.[0]?.content?.[1]?.content ?? [])[0];
    expect(firstBodyCell?.content?.[0]?.content).toEqual([
      { type: "text", text: "a | b" },
    ]);
  });

  it("round-trips cells containing emphasis, brackets, and code", () => {
    const src =
      "| Em | Strong | Brackets | Code |\n" +
      "|----|--------|----------|------|\n" +
      "| *x* | **y** | [ ] | `z` |\n";
    expectSemanticRoundTrip(src);
  });

  it("round-trips a code cell containing a pipe", () => {
    const src = "| c |\n|---|\n| `a\\|b` |\n";
    expectSemanticRoundTrip(src);
    expect(rt(src)).toContain("`a\\|b`");
  });

  it("round-trips a link cell", () => {
    const src =
      "| l |\n|---|\n| [x](https://example.com) |\n";
    expectSemanticRoundTrip(src);
  });

  it("round-trips a <br> break inside a cell (model: hardBreak, file: <br>)", () => {
    const src = "| a<br>b | c |\n|---|---|\n| 1 | 2 |\n";
    expectSemanticRoundTrip(src);
    expect(rt(src)).toBe("| a<br>b | c |\n| ------ | - |\n| 1      | 2 |\n");
    const json = markdownToTiptap(src);
    const headerCell = (json.content?.[0]?.content?.[0]?.content ?? [])[0];
    expect(headerCell?.content?.[0]?.content).toEqual([
      { type: "text", text: "a" },
      { type: "hardBreak" },
      { type: "text", text: "b" },
    ]);
  });

  it("round-trips empty cells", () => {
    const src = "| a | b |\n|---|---|\n|  | x |\n";
    expectSemanticRoundTrip(src);
  });

  it("collapses a multi-paragraph cell to <br> (documented degradation)", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { align: [null, null] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "h1" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "h2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "line one" }] },
                    { type: "paragraph", content: [{ type: "text", text: "line two" }] },
                  ],
                },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const out = tiptapToMarkdown(json);
    // Column width follows the longest cell (the collapsed one).
    expect(out).toBe(
      "| h1                   | h2 |\n" +
        "| -------------------- | -- |\n" +
        "| line one<br>line two | x  |\n",
    );
    // The collapse is reversible: parsing the output back yields the break.
    const reparsed = markdownToTiptap(out);
    const cell = (reparsed.content?.[0]?.content?.[1]?.content ?? [])[0];
    expect(cell?.content?.[0]?.content).toEqual([
      { type: "text", text: "line one" },
      { type: "hardBreak" },
      { type: "text", text: "line two" },
    ]);
  });
});

describe("GFM tables through the live editor (GfmTable extension)", () => {
  function makeEditor(content?: string) {
    return new Editor({
      extensions: [
        StarterKit,
        GfmTable.configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH }),
        TableRow,
        TableCell,
        TableHeader,
      ],
      content: content === undefined ? { type: "doc", content: [] } : markdownToTiptap(content),
    });
  }

  it("carries the align attribute through the ProseMirror schema", () => {
    const editor = makeEditor("| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n");
    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.align).toEqual(["left", "center", "right"]);
    editor.destroy();
  });

  it("keeps alignment when a cell is edited", () => {
    const editor = makeEditor("| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n");
    // Type into the middle body cell.
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "2") {
        editor.chain().setTextSelection(pos + 1).run();
        return false;
      }
      return true;
    });
    editor.commands.insertContent("X");
    const md = tiptapToMarkdown(editor.getJSON());
    expect(md).toContain("| :- | :-: | -: |");
    expect(md).toContain("2X");
    expect(astOf(md)).toEqual(
      astOf("| L | C | R |\n|:--|:-:|--:|\n| 1 | 2X | 3 |\n"),
    );
    editor.destroy();
  });

  it("insertTable (with header) produces valid GFM with a header row", () => {
    const editor = makeEditor();
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const md = tiptapToMarkdown(editor.getJSON());
    const ast = astOf(md) as { children: Array<{ type: string; children: unknown[] }> };
    expect(ast.children[0].type).toBe("table");
    expect(ast.children[0].children).toHaveLength(2);
    editor.destroy();
  });

  it("insertTable (without header) still produces parseable GFM", () => {
    const editor = makeEditor();
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
    const md = tiptapToMarkdown(editor.getJSON());
    // GFM forces the first row to be the header: the document must re-parse
    // as a 2-row table, not a table plus stray paragraph.
    const ast = astOf(md) as {
      children: Array<{ type: string; children: unknown[] }>;
    };
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0].type).toBe("table");
    expect(ast.children[0].children).toHaveLength(2);
    editor.destroy();
  });

  it("loads a cell containing an escaped pipe and re-escapes it on save", () => {
    const editor = makeEditor("| a | b |\n|---|---|\n| a \\| b | c |\n");
    // The model holds the unescaped text.
    let cellText: string | null = null;
    editor.state.doc.descendants((node) => {
      if (node.isText && node.text?.includes("|")) cellText = node.text;
      return true;
    });
    expect(cellText).toBe("a | b");
    // Saving re-escapes the pipe.
    const md = tiptapToMarkdown(editor.getJSON());
    expect(md).toContain("a \\| b");
    editor.destroy();
  });

  it("loads a cell with an empty paragraph and serializes an empty cell", () => {
    const editor = makeEditor("| a | b |\n|---|---|\n|  | x |\n");
    const md = tiptapToMarkdown(editor.getJSON());
    expect(astOf(md)).toEqual(astOf("| a | b |\n|---|---|\n|  | x |\n"));
    editor.destroy();
  });
});

describe("fixture gfm-tables.md through the clean-path pipeline", () => {
  it("classifies all five fixture tables as table blocks", () => {
    const model = createDocument(FIXTURE);
    const tableBlocks = model.blocks.filter((b) => b.kind === "table");
    expect(tableBlocks).toHaveLength(5);
  });

  it("splices an edited table, preserving alignment, escapes, and <br>", () => {
    const model = createDocument(FIXTURE);
    const json = markdownToTiptap(FIXTURE);
    // Edit the escaped-pipe cell "a | b" to "A | b".
    const table = (json.content ?? []).find(
      (n) => n.type === "table" && JSON.stringify(n).includes('"a | b"'),
    );
    expect(table).toBeDefined();
    for (const row of table?.content ?? []) {
      for (const cell of row.content ?? []) {
        for (const para of cell.content ?? []) {
          if (para.type === "paragraph" && JSON.stringify(para).includes('"a | b"')) {
            para.content = [{ type: "text", text: "A | b" }];
          }
        }
      }
    }
    const result = saveDocument(model, tiptapToMarkdown(json));
    expect(result.kind).toBe("splice");
    // The edited cell is re-escaped; the other escaped pipe and the code
    // cell's escaped pipe survive the re-serialization.
    expect(result.text).toContain("A \\| b");
    expect(result.text).toContain("b \\| c \\| d");
    expect(result.text).toContain("`y \\| z`");
    // Hard breaks in cells survive as <br>.
    expect(result.text).toContain("first line<br>second line");
    // Untouched paragraph blocks stay byte-exact.
    expect(result.text).toContain("GFM table hardening (issue #61):\n");
    expect(result.text).toContain("Alignment in every column:\n");
    // All five tables survive with their alignment specs intact.
    const ast = astOf(result.text) as {
      children: Array<{ type: string; align: Array<string | null> }>;
    };
    const tables = ast.children.filter((n) => n.type === "table");
    expect(tables).toHaveLength(5);
    expect(tables[0].align).toEqual(["left", "center", "right"]);
    for (const t of tables.slice(1)) {
      expect(t.align.length).toBeGreaterThan(0);
      expect(t.align.every((a) => a === null)).toBe(true);
    }
  });
});
