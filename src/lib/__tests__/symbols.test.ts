// @vitest-environment jsdom
// Special characters (plan 09 task 9.6, issue #89): the bundled symbol table
// (one entry per single-codepoint character, unique names, the six popover
// categories), the name search ("copyright" → ©), and the localStorage-backed
// recents (most recent first, deduplicated, capped).
import { beforeEach, describe, expect, it } from "vitest";
import {
  SYMBOLS,
  SYMBOL_CATEGORIES,
  SYMBOL_COUNT,
  getRecentSymbols,
  recordSymbolInsert,
  searchSymbols,
  symbolCategoryById,
  symbolsInCategory,
} from "../symbols";

describe("SYMBOLS (the bundled table)", () => {
  it("is a non-trivial table, one entry per character", () => {
    expect(SYMBOL_COUNT).toBe(SYMBOLS.length);
    expect(SYMBOL_COUNT).toBeGreaterThanOrEqual(300);
    const seen = new Set<string>();
    for (const s of SYMBOLS) {
      // Single code point: the insert is one UTF-8 character, never a
      // surrogate-pair split or a multi-codepoint cluster (code-page safe).
      expect([...s.char].length).toBe(1);
      expect(seen.has(s.char), `duplicate character ${s.char}`).toBe(false);
      seen.add(s.char);
    }
  });

  it("has unique names", () => {
    const names = new Set(SYMBOLS.map((s) => s.name));
    expect(names.size).toBe(SYMBOLS.length);
  });

  it("covers the six categories in popover order", () => {
    expect(SYMBOL_CATEGORIES.map((c) => c.id)).toEqual([
      "currency",
      "math",
      "arrows",
      "bullets",
      "typography",
      "symbols",
    ]);
    for (const s of SYMBOLS) {
      expect(symbolCategoryById(s.category), `unknown category for ${s.char}`).not.toBeNull();
    }
  });

  it("every category is non-empty", () => {
    for (const c of SYMBOL_CATEGORIES) {
      expect(symbolsInCategory(c.id).length, `category ${c.id}`).toBeGreaterThan(0);
    }
  });
});

describe("searchSymbols (name search)", () => {
  it("finds copyright by name (plan 09 §2.5: 'copyright' → ©)", () => {
    const hits = searchSymbols("copyright");
    expect(hits.some((s) => s.char === "©")).toBe(true);
    for (const s of hits) {
      expect(s.name.toLowerCase()).toContain("copyright");
    }
  });

  it("trims and matches case-insensitively", () => {
    const hits = searchSymbols("  COPYRIGHT ");
    expect(hits.some((s) => s.char === "©")).toBe(true);
  });

  it("an empty query returns the whole table", () => {
    expect(searchSymbols("   ")).toHaveLength(SYMBOL_COUNT);
  });

  it("a nonsense query returns nothing", () => {
    expect(searchSymbols("zzzznotasymbolzzzz")).toHaveLength(0);
  });
});

describe("recents (localStorage-backed)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(getRecentSymbols()).toEqual([]);
  });

  it("records inserts, most recent first, deduplicated", () => {
    recordSymbolInsert("©");
    recordSymbolInsert("§");
    recordSymbolInsert("©");
    expect(getRecentSymbols()).toEqual(["©", "§"]);
  });

  it("caps at 24", () => {
    for (let i = 0; i < 30; i++) recordSymbolInsert(String.fromCharCode(0x2190 + i));
    const recent = getRecentSymbols();
    expect(recent).toHaveLength(24);
    expect(recent[0]).toBe(String.fromCharCode(0x2190 + 29));
  });

  it("ignores empty and multi-codepoint values", () => {
    expect(() => recordSymbolInsert("")).not.toThrow();
    // Arrow + variation selector: two code points, not one insertable char.
    expect(() => recordSymbolInsert("\u2192\uFE0E")).not.toThrow();
    expect(getRecentSymbols()).toEqual([]);
  });

  it("persists across re-reads (the key survives a session)", () => {
    recordSymbolInsert("©");
    recordSymbolInsert("§");
    expect(getRecentSymbols()).toEqual(["§", "©"]);
    // Corrupt storage degrades to empty rather than throwing.
    localStorage.setItem("quillmd.symbols.recent", "not-json");
    expect(getRecentSymbols()).toEqual([]);
  });
});
