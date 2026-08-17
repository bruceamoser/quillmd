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
import { parseFrontMatter, parseToAst, serializeAst } from "./markdown";

// Front matter is represented as a fenced code block with this marker language
// so the editor can render it as one atomic block while the converter knows to
// emit the raw YAML verbatim instead of a ``` fence.
export const FRONTMATTER_LANG = "frontmatter";

type FlowNode = BlockContent | DefinitionContent;

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
    const node = flowToTiptap(child as FlowNode);
    if (node) content.push(node);
  }

  return { type: "doc", content };
}

function flowToTiptap(node: FlowNode): JSONContent | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth },
        content: inlineChildren(node.children),
      };
    case "paragraph":
      return { type: "paragraph", content: inlineChildren(node.children) };
    case "blockquote":
      return blockquoteToTiptap(node);
    case "list":
      return listToTiptap(node);
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
    case "html":
      return {
        type: "codeBlock",
        attrs: { language: "html" },
        content: [{ type: "text", text: node.value }],
      };
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

function blockquoteToTiptap(node: Blockquote): JSONContent {
  const content: JSONContent[] = [];
  for (const child of node.children) {
    const converted = flowToTiptap(child);
    if (converted) content.push(converted);
  }
  return { type: "blockquote", content };
}

function listToTiptap(node: List): JSONContent {
  const content: JSONContent[] = [];
  for (const item of node.children) {
    const converted = listItemToTiptap(item);
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

function listItemToTiptap(node: ListItem): JSONContent | null {
  const children: JSONContent[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      children.push({ type: "paragraph", content: inlineChildren(child.children) });
    } else {
      const converted = flowToTiptap(child);
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
  for (const child of children) {
    const converted = inlineToTiptap(child);
    if (converted) out.push(converted);
  }
  return out;
}

function inlineToTiptap(node: PhrasingContent): JSONContent | null {
  switch (node.type) {
    case "text":
      return { type: "text", text: node.value };
    case "emphasis":
      return markWrapped(node.children, "italic");
    case "strong":
      return markWrapped(node.children, "bold");
    case "delete":
      return markWrapped(node.children, "strike");
    case "inlineCode":
      return { type: "text", text: node.value, marks: [{ type: "code" }] };
    case "link":
      return markWrapped(node.children, "link", { href: node.url });
    case "image":
      return {
        type: "image",
        attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
      };
    case "break":
      return { type: "hardBreak" };
    case "html":
      return { type: "text", text: node.value };
    case "linkReference":
      return markWrapped(node.children, "link", { href: node.identifier });
    case "imageReference":
      return {
        type: "image",
        attrs: { src: node.identifier, alt: node.alt ?? null },
      };
    default:
      return null;
  }
}

function markWrapped(
  children: PhrasingContent[],
  markType: string,
  attrs?: Record<string, unknown>,
): JSONContent {
  const content = inlineChildren(children);
  const marks = attrs ? [{ type: markType, attrs }] : [{ type: markType }];
  const first = content[0];
  if (content.length === 1 && first && first.type === "text") {
    return { type: "text", text: first.text ?? "", marks: [...(first.marks ?? []), ...marks] };
  }
  return { type: "text", text: "", marks, content };
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
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      out.push({ type: "break" } as Break);
      continue;
    }
    if (child.type === "image") {
      out.push({
        type: "image",
        url: typeof child.attrs?.src === "string" ? child.attrs.src : "",
        alt: typeof child.attrs?.alt === "string" ? child.attrs.alt : null,
        title: typeof child.attrs?.title === "string" ? child.attrs.title : null,
      });
      continue;
    }
    if (child.type === "text") {
      out.push(...tiptapTextWithMarks(child.text ?? "", child.marks ?? []));
      continue;
    }
    out.push(...tiptapInline(child));
  }
  return out;
}

function tiptapTextWithMarks(text: string, marks: NonNullable<JSONContent["marks"]>): PhrasingContent[] {
  let current: PhrasingContent[] = text.length > 0 ? [{ type: "text", value: text }] : [];

  for (const mark of marks) {
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
      current = [{ type: "link", url, children: current }];
    }
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
