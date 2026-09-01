// TocCard (plan 09 task 9.1, issue #84): the React NodeView for the tocBlock
// node. The document stores the table of contents as the fixed comment token
// `<!-- quillmd:toc -->` (the source of truth, golden rule 1); the card is a
// view artifact that renders the document's current H1-H4 headings as a
// clickable, indented list. The list is regenerated live on every document
// change — the token in the file never changes (adding/removing headings does
// not rewrite it, only the rendered view updates).
//
// The card subscribes to the editor's `update` event (available on the node
// view's props) so it re-renders whenever the document changes, even though
// the tocBlock node itself is untouched by heading edits. Clicking an entry
// selects the heading and scrolls it into view (the navigation pane's scroll
// tracking is a later task; this is the block's own click-to-jump). The card
// is read-only: the node is an atom, so ProseMirror never places the caret
// inside it and the list can never be edited into the document bytes.

import { useEffect, useState } from "react";
import type React from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection } from "@tiptap/pm/state";
import { tocEntriesFromDoc } from "../lib/toc";

// Selects the heading at `pos` and scrolls it into the view. A
// selection-only transaction: it changes no document bytes, so it never
// re-serializes or dirties the doc.
function jumpToHeading(view: EditorView, pos: number): void {
  const doc = view.state.doc;
  if (!doc.nodeAt(pos)) return;
  try {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, pos)));
  } catch {
    // A transiently invalid position (mid-transaction) is harmless; the list
    // is still correct, only the jump is skipped.
    return;
  }
  const dom = view.nodeDOM(pos);
  const el = dom instanceof Text ? dom.parentElement : (dom as HTMLElement | null);
  if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center" });
  }
}

// The framework passes its own ref through as a prop (React 19 treats ref as a
// regular prop for function components); the core NodeViewProps type does not
// declare it, so the card's props add it.
type TocCardProps = NodeViewProps & { ref?: React.Ref<HTMLElement> };

export default function TocCard(props: TocCardProps) {
  // Re-render on every document change: the heading list is derived from the
  // live doc, but a heading edit elsewhere leaves this atom node unchanged, so
  // the NodeView would not re-render on its own. The `update` event fires on
  // any document-affecting transaction, which is exactly when the list may
  // change. The bump state is the re-render trigger; the doc is read fresh
  // from the view's state on each render.
  const [, bump] = useState(0);
  useEffect(() => {
    const editor = props.editor;
    const handler = () => bump((t) => t + 1);
    editor.on("update", handler);
    return () => {
      if (editor.isDestroyed) return;
      editor.off("update", handler);
    };
  }, [props.editor]);

  const entries = tocEntriesFromDoc(props.view.state.doc);

  return (
    <NodeViewWrapper
      as="div"
      ref={props.ref}
      className="quillmd-toc"
      data-quillmd-toc=""
    >
      <div className="quillmd-toc-title">Contents</div>
      {entries.length === 0 ? (
        <div className="quillmd-toc-empty">No headings</div>
      ) : (
        <ol className="quillmd-toc-list">
          {entries.map((entry, i) => (
            <li
              key={`${entry.pos}-${i}`}
              className="quillmd-toc-item"
              data-level={entry.level}
            >
              <button
                type="button"
                className="quillmd-toc-link"
                onClick={() => jumpToHeading(props.view, entry.pos)}
              >
                {entry.text || "(untitled)"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}
