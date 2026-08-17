import { describe, expect, it } from "vitest";
import { createDocument, saveDocument } from "../pipeline";

const MEGABYTE = 1024 * 1024;

// Builds a ~1MB fixture of ~10k content lines in-memory (a committed 1MB file
// would bloat the repo; the perf envelope only cares about size + line count).
function buildLargeSource(): { source: string; paragraphs: number } {
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  const filler =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ";
  while (total < MEGABYTE) {
    const line = `Paragraph ${i}: ${filler}${i}`;
    parts.push(line);
    total += line.length + 2;
    i += 1;
  }
  return { source: `${parts.join("\n\n")}\n`, paragraphs: i };
}

describe("large-file performance envelope", () => {
  it(
    "parses, edits, and splices a 1MB / 10k-line document in under 250ms",
    () => {
      const { source, paragraphs } = buildLargeSource();
      const mb = source.length / MEGABYTE;
      expect(source.length).toBeGreaterThanOrEqual(MEGABYTE);
      expect(paragraphs).toBeGreaterThanOrEqual(9000);

      const start = performance.now();

      const model = createDocument(source);
      const mid = Math.floor(model.blocks.length / 2);
      const block = model.blocks[mid];
      const edited =
        source.slice(0, block.start) +
        "edited middle paragraph\n" +
        source.slice(block.end);
      const saved = saveDocument(model, edited);

      const elapsed = performance.now() - start;

      // Document the actual number for the acceptance report.
      console.log(
        `perf: ${mb.toFixed(2)}MB / ${paragraphs} lines -> parse + edit + splice in ${elapsed.toFixed(2)}ms`,
      );

      expect(saved.text).toBe(edited);
      expect(elapsed).toBeLessThan(250);
    },
    30000,
  );
});
