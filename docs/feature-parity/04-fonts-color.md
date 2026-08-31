# Plan 04 — Fonts, Sizes, Color & Text Attributes (P2)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P2/fonts`
Depends on: P1 (registry, alignment pattern) · Unblocks: P5 (styles build on
the same attribute machinery)

## 1. Problem

Word/Docs font controls (family, size, underline, font color, highlight color)
have no home in QuillMD today: no font-family/size selects, no color pickers,
underline unexposed. Markdown has no font semantics, so this plan defines the
one sanctioned mechanism — **pandoc inline attributes on HTML spans** — and
the UI around it.

## 2. Scope

1. **Font family select** — "Normal (document default)" + a curated list of
   ~24 common cross-platform families (Segoe UI, Arial, Calibri, Georgia,
   Times New Roman, Courier New, Consolas, Verdana, Tahoma, Trebuchet MS,
   Garamond, Cambria, Comic Sans MS, Impact, …) + "Custom…" (free text).
2. **Font size** — Word-style sizes: 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28,
   32, 36, 48 pt → rendered as `font-size: <n>pt` in the span attribute.
   "Normal" = inherit.
3. **Font color** — picker with: auto (inherit), 24 standard colors (Word's
   theme palette), "Custom color…" (full `<input type=color>`).
4. **Highlight color** — same palette, applied via the existing `highlight`
   mark extended with a color attribute (default stays the yellow).
5. **Underline** — completed in P1; this plan only adds it to the Font group
   layout (toolbar cluster: family | size | B I U S | sub sup | color |
   highlight | clear).
6. **Clear formatting** — now also strips font family/size/color attributes
   (extends the existing `clearFormatting` command).

Out of scope: per-character kerning, small-caps/all-caps as first-class
(defer), text effects/shadow, per-paragraph font override (fonts are
character-level only, like Word).

## 3. Design notes

- **Serialization mechanism (the core decision).** Styled text serializes as
  pandoc/HTML spans with a stable class + inline style, e.g.:

  ```html
  <span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">styled</span>
  ```

  - Written by the serializer only where style attributes are non-default.
  - Parsed back by rehype into the same TipTap `textStyle`-like marks
    (`fontFamily`, `fontSize`, `fontColor`, `highlightColor`) so WYSIWYG
    shows the styling live.
  - **Clean path:** docs with zero styled text are saved verbatim (attribute
    never appears). Docs with styled text re-serialize; the span HTML is
    stable (attribute order fixed) so save→reopen→save is byte-identical.
  - Preview renders spans as-is (CSS honors them); Source shows the raw span
    (grep-able, human-readable — matches how footnote/highlight already
    behave).
  - This is the same pattern as P2 alignment (block classes); one test
    fixture covers both.
- **TipTap model:** three new marks (`fontFamily`, `fontSize`, `fontColor`)
  + `highlight` gets an optional `color` attribute. All are inline,
  composable with bold/italic/etc. (Word composes too).
- **Color palette:** Word's standard 24 (rows of 6) as a CSS grid in a
  popover; "Auto" cell; custom row with the native color input. Palette
  constant shared with the highlight picker.
- **Toolbar layout** (replaces the flat glyph row for the font cluster):
  `[Font ▾] [11 ▾] | B I U S | x₂ x² | [A color ▾] [highlight ▾] | clear`
  — one toolbar row, separators as today. Heading select moves left of the
  font cluster (paragraph group first, like Word).
- **Menu:** Format > Font submenu (family list, size list, color, highlight,
  underline, clear). Context menu (P3) reuses the same builders.
- **No markdown meaning lost:** spans are HTML-in-markdown; pandoc import/
  export passes them through (pandoc preserves raw HTML by default —
  verify in acceptance with a DOCX export of a styled doc; if pandoc drops
  spans in DOCX, that is documented as an export limitation, not a bug).
- **Export spot-check results (task 4.6, issue #52; pandoc 3.7 + typst 0.15
  on fixtures/clean/font-styled.md, the same pipeline as convert.rs):**
  pandoc's typst and docx writers both drop the quillmd spans, so the styled
  text **degrades to plain text** in both PDF and DOCX — the text content
  (and markdown bold) survives byte-for-byte, but the font family/size/color
  and highlight background do not. This is the documented AC7 export
  limitation, not a bug: the markdown remains the source of truth with the
  full styling, and re-importing the DOCX back into QuillMD loses nothing
  that was not already lost by pandoc. Release notes should carry: "PDF/DOCX
  export renders styled text as plain text (pandoc drops the quillmd font
  spans); styling is preserved in the .md source."
- **Editor font (the editor's own chrome font)** is separate: View >
  "Editor font" select (monospace/sans/serif + size) persisted per-app in
  settings — cosmetic, never touches the document.

## 4. Acceptance criteria

1. Apply Georgia 14pt red to a word: the saved `.md` contains exactly one
   `<span class="quillmd-font" ...>` line; reopen renders it identically; a
   second save of the untouched doc is byte-identical (hash compare).
2. Unstyled docs remain byte-identical through save (existing round-trip
   fixtures all green).
3. Compose bold + italic + font + color on one range; each attribute is
   independently toggleable off (deselect sub-range, reapply).
4. Clear formatting on a styled selection removes family/size/color while
   keeping bold/italic (Word behavior).
5. Highlight color picker changes the highlight color; default yellow
   unchanged for existing `==text==` highlights (backward compat).
6. Font cluster + Font submenu + (P3) context menu all dispatch the same
   registry ids — verified by a test that triggers each path and compares
   resulting document text.
7. DOCX/PDF export of a styled doc: PDF (Typst) renders the styled text;
   DOCX result documented (spans may degrade to plain — note in release
   notes, not a blocker).

## 5. Tasks (each → sub-issue)

1. **Marks + serializer/parser** — `fontFamily`/`fontSize`/`fontColor` marks,
   highlight color attr, span emit/parse, stable attribute order; round-trip
   fixture suite.
2. **Color palette component** — 24-color grid + auto + custom; shared
   popover; used by font color and highlight.
3. **Font toolbar cluster** — family select, size select, color/highlight
   buttons, clear; heading select repositioned; CSS.
4. **Format > Font submenu** — menu wiring for family/size/color/highlight/
   underline/clear.
5. **Clear formatting extension + editor-chrome font setting** — command
   update; per-app editor font/size setting (View > Editor font).
6. **Acceptance** — `p2-fonts` harness section; PDF/DOCX export spot-checks
   with a styled fixture; Windows manual pass.
