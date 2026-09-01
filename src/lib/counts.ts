// Word count (plan 09 task 9.4, issue #87): the shared counting rules for the
// status bar and the Word Count dialog, so the two surfaces always agree
// (plan 09 AC3). The status bar shows words and characters (with spaces);
// the dialog shows the full set: words, characters (with and without
// spaces), sentences, paragraphs, and reading time at 200 wpm.
//
// Rules (the status-bar rule for words is preserved exactly — the dialog
// must match the status bar for the whole document):
//   words      — whitespace-split of the trimmed text ("a  b\nc" is 3,
//                empty/whitespace-only text is 0)
//   chars      — the text length, with spaces
//   no spaces  — the text length with every whitespace character removed
//   sentences  — the runs separated at a sentence terminator (. ! ?) that is
//                followed by whitespace; empty/whitespace-only text is 0
//   paragraphs — the block count: blank-line-separated blocks of the source
//                for a whole document; for a selection, the textblocks the
//                selection range touches (countSelection, below)
//   reading    — the words at 200 wpm, rounded up; 0 words is 0 minutes
//
// Selection scoping: a non-collapsed WYSIWYG selection counts the selected
// text range — its words/chars/sentences from the extracted text (blocks
// joined with a single newline) and its paragraph count from the document
// (the textblocks the range touches), since the flattened text cannot
// recover block boundaries on its own.

import type { Node } from "@tiptap/pm/model";

export interface TextCounts {
  words: number;
  // Characters with spaces (the raw text length).
  chars: number;
  // Characters with every whitespace character removed.
  charsNoSpaces: number;
  sentences: number;
  paragraphs: number;
  readingMinutes: number;
}

// Words per minute for the reading-time estimate (plan 09 §2.2).
export const READING_WPM = 200;

// Word count: whitespace-split of the trimmed text — the same rule the
// status bar uses, so the status bar, the Info panel, and the dialog always
// agree.
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

// Characters with spaces: the raw text length.
export function countChars(text: string): number {
  return text.length;
}

// Characters without spaces: every whitespace character removed.
export function countCharsNoSpaces(text: string): number {
  return text.replace(/\s/g, "").length;
}

// Sentences: the runs separated at a sentence terminator followed by
// whitespace ("End. Next" is 2, "End" is 1, "a.b" is 1 — no terminator
// before the whitespace means no break). Empty/whitespace-only text is 0.
export function countSentences(text: string): number {
  if (text.trim().length === 0) return 0;
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((segment) => segment.trim().length > 0)
    .length;
}

// Paragraphs as the block count of a flat text: the blank-line-separated
// blocks that carry non-whitespace content. A trailing newline adds no
// phantom block ("a\n" is 1 block, "a\n\n" is 1, "a\n\nb" is 2). The
// separator matches LF and CRLF line endings (Windows is first-class) and
// tolerates whitespace-only separator lines ("a\n \nb" is 2 blocks).
export function countParagraphs(text: string): number {
  let blocks = 0;
  for (const block of text.split(/\r?\n[ \t]*\r?\n/)) {
    if (block.trim().length > 0) blocks += 1;
  }
  return blocks;
}

// Reading time at 200 wpm, rounded up; 0 words is 0 minutes.
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.ceil(words / READING_WPM);
}

// The reading-time readout ("0 min", "1 min", "3 min").
export function formatReadingTime(minutes: number): string {
  return `${minutes} min`;
}

// The full count set for a flat text (the whole document's live source).
export function countText(text: string): TextCounts {
  const words = countWords(text);
  return {
    words,
    chars: countChars(text),
    charsNoSpaces: countCharsNoSpaces(text),
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    readingMinutes: readingMinutes(words),
  };
}

// The number of textblock nodes (paragraphs, headings, list-item and table
// paragraphs, code blocks) a [from, to) document range touches. The walk
// starts at the doc's children (positioned from 0, like the alignable-block
// walk in editorCommands.ts) and stops recursing into a textblock it counts:
// a counted block is one paragraph, however deep its inlines sit.
export function paragraphsInRange(doc: Node, from: number, to: number): number {
  let count = 0;
  const walk = (node: Node, pos: number): void => {
    // No intersection with [from, to).
    if (!(pos < to && pos + node.nodeSize > from)) return;
    if (node.isTextblock) {
      count += 1;
      return;
    }
    let offset = 0;
    node.forEach((child) => {
      walk(child, pos + 1 + offset);
      offset += child.nodeSize;
    });
  };
  let offset = 0;
  doc.forEach((child) => {
    walk(child, offset);
    offset += child.nodeSize;
  });
  return count;
}

// The full count set for a document range (selection scoping). Words, chars,
// and sentences come from the extracted text (blocks joined with a single
// newline — textBetween's separator defaults to the empty string, so it must
// be passed explicitly, the same as find.ts does — so a cross-block
// selection keeps the newline); paragraphs come from the document, where the
// flattened text cannot recover block boundaries.
export function countSelection(doc: Node, from: number, to: number): TextCounts {
  const base = countText(doc.textBetween(from, to, "\n"));
  return { ...base, paragraphs: paragraphsInRange(doc, from, to) };
}
