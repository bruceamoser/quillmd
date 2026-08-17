import { describe, expect, it } from "vitest";
import { parseMarkdown, parseToAst, serializeAst } from "../markdown";
import { createDocument, saveDocument } from "../pipeline";

// Deterministic 32-bit PRNG so the 1000-edit sequence is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each generator returns a single block: no blank lines, so a block stays one
// block under segmentation. Fences are avoided so the dirty-parse fallback is
// never triggered and parse always succeeds.
type Generator = (rng: () => number) => string;

const GENERATORS: Generator[] = [
  (rng) => `# Heading ${Math.floor(rng() * 1000)}`,
  (rng) =>
    `Paragraph ${Math.floor(rng() * 1000)} with *emphasis* and a [link](https://example.com/${Math.floor(rng() * 1000)}).`,
  (rng) => `- item ${Math.floor(rng() * 1000)}\n- item ${Math.floor(rng() * 1000)}`,
  () => "1. first\n2. second\n3. third",
  (rng) => `- [ ] todo ${Math.floor(rng() * 1000)}\n- [x] done`,
  (rng) => `> quoted ${Math.floor(rng() * 1000)}`,
  () => "---",
  (rng) => `inline \`code${Math.floor(rng() * 1000)}\` sample`,
];

function makeDoc(blocks: string[]): string {
  return blocks.map((b) => (b.endsWith("\n") ? b : `${b}\n`)).join("\n");
}

function generateBlock(rng: () => number, i: number): string {
  const g = GENERATORS[i % GENERATORS.length];
  return g(rng);
}

describe("1000-edit randomized stress (deterministic oracle)", () => {
  it(
    "always parses and the saved markdown matches the re-parsed source",
    () => {
      const rng = mulberry32(0x9e3779b9);
      const initialBlocks: string[] = [];
      for (let i = 0; i < 30; i += 1) initialBlocks.push(generateBlock(rng, i));

      const blocks = [...initialBlocks];
      const model = createDocument(makeDoc(initialBlocks));

      for (let i = 0; i < 1000; i += 1) {
        const op = Math.floor(rng() * 4);
        if (op === 0) {
          blocks[Math.floor(rng() * blocks.length)] = generateBlock(rng, i);
        } else if (op === 1 && blocks.length < 60) {
          blocks.splice(
            Math.floor(rng() * (blocks.length + 1)),
            0,
            generateBlock(rng, i),
          );
        } else if (op === 2 && blocks.length > 1) {
          blocks.splice(Math.floor(rng() * blocks.length), 1);
        } else {
          blocks[Math.floor(rng() * blocks.length)] = generateBlock(rng, i);
        }

        const text = makeDoc(blocks);

        // Parse always succeeds (no dirty-parse warnings).
        const current = parseMarkdown(text);
        expect(current.warnings).toHaveLength(0);

        // The clean-path save must be lossless against the intended source.
        const saved = saveDocument(model, text);
        expect(saved.text).toBe(text);
        expect(parseMarkdown(saved.text).warnings).toHaveLength(0);

        // Block-granular verbatim preservation (the "modulo manifest" oracle:
        // untouched regions must be byte-identical, never re-serialized).
        expect(parseMarkdown(saved.text).blocks.map((b) => b.text)).toEqual(
          current.blocks.map((b) => b.text),
        );
      }

      // Final canonical equivalence against the reference serializer.
      const final = makeDoc(blocks);
      expect(serializeAst(parseToAst(saveDocument(model, final).text))).toBe(
        serializeAst(parseToAst(final)),
      );
    },
    30000,
  );
});
