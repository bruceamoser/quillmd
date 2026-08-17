import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDocument, saveDocument } from "../pipeline";

const here = dirname(fileURLToPath(import.meta.url));
const CLEAN_DIR = join(here, "..", "..", "..", "fixtures", "clean");

const files = readdirSync(CLEAN_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();

describe("round-trip fidelity over clean fixtures", () => {
  it("has a non-trivial fixture corpus", () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  for (const file of files) {
    it(`round-trips ${file} byte-identically`, () => {
      const bytes = readFileSync(join(CLEAN_DIR, file));
      const source = new TextDecoder("utf-8").decode(bytes);
      const model = createDocument(source);
      const result = saveDocument(model, source);

      expect(result.kind).toBe("verbatim");
      expect(result.text).toBe(source);
      expect(new TextEncoder().encode(result.text)).toEqual(new Uint8Array(bytes));
    });
  }
});
