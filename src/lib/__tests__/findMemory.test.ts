// @vitest-environment jsdom
// Find panel state (plan 07 task 7.5, issue #73): the last search term and its
// options are remembered per document path, and the find panel position
// (top/bottom) is a global setting. Both persist in localStorage exactly like
// the view mode (viewModes.ts) and doc settings (docSettings.ts); they never
// touch the save pipeline or the round-trip contract.
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FIND_MEMORY,
  DEFAULT_FIND_PANEL_POSITION,
  isFindPanelPosition,
  loadFindMemory,
  loadFindPanelPosition,
  saveFindMemory,
  saveFindPanelPosition,
} from "../findMemory";
import type { FindMemory } from "../findMemory";

const MEMORY_KEY = "quillmd.findMemory";
const POSITION_KEY = "quillmd.findPanelPosition";

describe("findMemory per-doc term memory (plan 07 task 7.5, issue #73)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to an empty term and all options off", () => {
    expect(DEFAULT_FIND_MEMORY).toEqual({
      term: "",
      matchCase: false,
      wholeWord: false,
      useRegex: false,
    });
    expect(loadFindMemory("/a.md")).toEqual(DEFAULT_FIND_MEMORY);
  });

  it("round-trips a full memory record per path", () => {
    const memory: FindMemory = {
      term: "hello",
      matchCase: true,
      wholeWord: true,
      useRegex: false,
    };
    saveFindMemory("/a.md", memory);
    expect(loadFindMemory("/a.md")).toEqual(memory);
  });

  it("keeps memory independent per path", () => {
    saveFindMemory("/a.md", {
      term: "foo",
      matchCase: true,
      wholeWord: false,
      useRegex: false,
    });
    saveFindMemory("/b.md", {
      term: "bar",
      matchCase: false,
      wholeWord: true,
      useRegex: true,
    });
    expect(loadFindMemory("/a.md")).toEqual({
      term: "foo",
      matchCase: true,
      wholeWord: false,
      useRegex: false,
    });
    expect(loadFindMemory("/b.md")).toEqual({
      term: "bar",
      matchCase: false,
      wholeWord: true,
      useRegex: true,
    });
    // A doc never searched still reads the defaults.
    expect(loadFindMemory("/c.md")).toEqual(DEFAULT_FIND_MEMORY);
  });

  it("overwrites a path's memory when saved again", () => {
    saveFindMemory("/a.md", {
      term: "first",
      matchCase: true,
      wholeWord: false,
      useRegex: false,
    });
    saveFindMemory("/a.md", {
      term: "second",
      matchCase: false,
      wholeWord: true,
      useRegex: true,
    });
    expect(loadFindMemory("/a.md")).toEqual({
      term: "second",
      matchCase: false,
      wholeWord: true,
      useRegex: true,
    });
  });

  it("recovers a partially-corrupted record onto the defaults", () => {
    localStorage.setItem(
      MEMORY_KEY,
      JSON.stringify({
        // term not a string, matchCase not a boolean, wholeWord missing.
        "/a.md": { term: 42, matchCase: "yes" },
      }),
    );
    expect(loadFindMemory("/a.md")).toEqual(DEFAULT_FIND_MEMORY);
  });

  it("keeps the well-typed fields of a partially-populated record", () => {
    localStorage.setItem(
      MEMORY_KEY,
      JSON.stringify({
        // Only term + useRegex are present and well-typed.
        "/a.md": { term: "only", useRegex: true },
      }),
    );
    expect(loadFindMemory("/a.md")).toEqual({
      term: "only",
      matchCase: false,
      wholeWord: false,
      useRegex: true,
    });
  });

  it("recovers corrupted JSON onto the defaults", () => {
    localStorage.setItem(MEMORY_KEY, "{not json");
    expect(loadFindMemory("/a.md")).toEqual(DEFAULT_FIND_MEMORY);
  });

  it("treats a non-object top-level payload as the defaults", () => {
    localStorage.setItem(MEMORY_KEY, JSON.stringify("just a string"));
    expect(loadFindMemory("/a.md")).toEqual(DEFAULT_FIND_MEMORY);
  });

  it("leaves an unrelated localStorage map untouched", () => {
    localStorage.setItem("quillmd.viewMode", JSON.stringify({ "/a.md": "source" }));
    saveFindMemory("/a.md", {
      term: "hi",
      matchCase: false,
      wholeWord: true,
      useRegex: false,
    });
    expect(JSON.parse(localStorage.getItem("quillmd.viewMode")!)).toEqual({
      "/a.md": "source",
    });
    expect(JSON.parse(localStorage.getItem(MEMORY_KEY)!)).toEqual({
      "/a.md": { term: "hi", matchCase: false, wholeWord: true, useRegex: false },
    });
  });
});

describe("find panel position setting (plan 07 task 7.5, issue #73)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to top when nothing is stored", () => {
    expect(DEFAULT_FIND_PANEL_POSITION).toBe("top");
    expect(loadFindPanelPosition()).toBe("top");
  });

  it("round-trips the bottom position", () => {
    saveFindPanelPosition("bottom");
    expect(loadFindPanelPosition()).toBe("bottom");
  });

  it("round-trips the top position (an explicit re-save)", () => {
    saveFindPanelPosition("bottom");
    saveFindPanelPosition("top");
    expect(loadFindPanelPosition()).toBe("top");
  });

  it("recovers an invalid stored value onto the top default", () => {
    for (const raw of ['"left"', '"TOP"', "7", "null", "true", '"top "']) {
      localStorage.setItem(POSITION_KEY, raw);
      expect(loadFindPanelPosition()).toBe("top");
    }
  });

  it("recovers corrupted JSON onto the top default", () => {
    localStorage.setItem(POSITION_KEY, "{not json");
    expect(loadFindPanelPosition()).toBe("top");
  });

  it("isFindPanelPosition accepts only top and bottom", () => {
    expect(isFindPanelPosition("top")).toBe(true);
    expect(isFindPanelPosition("bottom")).toBe(true);
    expect(isFindPanelPosition("left")).toBe(false);
    expect(isFindPanelPosition("")).toBe(false);
    expect(isFindPanelPosition(1)).toBe(false);
    expect(isFindPanelPosition(null)).toBe(false);
  });

  it("stores the position under its own key, separate from the memory map", () => {
    saveFindMemory("/a.md", {
      term: "x",
      matchCase: false,
      wholeWord: false,
      useRegex: false,
    });
    saveFindPanelPosition("bottom");
    expect(localStorage.getItem(POSITION_KEY)).toBe('"bottom"');
    expect(localStorage.getItem(MEMORY_KEY)).not.toContain("bottom");
  });
});
