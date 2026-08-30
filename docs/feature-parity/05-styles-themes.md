# Plan 05 — Styles Gallery, Themes & Style Editing (P2)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P2/styles`
Depends on: P0 (settings persistence), P4 (font attributes) · Unblocks: P9
(TOC uses styled headings)

## 1. Problem

Word's Styles gallery and Docs' "Normal text style" dropdown are where
document-level look lives. QuillMD has headings and nothing else: no style
gallery, no way to restyle what a heading/blockquote/title looks like, no
theme, no user-defined styles. This plan maps Word/Docs styles onto markdown
block types plus a CSS theme layer, and adds the UI to browse, apply, and
modify styles.

## 2. Scope

1. **Style gallery (toolbar + Format > Styles submenu)** — the Word-style
   dropdown showing the built-in styles with live preview:
   - Normal (paragraph), Title (H1), Heading 1-3 (H2-H4 mapped; H5/H6 under
     "More styles"), Quote (blockquote), Intense Quote (blockquote + bold),
     Code (inline code), Source Code (code block), List Paragraph (list
     item), Caption (deferred), No Spacing (paragraph, tight margins),
     Subtitle (H2 styled), Emphasis (italic run), Strong (bold run).
   - Selecting a style on a selection = apply the corresponding block/mark
     command (all registry ids already exist or come from P1/P4).
2. **Themes** — app-level theme system:
   - Built-in themes: **Quill (default)**, **Minimal**, **Serif/Book**,
     **Dark**, **High Contrast**. Each = a CSS variable set (fonts, sizes,
     colors, line spacing, heading weights, link color, highlight color,
     code background) scoped to the document content container.
   - View > Theme submenu + settings entry; per-app default + per-doc
     override (like view mode persistence).
   - Themes are the *only* sanctioned way to change default document look —
     keeps the markdown file free of theme markup.
3. **Modify Style** — Format > Styles > "Modify…" opens a style editor for
   any built-in style: font family/size, color, bold/italic, spacing. Stored
   in **user style overrides** (JSON in app config dir, not in the document)
   applied as CSS classes in the WYSIWYG/Preview. Word's "Modify Style"
   semantics, minus document-portability (documented: overrides are
   machine-local; the document keeps markdown).
4. **Style inspector (stretch, same issue)** — status-bar click on the
   current block shows "This block is: Heading 2" with a jump-to-style
   action.

Out of scope: style import/export between docs (portability is the
machine-local limitation), per-paragraph style inheritance chains, Word
style-linking (character + paragraph linked styles).

## 3. Design notes

- **Style registry** (`src/lib/styles.ts`): each style = `{ id, label,
  kind: 'block'|'mark', command: EditorCommandId, previewCSS }`. The gallery
  is data-driven; adding a style = adding a row. Built-in styles never gain
  new markdown meaning — they are aliases of existing commands, so the
  round-trip invariant is untouched.
- **Theme system:** `src/themes/*.css` variable sheets loaded via
  `data-theme` attribute on the content container. A theme = font stack,
  base size, 6 heading scale, paragraph spacing, quote/code/link/highlight
  colors. No per-block theme markup in the document.
- **User style overrides:** `~/.config/quillmd/style-overrides.json`
  (Tauri app config dir) — `{ "h2": { "fontFamily": "Georgia", "size": "18pt" },
  "paragraph": { "color": "#333" } }`. Rendered as
  `.quillmd-style-h2 { ... }` injected CSS in WYSIWYG/Preview only. Save
  pipeline never sees them. "Reset to defaults" per style + global.
- **Style gallery UI:** popover grid (Word-style: large preview swatches for
  the top 6, "More styles" opens the full list grouped by kind). Active
  style highlights on selection (like the heading select today, generalized).
- **Modify Style dialog:** in-app dialog (not native) with live preview pane
  on the right; fields = family/size/color/weight/italic/spacing; writes to
  overrides JSON via a new Rust command `read_style_overrides` /
  `write_style_overrides` (or `plugin-fs` — decision: Rust command, keeps
  config dir access in the safety module).
- **Title/Subtitle mapping:** Title = H1; Subtitle = H2 (documented mapping
  table in the style list so users learn the markdown equivalent — this is
  the honest part of the Word/Docs mapping).

## 4. Acceptance criteria

1. Gallery shows ≥12 built-in styles with correct preview; selecting
   "Heading 2" on a paragraph sets H2 (registry command `h2`) and the
   gallery selection state follows the cursor.
2. Switching themes changes the rendered look of an open doc with **zero
   bytes changed** in `currentText` (hash check); theme choice persists
   per-doc and per-app default.
3. Modify Style on H2 (family Georgia, 18pt) restyles all H2s live; the
   document file on disk is unchanged; Reset restores default look;
   overrides survive app restart.
4. All 5 themes pass a visual screenshot diff on a standard fixture doc
   (baseline screenshots committed).
5. Dark theme is the default for new docs when the OS reports dark mode
   (Tauri `useDarkMode` — stretch, same issue).
6. Round-trip fixture suite green (no style/theme markup ever written to
   disk).

## 5. Tasks (each → sub-issue)

1. **Style registry + gallery popover** — data model, built-in style set,
   gallery UI with previews and active-state tracking.
2. **Format > Styles submenu + toolbar button** — menu/toolbar wiring to
   registry commands.
3. **Theme system** — CSS variable sheets, 5 built-in themes,
   `data-theme` scoping, View > Theme menu, per-doc/per-app persistence.
4. **Modify Style + overrides storage** — dialog with live preview,
   Rust overrides commands, injected CSS, reset flows.
5. **Style inspector** (stretch) — status-bar block-type indicator.
6. **Acceptance** — `p2-styles` harness section, screenshot baselines,
   round-trip regression.
