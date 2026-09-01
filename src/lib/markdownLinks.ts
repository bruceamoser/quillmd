// Markdown-side link operations for the preview link menu (plan 03 task 3.5,
// issue #43): the preview renders the document as read-only HTML, so it has
// no TipTap instance to edit. Its Edit / Remove link items act on the
// markdown source directly (golden rule 1: markdown is the source of
// truth) — the anchor under the caret identifies the link by its destination
// and display text, the matching mdast link node's source position locates
// the exact span to splice, and every other byte of the document is
// untouched (the save pipeline keeps the rest verbatim).
//
// Pure over the source string, so the preview surface, the app shell (the
// markdown-target link dialog), and the tests share one behavior.

import { toMarkdown } from "mdast-util-to-markdown";
import type { Definition, Link, LinkReference, PhrasingContent } from "mdast";
import { parseToAst } from "./markdown";
import { validateLinkUrl } from "./links";

// The identity of a rendered anchor as the preview sees it: its destination
// and its (flattened) display text.
export interface PreviewLinkTarget {
  href: string;
  text: string;
}

// The source span of one markdown link and what it holds. Offsets are
// character offsets into the source string (micromark's position offsets).
export interface MarkdownLinkRef {
  // The full link span (the `[text](url)` or `[text][label]` syntax).
  start: number;
  end: number;
  // The span of the link's display text — what stays when the link is
  // removed.
  innerStart: number;
  innerEnd: number;
  // The link's destination (the rendered anchor's href) and tooltip.
  href: string;
  title: string;
  // The link's flattened display text (the rendered anchor's text).
  text: string;
}

// A node of the mdast tree. Only the fields these operations read are
// modeled; the parser (remark) populates `position` on every node.
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  url?: string | null;
  title?: string | null;
  identifier?: string | null;
  position?: {
    start: { offset: number };
    end: { offset: number };
  };
}

// The flattened display text of a link's children: text and code nodes
// contribute their value, phrasing wrappers (emphasis, strong, ...)
// contribute their children. This is exactly what the rendered anchor shows.
function nodeText(node: MdastNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(nodeText).join("");
}

// The children's combined source span: from the first child's start to the
// last child's end (an empty link has an empty inner span at the start).
function innerSpan(node: MdastNode): { start: number; end: number } {
  const children = node.children ?? [];
  if (children.length === 0) {
    const offset = node.position?.start.offset ?? 0;
    return { start: offset, end: offset };
  }
  const first = children[0].position?.start.offset ?? node.position?.start.offset ?? 0;
  const last =
    children[children.length - 1].position?.end.offset ?? node.position?.end.offset ?? 0;
  return { start: first, end: last };
}

// Collects the source's link definitions (identifier → definition) in a
// first pass: a reference link's usage precedes its definition in document
// order, so the destinations must be known before the links are walked.
function collectDefinitions(root: MdastNode): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const visit = (node: MdastNode): void => {
    if (node.type === "definition") {
      const def = node as unknown as Definition;
      if (def.identifier) definitions.set(def.identifier, def);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return definitions;
}

// Collects every link the source carries, in document order: inline links
// (`[text](url)`, autolinks) and reference links (`[text][label]`, whose
// destination and title come from the matching definition).
function collectLinks(root: MdastNode): MarkdownLinkRef[] {
  const definitions = collectDefinitions(root);
  const out: MarkdownLinkRef[] = [];
  const visit = (node: MdastNode): void => {
    if (node.type === "link") {
      const link = node as unknown as Link;
      const span = innerSpan(node);
      out.push({
        start: node.position?.start.offset ?? 0,
        end: node.position?.end.offset ?? 0,
        innerStart: span.start,
        innerEnd: span.end,
        href: typeof link.url === "string" ? link.url : "",
        title: typeof link.title === "string" ? link.title : "",
        text: nodeText(node),
      });
    } else if (node.type === "linkReference") {
      const ref = node as unknown as LinkReference;
      const def = ref.identifier ? definitions.get(ref.identifier) : undefined;
      const span = innerSpan(node);
      out.push({
        start: node.position?.start.offset ?? 0,
        end: node.position?.end.offset ?? 0,
        innerStart: span.start,
        innerEnd: span.end,
        href: typeof def?.url === "string" ? def.url : "",
        title: typeof def?.title === "string" ? def.title : "",
        text: nodeText(node),
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

// Finds the link the rendered anchor under the caret belongs to: the first
// link, in document order, whose destination and display text both match.
// Returns null when the source carries no such link (the caller then reports
// the failure instead of touching the document).
export function findMarkdownLink(
  source: string,
  target: PreviewLinkTarget,
): MarkdownLinkRef | null {
  const root = parseToAst(source) as unknown as MdastNode;
  return (
    collectLinks(root).find(
      (link) => link.href === target.href && link.text === target.text,
    ) ?? null
  );
}

// Removes the link's markup, keeping its display text (the inner source
// bytes — inline emphasis and the like survive exactly as written). Returns
// the source unchanged when the ref does not address a valid span.
export function unlinkMarkdownLink(
  source: string,
  ref: MarkdownLinkRef,
): string {
  if (
    ref.start < 0 ||
    ref.start > source.length ||
    ref.innerStart < ref.start ||
    ref.innerEnd > ref.end ||
    ref.end > source.length
  ) {
    return source;
  }
  return source.slice(0, ref.start) + source.slice(ref.innerStart, ref.innerEnd) + source.slice(ref.end);
}

// Applies the link dialog's result to the matched link: the span is replaced
// by the (re)serialized inline link. The display text falls back to the
// link's current text, then to the destination — the same fallback the
// editor-side applyLink uses. Returns the source unchanged when the
// destination fails validation or the ref does not address a valid span.
export function relinkMarkdownLink(
  source: string,
  ref: MarkdownLinkRef,
  payload: { href: string; title: string; text: string },
): string {
  const href = payload.href.trim();
  if (validateLinkUrl(href) !== null) return source;
  if (
    ref.start < 0 ||
    ref.start > source.length ||
    ref.end < ref.start ||
    ref.end > source.length
  ) {
    return source;
  }
  const text =
    payload.text.trim() !== ""
      ? payload.text.trim()
      : ref.text !== ""
        ? ref.text
        : href;
  const title = payload.title.trim();
  const link: PhrasingContent = {
    type: "link",
    url: href,
    title: title === "" ? null : title,
    children: [{ type: "text", value: text }],
  };
  // The root handler appends a final newline; the splice sits mid-line, so
  // drop it.
  const serialized = toMarkdown({ type: "root", children: [link] });
  const replacement = serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;
  return source.slice(0, ref.start) + replacement + source.slice(ref.end);
}
