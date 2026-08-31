// Source-view find & replace (plan 07 task 7.4, issue #72).
//
// The find panel (task 7.2) is one object in both views: App owns
// { term, matchCase, wholeWord, useRegex, replaceTerm } and this module maps
// it 1:1 onto CodeMirror's built-in search state (a SearchQuery, applied with
// the setSearchQuery state effect), so the same term/options produce the same
// results in WYSIWYG and source and stay in sync across view switches. The
// parity of the two engines' match counts is asserted on the shared fixture
// in __tests__ (plan 07 §4 AC4).
//
// Wiring (the same single-subscriber bridge pattern as the WYSIWYG find
// editor bridge in find.ts):
//   * view provider — SourceView registers the live EditorView on mount and
//     unregisters on unmount; App applies the query, selects the active
//     match, and runs the replace transactions through the view.
//   * highlight state — a StateField + ViewPlugin in the source view render
//     the same quillmd-find-match / quillmd-find-current spans the WYSIWYG
//     decorations use, so the highlights look identical across views. App
//     turns the field on with the query (panel open) and off with null
//     (panel closed or another view). CodeMirror's own search highlighting
//     only draws while its own panel is open, which this app never shows, so
//     the plugin carries the highlights.
//
// Replace writes through the existing source-change pipeline: the replace
// transactions are dispatched on the view, the view's update listener fires
// SourceView's onChange, and App updates the doc text (dirty flag, save).

import {
  EditorSelection,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { search, SearchQuery } from "@codemirror/search";
import {
  FIND_CURRENT_CLASS,
  FIND_MATCH_CLASS,
  applyReplacement,
  normalizeOptions,
} from "./find";

export interface SourceFindOptions {
  term: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  replace?: string;
}

// One match in doc offsets, in document order.
export interface SourceMatch {
  from: number;
  to: number;
}

// The panel's options object maps 1:1 onto CodeMirror's search query (plan
// 07 §3): term -> search, matchCase -> caseSensitive, wholeWord -> wholeWord,
// useRegex -> regexp, replaceTerm -> replace. Plain mode sets `literal` so
// the term is matched byte-for-byte (no \n / \t unescaping) — the same
// literal semantics the WYSIWYG engine applies to a non-regex term.
export function toSearchQuery(options: SourceFindOptions): SearchQuery {
  return new SearchQuery({
    search: options.term,
    caseSensitive: options.matchCase ?? false,
    literal: !(options.useRegex ?? false),
    wholeWord: options.wholeWord ?? false,
    regexp: options.useRegex ?? false,
    replace: options.replace ?? "",
  });
}

// A module-level constant: building a fresh extension on every SourceView
// render would churn StateEffect.reconfigure on each re-render.
export const sourceSearchExtension: Extension = search();

// --- view provider ---------------------------------------------------------

type SourceViewProvider = () => EditorView | null;
let sourceViewProvider: SourceViewProvider | null = null;

export function registerSourceFindView(fn: SourceViewProvider): () => void {
  sourceViewProvider = fn;
  return () => {
    if (sourceViewProvider === fn) sourceViewProvider = null;
  };
}

export function currentSourceFindView(): EditorView | null {
  return sourceViewProvider ? sourceViewProvider() : null;
}

// --- match iteration -------------------------------------------------------

// The static return type of SearchQuery.getCursor is the bare Iterator
// interface, but at runtime it is a SearchCursor / RegExpCursor, both of which
// expose `.value` / `.done` and `next(): this`. This minimal structural type
// covers both so the matches can be walked without a cast to either class.
interface MatchCursor {
  done: boolean;
  value: { from: number; to: number };
  next(): MatchCursor;
}

// Yields every match of the query in the given state (document order, in doc
// offsets), including zero-width matches (callers decide whether to render
// them).
function* iterMatches(query: SearchQuery, state: EditorState): Generator<SourceMatch> {
  const cursor = query.getCursor(state) as unknown as MatchCursor;
  cursor.next();
  while (!cursor.done) {
    yield { from: cursor.value.from, to: cursor.value.to };
    cursor.next();
  }
}

// --- highlight state -------------------------------------------------------

// What the source view highlights: the query whose matches are drawn, plus
// the index of the active match (the stronger orange one). null: panel closed,
// no highlights. App sets it through this effect; it survives doc transactions
// (the field is not touched by them), so on an edit the decorations are rebuilt
// from the (shifted) matches and the active match tracks its edits exactly like
// the WYSIWYG decoration set. The active match is chosen by index, not by the
// selection, so the user's caret is never yanked while typing.
export interface SourceFindHighlight {
  query: SearchQuery;
  active: number;
}

export const setSourceFindHighlight = StateEffect.define<SourceFindHighlight | null>();

const sourceFindHighlightField = StateField.define<SourceFindHighlight | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSourceFindHighlight)) return effect.value;
    }
    return value;
  },
});

// The same classes the WYSIWYG decorations use (App.css styles them for the
// ProseMirror DOM; the .quillmd-source scope covers the CodeMirror DOM, see
// App.css). The active match is the one at `active` in document order.
const findMatchMark = Decoration.mark({ class: FIND_MATCH_CLASS });
const findCurrentMark = Decoration.mark({
  class: `${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}`,
});

const sourceFindDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.highlight(view.state);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.state.field(sourceFindHighlightField) !==
          update.startState.field(sourceFindHighlightField)
      ) {
        this.decorations = this.highlight(update.state);
      }
    }
    private highlight(state: EditorState): DecorationSet {
      const hl = state.field(sourceFindHighlightField);
      if (!hl || hl.query.search.length === 0 || !hl.query.valid) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      // Count every cursor match (including zero-width) so the index stays
      // aligned with sourceMatches' array; zero-width ranges just get no span.
      let i = 0;
      for (const match of iterMatches(hl.query, state)) {
        if (match.to > match.from) {
          builder.add(match.from, match.to, i === hl.active ? findCurrentMark : findMatchMark);
        }
        i++;
      }
      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// The extensions SourceView adds for find & replace: the search state, the
// highlight field, and the decoration plugin.
export const sourceFindExtensions: Extension[] = [
  sourceSearchExtension,
  sourceFindHighlightField,
  sourceFindDecorationsPlugin,
];

// --- queries against a view ------------------------------------------------

// All matches of the options in the view's doc (doc offsets, in document
// order). Empty for an empty term or an invalid regex (which SearchQuery
// reports through `valid`).
export function sourceMatches(view: EditorView, options: SourceFindOptions): SourceMatch[] {
  const query = toSearchQuery(options);
  if (query.search.length === 0 || !query.valid) return [];
  return [...iterMatches(query, view.state)];
}

// Moves the view's selection onto the match (and scrolls it into view) when
// it is not already there. The selection is what marks the active match for
// both the highlight plugin and the panel counter.
export function selectSourceMatch(view: EditorView, match: SourceMatch): void {
  const main = view.state.selection.main;
  if (main.from === match.from && main.to === match.to) return;
  const selection = EditorSelection.single(match.from, match.to);
  view.dispatch({
    selection,
    effects: [EditorView.scrollIntoView(selection.main, { y: "center" })],
  });
}

// --- replace ---------------------------------------------------------------
//
// Single replace rewrites the active match; replace all rewrites every match
// in ONE transaction (Word parity: Replace All is one undo step). Both go
// through the view, so the doc change flows through SourceView's onChange
// into App's source-change pipeline (dirty flag, save). Regex mode runs the
// replacement through the same JS `String.replace` semantics as WYSIWYG
// ($1, $&, ...) via applyReplacement.

function replacementText(
  view: EditorView,
  match: SourceMatch,
  options: SourceFindOptions,
  replacement: string,
): string {
  const matched = view.state.sliceDoc(match.from, match.to);
  return applyReplacement(matched, normalizeOptions(options), replacement);
}

// Replaces the active match (or a no-op when there is none). The doc change
// flows through the view's onChange to the source-change pipeline.
export function replaceSourceActiveMatch(
  view: EditorView,
  matches: SourceMatch[],
  active: number,
  options: SourceFindOptions,
  replacement: string,
): boolean {
  if (active < 0 || active >= matches.length) return false;
  const m = matches[active];
  const text = replacementText(view, m, options, replacement);
  if (text === view.state.sliceDoc(m.from, m.to)) return true; // no-op
  const selection = EditorSelection.single(m.from, m.from + text.length);
  view.dispatch({
    changes: { from: m.from, to: m.to, insert: text },
    selection,
    userEvent: "input.replace",
  });
  return true;
}

// Replaces every match in one transaction, applied in reverse offset order
// so the earlier ranges stay valid (single undo, like WYSIWYG). Returns the
// number of matches replaced (0 when there is nothing to replace, which also
// means no transaction was dispatched).
export function replaceAllSourceMatches(
  view: EditorView,
  matches: SourceMatch[],
  options: SourceFindOptions,
  replacement: string,
): number {
  if (matches.length === 0) return 0;
  const ops = [...matches]
    .map((m) => ({ from: m.from, to: m.to, text: replacementText(view, m, options, replacement) }))
    .sort((a, b) => b.from - a.from);
  view.dispatch({
    changes: ops.map((op) => ({ from: op.from, to: op.to, insert: op.text })),
    userEvent: "input.replace.all",
  });
  return ops.length;
}
