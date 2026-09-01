// OutlinePane (plan 09 task 9.3, issue #86): the right-hand navigation pane.
//
// Lists the active document's H1-H4 headings (the shared policy from toc.ts),
// highlights the entry that is currently at the top of the visible area
// (scroll tracking, outline.ts), and jumps to an entry on click. It mirrors
// the Explorer's look on the opposite rail and is toggled from the View menu
// (the toggle persists per path in DocSettings, like the view mode).
//
// The pane is a view artifact: it never writes to the document. In the
// WYSIWYG/split it reads the live ProseMirror doc (and selects the heading on
// click — a selection-only transaction, no bytes change); in the preview it
// reads the rendered headings; in source it lists the markdown's headings
// (no rendered surface to track, so no active highlight or jump there).
//
// Surfaces are resolved from the live DOM + the find-bridge editor, so the
// pane takes no refs from the App: it is self-contained and takes only the
// doc's markdown, the view mode, and its own width state.

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { ViewMode } from "./viewModes";
import { currentFindEditor } from "../lib/find";
import {
  outlineEntriesFromDoc,
  outlineEntriesFromMarkdown,
  startOutlineTracking,
  type OutlineEntry,
} from "../lib/outline";

interface OutlinePaneProps {
  // The active document's markdown (source of the list in source/preview).
  value: string;
  // The active document's view mode (drives which surface the pane tracks).
  mode: ViewMode;
  open: boolean;
  width: number;
  onResize: (width: number) => void;
}

interface Surface {
  // The element whose scrollTop drives the active-entry tracking.
  scrollEl: HTMLElement;
  // Resolves the viewport top of each heading, in entries order; null when
  // the surface can no longer resolve them (editor gone, headings changed).
  getTops: () => number[] | null;
  // Jumps to the entry at `index` (select + scroll in the WYSIWYG,
  // scrollIntoView in the preview).
  jump: (index: number) => void;
}

// The WYSIWYG/split surface: the live editor's scroll container
// (.quillmd-editor-body) and its ProseMirror positions (the design's
// coordsAtPos). Clicking selects the heading (a selection-only transaction)
// and scrolls it into view, like the TocCard.
function wysiwygSurface(ed: TiptapEditor): Surface | null {
  const dom = ed.view.dom;
  const scrollEl =
    (dom.closest?.(".quillmd-editor-body") as HTMLElement | null) ??
    dom.parentElement;
  if (!(scrollEl instanceof HTMLElement)) return null;

  const jumpToPos = (pos: number): void => {
    const view: EditorView = ed.view;
    const doc = view.state.doc;
    if (!doc.nodeAt(pos)) return;
    try {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, pos)));
    } catch {
      // A transiently invalid position is harmless; the jump is skipped.
      return;
    }
    const nodeDom = view.nodeDOM(pos);
    const el = nodeDom instanceof Text ? nodeDom.parentElement : (nodeDom as HTMLElement | null);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center" });
    }
  };

  return {
    scrollEl,
    getTops: () => {
      const tops: number[] = [];
      for (const entry of outlineEntriesFromDoc(ed.state.doc)) {
        if (entry.pos === null) return null;
        const coords = ed.view.coordsAtPos(entry.pos);
        if (!coords) return null;
        tops.push(coords.top);
      }
      return tops;
    },
    jump: (index) => {
      const entry = outlineEntriesFromDoc(ed.state.doc)[index];
      if (entry && entry.pos !== null) jumpToPos(entry.pos);
    },
  };
}

// The preview surface: the preview's scroll container (.quillmd-preview) and
// its rendered h1-h4 elements. Clicking scrolls the matching heading into view.
function previewSurface(): Surface | null {
  const scrollEl = document.querySelector<HTMLElement>(".quillmd-preview");
  if (!scrollEl) return null;
  const headings = () =>
    Array.from(
      scrollEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4"),
    );
  return {
    scrollEl,
    getTops: () =>
      headings().map((h) => h.getBoundingClientRect().top),
    jump: (index) => {
      const h = headings()[index];
      if (h && typeof h.scrollIntoView === "function") {
        h.scrollIntoView({ block: "center" });
      }
    },
  };
}

// Resolves the surface for the current mode, or null when there is none to
// track (source has no rendered heading surface; the editor is absent).
function resolveSurface(mode: ViewMode): Surface | null {
  if (mode === "wysiwyg" || mode === "split") {
    const ed = currentFindEditor();
    return ed ? wysiwygSurface(ed) : null;
  }
  if (mode === "preview") {
    return previewSurface();
  }
  return null;
}

export default function OutlinePane({
  value,
  mode,
  open,
  width,
  onResize,
}: OutlinePaneProps) {
  const [active, setActive] = useState(-1);
  // Bumped on every live-doc change (WYSIWYG/split) so the heading list —
  // derived from the doc, not from the pane's props — re-renders.
  const [, bump] = useState(0);

  const ed = mode === "wysiwyg" || mode === "split" ? currentFindEditor() : null;
  const entries: OutlineEntry[] = ed
    ? outlineEntriesFromDoc(ed.state.doc)
    : outlineEntriesFromMarkdown(value);

  // Re-render the list whenever the live doc changes (WYSIWYG/split). The
  // `update` event fires on any document-affecting transaction.
  useEffect(() => {
    if (!ed) return;
    const handler = () => bump((t) => t + 1);
    ed.on("update", handler);
    return () => {
      if (ed.isDestroyed) return;
      ed.off("update", handler);
    };
  }, [ed, mode]);

  // Scroll tracking: resolve the surface for the mode and start the
  // throttled listener. Re-resolves when the mode or the editor changes;
  // getTops reads the live doc each tick, so doc edits need no restart.
  useEffect(() => {
    if (!open) {
      setActive(-1);
      return;
    }
    const surface = resolveSurface(mode);
    if (!surface) {
      setActive(-1);
      return;
    }
    return startOutlineTracking({
      scrollEl: surface.scrollEl,
      getTops: surface.getTops,
      onChange: setActive,
    });
  }, [open, mode, ed, value]);

  const onJump = useCallback(
    (index: number) => {
      resolveSurface(mode)?.jump(index);
    },
    [mode],
  );

  // Drag the left edge to resize (the mirror of the Explorer's right edge):
  // dragging left widens the right-hand pane.
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        onResize(Math.max(160, Math.min(480, startWidth - (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, onResize],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="quillmd-splitter"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
      />
      <aside className="quillmd-outline" style={{ width }} aria-label="Navigation pane">
        <div className="quillmd-outline-header">
          <span>Navigation</span>
        </div>
        <div className="quillmd-outline-body">
          {entries.length === 0 ? (
            <div className="quillmd-outline-empty">No headings</div>
          ) : (
            <ol className="quillmd-outline-list">
              {entries.map((entry, i) => (
                <li
                  key={`${entry.pos ?? i}:${i}`}
                  className="quillmd-outline-item"
                  data-level={entry.level}
                >
                  <button
                    type="button"
                    className={`quillmd-outline-link ${i === active ? "quillmd-outline-active" : ""}`}
                    onClick={() => onJump(i)}
                  >
                    {entry.text || "(untitled)"}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}
