# Spec: QuillMD — WYSIWYG Markdown Editor with Native MD Persistence

- **Status:** Draft v0.1 (2026-08-15) — for council review
- **Owner:** Bruce Moser (final authority) · **Winston** (chief-of-staff)
- **Council:** Systems Architect · UX/Product Designer · Engineering Lead · Contrarian · Cross-Platform/QA

---

## 1. Goal

A WYSIWYG markdown editor that **persists natively in markdown** — the file on disk IS the source of truth (`.md`), and the editor renders it as rich text while round-tripping the raw markdown losslessly. Usable on **Windows and Linux** (both desktop platforms, same repo).

One sentence: *"What you see is what the markdown says — and what the markdown says is what you saved."*

---

## 2. Requirements

### 2.1 Core editor behavior
1. Open a `.md` file, render it as rich text (WYSIWYG), edit inline, save back to the SAME file as raw markdown.
2. Native markdown persistence: no proprietary save format, no database, no hidden sync layer. The `.md` file is the only source of truth. Save = write markdown to disk.
3. Full markdown feature support, leveraging as many markdown options as possible:
   - Headings (H1–H6), paragraphs, line breaks
   - Bold, italic, strikethrough, inline code
   - Links (inline, reference, auto), images (local + remote)
   - Lists: unordered, ordered, task lists (checkbox), nested
   - Blockquotes (incl. nested)
   - Code blocks with language highlighting (fenced + indented)
   - Tables (GFM), including editing cells
   - Horizontal rules
   - HTML passthrough (raw HTML blocks/inline where CommonMark allows)
   - Footnotes (GFM/Pandoc-style where feasible)
   - Definition lists, subscript/superscript, mark/highlight (GFM/Pandoc extensions where feasible)
   - YAML front matter (Pandoc-style) — editable as structured block, preserved verbatim
   - Task list toggle (click checkbox, markdown updates)
4. Round-trip fidelity: opening a file and saving without edits produces **byte-identical** markdown (for files that parse cleanly). No reformatting surprises by default.
5. Markdown-aware editing affordances in WYSIWYG mode:
   - Click-to-edit any block
   - Tab/Shift-Tab to indent list items, outdent
   - Enter continues list items; backspace on empty item exits list
   - Typing `# ` converts to heading; `> ` blockquote; `- ` list; `` ` `` code (CommonMark shortcut conventions)
   - Alt-Enter / shift-enter hard break behavior per markdown semantics
6. Undo/redo that operates on the MARKDOWN text (so undo never produces non-renderable states) while presenting visually in WYSIWYG.
7. Find & replace across the document (plain text and/or regex toggle).

### 2.2 View modes
1. **WYSIWYG (default)** — rich rendered view, inline editing.
2. **Source** — raw markdown editing with syntax highlighting (split or toggle).
3. **Split** — side-by-side WYSIWYG + source, synchronized scrolling, live cursor mapping.
4. **Preview/read-only** — rendered view with no edit chrome (like GitHub render), for review.

### 2.3 Files & platform
1. Windows + Linux, same codebase. No macOS requirement (nice-to-have later, non-goal for v1).
2. Native file dialogs (open/save/save-as), recent files list.
3. Auto-save (configurable: off / interval), with crash recovery snapshot (`.quillmd-unsaved.md` or similar) — never lose user data.
4. Encoding: UTF-8 (with BOM detection on read; preserve original BOM state on save).
5. Line endings: preserve the file's existing line endings (LF vs CRLF) on save; configurable for new files.
6. File watching: if the file changes on disk externally, detect and prompt (reload / merge / overwrite).

### 2.4 Document features
1. Document outline / headings navigator (click to jump).
2. Word count / char count / reading time in status bar.
3. Search within file; optional regex.
4. Multi-file: tabs. (Workspace/project tree is a NON-GOAL for v1 — see scope.)

### 2.5 Import / Export (conversion)
1. **Export to PDF:** render the current document to PDF (styled, print-ready). Table of contents option, page numbers, code highlighting preserved.
2. **Export to Word (.docx):** lossless-ish conversion — headings, bold/italic, lists, tables, images, footnotes survive as native Word constructs.
3. **Export to EPUB:** single-file EPUB for e-readers (cover, TOC, chapter splits from headings).
4. **Export to TXT:** plain text (markdown stripped to readable text, or raw markdown per user choice).
5. **Import from Word (.docx):** open a .docx and convert to markdown — the editor edits it natively in MD after import. Best-effort fidelity: headings, emphasis, lists, tables, footnotes, images.
6. **Import from TXT:** open a .txt as markdown (no conversion needed, but file type recognized).
7. Import/export fidelity is best-effort for foreign formats (docx/epub are lossy by nature); **markdown is the only lossless format**. The spec's round-trip fidelity guarantee (§2.1.4) applies to .md files only.
8. Engine: **Pandoc** (or equivalent) as the conversion backend — proven, cross-platform, handles all four target formats. Bundled or invoked via system install (see architecture question §6.6).

---

## 3. Scope / In

- v1.0: single-file editing with tabs, full feature set above, Windows + Linux builds.
- Markdown engine with CommonMark compliance + GFM extensions + selected Pandoc extensions (front matter, footnotes, definition lists, sub/sup, highlight).
- Round-trip fidelity test suite (open → save → byte-compare).
- Import/export: PDF, DOCX, EPUB, TXT (both directions for DOCX/TXT; export for PDF/EPUB).

## 4. Non-goals / Out (v1)

- No project/workspace explorer or multi-folder management.
- No collaborative editing / real-time sync / CRDT.
- No cloud sync or account system.
- No plugins/marketplace (architecture must ALLOW them later, but no plugin system in v1).
- No mobile/web versions.
- No proprietary binary format ever (core constraint).
- macOS support deferred.
- No built-in git UI (external git integration deferred).

---

## 5. Acceptance criteria (map 1:1 to tests in acceptance-test.sh)

1. **Round-trip fidelity:** for a corpus of ≥50 markdown fixtures (covering every feature in §2.1), open → save → byte-identical for clean fixtures (excluding known-normalization exceptions documented in the test).
2. **Feature coverage:** every markdown feature in §2.1.2 renders correctly in WYSIWYG AND round-trips through source mode.
3. **Task list:** clicking a checkbox in WYSIWYG updates `[ ]` ↔ `[x]` in the source.
4. **List editing:** Enter continues lists; Tab/Shift-Tab indent/outdent; backspace on empty item exits list — all reflected correctly in source.
5. **Undo/redo:** 50-step undo/redo sequence never produces a parse-failure state in the editor (parse always succeeds after each step).
6. **Line endings:** CRLF file saves as CRLF; LF file saves as LF.
7. **BOM:** UTF-8 BOM file saves with BOM; non-BOM saves without.
8. **Auto-save + crash recovery:** kill the process mid-edit; reopen → recovery prompt restores the unsaved edit.
9. **File watch:** external modification prompts reload/merge/overwrite.
10. **Platform:** editor launches and passes core test suite on Windows 10/11 AND Linux (Ubuntu LTS). CI matrix runs both.
11. **Front matter:** YAML front matter preserved verbatim (byte-identical) and editable as a structured block.
12. **No data loss:** after any 1000-edit randomized stress sequence, saved markdown parses and matches the model state.
13. **Export PDF:** exporting a fixture document produces a valid PDF (opens, page count ≥1, text extractable).
14. **Export DOCX:** exporting a fixture with headings/lists/tables/footnotes produces a .docx that re-imports back to semantically equivalent markdown (content preserved, formatting normalized).
15. **Export EPUB:** exporting a multi-heading fixture produces a valid EPUB (opens, TOC entries match headings).
16. **Export TXT:** exports plain text (and raw markdown option).
17. **Import DOCX:** opening a .docx fixture yields editable markdown; re-export round-trips content (normalization allowed).
18. **Import TXT:** opening a .txt file loads as markdown.

---

## 6. Open architecture questions (for council + Bruce)

1. **Tech stack** — the big one:
   - **A. Web-tech shell** (Tauri 2 + React/Svelte + CodeMirror 6 + markdown-it/micromark + ProseMirror/TipTap): small binaries, one codebase, both platforms, best WYSIWYG ecosystem (ProseMirror is the gold standard for MD WYSIWYG round-trip).
   - **B. Electron + same web stack**: fastest to ship, heavier binary.
   - **C. Native** (Qt/C++ or Rust/egui or Flutter): no browser runtime, but WYSIWYG markdown editing is far harder and slower to build.
   - **Winston's lean:** **Tauri 2 + TypeScript/React + ProseMirror** — ProseMirror's `markdown` schema + plugins give lossless round-trip; Tauri gives cross-platform with tiny binaries. Electron acceptable fallback if Tauri pain exceeds benefit.
2. **Markdown engine:** micromark + mdast-util (unified) vs markdown-it vs ProseMirror's built-in. Lean: unified/micromark for parsing + ProseMirror for editing, with a round-trip test gate.
3. **Undo model:** markdown-text-level undo vs ProseMirror document-level undo. Lean: ProseMirror native undo (doc-level) mapped to markdown on save — but spec requires parse-always-success, so need the test.
4. **Auto-save + external change conflict:** save-on-interval + hash compare + prompt. Need Bruce's call on default (auto-save ON vs OFF by default).
5. **Settings persistence:** per-user config file (JSON/TOML in user config dir) — v1 minimal, expanded later.
6. **Conversion backend:** Pandoc bundled with the app vs system-install dependency. Lean: detect system pandoc first, bundle fallback for release builds (Windows especially, where users won't have it). PDF export also needs an engine (Pandoc's default pdf-engine is LaTeX — heavy; wkhtmltopdf/weasyprint/typst are lighter options). Note: our HOL book already builds via Quarto+Typst, so Typst is a known-quantity PDF path.

---

## 7. Risks / failure modes

- **Round-trip lossiness** is the #1 risk — markdown → rich text → markdown almost always mutates something (emphasis placement, list tightness, reference link style). Mitigation: byte-fidelity test suite + "normalization exceptions" whitelist + always-showing source mode so nothing is hidden.
- **ProseMirror learning curve** — it's powerful but notoriously complex; mitigation: start with TipTap (ProseMirror wrapper) which ships markdown plugins.
- **Cross-platform file handling** — Windows path/CRLF/BOM quirks; mitigation: platform test matrix from day 1.
- **Scope creep into workspace/git/collab** — explicitly non-goals; keep the spec sharp.
- **Tauri/WebView2 dependency on Windows** — users need WebView2 runtime (preinstalled on Win11); mitigation: document + bundle installer check.

---

## 8. Rollback plan

- v0 spec is a document — no code to roll back yet. Once code exists: every milestone tagged; spec changes flow through council + Bruce; any feature can be reverted by reverting its PR (squash-merge discipline, same as HOL).

---

## 9. Council workflow (mirrors HOL)

- Daily/on-demand council walkthrough: five lenses review the spec → code → docs.
- Findings: `[file:line] SEVERITY — what — fix`.
- Mechanical → fix in-loop. Design-flavored → Bruce with implemented-default flag. Contrarian findings get special weight on data-loss paths.
- Same implement-don't-report law: every review round must ship a delta.

---

*Draft for council. Next: council review round 1 on this spec.*
