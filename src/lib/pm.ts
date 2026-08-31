// Converter between the mdast tree (unified/micromark) and TipTap/ProseMirror
// JSON. The WYSIWYG editor is an editing VIEW only: on load we descend mdast
// into TipTap nodes, and on change we ascend TipTap nodes back into mdast and
// serialize with the canonical serializer. Round-trip fidelity for untouched
// regions is owned by the clean-path pipeline, not this converter.

import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  Blockquote,
  Break,
  DefinitionContent,
  InlineCode,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";
import { normalizeColor } from "./colors";
import { parseFrontMatter, parseToAst, serializeAst } from "./markdown";

// Front matter is represented as a fenced code block with this marker language
// so the editor can render it as one atomic block while the converter knows to
// emit the raw YAML verbatim instead of a ``` fence.
export const FRONTMATTER_LANG = "frontmatter";

// Text alignment (task 2.3) is serialized as a single HTML block wrapping the
// aligned block: <div class="quillmd-align-center|right"> ... </div>. Left
// alignment is the default and emits no marker. The wrapper contains no blank
// lines, so it parses as one mdast html node and keeps the block model's
// 1:1 block correspondence intact.
export const ALIGN_CLASSES = {
  center: "quillmd-align-center",
  right: "quillmd-align-right",
} as const;

export type AlignValue = "left" | "center" | "right";

const ALIGN_WRAPPER_RE = /^<div class="quillmd-align-(center|right)">\r?\n([\s\S]*)\r?\n<\/div>$/;

const ALIGNABLE_NODE_TYPES = new Set(["paragraph", "heading", "blockquote", "codeBlock"]);

export function isAlignableNodeType(type: string | undefined): boolean {
  return type !== undefined && ALIGNABLE_NODE_TYPES.has(type);
}

function matchAlignWrapper(value: string): { align: AlignValue; inner: string } | null {
  const m = ALIGN_WRAPPER_RE.exec(value);
  if (!m) return null;
  return { align: m[1] as AlignValue, inner: m[2] };
}

function alignableToJson(node: JSONContent, align: AlignValue): JSONContent | null {
  if (!isAlignableNodeType(node.type)) return null;
  node.attrs = { ...(node.attrs ?? {}), textAlign: align };
  return node;
}

function wrapAligned(flow: FlowNode, align: keyof typeof ALIGN_CLASSES): FlowNode {
  const body = serializeAst({ type: "root", children: [flow] as RootContent[] }).replace(/\n+$/, "");
  return { type: "html", value: `<div class="${ALIGN_CLASSES[align]}">\n${body}\n</div>` };
}

type FlowNode = BlockContent | DefinitionContent;

// --- <img> HTML (plan 08 task 8.4, issue #79) --------------------------------
//
// A width-carrying image serializes as the HTML form <img src="…" alt="…"
// title="…" width="…"> (decision in plan 08 §3: HTML over the pandoc
// {width=...} syntax for maximum renderer compatibility). Parsing and
// rendering share one canonical shape — src first, then alt, title, and
// width in that order, each only when set — so the WYSIWYG round-trip of an
// edited block is byte-stable. Tags with anything beyond the recognized
// attributes stay opaque HTML (the norm-002 passthrough behavior).

const IMG_TAG_RE = /^<img\b([^>]*?)>$/i;

interface ImgAttrs {
  src: string;
  alt: string | null;
  title: string | null;
  width: string | null;
}

// The recognized attributes of an <img> tag, or null when the value is not
// an <img> tag or carries an unrecognized attribute (then it stays opaque
// HTML, never silently rewritten).
export function parseImgHtml(value: string): ImgAttrs | null {
  const m = IMG_TAG_RE.exec(value.trim());
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /\b(src|alt|title|width)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(m[1])) !== null) {
    attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? "";
  }
  const stripped = m[1]
    .replace(/\b(src|alt|title|width)\s*=\s*(?:"[^"]*"|'[^']*')/gi, " ")
    .replace(/\/$/, " ")
    .trim();
  if (stripped.length > 0) return null;
  if (typeof attrs.src !== "string") return null;
  return {
    src: attrs.src,
    alt: attrs.alt ?? null,
    title: attrs.title ?? null,
    width: attrs.width ?? null,
  };
}

// The canonical <img> tag for an image node's attributes: src always, then
// alt, title, and width only when set.
export function renderImgHtml(attrs: {
  src: string;
  alt?: string | null;
  title?: string | null;
  width?: string | null;
}): string {
  const parts = [`src="${attrs.src}"`];
  for (const name of ["alt", "title", "width"] as const) {
    const v = attrs[name];
    if (typeof v === "string" && v !== "") parts.push(`${name}="${v}"`);
  }
  return `<img ${parts.join(" ")}>`;
}

// --- Font & highlight spans (plan 04 task 4.1, issue #47) ------------------
//
// Styled text serializes as pandoc/HTML spans with a stable class + inline
// style (decision in plan 04 §3):
//   <span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">styled</span>
// The serializer writes only non-default properties, always in the fixed
// order font-family, font-size, color, so the span HTML is stable and
// save -> reopen -> save is byte-identical. A highlight with a non-default
// color uses the same mechanism with background-color:
//   <span class="quillmd-highlight" style="background-color: #ffff00">marked</span>
// A highlight without a color keeps the ==text== syntax (backward compat).
// Tags with anything beyond the recognized shape stay opaque HTML (the
// norm-002 passthrough behavior).

export const FONT_SPAN_CLASS = "quillmd-font";
export const HIGHLIGHT_SPAN_CLASS = "quillmd-highlight";

export interface FontSpanStyle {
  fontFamily: string | null;
  fontSize: string | null;
  color: string | null;
}

const SPAN_OPEN_RE = /^<span\b([^>]*?)>$/i;
const SPAN_CLOSE = "</span>";

interface SpanOpen {
  kind: "font" | "highlight";
  style: FontSpanStyle & { background: string | null };
}

// The recognized opening span tags, or null when the value is not one (then
// it stays opaque HTML, never silently rewritten). Attribute order is
// accepted anywhere; the canonical order is enforced on emit.
export function parseSpanOpen(value: string): SpanOpen | null {
  const m = SPAN_OPEN_RE.exec(value.trim());
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /\b(class|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(m[1])) !== null) {
    attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? "";
  }
  const stripped = m[1].replace(/\b(class|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, " ").trim();
  if (stripped.length > 0) return null;
  const className = attrs.class?.trim();
  if (className !== FONT_SPAN_CLASS && className !== HIGHLIGHT_SPAN_CLASS) return null;
  const style: FontSpanStyle & { background: string | null } = {
    fontFamily: null,
    fontSize: null,
    color: null,
    background: null,
  };
  if (attrs.style !== undefined) {
    for (const part of attrs.style.split(";")) {
      if (part.trim() === "") continue;
      const idx = part.indexOf(":");
      if (idx === -1) return null;
      const key = part.slice(0, idx).trim().toLowerCase();
      const val = part.slice(idx + 1).trim();
      if (val === "") return null;
      switch (key) {
        case "font-family":
          style.fontFamily = val;
          break;
        case "font-size":
          if (!/^\d+pt$/.test(val)) return null;
          style.fontSize = val;
          break;
        case "color": {
          const color = normalizeColor(val);
          if (!color) return null;
          style.color = color;
          break;
        }
        case "background-color": {
          const background = normalizeColor(val);
          if (!background) return null;
          style.background = background;
          break;
        }
        default:
          return null;
      }
    }
  }
  if (className === FONT_SPAN_CLASS) {
    if (style.background !== null) return null;
    if (!style.fontFamily && !style.fontSize && !style.color) return null;
    return { kind: "font", style };
  }
  if (style.background === null) return null;
  if (style.fontFamily !== null || style.fontSize !== null || style.color !== null) return null;
  return { kind: "highlight", style };
}

// The canonical opening tag for a font span's style (fixed property order,
// only the properties that are set).
export function renderFontSpanOpen(style: FontSpanStyle): string {
  const parts: string[] = [];
  if (style.fontFamily) parts.push(`font-family: ${style.fontFamily}`);
  if (style.fontSize) parts.push(`font-size: ${style.fontSize}`);
  if (style.color) parts.push(`color: ${style.color}`);
  return `<span class="${FONT_SPAN_CLASS}" style="${parts.join("; ")}">`;
}

// The canonical opening tag for a colored highlight span.
export function renderHighlightSpanOpen(color: string): string {
  return `<span class="${HIGHLIGHT_SPAN_CLASS}" style="background-color: ${color}">`;
}

// The ==text== highlight syntax inside a run of plain text (same delimiter
// rules as the TipTap highlight input rule: no '=' inside, no == hugging a
// space+==).
const HIGHLIGHT_SYNTAX_RE = /==(?!\s+==)((?:[^=]+))==/g;

function splitHighlightSyntax(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  let last = 0;
  for (const m of text.matchAll(HIGHLIGHT_SYNTAX_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", text: text.slice(last, idx) });
    out.push({ type: "text", text: m[1], marks: [{ type: "highlight" }] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.length > 0 ? out : [{ type: "text", text }];
}

// Adds `marks` to every text node of the (possibly nested) inline JSON.
// ProseMirror stores marks on text nodes only, so a span covering a mixed
// run (e.g. **bold** and plain) becomes the mark on each text run; this is
// also the only shape the TipTap JSON loader accepts (an empty text node
// with content throws in Node.fromJSON and drops the document).
function applyInlineMarks(nodes: JSONContent[], marks: NonNullable<JSONContent["marks"]>): JSONContent[] {
  if (marks.length === 0 || nodes.length === 0) return nodes;
  return nodes.map((node) => {
    if (node.type === "text") {
      const existing = node.marks ?? [];
      const merged = existing.filter(
        (m) => !marks.some((n) => n.type === m.type && JSON.stringify(n.attrs) === JSON.stringify(m.attrs)),
      );
      return { ...node, marks: [...merged, ...marks] };
    }
    if (Array.isArray(node.content)) {
      return { ...node, content: applyInlineMarks(node.content, marks) };
    }
    return node;
  });
}

// --- markdown -> TipTap ---------------------------------------------------

export function markdownToTiptap(markdown: string): JSONContent {
  const fm = parseFrontMatter(markdown);
  const content: JSONContent[] = [];

  if (fm) {
    content.push({
      type: "codeBlock",
      attrs: { language: FRONTMATTER_LANG },
      content: [{ type: "text", text: fm.raw.replace(/\n$/, "") }],
    });
  }

  const body = fm ? markdown.slice(fm.end) : markdown;
  const root = parseToAst(body);
  for (const child of root.children) {
    const node = flowToTiptap(child as FlowNode, body);
    if (node) content.push(node);
  }

  return { type: "doc", content };
}

function flowToTiptap(node: FlowNode, source: string): JSONContent | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth },
        content: inlineChildren(node.children),
      };
    case "paragraph": {
      const raw = node.position
        ? source.slice(node.position.start.offset, node.position.end.offset)
        : "";
      if (isDefinitionListText(raw)) {
        return { type: "opaqueBlock", attrs: { raw, hint: "Definition list" } };
      }
      return { type: "paragraph", content: inlineChildren(node.children) };
    }
    case "footnoteDefinition": {
      const content: JSONContent[] = [];
      for (const child of node.children) {
        const converted = flowToTiptap(child, source);
        if (converted) content.push(converted);
      }
      if (content.length === 0) content.push({ type: "paragraph" });
      return {
        type: "footnoteDef",
        attrs: { label: node.label ?? node.identifier },
        content,
      };
    }
    case "blockquote":
      return blockquoteToTiptap(node, source);
    case "list":
      return listToTiptap(node, source);
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? "" },
        content: [{ type: "text", text: node.value }],
      };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "table":
      return tableToTiptap(node);
    case "html": {
      const img = parseImgHtml(node.value);
      if (img) {
        // A standalone <img> line is phrasing content, so it lives in a
        // paragraph (the doc schema has no top-level image). Serializing an
        // image that carries a width back to <img> keeps this byte-stable.
        return {
          type: "paragraph",
          content: [imageToJson(img)],
        };
      }
      const aligned = matchAlignWrapper(node.value);
      if (aligned) {
        const inner = parseToAst(aligned.inner);
        if (inner.children.length === 1) {
          const child = flowToTiptap(inner.children[0] as FlowNode, aligned.inner);
          if (child) {
            const unwrapped = alignableToJson(child, aligned.align);
            if (unwrapped) return unwrapped;
          }
        }
      }
      return {
        type: "codeBlock",
        attrs: { language: "html" },
        content: [{ type: "text", text: node.value }],
      };
    }
    case "definition": {
      const title = node.title ? ` "${node.title}"` : "";
      return {
        type: "paragraph",
        content: [{ type: "text", text: `[${node.identifier}]: ${node.url}${title}` }],
      };
    }
    default:
      return null;
  }
}

function blockquoteToTiptap(node: Blockquote, source: string): JSONContent {
  const content: JSONContent[] = [];
  for (const child of node.children) {
    const converted = flowToTiptap(child, source);
    if (converted) content.push(converted);
  }
  return { type: "blockquote", content };
}

function listToTiptap(node: List, source: string): JSONContent {
  const content: JSONContent[] = [];
  for (const item of node.children) {
    const converted = listItemToTiptap(item, source);
    if (converted) content.push(converted);
  }
  const tight = node.spread === false;
  if (node.ordered) {
    return {
      type: "orderedList",
      attrs: { start: node.start ?? 1, tight },
      content,
    };
  }
  return { type: "bulletList", attrs: { tight }, content };
}

function listItemToTiptap(node: ListItem, source: string): JSONContent | null {
  const children: JSONContent[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      children.push({ type: "paragraph", content: inlineChildren(child.children) });
    } else {
      const converted = flowToTiptap(child, source);
      if (converted) children.push(converted);
    }
  }
  if (children.length === 0) {
    children.push({ type: "paragraph" });
  }
  if (typeof node.checked === "boolean") {
    return { type: "taskItem", attrs: { checked: node.checked }, content: children };
  }
  return { type: "listItem", content: children };
}

function tableToTiptap(node: Table): JSONContent {
  const rows: JSONContent[] = [];
  node.children.forEach((row: TableRow, rowIndex: number) => {
    const cells: JSONContent[] = [];
    for (const cell of row.children) {
      const isHeader = rowIndex === 0;
      cells.push({
        type: isHeader ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph", content: inlineChildren(cell.children) }],
      });
    }
    rows.push({ type: "tableRow", content: cells });
  });
  return { type: "table", content: rows };
}

function inlineChildren(children: PhrasingContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === "html" && child.value.trim() !== SPAN_CLOSE) {
      const img = parseImgHtml(child.value);
      if (img) {
        out.push(imageToJson(img));
        i += 1;
        continue;
      }
      const span = parseSpanOpen(child.value);
      if (span) {
        // Collect the span's phrasing content up to the matching </span>
        // (nested spans of any kind tracked by depth); the marks land on
        // every inner text run.
        const inner: PhrasingContent[] = [];
        let j = i + 1;
        let depth = 1;
        let closed = false;
        while (j < children.length) {
          const c = children[j];
          if (c.type === "html") {
            const v = c.value.trim();
            if (v === SPAN_CLOSE) {
              depth -= 1;
              if (depth === 0) {
                closed = true;
                break;
              }
            } else if (/^<span\b/i.test(v)) {
              depth += 1;
            }
          }
          inner.push(c);
          j += 1;
        }
        if (closed) {
          const marks: NonNullable<JSONContent["marks"]> =
            span.kind === "font"
              ? [
                  ...(span.style.fontFamily ? [{ type: "fontFamily", attrs: { fontFamily: span.style.fontFamily } }] : []),
                  ...(span.style.fontSize ? [{ type: "fontSize", attrs: { fontSize: span.style.fontSize } }] : []),
                  ...(span.style.color ? [{ type: "fontColor", attrs: { color: span.style.color } }] : []),
                ]
              : [{ type: "highlight", attrs: { color: span.style.background } }];
          out.push(...applyInlineMarks(inlineChildren(inner), marks));
          i = j + 1;
          continue;
        }
      }
      out.push({ type: "text", text: child.value });
      i += 1;
      continue;
    }
    if (child.type === "text") {
      // ==text== is the highlight syntax (plan 04 §3, AC5): parse it into
      // the colorless highlight mark so WYSIWYG renders the default yellow
      // and the serializer keeps the syntax for backward compatibility.
      out.push(...splitHighlightSyntax(child.value));
      i += 1;
      continue;
    }
    out.push(...inlineToTiptap(child));
    i += 1;
  }
  return out;
}

function inlineToTiptap(node: PhrasingContent): JSONContent[] {
  switch (node.type) {
    case "text":
      return [{ type: "text", text: node.value }];
    case "emphasis":
      return markWrapped(node.children, "italic");
    case "strong":
      return markWrapped(node.children, "bold");
    case "delete":
      return markWrapped(node.children, "strike");
    case "inlineCode":
      return [{ type: "text", text: node.value, marks: [{ type: "code" }] }];
    case "footnoteReference":
      return [{ type: "footnoteRef", attrs: { label: node.label ?? node.identifier } }];
    case "link":
      // The title round-trips through the link mark attribute (plan 08
      // task 8.1): [text](url "title") must survive an edit of its block.
      return markWrapped(node.children, "link", {
        href: node.url,
        title: typeof node.title === "string" ? node.title : null,
      });
    case "image":
      return [imageToJson({ src: node.url, alt: node.alt, title: node.title })];
    case "break":
      return [{ type: "hardBreak" }];
    case "html":
      return [{ type: "text", text: node.value }];
    case "linkReference":
      return markWrapped(node.children, "link", { href: node.identifier });
    case "imageReference":
      return [imageToJson({ src: node.identifier, alt: node.alt })];
    default:
      return [];
  }
}

// The TipTap image node for a parsed image: markdown image syntax (no width)
// and the <img> HTML form (width set) both land here.
function imageToJson(attrs: {
  src: string;
  alt?: string | null;
  title?: string | null;
  width?: string | null;
}): JSONContent {
  return {
    type: "image",
    attrs: {
      src: attrs.src,
      alt: attrs.alt ?? null,
      title: attrs.title ?? null,
      width: attrs.width ?? null,
    },
  };
}

function markWrapped(
  children: PhrasingContent[],
  markType: string,
  attrs?: Record<string, unknown>,
): JSONContent[] {
  const content = inlineChildren(children);
  const marks: NonNullable<JSONContent["marks"]> = attrs
    ? [{ type: markType, attrs }]
    : [{ type: markType }];
  // A mark over a mixed run (e.g. **bold _italic_**) lands on every inner
  // text run — the only shape the TipTap JSON loader accepts (an empty text
  // node with content throws in Node.fromJSON and drops the document).
  return applyInlineMarks(content, marks);
}

// Definition lists parse as a single paragraph whose later lines all start
// with a ": " marker (Pandoc style). The block model classifies these as an
// opaque "definitionList" block; here we mirror that so WYSIWYG renders them
// as a read-only leaf instead of a soft-wrapped paragraph. The raw text is
// sliced from the source so any inline formatting on the term is preserved.
function isDefinitionListText(text: string): boolean {
  const lines = text.split("\n");
  if (lines.length < 2) return false;
  if (/^\s*:\s+/.test(lines[0])) return false;
  return lines.slice(1).every((line) => /^\s*:\s+/.test(line));
}

// --- TipTap -> markdown ---------------------------------------------------

export function tiptapToMarkdown(doc: JSONContent): string {
  const content = doc.content ?? [];
  const mdast: FlowNode[] = [];
  let frontMatterRaw: string | null = null;

  for (const node of content) {
    if (isFrontmatter(node)) {
      frontMatterRaw = node.content?.[0]?.text ?? "";
    } else {
      const converted = tiptapToFlow(node);
      if (converted) mdast.push(converted);
    }
  }

  const root: Root = { type: "root", children: mdast as RootContent[] };
  const body = serializeAst(root);
  if (frontMatterRaw !== null) {
    const fm = frontMatterRaw.endsWith("\n") ? frontMatterRaw : `${frontMatterRaw}\n`;
    return fm + (body.length > 0 ? `\n${body}` : "");
  }
  return body;
}

function isFrontmatter(node: JSONContent): boolean {
  return node.type === "codeBlock" && node.attrs?.language === FRONTMATTER_LANG;
}

function tiptapToFlow(node: JSONContent): FlowNode | null {
  const flow = tiptapToFlowPlain(node);
  if (flow && isAlignableNodeType(node.type)) {
    const align = typeof node.attrs?.textAlign === "string" ? node.attrs.textAlign : null;
    if (align === "center" || align === "right") {
      return wrapAligned(flow, align);
    }
  }
  return flow;
}

function tiptapToFlowPlain(node: JSONContent): FlowNode | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        depth: clampLevel(node.attrs?.level),
        children: tiptapInline(node),
      };
    case "paragraph":
      return { type: "paragraph", children: tiptapInline(node) };
    case "blockquote":
      return { type: "blockquote", children: tiptapBlockChildren(node) };
    case "bulletList":
      return {
        type: "list",
        ordered: false,
        spread: node.attrs?.tight === false,
        children: tiptapListItems(node),
      };
    case "orderedList":
      return {
        type: "list",
        ordered: true,
        start: node.attrs?.start ?? 1,
        spread: node.attrs?.tight === false,
        children: tiptapListItems(node),
      };
    case "codeBlock":
      return codeBlockToMdast(node);
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "table":
      return tableToMdast(node);
    case "footnoteDef":
      return {
        type: "footnoteDefinition",
        identifier: String(node.attrs?.label ?? ""),
        label: String(node.attrs?.label ?? ""),
        children: tiptapBlockChildren(node),
      };
    case "opaqueBlock":
      // Emit as a raw HTML block so the verbatim text is not re-escaped by the
      // serializer (which would corrupt formatted definition-list terms).
      return { type: "html", value: String(node.attrs?.raw ?? "") };
    default:
      return null;
  }
}

function clampLevel(level: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const n = typeof level === "number" ? level : 1;
  return Math.min(6, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4 | 5 | 6;
}

function codeBlockToMdast(node: JSONContent): FlowNode {
  const text = node.content?.map((c) => c.text ?? "").join("") ?? "";
  const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
  if (lang === "html") {
    return { type: "html", value: text };
  }
  return { type: "code", lang: lang || null, meta: null, value: text };
}

function tiptapListItems(node: JSONContent): ListItem[] {
  const items: ListItem[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "taskItem") {
      items.push({
        type: "listItem",
        checked: child.attrs?.checked === true,
        spread: false,
        children: tiptapBlockChildren(child),
      });
    } else if (child.type === "listItem") {
      items.push({ type: "listItem", spread: false, children: tiptapBlockChildren(child) });
    }
  }
  return items;
}

function tableToMdast(node: JSONContent): Table {
  const rows: TableRow[] = [];
  for (const row of node.content ?? []) {
    const cells: TableCell[] = [];
    for (const cell of row.content ?? []) {
      cells.push({
        type: "tableCell",
        children: tiptapInline(cell.content?.[0] ?? cell),
      });
    }
    rows.push({ type: "tableRow", children: cells });
  }
  return { type: "table", children: rows, align: [] };
}

function tiptapBlockChildren(node: JSONContent): Array<BlockContent | DefinitionContent> {
  const out: Array<BlockContent | DefinitionContent> = [];
  for (const child of node.content ?? []) {
    const converted = tiptapToFlow(child);
    if (converted) out.push(converted);
  }
  return out;
}

function tiptapInline(node: JSONContent): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const children = node.content ?? [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === "text") {
      // ProseMirror splits a styled run into one text node per distinct
      // mark set (e.g. **bold** and plain inside one font span). Group the
      // consecutive text nodes sharing the same font attribute set so a
      // single span wraps the whole run — the canonical, byte-stable form.
      const font = fontStyleOf(child);
      const group: JSONContent[] = [child];
      let j = i + 1;
      while (
        j < children.length &&
        children[j].type === "text" &&
        sameFontStyle(fontStyleOf(children[j]), font)
      ) {
        group.push(children[j]);
        j += 1;
      }
      out.push(...tiptapTextGroup(group));
      i = j;
      continue;
    }
    // Non-text, non-leaf inline content (defensive; paragraphs are flat).
    if (child.type === "hardBreak") {
      out.push({ type: "break" } as Break);
      i += 1;
      continue;
    }
    if (child.type === "image") {
      const src = typeof child.attrs?.src === "string" ? child.attrs.src : "";
      const alt = typeof child.attrs?.alt === "string" ? child.attrs.alt : null;
      const title = typeof child.attrs?.title === "string" ? child.attrs.title : null;
      const width = typeof child.attrs?.width === "string" ? child.attrs.width : null;
      // A width (plan 08 task 8.4, issue #79) has no markdown image-syntax
      // home, so it serializes as the canonical <img> HTML form; without a
      // width the image stays markdown syntax (source-of-truth preference).
      if (width) {
        out.push({ type: "html", value: renderImgHtml({ src, alt, title, width }) });
      } else {
        out.push({ type: "image", url: src, alt, title });
      }
      i += 1;
      continue;
    }
    if (child.type === "footnoteRef") {
      const label = String(child.attrs?.label ?? "");
      out.push({ type: "footnoteReference", identifier: label, label });
      i += 1;
      continue;
    }
    out.push(...tiptapInline(child));
    i += 1;
  }
  return out;
}

function fontStyleOf(node: JSONContent): FontSpanStyle {
  const style: FontSpanStyle = { fontFamily: null, fontSize: null, color: null };
  for (const mark of node.marks ?? []) {
    if (mark.type === "fontFamily" && typeof mark.attrs?.fontFamily === "string") {
      style.fontFamily = mark.attrs.fontFamily;
    } else if (mark.type === "fontSize" && typeof mark.attrs?.fontSize === "string") {
      style.fontSize = mark.attrs.fontSize;
    } else if (mark.type === "fontColor" && typeof mark.attrs?.color === "string") {
      style.color = mark.attrs.color;
    }
  }
  return style;
}

function sameFontStyle(a: FontSpanStyle, b: FontSpanStyle): boolean {
  return (
    a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.color === b.color
  );
}

// Canonical mark-nesting order, outermost first: the marks that can be
// factored out as a wrapper around a run every node shares. Font spans are
// applied by the caller (outside everything); code, sub/superscript, and the
// colorless highlight are literal text and never wrap.
const WRAPPABLE_MARKS = ["highlight", "underline", "link", "bold", "italic", "strike"];

// A highlight only wraps (as a colored span) when it carries a color; the
// colorless highlight is the ==text== literal.
function isWrappableMark(mark: { type: string; attrs?: Record<string, unknown> }): boolean {
  if (mark.type === "highlight") {
    return typeof mark.attrs?.color === "string" && mark.attrs.color !== "";
  }
  return (WRAPPABLE_MARKS as readonly string[]).includes(mark.type);
}

// The outermost mark (per WRAPPABLE_MARKS) present on every node with the
// same attributes — null when no such mark exists.
function sharedWrappableMark(nodes: JSONContent[]): { type: string; attrs?: Record<string, unknown> } | null {
  for (const type of WRAPPABLE_MARKS) {
    const first = (nodes[0].marks ?? []).find((m) => m.type === type);
    if (!first || !isWrappableMark(first)) continue;
    const firstAttrs = JSON.stringify(first.attrs ?? null);
    if (!nodes.every((n) => {
      const m = (n.marks ?? []).find((mm) => mm.type === type);
      return m !== undefined && JSON.stringify(m.attrs ?? null) === firstAttrs;
    })) continue;
    return { type, attrs: first.attrs as Record<string, unknown> | undefined };
  }
  return null;
}

// Stable identity of a text node's non-font marks (font marks are uniform
// within a group and handled by the caller). Used to split a run into
// maximal segments that share one mark set.
function markSetKey(node: JSONContent): string {
  return (node.marks ?? [])
    .filter((m) => m.type !== "fontFamily" && m.type !== "fontSize" && m.type !== "fontColor")
    .map((m) => `${m.type}:${JSON.stringify(m.attrs ?? null)}`)
    .join(",");
}

// Serializes a run of consecutive text nodes that share one font attribute
// set: the shared font style wraps the whole group in a single span
// (outermost layer) and the non-font marks are re-nested into structure.
function tiptapTextGroup(group: JSONContent[]): PhrasingContent[] {
  const font = fontStyleOf(group[0]);
  const body = reNest(group);
  if (!font.fontFamily && !font.fontSize && !font.color) return body;
  return [
    { type: "html", value: renderFontSpanOpen(font) },
    ...body,
    { type: "html", value: SPAN_CLOSE },
  ];
}

// Rebuilds markdown nesting from ProseMirror's flat "marks on text nodes"
// model. The outermost mark shared by every node is factored out as a
// wrapper and the inner run re-serialized without it; with no shared
// wrappable mark the run splits into maximal identical-mark-set segments —
// a segment carrying only literal marks (code, sub/sup, colorless
// highlight) serializes its joined text directly, otherwise it recurses.
function reNest(nodes: JSONContent[]): PhrasingContent[] {
  if (nodes.length === 0) return [];
  const shared = sharedWrappableMark(nodes);
  if (shared) {
    const inner = nodes.map((n) => ({
      ...n,
      marks: (n.marks ?? []).filter((m) => m.type !== shared.type),
    }));
    return wrapMarked(shared.type, shared.attrs, reNest(inner));
  }
  const out: PhrasingContent[] = [];
  let start = 0;
  for (let k = 1; k <= nodes.length; k++) {
    if (k === nodes.length || markSetKey(nodes[k]) !== markSetKey(nodes[start])) {
      const segment = nodes.slice(start, k);
      if (segment.some((n) => (n.marks ?? []).some((m) => isWrappableMark(m)))) {
        out.push(...reNest(segment));
      } else {
        const text = segment.map((n) => n.text ?? "").join("");
        out.push(...tiptapTextWithMarks(text, segment[0].marks ?? []));
      }
      start = k;
    }
  }
  return out;
}

// Wraps already-serialized phrasing content in one mark (the outermost
// shared-mark layer of reNest).
function wrapMarked(
  type: string,
  attrs: Record<string, unknown> | undefined,
  content: PhrasingContent[],
): PhrasingContent[] {
  switch (type) {
    case "bold":
      return [{ type: "strong", children: content }];
    case "italic":
      return [{ type: "emphasis", children: content }];
    case "strike":
      return [{ type: "delete", children: content }];
    case "link": {
      const url = typeof attrs?.href === "string" ? attrs.href : "";
      const title = typeof attrs?.title === "string" ? attrs.title : null;
      return [{ type: "link", url, title, children: content }];
    }
    case "underline":
      return [{ type: "html", value: "<u>" }, ...content, { type: "html", value: "</u>" }];
    case "highlight": {
      const color = typeof attrs?.color === "string" ? attrs.color : null;
      return [
        { type: "html", value: renderHighlightSpanOpen(color ?? "#ffff00") },
        ...content,
        { type: "html", value: SPAN_CLOSE },
      ];
    }
    default:
      return content;
  }
}

function tiptapTextWithMarks(
  text: string,
  marks: NonNullable<JSONContent["marks"]>,
): PhrasingContent[] {
  let current: PhrasingContent[] = text.length > 0 ? [{ type: "text", value: text }] : [];

  // Marks are emitted in a fixed nesting order (last wrap = outermost) so
  // the output is stable regardless of the mark order ProseMirror reports:
  // the syntax marks first, then underline and the highlight span, with the
  // font span applied by the caller around the whole grouped run.
  const byType = (type: string) => marks.find((m) => m.type === type);
  const ordered: NonNullable<JSONContent["marks"]> = [];
  for (const type of [
    "bold",
    "italic",
    "strike",
    "link",
    "subscript",
    "superscript",
    "code",
    "underline",
    "highlight",
  ]) {
    const mark = byType(type);
    if (mark) ordered.push(mark);
  }

  let highlightColor: string | null = null;

  for (const mark of ordered) {
    const type = mark.type;
    if (type === "bold") {
      current = [{ type: "strong", children: current }];
    } else if (type === "italic") {
      current = [{ type: "emphasis", children: current }];
    } else if (type === "strike") {
      current = [{ type: "delete", children: current }];
    } else if (type === "code") {
      const joined = current.map(plainTextOf).join("");
      current = [{ type: "inlineCode", value: joined }];
    } else if (type === "link") {
      const url = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      const title = typeof mark.attrs?.title === "string" ? mark.attrs.title : null;
      current = [{ type: "link", url, title, children: current }];
    } else if (type === "subscript") {
      const joined = current.map(plainTextOf).join("");
      current = [{ type: "text", value: `~${joined}~` }];
    } else if (type === "superscript") {
      const joined = current.map(plainTextOf).join("");
      current = [{ type: "text", value: `^${joined}^` }];
    } else if (type === "underline") {
      current = [{ type: "html", value: "<u>" }, ...current, { type: "html", value: "</u>" }];
    } else if (type === "highlight") {
      const color = typeof mark.attrs?.color === "string" ? mark.attrs.color : null;
      if (color) {
        highlightColor = color;
      } else {
        // Default (yellow) highlight keeps the ==text== syntax.
        const joined = current.map(plainTextOf).join("");
        current = [{ type: "text", value: `==${joined}==` }];
      }
    }
  }

  if (highlightColor) {
    current = [
      { type: "html", value: renderHighlightSpanOpen(highlightColor) },
      ...current,
      { type: "html", value: SPAN_CLOSE },
    ];
  }
  return current;
}

function plainTextOf(node: PhrasingContent): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return (node as Text | InlineCode).value;
  }
  if ("children" in node) {
    return node.children.map(plainTextOf).join("");
  }
  return "";
}
