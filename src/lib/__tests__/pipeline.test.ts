import { describe, expect, it } from "vitest";
import {
  computeBlockEdits,
  createDocument,
  encodeDocument,
  saveDocument,
  untouchedBlockOffsets,
} from "../pipeline";

describe("clean-path save pipeline", () => {
  it("verbatim path returns the exact source when unmodified", () => {
    const source = "# Hello\n\nworld\n";
    const model = createDocument(source);
    const result = saveDocument(model, source);
    expect(result.kind).toBe("verbatim");
    expect(result.text).toBe(source);
  });

  it("splice path edits exactly one block and keeps the rest byte-identical", () => {
    const source = "# Title\n\nA paragraph.\n\n- one\n- two\n";
    const model = createDocument(source);
    const current = source.replace("A paragraph.", "Edited paragraph.");
    const edits = computeBlockEdits(model, createDocument(current));
    expect(edits).not.toBeNull();
    expect(edits?.length).toBe(1);
    expect(edits?.[0].index).toBe(1);

    const result = saveDocument(model, current);
    expect(result.kind).toBe("splice");
    expect(result.text).toBe(current);

    const untouched = untouchedBlockOffsets(model, edits ?? []);
    expect(untouched.map((b) => b.text)).toEqual(["# Title\n", "- one\n- two\n"]);
  });

  it("splice preserves a setext heading verbatim when another block is edited", () => {
    const source = "Title\n=====\n\nChange me.\n";
    const model = createDocument(source);
    const current = "Title\n=====\n\nChanged.\n";
    const result = saveDocument(model, current);
    expect(result.kind).toBe("splice");
    expect(result.text).toBe("Title\n=====\n\nChanged.\n");
  });

  it("falls back to raw write when the block structure changes", () => {
    const source = "# Title\n\npara\n";
    const model = createDocument(source);
    const current = "# Title\npara\n";
    const result = saveDocument(model, current);
    expect(result.kind).toBe("raw");
    expect(result.text).toBe(current);
  });

  it("falls back to raw write when parsing the new text warns", () => {
    const source = "clean paragraph\n";
    const model = createDocument(source);
    const current = "```js\nunclosed fence without newline";
    const result = saveDocument(model, current);
    expect(result.kind).toBe("raw");
    expect(result.text).toBe(current);
  });

  it("encodeDocument adds a BOM and normalizes to CRLF", () => {
    const bytes = encodeDocument("a\nb", { eol: "crlf", bom: true });
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe("\uFEFFa\r\nb");
  });

  it("encodeDocument emits LF without a BOM by default", () => {
    const bytes = encodeDocument("a\r\nb", { eol: "lf", bom: false });
    expect(new TextDecoder().decode(bytes)).toBe("a\nb");
  });
});
