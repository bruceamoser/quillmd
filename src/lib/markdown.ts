// Markdown engine: parse .md into a block-granular document model and
// serialize ASTs back to canonical markdown. The block model is what the
// clean-path pipeline splices; unified/micromark power the editable AST.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import type { Root } from "mdast";

import type {
  BlockKind,
  BlockSpan,
  FrontMatter,
  FrontMatterField,
  MarkdownDocument,
  ParseWarning,
} from "./types";
import manifestJson from "../../fixtures/normalization-manifest.json";

// --- manifest -------------------------------------------------------------

export const NORMALIZATION_MANIFEST = manifestJson as unknown as {
  version: number;
  updated: string;
  note: string;
  manifest: Array<{ id: string; construct: string }>;
};

// Mapping from a construct name to its manifest id, so tests can assert a
// construct is (or is not) on the whitelist.
export function manifestIdForConstruct(construct: string): string | null {
  for (const entry of NORMALIZATION_MANIFEST.manifest) {
    if (entry.construct === construct) {
      return entry.id;
    }
  }
  return null;
}

export function isNormalizable(construct: string): boolean {
  return manifestIdForConstruct(construct) !== null;
}

// --- low-level line helpers ----------------------------------------------

function skipToNextLine(source: string, i: number): number {
  while (i < source.length && source[i] !== "\n") i += 1;
  return i < source.length ? i + 1 : i;
}

function isBlankLine(source: string, start: number): boolean {
  let i = start;
  while (i < source.length && source[i] !== "\n") {
    if (source[i] !== " " && source[i] !== "\t") return false;
    i += 1;
  }
  return true;
}

function skipBlankLines(source: string, i: number): number {
  while (i < source.length) {
    const end = skipToNextLine(source, i);
    if (!isBlankLine(source, i)) return i;
    i = end;
  }
  return i;
}

// Counts the number of characters of indentation (spaces or tabs) at the
// start of a line. Tabs count as 4 columns for code-fence purposes.
function leadingIndent(source: string, start: number): number {
  let i = start;
  let cols = 0;
  while (i < source.length && source[i] !== "\n") {
    if (source[i] === " ") cols += 1;
    else if (source[i] === "\t") cols += 4;
    else break;
    i += 1;
  }
  return cols;
}

// Returns the fence info: `{ char, length, contentStart }` if the line at
// `start` opens a fenced code block, otherwise null.
function fenceInfo(
  source: string,
  start: number,
): { char: string; length: number; contentStart: number } | null {
  if (leadingIndent(source, start) > 3) return null;
  let i = start;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i += 1;
  const fenceChar = source[i];
  if (fenceChar !== "`" && fenceChar !== "~") return null;
  let j = i;
  while (j < source.length && source[j] === fenceChar) j += 1;
  const length = j - i;
  if (length < 3) return null;
  return { char: fenceChar, length, contentStart: skipToNextLine(source, i) };
}

function isClosingFence(
  source: string,
  start: number,
  char: string,
  length: number,
): boolean {
  if (leadingIndent(source, start) > 3) return false;
  let i = start;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i += 1;
  if (source[i] !== char) return false;
  let j = i;
  while (j < source.length && source[j] === char) j += 1;
  const count = j - i;
  if (count < length) return false;
  while (j < source.length && source[j] !== "\n") {
    if (source[j] !== " " && source[j] !== "\t") return false;
    j += 1;
  }
  return true;
}

// CommonMark HTML block-level tag names (type 6 blocks).
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body",
  "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header",
  "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem",
  "nav", "noframes", "ol", "optgroup", "option", "p", "param", "search",
  "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead",
  "title", "tr", "track", "ul",
]);

// Type 1 tags: raw text blocks terminated by a matching closing tag.
const RAW_TAGS = new Set(["script", "pre", "style", "textarea"]);

interface HtmlOpen {
  kind: "raw" | "comment" | "pi" | "decl" | "cdata" | "block" | "other";
  tag?: string;
}

function htmlOpenAt(source: string, start: number): HtmlOpen | null {
  if (leadingIndent(source, start) > 3) return null;
  let i = start;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i += 1;
  if (source[i] !== "<") return null;
  const rest = source.slice(i);
  if (rest.startsWith("<!--")) return { kind: "comment" };
  if (rest.startsWith("<?")) return { kind: "pi" };
  if (rest.startsWith("<![CDATA[")) return { kind: "cdata" };
  if (rest.startsWith("<!") && rest.length > 2 && /[A-Z]/.test(rest[2] ?? "")) {
    return { kind: "decl" };
  }
  if (rest.startsWith("</")) return { kind: "block" };
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  if (RAW_TAGS.has(tag)) return { kind: "raw", tag };
  if (BLOCK_TAGS.has(tag)) return { kind: "block" };
  return { kind: "other" };
}

// --- block segmentation ---------------------------------------------------

// Scans a block starting at `start`, returning the offset just past the
// block. Handles fenced code and HTML blocks (which may contain blank
// lines); everything else is terminated by the next blank line.
function findBlockEnd(source: string, start: number): number {
  const fence = fenceInfo(source, start);
  if (fence) {
    let i = fence.contentStart;
    while (i < source.length) {
      if (isClosingFence(source, i, fence.char, fence.length)) {
        return skipToNextLine(source, i);
      }
      i = skipToNextLine(source, i);
    }
    return source.length;
  }

  const html = htmlOpenAt(source, start);
  if (html) {
    let i = start;
    const terminator = terminatorFor(html);
    if (terminator) {
      while (i < source.length) {
        const end = skipToNextLine(source, i);
        const line = source.slice(i, end);
        if (line.includes(terminator)) return end;
        i = end;
      }
      return source.length;
    }
    // Block and other tags end at the next blank line.
    while (i < source.length) {
      const end = skipToNextLine(source, i);
      if (isBlankLine(source, i)) return i;
      i = end;
    }
    return source.length;
  }

  let i = start;
  while (i < source.length) {
    if (isBlankLine(source, i)) return i;
    i = skipToNextLine(source, i);
  }
  return source.length;
}

function terminatorFor(html: HtmlOpen): string | null {
  switch (html.kind) {
    case "raw":
      return `</${html.tag ?? ""}`;
    case "comment":
      return "-->";
    case "pi":
      return "?>";
    case "cdata":
      return "]]>";
    case "decl":
      return ">";
    default:
      return null;
  }
}

export function segmentBlocks(source: string): BlockSpan[] {
  const blocks: BlockSpan[] = [];
  let i = 0;
  let index = 0;
  while (i < source.length) {
    i = skipBlankLines(source, i);
    if (i >= source.length) break;
    const start = i;
    const end = findBlockEnd(source, start);
    const text = source.slice(start, end);
    blocks.push({
      index,
      start,
      end,
      text,
      kind: classifyBlock(text),
    });
    index += 1;
    i = end;
  }
  return blocks;
}

// --- block classification -------------------------------------------------

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
const SETEXT_RE = /^\s{0,3}(=+|-+)\s*$/;
const THEMATIC_RE = /^\s{0,3}(\*[ \t]*){3,}$|^\s{0,3}(-[ \t]*){3,}$|^\s{0,3}(_[ \t]*){3,}$/;
const UL_MARKER_RE = /^\s{0,3}([-+*])(\s|$)/;
const OL_MARKER_RE = /^\s{0,3}\d{1,9}[.)](\s|$)/;
const REF_DEF_RE = /^\s{0,3}\[([^\]^][^\]]*)\]:\s*(\S.*|)$/;
const FOOTNOTE_DEF_RE = /^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/;
const DEF_LIST_RE = /^\s{0,3}:\s+/;
const TABLE_DELIM_RE = /^\s*\|?[\s:|-]*\|[\s:|-]*\|?[\s:|-]*$/;

function linesOf(text: string): string[] {
  const raw = text.split("\n");
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  return raw;
}

export function classifyBlock(text: string): BlockKind {
  const lines = linesOf(text);
  const first = lines[0] ?? "";

  if (FENCE_RE.test(first)) return "code";

  // Single thematic-break candidate wins before paragraph/heading.
  if (lines.length === 1 && THEMATIC_RE.test(first)) return "thematicBreak";

  // Footnote definitions: every line starts with [^label]:
  if (lines.length > 0 && lines.every((l) => FOOTNOTE_DEF_RE.test(l))) {
    return "footnoteDefinition";
  }

  // Link reference definitions: every line is [label]: dest.
  if (lines.length > 0 && lines.every((l) => REF_DEF_RE.test(l))) {
    return "linkReferenceDefinition";
  }

  // Definition list: a term line followed by one or more ": definition" lines.
  if (
    lines.length > 1 &&
    !DEF_LIST_RE.test(first) &&
    lines.slice(1).every((l) => DEF_LIST_RE.test(l))
  ) {
    return "definitionList";
  }

  if (ATX_RE.test(first)) return "heading";

  // Setext heading: text line(s) then an all "=" or "-" underline.
  if (
    lines.length >= 2 &&
    SETEXT_RE.test(lines[lines.length - 1]) &&
    !THEMATIC_RE.test(lines[lines.length - 1])
  ) {
    return "setextHeading";
  }

  if (lines.length === 1 && SETEXT_RE.test(first)) {
    // A lone "-" or "=" line is not meaningful; treat as thematic break for
    // "-" and paragraph for "=" to avoid misclassifying HR-like content.
    if (/^\s{0,3}-+\s*$/.test(first)) return "thematicBreak";
  }

  if (htmlOpenAt(first, 0) !== null) return "html";

  if (first.trimStart().startsWith(">")) return "blockquote";

  if (UL_MARKER_RE.test(first) || OL_MARKER_RE.test(first)) return "list";

  // Table: first line has pipes and a later line is a delimiter row.
  if (
    first.includes("|") &&
    lines.some(
      (l) => TABLE_DELIM_RE.test(l) && l.includes("-") && !l.trimStart().startsWith("|"),
    )
  ) {
    return "table";
  }
  if (first.includes("|") && lines.length >= 2 && /^\s*\|?[\s:|-]+\|/.test(lines[1] ?? "")) {
    return "table";
  }

  if (leadingIndent(text, 0) >= 4) return "code";

  return "paragraph";
}

// --- front matter ---------------------------------------------------------

export function parseFrontMatter(source: string): FrontMatter | null {
  if (!source.startsWith("---")) return null;
  const firstLineEnd = source.indexOf("\n");
  if (firstLineEnd < 0) return null;
  const firstLine = source.slice(0, firstLineEnd);
  if (!/^-{3}\s*$/.test(firstLine)) return null;

  let i = firstLineEnd + 1;
  while (i < source.length) {
    const end = source.indexOf("\n", i);
    const lineEnd = end < 0 ? source.length : end;
    const line = source.slice(i, lineEnd);
    if (/^(-{3}|\.{3})\s*$/.test(line)) {
      const closeEnd = end < 0 ? source.length : end + 1;
      const raw = source.slice(0, closeEnd);
      return {
        start: 0,
        end: closeEnd,
        raw,
        fields: parseFrontMatterFields(source, firstLineEnd + 1, lineEnd),
      };
    }
    if (end < 0) break;
    i = end + 1;
  }
  return null;
}

function parseFrontMatterFields(
  source: string,
  bodyStart: number,
  bodyEnd: number,
): FrontMatterField[] {
  const fields: FrontMatterField[] = [];
  let i = bodyStart;
  while (i < bodyEnd) {
    const end = source.indexOf("\n", i);
    const lineEnd = end < 0 ? bodyEnd : end;
    const line = source.slice(i, lineEnd);
    const colon = line.indexOf(":");
    if (colon >= 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      const name = line.slice(0, colon).trim();
      let valueStart = i + colon + 1;
      while (valueStart < lineEnd && (source[valueStart] === " " || source[valueStart] === "\t")) {
        valueStart += 1;
      }
      let valueEnd = lineEnd;
      while (valueEnd > valueStart && (source[valueEnd - 1] === " " || source[valueEnd - 1] === "\t")) {
        valueEnd -= 1;
      }
      if (name.length > 0) {
        fields.push({
          name,
          value: source.slice(valueStart, valueEnd),
          valueStart,
          valueEnd,
          line: i,
        });
      }
    }
    if (end < 0) break;
    i = end + 1;
  }
  return fields;
}

// Byte-splices a single front-matter field value in place, leaving every
// other byte (including other fields and all formatting) untouched.
export function editFrontMatterField(
  source: string,
  fieldName: string,
  newValue: string,
): string {
  const fm = parseFrontMatter(source);
  if (!fm) return source;
  const field = fm.fields.find((f) => f.name === fieldName);
  if (!field) return source;
  return (
    source.slice(0, field.valueStart) +
    newValue +
    source.slice(field.valueEnd)
  );
}

// --- full document model --------------------------------------------------

export function parseMarkdown(source: string): MarkdownDocument {
  const warnings: ParseWarning[] = [];
  const frontMatter = parseFrontMatter(source);

  const bodyStart = frontMatter ? frontMatter.end : 0;
  const body = source.slice(bodyStart);

  const blocks: BlockSpan[] = [];
  if (frontMatter) {
    blocks.push({
      index: 0,
      start: 0,
      end: frontMatter.end,
      text: frontMatter.raw,
      kind: "frontmatter",
    });
  }

  const bodyBlocks = segmentBlocks(body);
  for (const b of bodyBlocks) {
    const start = bodyStart + b.start;
    const end = bodyStart + b.end;
    if (end > start) {
      blocks.push({
        index: blocks.length,
        start,
        end,
        text: b.text,
        kind: b.kind,
      });
    }
  }

  // Warn about unclosed fences so the pipeline can fall back to raw write.
  warnUnclosedFences(source, blocks, warnings);

  return { source, blocks, frontMatter, warnings };
}

function warnUnclosedFences(
  source: string,
  blocks: BlockSpan[],
  warnings: ParseWarning[],
): void {
  for (const b of blocks) {
    const first = linesOf(b.text)[0] ?? "";
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(first);
    if (m) {
      const char = m[1][0];
      const length = m[1].length;
      const inner = source.slice(b.start, b.end).split("\n").slice(1);
      const hasClose = inner.some((line) => {
        const t = line.trimEnd();
        return (
          t.length >= length &&
          t[0] === char &&
          t.split("").every((c) => c === char || c === " " || c === "\t")
        );
      });
      if (!hasClose && !b.text.endsWith("\n")) {
        warnings.push({ index: b.index, message: "unclosed fenced code block" });
      }
    }
  }
}

// --- AST parse/serialize (unified + micromark) ---------------------------

export function parseToAst(source: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.parse(source) as Root;
}

export function serializeAst(root: Root): string {
  return toMarkdown(root, {
    extensions: [gfmToMarkdown()],
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fence: "```" as "`" | "~",
    listItemIndent: "one",
  });
}

// Re-parses `source` and reports any micromark messages that surfaced while
// building the AST. Used by the dirty-parse fallback gate.
export function parseWarnings(source: string): string[] {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const messages: string[] = [];
  processor.parse(source);
  // Capture processor warnings by re-processing with a message sink.
  try {
    const file = unified().use(remarkParse).use(remarkGfm).use(function noteWarn() {
      return (_tree: unknown, file: { messages: Array<{ reason: string }> }) => {
        for (const msg of file.messages) messages.push(msg.reason);
      };
    }).processSync(source);
    void file;
  } catch {
    // Parse errors already surface via parseMarkdown warnings.
  }
  return messages;
}
