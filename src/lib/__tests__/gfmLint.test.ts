// GFM lint for the table fixtures (plan 06 task 6.7, issue #67).
//
// The CI lint gate for table fidelity (plan 06 §4 AC2: every table operation
// "produces valid GFM on save, linted by the existing remark parser — no
// parse errors"). This suite lints the fixture contract with the same parser
// the app uses (unified + remark-parse + remark-gfm, via markdown.ts' engine):
//
//   1. Every clean fixture parses with zero remark parse messages (a hard
//      parse failure or a soft parser message is a lint failure).
//   2. Each table fixture carries exactly the pinned number of table nodes —
//      a table that silently degrades to a paragraph of pipes is caught here,
//      not just as a round-trip byte diff.
//   3. Every parsed table is structurally sound: rectangular rows (one cell
//      per delimiter column) and a valid per-column alignment spec
//      (null/left/center/right, one entry per column).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { VFile } from "vfile";
import type { Root, Table } from "mdast";

const here = dirname(fileURLToPath(import.meta.url));
const CLEAN_DIR = join(here, "..", "..", "..", "fixtures", "clean");

const processor = unified().use(remarkParse).use(remarkGfm);

const VALID_ALIGN = new Set<unknown>([null, "left", "center", "right"]);

// Parses `source` with the app's GFM engine. Returns the remark messages the
// parser recorded (empty when the document lints clean) and every table node
// in the tree. A hard parse failure surfaces as a message, never a throw.
function lintGfm(source: string): { messages: string[]; tables: Table[] } {
  const file = new VFile({ value: source });
  let root: Root | null = null;
  try {
    root = processor.parse(file) as Root;
  } catch (err) {
    return {
      messages: [err instanceof Error ? err.message : String(err)],
      tables: [],
    };
  }
  const messages = file.messages.map((m) => m.reason ?? m.message ?? String(m));
  const tables: Table[] = [];
  const walk = (node: { type: string; children?: unknown[] }): void => {
    if (node.type === "table") tables.push(node as unknown as Table);
    for (const child of node.children ?? []) walk(child as { type: string });
  };
  walk(root);
  return { messages, tables };
}

// Structural lint of one parsed table: rectangular rows and a valid
// alignment spec. Returns the problems found (empty when sound).
function tableProblems(table: Table): string[] {
  const problems: string[] = [];
  const rows = table.children;
  if (rows.length === 0) return ["table has no rows"];
  const width = rows[0].children.length;
  if (width === 0) return ["table has no columns"];
  rows.forEach((row, i) => {
    if (row.children.length !== width) {
      problems.push(`row ${i} has ${row.children.length} cells, expected ${width}`);
    }
  });
  if (table.align) {
    if (table.align.length !== width) {
      problems.push(
        `alignment spec has ${table.align.length} entries for ${width} columns`,
      );
    }
    table.align.forEach((a, i) => {
      if (!VALID_ALIGN.has(a)) problems.push(`alignment ${i} is not null/left/center/right`);
    });
  }
  return problems;
}

// The table fixtures: every clean fixture that carries GFM tables, pinned to
// the exact number of table nodes the lint expects (issue #61's fixture
// matrix plus the pre-existing table documents in the round-trip contract).
const TABLE_FIXTURES: Record<string, number> = {
  "gfm-tables.md": 5,
  "tables.md": 3,
  "table-complex.md": 1,
  "long-document.md": 1,
  "mixed-structure.md": 1,
  "theme-standard.md": 1,
};

describe("GFM lint over the table fixtures (plan 06 task 6.7, issue #67)", () => {
  const files = readdirSync(CLEAN_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

  it("parses every clean fixture with zero remark parse messages", () => {
    const bad: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(CLEAN_DIR, file), "utf8");
      const { messages } = lintGfm(source);
      if (messages.length > 0) bad.push(`${file}: ${messages.join("; ")}`);
    }
    expect(bad).toEqual([]);
  });

  for (const [file, expected] of Object.entries(TABLE_FIXTURES)) {
    it(`lints ${file} as exactly ${expected} valid GFM table${expected === 1 ? "" : "s"}`, () => {
      const source = readFileSync(join(CLEAN_DIR, file), "utf8");
      const { messages, tables } = lintGfm(source);
      expect(messages, `${file} parse messages`).toEqual([]);
      expect(tables, `${file} table count`).toHaveLength(expected);
      const bad = tables
        .map((t, i) => tableProblems(t).map((p) => `table ${i}: ${p}`))
        .flat();
      expect(bad, `${file} table structure`).toEqual([]);
    });
  }

  it("keeps the alignment spec of the gfm-tables.md matrix intact", () => {
    const source = readFileSync(join(CLEAN_DIR, "gfm-tables.md"), "utf8");
    const { tables } = lintGfm(source);
    expect(tables[0].align).toEqual(["left", "center", "right"]);
    for (const t of tables.slice(1)) {
      expect(t.align ?? []).toHaveLength(t.children[0].children.length);
    }
  });
});
