// Shared table-of-contents helpers (plan 09 task 9.1, issue #84).
//
// The tocBlock node (Editor.tsx) renders a live list of the document's
// headings in the WYSIWYG and the preview. The two surfaces reach the headings
// from different sources — the WYSIWYG walks the ProseMirror doc (and needs
// each heading's position to scroll to it on click), the preview parses the
// markdown — so the collectors live here and share one "which headings"
// policy: H1-H4, in document order (plan 09 §2).

import type { Node as PmNode } from "@tiptap/pm/model";
import type { PhrasingContent } from "mdast";
import { parseToAst } from "./markdown";

export interface TocEntry {
  // 1-4 (the TOC lists H1-H4).
  level: number;
  // The heading's plain text (no markup).
  text: string;
}

// The TOC lists H1-H4; deeper headings are excluded (plan 09 §2).
const MAX_LEVEL = 4;

// The plain text of a run of mdast phrasing content (nested emphasis/strong
// unwrap to their text; links keep their display text).
function mdastPlainText(children: PhrasingContent[]): string {
  let out = "";
  for (const child of children) {
    if (child.type === "text" || child.type === "inlineCode") {
      out += child.value;
    } else if ("children" in child && Array.isArray(child.children)) {
      out += mdastPlainText(child.children as PhrasingContent[]);
    }
  }
  return out;
}

// The H1-H4 headings of a markdown source, in document order (the preview's
// source of truth).
export function tocEntriesFromMarkdown(markdown: string): TocEntry[] {
  const root = parseToAst(markdown);
  const out: TocEntry[] = [];
  for (const child of root.children) {
    if (child.type === "heading" && child.depth <= MAX_LEVEL) {
      out.push({ level: child.depth, text: mdastPlainText(child.children) });
    }
  }
  return out;
}

// The H1-H4 headings of a ProseMirror doc, in document order, each with its
// position so the WYSIWYG card can scroll to it on click (the editor's source
// of truth).
export function tocEntriesFromDoc(doc: PmNode): Array<TocEntry & { pos: number }> {
  const out: Array<TocEntry & { pos: number }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
      if (level >= 1 && level <= MAX_LEVEL) {
        out.push({ level, text: node.textContent, pos });
      }
    }
    return true;
  });
  return out;
}
