// VSCode-style Explorer tab opening: one click replaces the active tab, a
// double click opens a new one, and an already-open file is only activated.
import { describe, expect, it } from "vitest";
import { replaceDocRecord, singleClickIntent } from "../tabOpen";

const context = (overrides: Partial<Parameters<typeof singleClickIntent>[0]> = {}) => ({
  path: "/docs/b.md",
  activePath: "/docs/a.md" as string | null,
  openPaths: ["/docs/a.md"],
  activeProtected: false,
  ...overrides,
});

describe("singleClickIntent", () => {
  it("replaces the active tab for a new file", () => {
    expect(singleClickIntent(context())).toBe("replace");
  });

  it("activates a file that already has a tab instead of reloading it", () => {
    expect(
      singleClickIntent(
        context({ path: "/docs/c.md", openPaths: ["/docs/a.md", "/docs/c.md"] }),
      ),
    ).toBe("activate");
  });

  it("activates the file when it is the active tab (a no-op)", () => {
    expect(singleClickIntent(context({ path: "/docs/a.md" }))).toBe("activate");
  });

  it("opens normally when no tab is active", () => {
    expect(singleClickIntent(context({ activePath: null, openPaths: [] }))).toBe("open");
  });

  it("never discards a dirty tab: a single click opens a new tab instead", () => {
    expect(singleClickIntent(context({ activeProtected: true }))).toBe("open");
  });

  it("never replaces an untitled scratch buffer (it is permanent too)", () => {
    expect(
      singleClickIntent(
        context({ activePath: "untitled:/1", openPaths: ["untitled:/1"], activeProtected: true }),
      ),
    ).toBe("open");
  });
});

describe("replaceDocRecord", () => {
  it("swaps the entry in place so the tab keeps its position", () => {
    const docs = { a: "A", b: "B", c: "C" };
    const next = replaceDocRecord(docs, "b", "b2", "B2");
    expect(Object.keys(next)).toEqual(["a", "b2", "c"]);
    expect(next).toEqual({ a: "A", b2: "B2", c: "C" });
  });

  it("leaves the other tabs untouched", () => {
    const docs = { a: { text: "A" }, b: { text: "B" } };
    const next = replaceDocRecord(docs, "a", "z", { text: "Z" });
    expect(next.b).toBe(docs.b);
    expect(docs).toEqual({ a: { text: "A" }, b: { text: "B" } });
  });

  it("appends when the tab being replaced was closed meanwhile", () => {
    const next = replaceDocRecord({ a: "A" }, "gone", "b", "B");
    expect(Object.keys(next)).toEqual(["a", "b"]);
  });

  it("does not leave a duplicate when the target was already open", () => {
    const next = replaceDocRecord({ a: "A", b: "B", c: "C" }, "b", "c", "C2");
    expect(Object.keys(next)).toEqual(["a", "c"]);
    expect(next.c).toBe("C2");
  });
});
