// @vitest-environment jsdom
// Plan 07 task 7.6 (issue #74) — large-doc perf check for the find engine:
// recomputing the match list of a 100k-char document must stay under 100 ms.
// The panel debounces recompute to 150 ms while typing, so a single
// recompute has to fit well inside that window or the panel would drop
// updates; this asserts the engine's linear scan (flatten + matcher) over
// a realistic mixed-structure document (headings, paragraphs, lists, code
// blocks, tables) with the full option set.
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { markdownToTiptap } from "../pm";
import { searchDoc, type SearchOptions } from "../find";

const TARGET_CHARS = 100_000;
const RECOMPUTE_BUDGET_MS = 100;

// Builds a >=100k-char markdown document in-memory (a committed 100k file
// would bloat the repo; the perf envelope only cares about size + structure).
// Every chunk carries the word "needle" so each query has real work to do.
function buildLargeSource(): { source: string; chunks: number } {
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  const filler =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore ";
  while (total < TARGET_CHARS) {
    const chunk = [
      `## Section ${i} needle`,
      `Paragraph ${i} mentions the word needle: ${filler}${filler}`,
      "- first needle item\n- [x] second needle item",
      "```\nneedle = ${i};\n```",
      "| col | row |\n| --- | --- |\n| needle | ${i} |",
    ].join("\n\n") + "\n";
    parts.push(chunk);
    total += chunk.length;
    i += 1;
  }
  return { source: parts.join("\n"), chunks: i };
}

// The full option set the panel exposes, each against the same large doc.
const QUERIES: Array<{ name: string; options: SearchOptions }> = [
  { name: "plain common word", options: { term: "needle" } },
  { name: "match case", options: { term: "needle", matchCase: true } },
  { name: "whole word", options: { term: "needle", wholeWord: true } },
  { name: "rare word", options: { term: "Section" } },
  { name: "regex with capture group", options: { term: "Section (\\d+) needle", useRegex: true } },
];

describe("find engine large-doc perf (plan 07 task 7.6, issue #74)", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("recomputes a 100k-char document in under 100ms", () => {
    const { source, chunks } = buildLargeSource();
    const kChars = source.length / 1000;
    expect(source.length).toBeGreaterThanOrEqual(TARGET_CHARS);
    expect(chunks).toBeGreaterThanOrEqual(200);

    // Parsing is the pipeline's envelope (perf.test.ts); only the recompute
    // (flatten + matcher) is timed here.
    editor = new Editor({
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
      ],
      content: markdownToTiptap(source),
    });
    const doc = editor.state.doc;

    const rows: string[] = [];
    let worst = 0;
    for (const q of QUERIES) {
      // Two runs; report the better one (the first pays for JIT warmup).
      let best = Infinity;
      let matches = 0;
      for (let run = 0; run < 2; run += 1) {
        const start = performance.now();
        const state = searchDoc(doc, q.options);
        const elapsed = performance.now() - start;
        best = Math.min(best, elapsed);
        matches = state.matches.length;
        expect(matches, `${q.name} must have matches`).toBeGreaterThan(0);
      }
      rows.push(`${q.name}: ${matches} matches, ${best.toFixed(1)}ms`);
      worst = Math.max(worst, best);
    }

    console.log(
      `perf: ${kChars.toFixed(0)}k chars / ${chunks} chunks -> worst recompute ${worst.toFixed(1)}ms\n` +
        rows.map((r) => `  ${r}`).join("\n"),
    );

    expect(worst).toBeLessThan(RECOMPUTE_BUDGET_MS);
  }, 30000);
});
