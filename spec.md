# Spec: QuillMD — WYSIWYG Markdown Editor with Native MD Persistence

- **Status:** v0.2 (2026-08-16) — council round 1 incorporated
- **Owner:** Bruce Moser (final authority) · **Winston** (chief-of-staff)
- **Council:** Systems Architect · UX/Product Designer · Engineering Lead · Contrarian · Cross-Platform/QA
- **Round log:** docs/council-rounds.md

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
4. **Round-trip fidelity with a clean-path guarantee:**
   - Opening a file and saving WITHOUT edits produces **byte-identical** markdown — implemented by hash-compare on load and **writing the original bytes verbatim** when the document is unmodified (no re-serialization).
   - With edits: re-serialize ONLY the edited blocks and splice them into the original source (block-granular dirty tracking). ProseMirror is an **editing view, never the serialization authority for untouched regions**.
   - **Normalization whitelist:** constructs that are allowed to normalize on save (reference links, inline HTML, tight/loose lists, indented code, hard breaks, etc.) are enumerated in a versioned, council-reviewed manifest (`fixtures/normalization-manifest.json`), each entry mapped to a §2.1.3 feature with a user-visible justification. Anything not on the whitelist must round-trip byte-exactly.
   - **Dirty-parse fallback:** if parsing the doc produces warnings, bypass the serializer and write the raw source text instead (never silently mutate).
5. Markdown-aware editing affordances in WYSIWYG mode:
   - Click-to-edit any block; Tab/Shift-Tab indent/outdent list items; Enter continues list items; backspace on empty item exits list.
   - Typing conventions (1:1 with §2.1.3): `# ` heading, `> ` blockquote, `- ` unordered, `1. ` ordered, `- [ ]` task list, `` ` `` inline code, ``` ``` ``` fenced code, `---` horizontal rule, `[^1]` footnote, `~~` strikethrough.
   - **Insert affordances for constructs that are awkward to type blind:** toolbar + slash-command (`/table`, `/code`, `/image`, `/link`, `/footnote`, `/hr`, `/front-matter`) + insert menu. Raw markdown typing with visible markers always works as fallback.
   - **Selection-based formatting** (the primary WYSIWYG interaction): Ctrl+B bold, Ctrl+I italic, Ctrl+K link-on-selection, strikethrough, inline code on selection. Full keyboard map in §2.6.
   - **Block exit mechanics:** ArrowDown past the last line exits code blocks/tables/blockquotes; closing backtick exits inline code; Escape clears selection; each block type defines an explicit exit key.
   - **Link/image editing UX:** clicking a link offers edit-URL tooltip (not navigate); images offer alt-text/resize properties.
   - **Hard break:** Shift+Enter inserts a hard line break; Enter inside a list item adds a new item (not a break). Alt+Enter reserved for OS menu conventions.
6. **Undo/redo — markdown-text level, never re-based on save:**
   - A single unified markdown-text undo stack with per-action snapshots, **shared by both editing surfaces** (WYSIWYG + Source), NEVER cleared or re-based at autosave — undo past a save restores the pre-save markdown bytes.
   - **Action-grouped coalescing:** one user action (applying bold) = one undo step, even though it spans multiple markdown edits.
   - Source-mode edits append markdown-text undo entries; view toggles never inject re-serializations into the undo chain.
   - The 50-step undo test asserts the markdown BYTES after each step (not merely parse success).
7. Find & replace (plain + regex toggle) operating on the **markdown text with preview**, excluding code spans/blocks and link URLs; the serialized result is re-validated (serialize→parse→serialize idempotence) before committing.

### 2.2 View modes
1. **WYSIWYG (default)** — rich rendered view, inline editing, explicit edit chrome (block handles, table cell borders, hover affordances).
2. **Source** — full-window raw markdown with syntax highlighting; toggled with Ctrl+/ (or F12); remembers last-used mode per file.
3. **Split** — side-by-side WYSIWYG + source, synchronized scrolling, **block-level** cursor mapping (not char-level; a documented fidelity budget), incremental block-granular parse/serialize per keystroke (no whole-document re-conversion).
4. **Preview** — rendered read-only, distinct from WYSIWYG: no edit chrome, mode labeled in status bar/title; primarily for print/review flow (paired with export).
5. Active mode always visible in the status bar; Ctrl+/ toggles between WYSIWYG and Source.

### 2.3 Files, platform & safety
1. Windows + Linux, same codebase. Arch: x64 both platforms (arm64 deferred). Windows 10/11 target confirmed (Win10 EOL 2025-10 — see council decision) — runners selected accordingly.
2. Native file dialogs (open/save/save-as), recent files list (tolerant of unreadable paths).
3. **Save pipeline (data-loss prevention):**
   - Atomic write: temp file → fsync → atomic rename (Rust/Tauri layer).
   - **Hash-compare-before-write:** if the on-disk file changed since load/watch, HOLD the write and prompt (never blind-overwrite an external edit).
   - `.bak` file written before honoring any explicit "overwrite" of an external change.
   - **Save reentrancy-safe:** dirty flag set on every mutation and re-checked after each write (loop until clean); saves serialized so two autosave ticks never interleave.
   - Crash recovery snapshot: always-on cheap cadence, decoupled from autosave (see §6.7 data-loss posture); written via same atomic path; on next open, if the .md fails to parse or is torn, offer restore from snapshot. Deletion of the on-disk file is a distinct watch event with an explicit prompt — never auto-create a deleted file, never discard a buffer on tab close without confirmation when the file is gone.
4. Encoding: UTF-8 (BOM detect on read, preserve BOM state on save). **Non-UTF-8 policy (council decision): detect → offer conversion to UTF-8, never silently write back** — refuse-or-convert with explicit prompt.
5. Line endings: detect dominant EOL once on load, normalize internally, emit the detected EOL on save (single-EOL policy); mixed-ending files get a fixture and a documented normalization entry. UTF-16 is refused with a conversion prompt (never mojibake write-back).
6. File watching: platform-native watcher (inotify / ReadDirectoryChangesW); editor opens files with read sharing (FILE_SHARE_READ|WRITE|DELETE on Windows) so external edits are observable. External modification prompt: **reload / keep mine / save-as** (merge deferred to a future version). Deletion = distinct prompted event.
7. **Windows path safety:** all fs ops in the Rust/Tauri layer on OsStr (JS gets display-only strings); reject reserved names (CON, NUL, AUX), trailing dots/spaces, >260-char paths with clear errors; non-ASCII names supported.
8. **Path serialization:** all paths written into markdown use forward slashes; file/config paths resolved via Tauri path API. Windows-style backslash paths in markdown are preserved verbatim (opaque leaf) — never interpreted as escapes.
9. Export targets can NEVER equal the open file's path (validated + blocked), exports write to temp first, and export extension filters prevent selecting `.md` as a target.

### 2.4 Document features
1. Document outline / headings navigator (click to jump).
2. Word count / char count / reading time in status bar.
3. Search within file; optional regex (per §2.1.7).
4. Multi-file: tabs. (Workspace/project tree is a NON-GOAL for v1 — see scope.)
5. **Performance envelope:** smooth editing at 1MB / ~10k lines; block-granular incremental parsing; large-file fixture in the acceptance corpus.

### 2.5 Import / Export (conversion)
1. **Export to PDF:** styled, print-ready; TOC option, page numbers, code highlighting preserved. Engine: **Typst** (known quantity from HOL; LaTeX not used in v1).
2. **Export to Word (.docx):** headings, bold/italic, lists, tables, images, footnotes survive as native Word constructs.
3. **Export to EPUB:** single-file EPUB (cover, TOC, chapter splits from headings).
4. **Export to TXT:** plain text (markdown stripped) or raw markdown per user choice.
5. **Import from Word (.docx):** converts to markdown; **import forces Save-As to a .md path before the buffer becomes editable** (plain Save disabled until a .md path exists — the source-of-truth rule never breaks).
6. **Import from TXT:** opens as markdown (file type recognized).
7. Foreign-format fidelity is best-effort (docx/epub are lossy by nature); **markdown is the only lossless format**. Round-trip guarantee (§2.1.4) applies to .md only.
8. Engine: **Pandoc**, **one pinned version bundled for release builds** (the only tested path); system-install detection is dev-only. Conversion behind a single service with a version gate.

### 2.6 Keyboard map (v1)
- Ctrl+B / Ctrl+I: bold / italic on selection
- Ctrl+K: link on selection
- Ctrl+Shift+X: strikethrough; Ctrl+E: inline code
- Ctrl+/ or F12: toggle WYSIWYG ↔ Source
- Shift+Enter: hard break; Enter in list: new item
- Tab / Shift+Tab: indent / outdent list items
- Ctrl+F: find; Ctrl+H: replace
- Ctrl+S: save; Ctrl+Shift+S: save as
- Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y): undo / redo
- `/` at block start (WYSIWYG): slash-command insert menu
- F1 (or Help menu): markdown cheatsheet (also first-run empty-state hints)

---

## 3. Scope / In

- v1.0: single-file editing with tabs, full feature set above, Windows + Linux builds (x64).
- Markdown engine: CommonMark compliance + GFM extensions + selected Pandoc extensions (front matter, footnotes, definition lists, sub/sup, highlight).
- Round-trip fidelity test suite (open → save → byte-compare) with a versioned normalization manifest.
- Import/export: PDF, DOCX, EPUB, TXT (both directions for DOCX/TXT; export for PDF/EPUB).
- Test infrastructure: acceptance-test.sh (runs under Git Bash on Windows), CI matrix, GUI driver.

## 4. Non-goals / Out (v1)

- No project/workspace explorer or multi-folder management.
- No collaborative editing / real-time sync / CRDT.
- No cloud sync or account system.
- No plugins/marketplace (architecture must ALLOW them later, but no plugin system in v1).
- No mobile/web versions.
- No proprietary binary format ever (core constraint).
- macOS, arm64 builds deferred.
- No built-in git UI (external git integration deferred).
- No 3-way merge UI in the external-change prompt (deferred).

---

## 5. Acceptance criteria (map 1:1 to tests in acceptance-test.sh)

1. **Round-trip fidelity:** ≥50 markdown fixtures (every feature in §2.1.3, plus CRLF/BOM/mixed-EOL/emoji/Windows-path/task-nested fixtures) — open → save → **byte-identical** for clean fixtures, per the normalization manifest (versioned, council-reviewed; each exception mapped to a §2.1 feature). No-edit save writes original bytes verbatim (hash path).
2. **Feature coverage:** every feature in §2.1.3 renders correctly in WYSIWYG (golden DOM/screenshot snapshot per fixture, diffed in CI — no human eyeballs) AND round-trips through source mode.
3. **Task list:** clicking a checkbox updates `[ ]` ↔ `[x]` as a byte-range splice in source (nested-task-list fixture included).
4. **List editing:** Enter continues lists; Tab/Shift-Tab indent/outdent; backspace on empty exits list — all reflected in source.
5. **Undo/redo:** 50-step sequence asserts markdown BYTES after each step; parse always succeeds; **undo past an autosave restores the pre-save markdown bytes**; action-grouped (one user action = one step); source-mode edits are undoable.
6. **Line endings:** CRLF file saves CRLF; LF saves LF; mixed-ending fixture round-trips per the manifest.
7. **BOM:** BOM file saves with BOM; non-BOM without; combined BOM+CRLF+emoji+reference-link fixture round-trips.
8. **Crash recovery:** crash-injection test hook (env-var panic point) — kill process mid-edit; reopen → recovery prompt restores the unsaved edit; kill during a 10MB save → disk file intact or fully recoverable. Runs headless via GUI driver.
9. **File watch:** external modification (from an app-independent writer process) prompts reload/keep/save-as; deletion prompts distinctly; no auto-create of deleted files.
10. **Platform:** editor launches and passes the core subset (§5.1–§5.12 headless) on Windows 10/11 + Linux (ubuntu-24.04, xvfb-run headless); CI matrix runs both; pinned pandoc + Typst engine on both legs.
11. **Front matter:** preserved verbatim except the edited field (byte-splice); fixture edits one field, asserts byte-identity of all other content.
12. **No data loss:** 1000-edit randomized stress sequence; oracle = replay against a reference serializer / internal doc AST; saved markdown parses AND matches the oracle modulo the manifest.
13. **Export PDF:** valid PDF (opens, page count ≥1, text extractable), Typst engine pinned.
14. **Export DOCX:** re-imports to semantically equivalent markdown (AST comparison modulo the shared comparator).
15. **Export EPUB:** valid EPUB, TOC entries match headings.
16. **Export TXT:** plain text and raw markdown options.
17. **Import DOCX:** yields editable markdown; forces Save-As to .md before editing; re-export round-trips content (shared comparator with §5.14).
18. **Import TXT:** opens as markdown.
19. **Packaging:** fresh VM (no dev toolchain) installs and launches on both platforms; Windows installer includes WebView2 Evergreen bootstrapper; Linux AppImage/deb launches on clean Ubuntu.
20. **Large file:** 1MB / ~10k-line fixture edits smoothly (no >250ms blocking keystroke).

---

## 6. Architecture decisions

1. **Stack (CONFIRMED by Bruce 2026-08-16):** Tauri 2 + TypeScript/React + ProseMirror (via TipTap) + unified (micromark) for parsing. Electron is the documented fallback, triggered only if WebKitGTK packaging blocks 2 consecutive release milestones (Bruce approves the switch).
2. **Markdown engine:** unified/micromark for parse + ProseMirror for editing; round-trip test gate; opaque verbatim leaf nodes for unrepresentable inline constructs (inline HTML, reference definitions, Windows paths).
3. **Undo model:** markdown-text undo stack shared across surfaces (per §2.1.6) — NOT PM doc-level. PM native undo disabled in favor of the unified stack.
4. **Auto-save + conflicts:** state machine per §2.3.3 — hash-compare-before-write; pause auto-save on external change; prompt, never auto-overwrite. (Merge deferred.)
5. **Settings:** per-user config (JSON/TOML in user config dir) — v1 minimal.
6. **Conversion backend:** one pinned Pandoc version bundled for releases; dev-only system detection; Typst for PDF (no LaTeX).
7. **Data-loss posture (CONFIRMED by Bruce 2026-08-16):** recovery snapshot on an always-on cheap cadence (e.g. every 2s of change, decoupled from autosave), so a crash never loses more than the last few seconds even with autosave OFF. Autosave default: OFF for explicit-save UX; the snapshot cadence provides the safety net.

---

## 7. Risks / failure modes

- **Round-trip lossiness** is the #1 risk — mitigated by the clean-path guarantee, block-granular re-serialization, the versioned normalization manifest, opaque verbatim leaf nodes, dirty-parse→raw-write fallback, and atomic+fsync writes.
- **Data-loss paths (Contrarian top 3):** (1) undo past autosave — mitigated by never-rebased markdown-text undo + byte assertion test; (2) save racing external rename/change — mitigated by hash-compare-before-write, temp+rename, .bak, distinct deletion event; (3) serializer mutation of un-normalizable markdown — mitigated by opaque leaves, manifest, raw-write fallback, atomic writes.
- **ProseMirror learning curve** — TipTap wrapper; phased build: CommonMark+GFM core first, Pandoc extensions second.
- **Cross-platform:** Windows WebView2 (bundled Evergreen bootstrapper) + Linux WebKitGTK 4.1 (bundled/installer check; clean-Ubuntu CI smoke); CRLF/BOM/path parity handled in §2.3.
- **Test infra:** acceptance-test.sh, CI matrix, GUI driver, and fixture corpus must exist before the first implementation PR (scaffold in the same commit as the first code).
- **Scope creep** into workspace/git/collab/merge — explicit non-goals.
- **Pandoc version skew** — one pinned bundled version is the only tested path.
- **Performance** — block-granular incremental parse; 1MB envelope with a large-file fixture.

---

## 8. Rollback plan

- v0 spec is a document. Once code exists: every milestone tagged; spec changes flow through council + Bruce; any feature can be reverted by reverting its PR (squash-merge discipline).
- Normalization manifest changes require a council round + Bruce sign-off (they change the product promise).

---

## 9. Council workflow (mirrors HOL)

- Five-lens review at milestones and on demand (see COUNCIL.md).
- Findings: `[file:line] SEVERITY — what — fix`.
- Mechanical → fix in-loop. Design-flavored → Bruce with implemented-default flag, one decision at a time. Contrarian findings on data-loss paths get special weight — never merged without explicit resolution.
- Implement-don't-report law: every review round ships a delta.
- Round log: docs/council-rounds.md.

---

## Appendix A — Council round 1 (2026-08-16) outcome

- 64 findings across five lenses (Architect 12, UX 12, Engineering Lead 12, Contrarian 16, Cross-Platform/QA 12).
- Incorporated in v0.2: clean-path save pipeline, unified markdown-text undo, normalization manifest, opaque leaf nodes, atomic writes, hash-compare-before-write, .bak, deletion event, non-UTF-8 policy, EOL policy, Windows path safety, forward-slash serialization, insert affordances + toolbar + slash commands, keyboard map, block exit mechanics, link/image edit UX, action-grouped undo, mode labeling, export-target protection, DOCX import forces Save-As, test infra (CI matrix, GUI driver, golden renders, crash hook), packaging criterion, performance envelope, Typst PDF, pinned Pandoc.
- **Confirmed by Bruce:** tech stack (Tauri 2 + TS/React + ProseMirror/TipTap + unified), data-loss posture (always-on snapshot cadence, autosave OFF default).
- **Deferred by council:** 3-way merge UI, plugins, workspace, arm64/macOS.
- Full findings detail in docs/council-rounds.md.

---

*Next: council round 2 after first implementation PR, or on demand.*
