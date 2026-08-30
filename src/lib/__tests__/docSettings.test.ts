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

describe("docSettings (plan 02 task 2.5, issue #34)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to single spacing, wrap on, marks off", () => {
    expect(DEFAULT_DOC_SETTINGS).toEqual({
      lineSpacing: "single",
      wordWrap: true,
      showMarks: false,
    });
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("round-trips a full settings record per path", () => {
    const settings: DocSettings = { lineSpacing: "1.5", wordWrap: false, showMarks: true };
    saveDocSettings("/a.md", settings);
    expect(loadDocSettings("/a.md")).toEqual(settings);
  });

  it("keeps settings independent per path", () => {
    saveDocSettings("/a.md", { lineSpacing: "double", wordWrap: false, showMarks: true });
    saveDocSettings("/b.md", { lineSpacing: "1.15", wordWrap: true, showMarks: false });
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "double",
      wordWrap: false,
      showMarks: true,
    });
    expect(loadDocSettings("/b.md")).toEqual({
      lineSpacing: "1.15",
      wordWrap: true,
      showMarks: false,
    });
    // An unknown path still gets the defaults.
    expect(loadDocSettings("/c.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("overwrites an existing record on the same path", () => {
    saveDocSettings("/a.md", { lineSpacing: "double", wordWrap: false, showMarks: true });
    saveDocSettings("/a.md", { lineSpacing: "single", wordWrap: true, showMarks: false });
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("merges a partial record onto the defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": { lineSpacing: "1.5" } }));
    expect(loadDocSettings("/a.md")).toEqual({
      lineSpacing: "1.5",
      wordWrap: true,
      showMarks: false,
    });
  });

  it("recovers a corrupted record onto the defaults", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ "/a.md": { lineSpacing: "triple", wordWrap: "yes", showMarks: 1 } }),
    );
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("recovers corrupted JSON onto the defaults", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadDocSettings("/a.md")).toEqual(DEFAULT_DOC_SETTINGS);
  });

  it("leaves an unrelated localStorage map untouched", () => {
    localStorage.setItem("quillmd.viewMode", JSON.stringify({ "/a.md": "source" }));
    saveDocSettings("/a.md", { lineSpacing: "1.5", wordWrap: false, showMarks: true });
    expect(JSON.parse(localStorage.getItem("quillmd.viewMode")!)).toEqual({
      "/a.md": "source",
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      "/a.md": { lineSpacing: "1.5", wordWrap: false, showMarks: true },
    });
  });
});
