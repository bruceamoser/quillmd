# Plan 07 — Find & Replace Panel (P1)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P1/find-replace`
Depends on: P0 (in-app dialog conventions) · Unblocks: P3 (Edit menu context
menu items), P9 (word count uses the same scan primitives)

## 1. Problem

`Edit > Find` today is `window.prompt()` + `window.find`, which is a no-op in
most webviews. Word/Docs find-and-replace is a core daily driver: find,
replace, replace all, next/previous, match case, regex (Docs), whole word.
This must be a real in-app panel that works in WYSIWYG **and** source views.

## 2. Scope

1. **Find panel** (Ctrl+F) — floating bar under the toolbar (Docs-style):
   - Input, match-case toggle, whole-word toggle, regex toggle (Docs has it;
     Word has "Match case/whole word" — include all three).
   - Up/Down arrows (prev/next), close (Esc).
   - Result counter `3 of 17` + "no results" state (input turns red).
   - Highlight all matches (ProseMirror `Decoration` set, yellow background;
     current match stronger orange).
2. **Replace panel** (Ctrl+H) — same bar expanded with replace input +
   buttons: Replace, Replace All. Regex replace supports `$1`-style capture
   substitution (JS `String.replace` semantics; documented).
3. **View coverage:**
   - **WYSIWYG:** ProseMirror search over `editor.state.doc` text (works
     across block boundaries with a "cross-block" guard: matches spanning
     blocks are highlighted but replace only applies within a single text
     block — documented).
   - **Source (CodeMirror):** reuse CodeMirror's built-in search with the
     same options object (search module); replace writes through the
     existing source-change pipeline.
   - **Split/Preview:** find operates on the active pane (source if split).
4. **State:** per-doc last search term remembered; panel position
   (top/bottom) is a setting.
5. **Edit menu** — Find… (Ctrl+F), Find and Replace… (Ctrl+H) wired to the
   panel; "Find Next" (F3) / "Find Previous" (Shift+F3) when a term is
   loaded.

Out of scope: find in files (that's an Explorer feature, parked), search
across tabs, thesaurus.

## 3. Design notes

- **ProseMirror search** (`src/lib/find.ts`): iterate doc text nodes, build
  a match list `{from, to, block}` with `String.indexOf` (case/word/regex
  variants via a compiled `RegExp`), exposed as a `SearchState` object.
  Decorations render from it; next/prev just moves the active index.
  Complexity: linear in doc text — fine for 100k-char docs; debounce
  recompute to 150 ms on typing.
- **Replace:** single = `tr.replaceWith(from, to, textnode)`; Replace All =
  one transaction with all matches applied **in reverse offset order**
  (stable, single undo step — Word parity: Replace All is one undo).
- **Regex mode:** input validated; invalid regex shows an inline error, no
  search. Replace-all in regex mode uses the compiled regex `replace` per
  block.
- **Source view:** `@codemirror/search` (already a transitive dep via the
  markdown language package — verify) or add the package explicitly; the
  panel's state object maps 1:1 onto CodeMirror's `openSearchPanel` options
  so options sync across view switches.
- **Panel component** (`src/components/FindReplacePanel.tsx`): controlled by
  `App.tsx` state `{ open, mode: 'find'|'replace', term, ... }`; Esc closes,
  F3 cycles.
- Cross-block matches: highlight only; Replace button disabled while the
  active match spans blocks (tooltip explains).

## 4. Acceptance criteria

1. Ctrl+F opens the panel; typing highlights all matches in WYSIWYG;
   counter is correct (`n of m`); F3/Shift+F3 navigate; Esc closes.
2. Match case / whole word / regex each change results correctly (vitest
   against a fixture doc covering all three, incl. regex with capture
   groups).
3. Replace (single) and Replace All both work in WYSIWYG; Replace All is a
   **single undo** (Ctrl+Z restores the pre-replace doc exactly).
4. Source view: same term/options produce the same match count as WYSIWYG
   (parity test on the same fixture).
5. Cross-block term: highlighted, Replace disabled with tooltip.
6. Dirty-state: a replace marks the doc dirty; save serializes correctly;
   round-trip of a doc with replaced text is byte-identical on re-save.
7. Edit menu + F3 shortcuts all dispatch the panel (no prompt() anywhere).

## 5. Tasks (each → sub-issue)

1. **find.ts search engine** — WYSIWYG matcher (case/word/regex),
   SearchState, decoration builder; unit tests.
2. **FindReplacePanel component** — UI, counter, error states, keyboard
   model (F3/Esc/arrows).
3. **WYSIWYG replace** — single + replace-all (reverse-order transaction),
   single-undo guarantee; tests.
4. **Source view integration** — CodeMirror search wiring, option sync,
   parity test.
5. **Menu + shortcuts** — Edit menu items, F3/Shift+F3, per-doc term memory,
   panel position setting.
6. **Acceptance** — `p1-find` harness section; large-doc perf check
   (100k chars < 100 ms recompute, measured in a vitest perf test).
