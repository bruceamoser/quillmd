// Clean-path save pipeline. The single most important guarantee of QuillMD:
// an unmodified document is written back verbatim (never re-serialized), and
// an edited document is re-serialized block-granularly, splicing only the
// dirty blocks into the original source at their byte offsets.

import { parseMarkdown } from "./markdown";
import type { BlockSpan, Eol, MarkdownDocument } from "./types";

export interface BlockEdit {
  index: number;
  text: string;
}

export type SaveKind = "verbatim" | "splice" | "raw";

export interface SaveResult {
  kind: SaveKind;
  text: string;
}

// Wraps a decoded source string into a document model (parse + block map).
export function createDocument(source: string): MarkdownDocument {
  return parseMarkdown(source);
}

// Aligns the original block map against a freshly parsed "current" text and
// returns the blocks whose text changed. Returns null when the structure
// changed too much to splice safely (block count differs), in which case the
// caller falls back to a raw write.
export function computeBlockEdits(
  model: MarkdownDocument,
  current: MarkdownDocument,
): BlockEdit[] | null {
  if (model.blocks.length !== current.blocks.length) return null;
  const edits: BlockEdit[] = [];
  for (let i = 0; i < model.blocks.length; i += 1) {
    const before = model.blocks[i];
    const after = current.blocks[i];
    if (before.text !== after.text) {
      edits.push({ index: i, text: after.text });
    }
  }
  return edits;
}

// Splices the edited blocks' new text into the original source, preserving
// every untouched block and all inter-block whitespace byte-exactly.
export function spliceBlocks(model: MarkdownDocument, edits: BlockEdit[]): string {
  const replacements = new Map<number, string>();
  for (const e of edits) replacements.set(e.index, e.text);

  let out = "";
  let prevEnd = 0;
  for (const block of model.blocks) {
    out += model.source.slice(prevEnd, block.start);
    out += replacements.has(block.index) ? replacements.get(block.index) as string : block.text;
    prevEnd = block.end;
  }
  out += model.source.slice(prevEnd);
  return out;
}

// Runs the full clean-path decision:
//   1. Unmodified text -> verbatim (the §2.1.4 guarantee).
//   2. Parse warnings -> raw source text (dirty-parse fallback, never mutate).
//   3. Otherwise -> block-granular splice.
export function saveDocument(model: MarkdownDocument, currentText: string): SaveResult {
  if (currentText === model.source) {
    return { kind: "verbatim", text: model.source };
  }

  const current = parseMarkdown(currentText);
  if (model.warnings.length > 0 || current.warnings.length > 0) {
    return { kind: "raw", text: currentText };
  }

  const edits = computeBlockEdits(model, current);
  if (edits === null) {
    return { kind: "raw", text: currentText };
  }
  if (edits.length === 0) {
    // Only inter-block whitespace changed; preserve the edit without
    // re-serializing any block by writing the raw current text.
    return { kind: "raw", text: currentText };
  }
  return { kind: "splice", text: spliceBlocks(model, edits) };
}

// Encodes a document string back to bytes for the disk write, restoring the
// detected BOM and normalizing to the dominant line ending (single-EOL policy,
// spec §2.3.5). The verbatim path bypasses this entirely and writes the
// original bytes.
export function encodeDocument(
  text: string,
  opts: { eol: Eol; bom: boolean },
): Uint8Array {
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (opts.eol === "crlf") {
    normalized = normalized.replace(/\n/g, "\r\n");
  }
  const withBom = opts.bom ? "\uFEFF" + normalized : normalized;
  return new TextEncoder().encode(withBom);
}

// Helper for tests/UI: describe the unchanged block spans.
export function untouchedBlockOffsets(model: MarkdownDocument, edits: BlockEdit[]): BlockSpan[] {
  const dirty = new Set(edits.map((e) => e.index));
  return model.blocks.filter((b) => !dirty.has(b.index));
}
