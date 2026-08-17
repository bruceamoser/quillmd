import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findTaskMarkers, toggleTaskAt, toggleTaskByIndex } from "../edit";
import { createDocument, saveDocument } from "../pipeline";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  here,
  "..",
  "..",
  "..",
  "fixtures",
  "clean",
  "nested-task-list.md",
);

describe("task-list checkbox toggle is a byte-range splice", () => {
  const source = new TextDecoder("utf-8").decode(readFileSync(FIXTURE));

  it("finds every checkbox in the nested task fixture", () => {
    const markers = findTaskMarkers(source);
    expect(markers.length).toBe(6);
    expect(markers.map((m) => m.checked)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("toggles a single checkbox by splicing exactly one byte", () => {
    const markers = findTaskMarkers(source);
    const first = markers[0];
    expect(first.checked).toBe(false);

    const toggled = toggleTaskAt(source, first);
    expect(toggled).not.toBe(source);
    expect(toggled).toBe(
      source.slice(0, first.contentOffset) +
        "x" +
        source.slice(first.contentOffset + 1),
    );
    expect(toggled.replace("[x]", "[ ]")).toBe(source);
  });

  it("toggling a checked box back is byte-identical to the original", () => {
    const markers = findTaskMarkers(source);
    const done = markers[1];
    expect(done.checked).toBe(true);

    const once = toggleTaskAt(source, done);
    const twice = toggleTaskAt(once, findTaskMarkers(once)[1]);
    expect(twice).toBe(source);
  });

  it("flows through the clean-path pipeline as a splice, never re-serializing", () => {
    const model = createDocument(source);
    const toggled = toggleTaskByIndex(source, 0);
    expect(toggled).not.toBeNull();

    const result = saveDocument(model, toggled as string);
    expect(result.kind).toBe("splice");
    expect(result.text).toBe(toggled);
    expect(result.text.replace("[x]", "[ ]")).toBe(source);
  });

  it("toggles a nested (indented) checkbox by index", () => {
    const toggled = toggleTaskByIndex(source, 2);
    expect(toggled).not.toBeNull();
    expect(toggled).toContain("  - [x] nested open");
    expect(toggled).toContain("- [ ] top open");
    expect(toggled).toContain("    - [x] deeply nested done");
  });
});
