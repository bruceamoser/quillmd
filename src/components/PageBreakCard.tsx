// PageBreakCard (plan 09 task 9.7, issue #90): the React NodeView for the
// pageBreak node. The document stores a physical page break as the fixed HTML
// block `<div class="quillmd-page-break"></div>` (the source of truth, golden
// rule 1); the card is a view artifact that renders it as a visible break line
// (a labeled dashed rule) so the user can see where the page will split. The
// node carries no state, so the card is static — unlike the live TOC card it
// never re-derives anything from the document. It is read-only: the node is an
// atom, so ProseMirror never places the caret inside it and the line can never
// be edited into the document bytes.

import type React from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";

// The framework passes its own ref through as a prop (React 19 treats ref as a
// regular prop for function components); the core NodeViewProps type does not
// declare it, so the card's props add it.
type PageBreakCardProps = NodeViewProps & { ref?: React.Ref<HTMLElement> };

export default function PageBreakCard(props: PageBreakCardProps) {
  return (
    <NodeViewWrapper
      as="div"
      ref={props.ref}
      className="quillmd-page-break"
      data-quillmd-page-break=""
    >
      <div className="quillmd-page-break-line">
        <span className="quillmd-page-break-label">Page break</span>
      </div>
    </NodeViewWrapper>
  );
}
