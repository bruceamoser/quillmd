// Navigation pane helpers (plan 09 task 9.3, issue #86).
//
// Pure, DOM-free helpers for the outline pane: the shared H1-H4 heading
// policy (the same one toc.ts applies to the TOC block — one "which
// headings" rule for both surfaces), and the scroll-tracking arithmetic:
// given each heading's viewport top and the scroll container's viewport top,
// which entry is "active". The DOM glue (the scroll listener) is
// startOutlineTracking below; the pane (components/OutlinePane.tsx) supplies
// the per-surface top resolvers (ProseMirror coordsAtPos in the WYSIWYG,
// rendered heading elements in the preview).

import type { Node as PmNode } from "@tiptap/pm/model";
import {
  tocEntriesFromDoc,
  tocEntriesFromMarkdown,
  type TocEntry,
} from "./toc";

// A navigation-pane entry: the shared H1-H4 policy plus the ProseMirror doc
// position when the entries came from the live editor doc (WYSIWYG/split —
// needed to select and scroll to the heading), null when they came from the
// markdown text (source/preview).
export interface OutlineEntry extends TocEntry {
  pos: number | null;
}

// The H1-H4 headings of a ProseMirror doc, in document order, each with its
// position (the editor's source of truth; the design's getHeadingList).
export function outlineEntriesFromDoc(doc: PmNode): OutlineEntry[] {
  return tocEntriesFromDoc(doc).map((e) => ({ level: e.level, text: e.text, pos: e.pos }));
}

// The H1-H4 headings of a markdown source, in document order (the preview's
// and source view's source of truth; no positions to resolve against).
export function outlineEntriesFromMarkdown(markdown: string): OutlineEntry[] {
  return tocEntriesFromMarkdown(markdown).map((e) => ({
    level: e.level,
    text: e.text,
    pos: null,
  }));
}

// The active-entry arithmetic (plan 09 §3): the active entry is the last one
// whose top has crossed `viewTop + offset` — a heading becomes active once it
// reaches near the top of the visible area, and it stays active until the
// next heading crosses. `atBottom` (the scroll is at the end of the content)
// forces the last entry active so the document's tail always highlights its
// final heading. Returns -1 when no heading has crossed (nothing active).
export function activeOutlineIndex(
  headingTops: readonly number[],
  viewTop: number,
  options: { offset?: number; atBottom?: boolean } = {},
): number {
  if (headingTops.length === 0) return -1;
  if (options.atBottom) return headingTops.length - 1;
  const threshold = viewTop + (options.offset ?? 48);
  let active = -1;
  for (let i = 0; i < headingTops.length; i++) {
    // Tops are in document order, hence non-decreasing: stop at the first
    // heading still below the threshold.
    if (headingTops[i] <= threshold) active = i;
    else break;
  }
  return active;
}

export interface OutlineTrackingOptions {
  // Resolves the viewport top of each heading, in entries order; null when
  // the surface can no longer resolve them (the editor unmounted, the tab
  // switched).
  getTops: () => number[] | null;
  // The element whose scrollTop drives the tracking (the WYSIWYG's
  // .quillmd-editor-body, the preview's .quillmd-preview).
  scrollEl: HTMLElement;
  // Called with the active index (-1 = none) whenever it changes.
  onChange: (index: number) => void;
  // How far below the container top a heading counts as "crossed" (px).
  offset?: number;
}

// Attaches a rAF-throttled scroll listener to `scrollEl` and publishes the
// active index (plan 09 §3: "scroll tracking via ... + scroll listener
// (throttled)"). The first evaluation runs immediately, so a pane opened
// mid-scroll shows the right active entry at once. Returns the disposer.
export function startOutlineTracking(options: OutlineTrackingOptions): () => void {
  const { scrollEl, getTops, onChange, offset } = options;
  // Sentinel: -2 can never be a real index, so the first evaluation always
  // publishes (even a -1 "nothing active").
  let last = -2;
  let scheduled = false;

  const evaluate = (): void => {
    scheduled = false;
    const tops = getTops();
    if (tops === null) return;
    const rect = scrollEl.getBoundingClientRect();
    const atBottom =
      scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
    const index = activeOutlineIndex(tops, rect.top, { offset, atBottom });
    if (index !== last) {
      last = index;
      onChange(index);
    }
  };

  const onScroll = (): void => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(evaluate);
    } else {
      setTimeout(evaluate, 16);
    }
  };

  scrollEl.addEventListener("scroll", onScroll, { passive: true });
  evaluate();
  return () => {
    scrollEl.removeEventListener("scroll", onScroll);
    scheduled = false;
  };
}
