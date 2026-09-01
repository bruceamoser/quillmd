// @vitest-environment jsdom
// Navigation-pane helpers (plan 09 task 9.3, issue #86): the shared H1-H4
// entry extraction (reusing the toc.ts policy), the pure active-index math,
// and the throttled scroll-tracking driver. The pane itself is covered in
// outlinePane.test.tsx; the App wiring (toggle + shortcut) is covered there
// too through the full App render.
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { markdownToTiptap } from "../pm";
import {
  activeOutlineIndex,
  outlineEntriesFromDoc,
  outlineEntriesFromMarkdown,
  startOutlineTracking,
} from "../outline";

// A document with headings at every level plus a too-deep H5.
const DOC =
  "# Title\n" +
  "\n" +
  "Intro.\n" +
  "\n" +
  "## One\n" +
  "\n" +
  "Body one.\n" +
  "\n" +
  "### Deep\n" +
  "\n" +
  "Body deep.\n" +
  "\n" +
  "#### Deeper\n" +
  "\n" +
  "Body deeper.\n" +
  "\n" +
  "##### Too deep\n" +
  "\n" +
  "Body too deep.\n";

describe("outlineEntriesFromMarkdown (issue #86)", () => {
  it("lists H1-H4 in document order, excluding deeper headings", () => {
    const entries = outlineEntriesFromMarkdown(DOC);
    expect(entries.map((e) => e.level)).toEqual([1, 2, 3, 4]);
    expect(entries.map((e) => e.text)).toEqual(["Title", "One", "Deep", "Deeper"]);
    // The H5 heading is not listed.
    expect(entries.some((e) => e.text === "Too deep")).toBe(false);
    // Markdown-derived entries carry no ProseMirror position.
    for (const e of entries) expect(e.pos).toBeNull();
  });

  it("returns an empty list for a document with no headings", () => {
    expect(outlineEntriesFromMarkdown("just some text\n")).toEqual([]);
  });
});

describe("outlineEntriesFromDoc (issue #86)", () => {
  function docOf(markdown: string) {
    const editor = new Editor({
      extensions: [StarterKit],
      content: markdownToTiptap(markdown),
    });
    const doc = editor.state.doc;
    editor.destroy();
    return doc;
  }

  it("lists H1-H4 with strictly-increasing positions, excluding deeper headings", () => {
    const entries = outlineEntriesFromDoc(docOf(DOC));
    expect(entries.map((e) => e.level)).toEqual([1, 2, 3, 4]);
    expect(entries.map((e) => e.text)).toEqual(["Title", "One", "Deep", "Deeper"]);
    expect(entries.some((e) => e.text === "Too deep")).toBe(false);
    // Every doc-derived entry has a real position, in document order.
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].pos).not.toBeNull();
      if (i > 0) expect(entries[i].pos!).toBeGreaterThan(entries[i - 1].pos!);
    }
  });
});

describe("activeOutlineIndex (issue #86)", () => {
  it("returns -1 when there are no headings", () => {
    expect(activeOutlineIndex([], 0)).toBe(-1);
  });

  it("returns -1 when no heading has crossed the threshold", () => {
    // Threshold = viewTop(0) + offset(48) = 48; the first heading (100) is
    // still below it.
    expect(activeOutlineIndex([100, 200, 300], 0)).toBe(-1);
  });

  it("returns the last heading that has crossed the threshold", () => {
    // Threshold 48: heading 0 (10) and heading 1 (30) have crossed, heading 2
    // (60) has not. Active is 1.
    expect(activeOutlineIndex([10, 30, 60], 0)).toBe(1);
  });

  it("honors a custom offset", () => {
    // Threshold = 0 + 10 = 10; only heading 0 (at 10, <=) has crossed.
    expect(activeOutlineIndex([10, 20, 30], 0, { offset: 10 })).toBe(0);
  });

  it("forces the last entry when scrolled to the bottom", () => {
    // atBottom wins: the final heading is active even if it has not crossed.
    expect(activeOutlineIndex([10, 30, 60], 0, { atBottom: true })).toBe(2);
    expect(activeOutlineIndex([10, 30, 60], 500, { atBottom: true })).toBe(2);
  });
});

describe("startOutlineTracking (issue #86)", () => {
  // A real element with the scroll metrics overridden, so the driver's
  // atBottom math and viewTop are deterministic under jsdom (which reports
  // zeroed layout otherwise).
  function makeScrollEl(metrics: {
    top?: number;
    scrollTop?: number;
    clientHeight?: number;
    scrollHeight?: number;
  }) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const { top = 0, scrollTop = 0, clientHeight = 300, scrollHeight = 1000 } = metrics;
    Object.defineProperty(el, "scrollTop", {
      value: scrollTop,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => new DOMRect(0, top, 800, clientHeight),
      configurable: true,
    });
    return el;
  }

  // Flushes the rAF/setTimeout the driver schedules after a scroll event.
  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 50));
  }

  it("publishes the active index on the initial evaluation and on scroll", async () => {
    const el = makeScrollEl({ top: 0, scrollTop: 0, clientHeight: 300, scrollHeight: 1000 });
    let tops = [10, 30, 60];
    const seen: number[] = [];
    const dispose = startOutlineTracking({
      scrollEl: el,
      getTops: () => tops,
      onChange: (i) => seen.push(i),
    });
    // Not at the bottom (0 + 300 < 999); threshold 48 → heading 1 active.
    expect(seen).toEqual([1]);

    // Scroll so all three headings have crossed; the active index advances.
    tops = [-50, -20, 10];
    el.dispatchEvent(new Event("scroll"));
    await settle();
    expect(seen).toEqual([1, 2]);

    // An unchanged index is not republished.
    el.dispatchEvent(new Event("scroll"));
    await settle();
    expect(seen).toEqual([1, 2]);

    dispose();
    el.remove();
  });

  it("forces the last entry when the scroll is at the bottom", async () => {
    // scrollTop + clientHeight >= scrollHeight - 1 → atBottom.
    const el = makeScrollEl({ top: 0, scrollTop: 0, clientHeight: 300, scrollHeight: 300 });
    const seen: number[] = [];
    const dispose = startOutlineTracking({
      scrollEl: el,
      // Only the first heading has "crossed", but atBottom forces the last.
      getTops: () => [10, 30, 60],
      onChange: (i) => seen.push(i),
    });
    expect(seen).toEqual([2]);
    dispose();
    el.remove();
  });

  it("stops publishing after the disposer runs", async () => {
    const el = makeScrollEl({ top: 0 });
    const seen: number[] = [];
    const dispose = startOutlineTracking({
      scrollEl: el,
      getTops: () => [10, 30, 60],
      onChange: (i) => seen.push(i),
    });
    dispose();
    el.dispatchEvent(new Event("scroll"));
    await settle();
    // Only the initial evaluation fired; the scroll after dispose did not.
    expect(seen).toEqual([1]);
    el.remove();
  });
});
