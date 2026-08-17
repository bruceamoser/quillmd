import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { editFrontMatterField, parseFrontMatter } from "../markdown";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  here,
  "..",
  "..",
  "..",
  "fixtures",
  "clean",
  "front-matter.md",
);

describe("front-matter field edit is a byte splice", () => {
  const source = new TextDecoder("utf-8").decode(readFileSync(FIXTURE));

  it("edits one field and leaves all other bytes identical", () => {
    const fm = parseFrontMatter(source);
    expect(fm).not.toBeNull();
    const title = fm?.fields.find((f) => f.name === "title");
    expect(title).toBeDefined();

    const edited = editFrontMatterField(source, "title", "Edited Title");

    const expected =
      source.slice(0, title?.valueStart) +
      "Edited Title" +
      source.slice(title?.valueEnd);
    expect(edited).toBe(expected);

    // Byte-identity of everything outside the edited field's value range.
    const valueStart = title?.valueStart ?? 0;
    const valueEnd = title?.valueEnd ?? 0;
    expect(edited.slice(0, valueStart)).toBe(source.slice(0, valueStart));
    expect(edited.slice(valueStart + "Edited Title".length)).toBe(
      source.slice(valueEnd),
    );

    // Every other field retains its exact value and surrounding formatting.
    const reparsed = parseFrontMatter(edited);
    expect(reparsed).not.toBeNull();
    for (const f of reparsed?.fields ?? []) {
      if (f.name === "title") continue;
      const original = fm?.fields.find((o) => o.name === f.name);
      expect(f.value).toBe(original?.value);
    }
    expect(reparsed?.raw).toBe(edited.slice(0, reparsed?.end));
    expect(reparsed?.raw).toContain("title: Edited Title");
  });

  it("edits a nested collection field in place", () => {
    const fm = parseFrontMatter(source);
    const custom = fm?.fields.find((f) => f.name === "custom");
    expect(custom).toBeDefined();

    const edited = editFrontMatterField(source, "custom", "{ only: this }");
    expect(edited).toContain("custom: { only: this }");
    expect(edited).toContain("title: Fixture Document");
    expect(edited).toContain("author: Bruce Moser");
    expect(edited).toContain("tags: [quillmd, test, roundtrip]");
  });

  it("editing a missing field is a no-op", () => {
    expect(editFrontMatterField(source, "missing", "x")).toBe(source);
  });
});
