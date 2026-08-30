# Plan 09 — Document Tools: TOC, Word Count, Spell Check, Insert Items (P4)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P4/doc-tools`
Depends on: P1 (spellcheck attr, find primitives), P5 (styled headings) · Unblocks: —

## 1. Problem

Word's References tab (TOC, footnotes) and Tools/Review tools (word count,
spell check) plus the everyday Insert items (date/time, special characters,
page break) have no home in QuillMD. These are the "document" features that
make it feel like a word processor rather than a markdown editor.

## 2. Scope

1. **Table of Contents**
   - **Navigation pane (View menu)**: right-side pane listing H1-H4 with
     indentation; click scrolls to heading; active heading tracks scroll
     position; pane toggles with the Explorer (shared side rail).
   - **Insert > Table of Contents**: inserts a **live TOC block** at the
     cursor as an HTML comment placeholder:
     `<!-- quillmd:toc -->` — rendered as a clickable TOC in WYSIWYG/Preview
     (generated from the current headings on render), and **regenerated on
     export** (pandoc/Typst export expands it to a real TOC; DOCX export
     inserts a TOC field). The placeholder is a stable token: the clean-path
     serializer treats `<!-- quillmd:toc -->` as an immutable block (byte-
     identical round-trip; headings added later don't rewrite the file —
     the rendered view updates live).
   - TOC block has its own node type `tocBlock` (like `footnoteDef` today).
2. **Word count dialog** (Tools/Review > Word Count, `Ctrl+Shift+F5`):
   words, characters (with/without spaces), sentences, paragraphs, reading
   time (200 wpm), plus selection-scoped counts when text is selected.
   Values already computed for the status bar — the dialog is presentation.
3. **Spell check command** — Review/Tools > "Spelling…" opens the first
   misspelling (uses the webview spellcheck engine state: `spellcheck`
   attribute from P1 + a Rust-side fallback: bundle `hunspell` dictionaries?
   **Decision:** webview-native only in v2; if the webview exposes no
   misspelling API (it doesn't reliably), the command falls back to a
   **scan-and-flag** mode: scan text against a bundled wordlist
   (`wordlist.txt`, ~120k words, ~3 MB — ship as a resource file) and show a
   popover list of flagged terms with "Ignore word" / "Add to personal
   dictionary" (stored in app config). This is the honest path: no
   hunspell dependency, works identically on Windows/Linux.
4. **Insert > Date & Time** — picker (format list: `August 30, 2026`,
   `2026-08-30`, `08/30/2026`, `30 August 2026` + 12/24-hour time variants;
   locale from `Intl.DateTimeFormat` with the app locale setting).
5. **Insert > Special characters** — popover: recent, then categories
   (currency, math, arrows, bullets, typography, symbols); click inserts;
   searches by name ("copyright" → ©). Built from a bundled table
   (`src/lib/symbols.ts`, ~300 common chars with names) — no icon-font
   dependency.
6. **Page break** — Insert > Page Break inserts
   `<div class="quillmd-page-break"></div>` (HTML block, round-trips
   verbatim); the Typst export template maps it to `pagebreak()`. Renders
   as a visible break line in WYSIWYG/Preview.
7. **Clear document** (Tools, Docs parity) — native confirm ("This removes
   all content. You can undo."), clears to empty, single undo restores
   everything.

Out of scope: footnotes UI improvements (have them), endnotes, citations,
captions (deferred per overview).

## 3. Design notes

- **tocBlock node:** `parseHTML` on `div[data-quillmd-toc]`; the serializer
  emits exactly `<!-- quillmd:toc -->` for it (fixed string → byte-stable).
  Render (WYSIWYG/Preview) replaces the node's DOM with the live TOC list;
  ProseMirror renders it read-only (like `footnoteDef` labels).
  Export: `export_document` (Rust) string-replaces the comment with a
  generated TOC **before** invoking pandoc for PDF (Typst `#outline()`
  call) — simplest correct place, no frontend export logic.
- **Navigation pane:** `src/components/OutlinePane.tsx`; heading list from
  the doc (`getHeadingList(editor)` — walk H1-H4, text + doc position);
  scroll tracking via ProseMirror `View.coordsAtPos` + scroll listener
  (throttled); click = `scrollIntoView` + select.
- **Word count:** `src/lib/counts.ts` (shared by status bar + dialog):
  words/chars/chars-no-spaces/sentences (regex on `(?<=[.!?])\s`)/paragraphs
  (block count)/reading time. Selection-scoped: count over the selected
  text range.
- **Spellcheck scan mode:** `src/lib/spellcheck.ts` — load wordlist into a
  `Set` (lazy, async), scan doc text, return flagged spans; ignore list +
  personal dictionary in app config (Rust commands `get_wordlist_settings` /
  `set_wordlist_settings`, or reuse the style-overrides storage pattern from
  plan 05). Popover on a flagged word: term, "Ignore all", "Add to
  dictionary".
- **Date/time:** pure `Intl` formatting; insert as plain text (no markup).
- **Page break in export:** Typst template addition in `convert.rs`
  (search/replace on the pre-pandoc text is sufficient — no template
  engine changes).

## 4. Acceptance criteria

1. Insert TOC: file gains exactly the comment line; adding/removing
   headings and re-saving does **not** change the comment line (byte
   check); WYSIWYG/Preview show the updated TOC live; exported PDF
   contains a real outline.
2. Navigation pane lists H1-H4, click scrolls, active item tracks scroll;
   toggle persists with view-mode settings.
3. Word count dialog matches the status bar for the whole doc and is
   correct for a selection (vitest against fixtures with known counts).
4. Spellcheck flags a planted misspelling, ignore-all suppresses it for the
   session, "add to dictionary" suppresses it permanently (restart test).
5. Date & Time inserts the selected format for the current date; special
   characters popover inserts © correctly on Windows (codepage-safe: the
   file stays UTF-8).
6. Page break renders as a break line; exported PDF shows a physical page
   break at that position.
7. Clear document requires the native confirm; Ctrl+Z restores the full
   prior text exactly (hash compare).

## 5. Tasks (each → sub-issue)

1. **tocBlock node + serializer token** — node, parse/render, fixed-token
   serialization, round-trip test.
2. **Export-time TOC generation** — comment expansion in `convert.rs` for
   PDF/DOCX; test with a fixture doc.
3. **Navigation pane** — heading extraction, scroll tracking, click-to-
   scroll, View menu toggle.
4. **Word count dialog** — counts.ts, dialog UI, selection scoping, tests.
5. **Spell check** — wordlist resource, scanner, ignore/personal
   dictionary storage, flagged-word popover.
6. **Date/time + special characters** — formatters, symbol table + popover,
   Insert menu wiring.
7. **Page break + clear document** — node/serialization, Typst mapping,
   confirm+clear command.
8. **Acceptance** — `p4-doc-tools` harness section; PDF export TOC + page
   break visual check.
