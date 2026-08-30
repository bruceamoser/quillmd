# Feature Parity Program (v2) — Master Overview

Status: **proposed** — one GitHub issue per plan doc in this directory, sub-issues per task.
Owner: Bruce Moser. Companion docs: `spec.md` (v1 invariants), `docs/packaging.md`.

## 1. Goal

Take QuillMD from a competent markdown editor to a **feature-rich WYSIWYG desktop
editor that covers the everyday document surface of Microsoft Word and Google Docs**:
full native file/folder dialogs, real find & replace, font and style controls,
context menus, tables, document tools (TOC, word count, spell check), and a
complete View menu — without abandoning the v1 invariants:

- **Byte-identical round-trip** for unmodified documents (clean-path save).
- **No data loss**: atomic writes, hash-guarded saves, crash-recovery snapshots.
- **Full markdown feature set** (CommonMark + GFM + Pandoc extensions).

## 2. Current state (what we build on)

| Area | Today |
|---|---|
| Native menus | File (New/Open/Open Folder/Recent/Save/Save As/Import/Export), Edit (undo/redo/cut/copy/paste/find), Insert (headings, bold, lists, table, link, image, code, hr, footnote, task, quote, emoji), Format (B/I/S, code, highlight, sub/sup, clear), View (4 view modes), Help (shortcuts) — `src-tauri/src/menu.rs` |
| File dialogs | **`window.prompt()` for paths** (open, save-as, export, import); native `open({directory:true})` folder picker only in the Explorer. This is the biggest UX gap. |
| Editor | TipTap (ProseMirror) + StarterKit + table, task-list, image, link, highlight, sub/sup, code-block. No font family/size controls, no underline button, no color, no alignment, no ruler/indent, no spellcheck UI. |
| Toolbar | Glyph buttons for inline marks + block insert + heading select + undo/redo. |
| Find/Replace | `Edit > Find` is `window.prompt()` + `window.find` (often a no-op). No replace, no next/prev, no case/regex. |
| Context menu | None — right-click is the WebView default. |
| Tables | Insert 3x3 grid only; no add/remove row/col, no alignment, no column resize. |
| Diagrams | None — a ` ```mermaid ` fence renders as a plain code block (no visualization, no insert affordance). |
| Styles | None. Headings are the only "styles". No style gallery, no user-defined styles, no theme. |
| Tools | None (no spell check, no word count dialog, no TOC, no document properties). |
| Undo | Unified markdown-text undo (v1 invariant — keep). |
| Export | PDF (Typst), DOCX, EPUB, TXT via bundled pandoc sidecars. |

## 3. Menu surface comparison — Word & Google Docs

### Microsoft Word (ribbon)

| Word tab / group | Items | Verdict for QuillMD |
|---|---|---|
| **File** backstage | New (template gallery), Open, Save, Save As, Export, Print, Close, Account, Recent, Info (properties) | **Adopt**: New (with templates), Open, Save, Save As, Export, Close, Info/properties. **Skip**: Print (covered by Export PDF), Account/Share. |
| **Home > Clipboard** | Paste (with Keep Text Only), Cut, Copy, Format Painter | **Adopt**: Paste/Keep Text Only, Cut/Copy. **Defer**: Format Painter. |
| **Home > Font** | Font family, size, B/I/U/S, subscript/superscript, color (font + highlight), clear formatting | **Adopt** all; font family/size map to pandoc/Typst attributes (see plan 04). **Adopt**: underline (dependency already present). |
| **Home > Paragraph** | Bullet, numbered, task (no Word equiv), indent out/in, line spacing, align L/C/R, show/hide ¶ | **Adopt**: lists (have), indent (map to markdown indent/heading-less blocks), alignment (limited markdown mapping — see plan 04), show formatting marks. |
| **Home > Styles** | Style gallery (Normal, Heading 1-9, Title, Quote, Code), modify style, pick style | **Adopt** — plan 05: style gallery mapped to markdown block types + user CSS themes. |
| **Home > Editing** | Find, Replace, Select, Word Count, Spell Check | **Adopt** — plans 07 and 09. |
| **Insert** | Tables, Pictures, Shapes, Charts, Equation, Links, Header/Footer, Caption, Text Box, Comment, Symbol, Date/Time | **Adopt**: Tables (full editing), Pictures, Links, Symbols (emoji exists — expand), Date/Time, Comment (as HTML comment or GFM annotation — defer), Caption (defer). **Charts** → **Mermaid diagrams** (plan 11: fenced code blocks render live, export to PNG). **Skip**: Shapes, Text Boxes (markdown-native equivalents don't exist; out of scope). |
| **Layout** | Margins, Orientation, Size, Columns, Spacing, Page Break, Drop Cap | **Adopt**: Page Break (`<div class="page-break"></div>` + Typst PDF), spacing/line-height via theme. **Skip**: margins/orientation/columns (theme-level only, via Typst template later). |
| **References** | Table of Contents, Footnotes, Endnotes, Citations, Cross-references, Captions | **Adopt**: TOC (generate from headings), footnotes (have). **Defer**: citations/cross-refs/captions. |
| **Review** | Spelling & Grammar, Thesaurus, Comments, Track Changes, Compare | **Adopt**: spell check (webview + HUNSPELL/`lrc` fallback), track changes via markdown diff view (defer). **Skip**: thesaurus, compare. |
| **View** | Reading, Page, Web, Outline, Zoom, Word Wrap, Show Ruler, Navigation Pane, Split | **Adopt**: zoom, word wrap, navigation pane (outline from headings), full-screen. **Skip**: reading/page/web layouts (we have 4 view modes already — map into one View menu). |

### Google Docs (classic menus)

| Menu | Items | Verdict |
|---|---|---|
| **File** | New, Open, Make a copy, Import, Share, Download, Print, Save & share, Settings, Versions, Explore | **Adopt**: New, Open, Import, Download (have), Make a copy, Settings (per-doc defaults), Versions (we have crash snapshots — expose a "Restore snapshot" item). **Skip**: Share (local-first), Explore. |
| **Edit** | Undo/Redo, Cut/Copy/Paste, Select all, Find and replace, Substitutions, Spelling, Translate | **Adopt**: Find and replace (real UI), spell check, paste options. **Defer**: substitutions, translate. |
| **View** | Show blank pages, word wrap, ruler, zoom, Full screen | **Adopt**: wrap, zoom, full screen, view modes. **Skip**: ruler (no CSS page model). |
| **Insert** | Page break, image, Table, Chart, Text box, Special characters, Comment, Link, Footnote, Date/time, Horizontal line, Equation | **Adopt**: page break, image, table, special characters, comment (defer), link, footnote, date/time, hr. **Chart** → **Mermaid diagrams** (plan 11). **Skip**: text box, equation (MathJax is a candidate stretch — park). |
| **Format** | Clear formatting, Text (font, size, color, underline, align), Paragraph (spacing, indent, lists), Lines & spacing, Borders & shading, Drop cap | **Adopt** as in Word row above. **Skip**: borders/shading (theme-level), drop cap (defer). |
| **Tools** | Spelling, Word count, Research, Clear formatting, Clear document, Script editor, Macro | **Adopt**: word count, clear formatting, clear document (dangerous op with confirm). **Skip**: research, scripts, macros. |
| **Extensions / Help** | Add-ons, What's new, Shortcuts | **Adopt**: shortcuts dialog (have, move to View or Help). |

### Net decisions

- **Adopt (this program):** everything in the "Adopt" cells above → plans 01-11
  (Charts in both apps map to Mermaid diagrams, plan 11).
- **Defer (documented, not scheduled):** Format Painter, track-changes/compare, comments,
  citations, captions, MathJax, drop cap, margins/columns as first-class (theme-level only).
- **Skip (no markdown-native model):** shapes, text boxes, print dialog
  (Export PDF covers it), cloud sharing/sync, collaboration.
  (Charts *are* covered — Mermaid, plan 11.)

The guiding rule: **if it cannot round-trip through markdown (or a stable
HTML/Typst attribute), it is not a first-class feature** — it is either a
theme/rendering concern or parked.

## 4. Milestones

| Milestone | Plans | Contents | Depends on |
|---|---|---|---|
| **P0 — Foundation** | 01 | Native dialogs everywhere (open/save-as/export/import), New + New from template, Make a copy, native confirmation dialogs replacing `window.prompt/confirm`, Close/Close All | — |
| **P1 — Editing core** | 02, 07 | Full WYSIWYG editor upgrade (underline, alignment, indent, zoom, spellcheck attr, formatting marks, paste-as-text), real Find & Replace panel | P0 |
| **P2 — Presentation** | 04, 05, 06, 11 | Fonts & sizes (family/size/underline/color/highlight via markdown attributes + CSS), style gallery + themes + modify, full table editing, Mermaid diagrams (insert/edit/visualize + PNG export) | P1 |
| **P3 — Interaction** | 03, 08 | Context menus (editor, table, image, link, tabs, explorer), File menu completion (properties, close all, versions/snapshot restore) | P0 |
| **P4 — Document tools** | 09, 10 | TOC pane + insert, word count dialog, spell check, special characters, date/time, page break; View menu completion + settings dialog + clear document | P1 |

Sequencing notes:

- P0 unblocks everything that touches the filesystem and is the single highest-
  perceived-value item (no more `window.prompt` for paths).
- P1's Find & Replace is prerequisite for the "Editing" group parity.
- P2 items are independent of each other (parallelizable).
- P3 context menus layer on top of P1/P2 commands — they are UI, not new
  capabilities, so they land after the capabilities exist.
- P4 is mostly assembly of existing primitives (headings → TOC, counts already
  computed in the status bar).

## 5. GitHub issue structure

- One **parent issue per plan doc** (`docs/feature-parity/01-*.md` … `11-*.md`),
  titled `P<0-4>/<area>: <name>`, labeled `enhancement` + `feature-parity`,
  milestone **Feature Parity (v2)**.
- Each plan's **task breakdown** (last section of each doc) becomes **sub-issues**
  of its parent, labeled `task`, with the same milestone.
- Parents are closed only when all sub-issues are closed and acceptance
  criteria in the doc pass.

## 6. Non-negotiables (apply to every plan)

1. **Byte-identical round-trip** still holds after each plan. The clean-path
   save pipeline (`src/lib/pipeline.ts`) must keep treating unmodified docs as
   verbatim; new formatting that has no markdown representation must be stored
   in a way that survives re-serialization (attributes, HTML blocks, or a
   document sidecar — decided per feature, documented in the plan).
2. **No `window.prompt`/`alert`/`confirm`** may remain on the Tauri path after
   P0 (native `plugin-dialog` for everything; keep the browser-dev fallbacks).
3. Every new command is registered in **one place** (`src/lib/editorCommands.ts`
   registry or the menu/command dispatch in `App.tsx`) so toolbar, menu,
   context menu, and shortcut all dispatch the same id.
4. Undo/redo stays unified at the markdown-text level (v1 invariant). Features
   that need editor-level state (e.g. color) must not break "undo past a save
   restores pre-save bytes".
5. Windows + Linux parity for every dialog, shortcut (Ctrl/Alt), and file path
   behavior. macOS is out of scope for this program (spec.md target platforms).
6. Tests: each plan adds vitest unit coverage for its lib changes and at least
   one interaction test; the acceptance harness (`tests/acceptance-test.sh`)
   grows a section per milestone.

## 7. Out of scope for the whole program

- Cloud sync, sharing, real-time collaboration.
- Shapes, charts, drawing, text boxes.
- Citations/bibliography engine, cross-references, captions.
- Track changes / document compare (deferred; revisit post-v2).
- LaTeX/MathJax equation editing (parked).
- Print pipeline (Export PDF is the print story).
- macOS build (no change to current target set).
