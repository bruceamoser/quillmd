// Shared document-model types for the QuillMD markdown engine.
// These types cross the pipeline boundary (markdown.ts <-> pipeline.ts
// <-> undo.ts) and must stay `any`-free.

export type Eol = "lf" | "crlf";

// The class of a top-level source block. Blocks drive the clean-path
// splice: untouched blocks are emitted verbatim, edited blocks are
// re-serialized and spliced in at their original byte offsets.
export type BlockKind =
  | "frontmatter"
  | "heading"
  | "setextHeading"
  | "paragraph"
  | "code"
  | "list"
  | "blockquote"
  | "thematicBreak"
  | "html"
  | "table"
  | "linkReferenceDefinition"
  | "footnoteDefinition"
  | "definitionList"
  | "opaque";

export interface BlockSpan {
  index: number;
  // Character offsets into the decoded source string (BOM stripped).
  start: number;
  end: number;
  // Verbatim source text for this block.
  text: string;
  kind: BlockKind;
}

export interface ParseWarning {
  index: number;
  message: string;
}

export interface FrontMatterField {
  name: string;
  // Raw value text as it appears on the line (after "name:"), trimmed of
  // leading/trailing whitespace for editing but byte-range for splicing.
  value: string;
  valueStart: number;
  valueEnd: number;
  line: number;
}

export interface FrontMatter {
  start: number;
  end: number;
  raw: string;
  fields: FrontMatterField[];
}

export interface MarkdownDocument {
  // Decoded source text (BOM stripped, original EOL preserved verbatim).
  source: string;
  blocks: BlockSpan[];
  frontMatter: FrontMatter | null;
  warnings: ParseWarning[];
}

// --- normalization manifest (fixtures/normalization-manifest.json) --------
export interface ManifestEntry {
  id: string;
  construct: string;
  example: string;
  behavior: string;
  justification: string;
  user_visible: string;
  feature: string;
}

export interface Manifest {
  version: number;
  updated: string;
  note: string;
  manifest: ManifestEntry[];
}
