// @vitest-environment jsdom
// Per-document view settings persistence (plan 02 task 2.5, issue #34):
// line spacing, word wrap, and formatting marks persist per path in
// localStorage exactly like the view mode (viewModes.ts). They never touch
// the save pipeline or the round-trip contract.
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_SETTINGS,
  loadDocSettings,
  saveDocSettings,
} from "../docSettings";
import type { DocSettings } from "../docSettings";

const KEY = "quillmd.docSettings";

describe("docSettings (plan 02 task 2.5, issue #34; zoom per task 2.6, #35)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to single spacing, wrap on, marks off, 100% zoom, spellcheck on, no theme override", () => {
    expect(DEFAULT_DOC_SETTINGS).toEqual({
      lineSpacing: "single",
      wordWrap: true,
      showMarks: false,
      zoom: 100,
      spellcheck: true,
      theme: null,
    });
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("round-trips a full settings record per path (including a theme override)", () => {
    const settings: DocSettings = {
      lineSpacing: "1.5",
      wordWrap: false,
      showMarks: true,
      zoom: 150,
      spellcheck: false,
      theme: "dark",
    };
    saveDocSettings("/a.md", settings);
    expect(loadDocSettings("/a.md")).toEqual(settings);
  });

  it("keeps settings independent per path", () => {
    saveDocSettings("/a.md", {
      lineSpacing: "double",
      wordWrap: false,
      showMarks: true,
      zoom: 120,
      spellcheck: false,
      theme: "serif",
    });
    saveDocSettings("/b.md", {
      lineSpacing: "1.15",
      wordWrap: true,
      showMarks: false,
      zoom: 80,
      spellcheck: true,
      theme: null,
    });
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "double",
      wordWrap: false,
      showMarks: true,
      zoom: 120,
      spellcheck: false,
      theme: "serif",
    });
    expect(loadDocSettings("/b.md")).toEqual({
      lineSpacing: "1.15",
      wordWrap: true,
      showMarks: false,
      zoom: 80,
      spellcheck: true,
      theme: null,
    });
    // An unknown path still gets the defaults.
    expect(loadDocSettings("/c.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("overwrites an existing record on the same path", () => {
    saveDocSettings("/a.md", {
      lineSpacing: "double",
      wordWrap: false,
      showMarks: true,
      zoom: 160,
      spellcheck: false,
      theme: "dark",
    });
    saveDocSettings("/a.md", {
      lineSpacing: "single",
      wordWrap: true,
      showMarks: false,
      zoom: 100,
      spellcheck: true,
      theme: null,
    });
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("merges a partial record onto the defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": { lineSpacing: "1.5", theme: "minimal" } }));
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "1.5",
      wordWrap: true,
      showMarks: false,
      zoom: 100,
      spellcheck: true,
      theme: "minimal",
    });
  });

  it("recovers a corrupted record onto the defaults", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        "/a.md": { lineSpacing: "triple", wordWrap: "yes", showMarks: 1, zoom: "wide" },
      }),
    );
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("clamps an out-of-range stored zoom into 50-200", () => {
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": { zoom: 500 } }));
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "single",
      wordWrap: true,
      showMarks: false,
      zoom: 200,
      spellcheck: true,
      theme: null,
    });
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": { zoom: 1 } }));
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "single",
      wordWrap: true,
      showMarks: false,
      zoom: 50,
      spellcheck: true,
      theme: null,
    });
    // A fractional stored percent rounds to a whole percent.
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": { zoom: 112.6 } }));
    expect(loadDocSettings("/a.md").zoom).toBe(113);
  });

  it("recovers corrupted JSON onto the defaults", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("leaves an unrelated localStorage map untouched", () => {
    localStorage.setItem("quillmd.viewMode", JSON.stringify({ "/a.md": "source" }));
    saveDocSettings("/a.md", {
      lineSpacing: "1.5",
      wordWrap: false,
      showMarks: true,
      zoom: 110,
      spellcheck: true,
      theme: "high-contrast",
    });
    expect(JSON.parse(localStorage.getItem("quillmd.viewMode")!)).toEqual({
      "/a.md": "source",
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      "/a.md": {
        lineSpacing: "1.5",
        wordWrap: false,
        showMarks: true,
        zoom: 110,
        spellcheck: true,
        theme: "high-contrast",
      },
    });
  });
});
