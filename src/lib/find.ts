// WYSIWYG find engine (plan 07 task 7.1, issue #69).
//
// Searches the visible text of a ProseMirror doc with the Word/Docs option
// set: match case, whole word, regex. The doc is flattened to one string in
// which top-level blocks are joined by a single "\n" (so a term containing a
// newline can match across blocks), the matcher runs over that flat string,
// and every flat match is mapped back to a doc position range. The result is
// a SearchState: the panel drives it (next/prev only move the active index)
// and the decoration builder renders it (every match highlighted, the active
// match stronger). Replace (task 7.3) consumes the same ranges.

import type { Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchOptions {
  term: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
}

export interface NormalizedSearchOptions {
  term: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

// One match, in doc positions. `block` is the top-level block index containing
// the match start; `crossBlock` is true when the match covers text of more
// than one top-level block (highlighted, but replace must refuse it).
export interface SearchMatch {
  from: number;
  to: number;
  block: number;
  crossBlock: boolean;
}

export interface SearchState {
  term: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  matches: SearchMatch[];
  // Index of the active match, -1 when there are no matches.
  active: number;
}

// CSS classes for the inline decorations (styled in App.css).
export const FIND_MATCH_CLASS = "quillmd-find-match";
export const FIND_CURRENT_CLASS = "quillmd-find-current";

export function normalizeOptions(options: SearchOptions): NormalizedSearchOptions {
  return {
    term: options.term,
    matchCase: options.matchCase ?? false,
    wholeWord: options.wholeWord ?? false,
    useRegex: options.useRegex ?? false,
  };
}

// Compiles the search term to the global RegExp the matcher runs. Plain mode
// escapes the term so it is a literal; regex mode compiles the term as-is and
// reports the engine's error message so the panel can show it inline.
export function compileSearch(options: SearchOptions): {
  regex: RegExp | null;
  error: string | null;
} {
  const norm = normalizeOptions(options);
  if (norm.term.length === 0) return { regex: null, error: null };
  const flags = `g${norm.matchCase ? "" : "i"}`;
  try {
    const pattern = norm.useRegex ? norm.term : escapeRegExp(norm.term);
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (err) {
    return {
      regex: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR_RE.test(ch);
}

interface FlatSegment {
  text: string;
  from: number;
  to: number;
  block: number;
}

interface FlatDoc {
  text: string;
  segments: FlatSegment[];
  // Flat start offset of each segment inside `text`.
  starts: number[];
  // For every flat character, the index of the segment it belongs to. The
  // separator "\n" after segment i is attributed to i (it is not a document
  // character; a match ending on it ends at segment i's end).
  segmentAt: Int32Array;
}

// Flattens the doc's text nodes into one string, remembering each segment's
// doc range and top-level block. Atom nodes (opaque blocks, footnote refs)
// carry no text and contribute nothing.
function flattenDoc(doc: Node): FlatDoc {
  const segments: FlatSegment[] = [];
  // The doc node has no opening token in the document's position space: its
  // content starts at position 0, unlike every other node (content at
  // pos + 1).
  doc.forEach((child, contentOffset, index) => {
    walkBlock(child, contentOffset, index, segments);
  });

  // Segments of one block concatenate directly; a top-level block boundary
  // is the single "\n" between the last segment of one block and the first
  // of the next (textless blocks still count as a boundary).
  const starts: number[] = [];
  const segmentAt: number[] = [];
  let text = "";
  segments.forEach((s, i) => {
    if (i > 0 && s.block !== segments[i - 1].block) {
      segmentAt.push(i - 1); // the separator
      text += "\n";
    }
    starts.push(text.length);
    text += s.text;
    for (let j = 0; j < s.text.length; j += 1) segmentAt.push(i);
  });
  return { text, segments, starts, segmentAt: Int32Array.from(segmentAt) };
}

function walkBlock(node: Node, pos: number, block: number, segments: FlatSegment[]): void {
  if (node.isText) {
    segments.push({ text: node.text ?? "", from: pos, to: pos + node.nodeSize, block });
    return;
  }
  if (node.isAtom) return;
  node.forEach((child, contentOffset) => {
    walkBlock(child, pos + 1 + contentOffset, block, segments);
  });
}

// Doc position of flat character k (k in [0, text.length)). A separator
// character maps to the end of the segment it follows.
function docPosAt(flat: FlatDoc, k: number): number {
  const i = flat.segmentAt[k];
  const s = flat.segments[i];
  if (k - flat.starts[i] >= s.text.length) return s.to;
  return s.from + (k - flat.starts[i]);
}

function blockAt(flat: FlatDoc, k: number): number {
  return flat.segments[flat.segmentAt[k]].block;
}

// Runs the matcher over the doc and builds the SearchState. Invalid regex
// terms (and empty terms) yield an empty match list, never a throw.
export function searchDoc(doc: Node, options: SearchOptions): SearchState {
  const norm = normalizeOptions(options);
  const state: SearchState = {
    term: norm.term,
    matchCase: norm.matchCase,
    wholeWord: norm.wholeWord,
    useRegex: norm.useRegex,
    matches: [],
    active: -1,
  };
  if (norm.term.length === 0) return state;

  const compiled = compileSearch(norm);
  if (compiled.regex === null) return state;
  const regex = compiled.regex;

  const flat = flattenDoc(doc);
  if (flat.text.length === 0) return state;

  regex.lastIndex = 0;
  for (let m = regex.exec(flat.text); m !== null; m = regex.exec(flat.text)) {
    const start = m.index;
    const end = start + m[0].length;

    if (
      norm.wholeWord &&
      (isWordChar(flat.text.charAt(start - 1)) || isWordChar(flat.text.charAt(end)))
    ) {
      if (m[0].length === 0) regex.lastIndex = start + 1;
      continue;
    }

    const match: SearchMatch =
      end > start
        ? {
            from: docPosAt(flat, start),
            to: docPosAt(flat, end - 1) + 1,
            block: blockAt(flat, start),
            crossBlock: flat.segmentAt[start] !== flat.segmentAt[end - 1],
          }
        : {
            from: docPosAt(flat, Math.min(start, flat.text.length - 1)),
            to: docPosAt(flat, Math.min(start, flat.text.length - 1)),
            block: blockAt(flat, Math.min(start, flat.text.length - 1)),
            crossBlock: false,
          };
    state.matches.push(match);
    // Zero-length matches (regex like "a*") would re-match at the same index
    // forever; step past them.
    if (m[0].length === 0) regex.lastIndex = start + 1;
  }

  if (state.matches.length > 0) state.active = 0;
  return state;
}

// Moves the active match forward (wrapping). No matches: unchanged (active
// stays -1). With matches but none active yet: the first match.
export function nextMatch(state: SearchState): SearchState {
  if (state.matches.length === 0) return state;
  const active = state.active < 0 ? 0 : (state.active + 1) % state.matches.length;
  return { ...state, active };
}

// Moves the active match backward (wrapping).
export function prevMatch(state: SearchState): SearchState {
  if (state.matches.length === 0) return state;
  const n = state.matches.length;
  const active = state.active < 0 ? n - 1 : (state.active - 1 + n) % n;
  return { ...state, active };
}

// Inline decorations for the state: every match gets the yellow highlight,
// the active match the stronger orange. The doc is only used to size the
// DecorationSet; ranges come from the state.
export function matchDecorations(doc: Node, state: SearchState): DecorationSet {
  const decos: Decoration[] = [];
  state.matches.forEach((m, i) => {
    if (m.to <= m.from) return;
    const cls =
      i === state.active ? `${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}` : FIND_MATCH_CLASS;
    // `attrs` styles the rendered spans; the spec carries the same class as
    // public data so consumers (panel scroll-to-match, tests) can read it
    // without touching the DOM.
    decos.push(Decoration.inline(m.from, m.to, { class: cls }, { class: cls }));
  });
  return DecorationSet.create(doc, decos);
}
