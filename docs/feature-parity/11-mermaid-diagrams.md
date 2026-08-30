# Plan 11 — Mermaid Diagrams: Insert, Edit, Visualize (P2)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P2/mermaid`
Depends on: P1 (registry), P0 (dialogs for image flows) · Unblocks: —
Related: P3 (#38) adds the diagram context-menu items on top of this plan's
commands.

## 1. Problem

Word has Charts; Docs has Insert > Chart; both are first-class diagram
surface. Markdown's native answer to "diagram in a document" is a **Mermaid
fenced code block** (` ```mermaid `) — it is what GitHub, Obsidian, and
Notion all render, so QuillMD documents stay portable to every major
renderer. Today QuillMD shows a mermaid fence as a plain code block: no
insert affordance, no rendered visualization, no editing experience.

Goal: a user can **add** a mermaid diagram (menu/slash), **edit** its source
in place, and **see** the live rendered result in WYSIWYG and Preview —
with export producing real images in PDF/DOCX/EPUB.

## 2. Scope

1. **Insert** — `Insert > Diagram (Mermaid)` menu item, toolbar button, and
   `/diagram` slash command. Inserts a mermaid block with a starter template
   (a 3-node flowchart) at the cursor.
2. **WYSIWYG rendering** — the block renders as a **card**: header bar
   ("Mermaid" label, Edit/Preview toggle, error badge) over the live SVG
   render. Debounced re-render (~300 ms) while the source changes. Syntax
   errors show a red badge + the first error line in the card footer — the
   card never breaks the editor (render failure = show source, not a
   crash).
3. **In-place editing** — Edit mode swaps the card body to an editable
   source surface (monospace, same node text — ProseMirror content, so
   undo/redo and the unified markdown-text undo work unchanged). Preview
   mode is read-only SVG with click-to-edit.
4. **Preview view** — renders the same SVG (shared render service).
5. **Source view** — the fence is plain text; CodeMirror gets lightweight
   mermaid syntax coloring (keyword set: graph/flowchart/sequenceDiagram/
   classDiagram/erDiagram/stateDiagram/gantt/pie/gitgraph/timeline — a
   small highlight definition, no full grammar).
6. **Export** — PDF/DOCX/EPUB export renders each mermaid block to **PNG**
   client-side (SVG → canvas → PNG at 2× scale), writes `diagram-N.png` next
   to the temp export markdown, and swaps the fence for
   `![diagram](diagram-N.png)` before invoking pandoc. PNG is universally
   accepted by pandoc's PDF (Typst), DOCX, and EPUB writers.
7. **Zoom/fit** — SVG is vector; the card scales to container width, with a
   "fit" behavior for wide diagrams (horizontal scroll fallback).
8. **Context menu items** — defined here, implemented under plan 03 (#38):
   Edit diagram / Preview diagram / Copy diagram code / Delete diagram.

Out of scope: interactive diagrams (click handlers — `securityLevel:
'strict'`), theme customization per diagram (document-level theme only),
mermaid v11 beta-only features, diagram search, embedded images *inside*
mermaid (supported by the renderer as-is, no extra work).

## 3. Design notes

- **Node model:** new TipTap node `mermaidBlock` — `content: "text*"`,
  `code: true` (like codeBlock), group `block`, parsing from
  `pre > code.language-mermaid`, rendering back to a fenced block with the
  `mermaid` info string. **Serialization is a plain code fence → the
  byte-identical round-trip invariant is trivially preserved** (the fence
  text is the document content; the SVG is a view artifact, never stored).
- **Render service** (`src/lib/mermaidRender.ts`): wraps `mermaid` (npm,
  MIT; init once with `securityLevel: 'strict'`, theme mapped from the
  active QuillMD theme — light/dark). `render(text) -> { svg, error }`
  using an offscreen container + `mermaid.render` with a unique id per
  call (avoids the classic duplicate-id race). Debounced in the NodeView.
- **NodeView UI** (`src/components/MermaidCard.tsx`, TipTap React NodeView):
  - Preview: SVG injected (sanitized by mermaid's strict mode), card chrome.
  - Edit: textarea-backed surface bound to the node text
    (`editor.view.updateState` on change — same pattern as the code-block
    language flow), 300 ms debounced re-render behind a "rendering…" chip.
  - Error state: amber/red badge, `error.message` + line in the footer,
    source still visible (never blank).
- **PNG export path:** on `exportDocument` (Rust), the frontend first
  pre-renders: for each mermaid block in the current doc, render SVG →
  draw to a 2× canvas → `toBlob('image/png')` → pass bytes to a new Rust
  command `export_write_asset(name, bytes) -> path` (writes into the export
  temp dir, collision-safe names). The markdown passed to pandoc has fences
  swapped for image refs. All-or-nothing: if any diagram fails to render,
  export shows the error and lists the failing diagram (no silent drop, no
  half-export).
- **Starter template:**
  `graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n  B -->|No| D[Retry]`
- **Dependency:** `mermaid` v11 (add to package.json; ~1.9 MB min —
  acceptable for a desktop app; loaded lazily via dynamic import on first
  diagram so the editor stays fast to open).
- **No new sidecar:** rendering is client-side (webview), so the
  "single installer, zero prerequisites" promise is unchanged and
  `pandoc-mermaid`/`mmdc` (which need a headless Chromium) are deliberately
  avoided.

## 4. Acceptance criteria

1. Insert > Diagram (and `/diagram`, toolbar) creates a fenced mermaid
   block with the starter template; the saved file contains exactly that
   fence; a doc with diagrams saved without edits is byte-identical on
   re-save (hash check).
2. Editing the source re-renders within ~500 ms; a syntax error shows the
   error badge + message and does not break editing or the rest of the
   document.
3. WYSIWYG and Preview show the same SVG; switching themes re-renders with
   the mapped light/dark theme.
4. Wide diagrams fit or scroll; SVG stays sharp at any window size.
5. Export PDF/DOCX/EPUB of a doc with 2 diagrams: output contains 2 PNG
   images in the right positions; export with a broken diagram is refused
   with a named error.
6. Source view shows the fence with mermaid keyword coloring.
7. Undo/redo across diagram edits stays at the markdown-text level
   (undo restores the prior fence text exactly).
8. Editor startup time regression < 100 ms (lazy import verified by a
   startup perf test).

## 5. Tasks (each → sub-issue)

1. **mermaidBlock node + extension** — parse/render fence, TipTap
   registration, slash/menu/toolbar wiring (Insert > Diagram), starter
   template; round-trip fixture tests.
2. **Mermaid render service** — lazy `mermaid` init, strict security,
   theme mapping, render/error API, debounce; unit tests (happy-dom).
3. **MermaidCard NodeView** — preview/edit modes, error badge, SVG
   injection, fit/scroll; interaction test.
4. **Source + Preview view support** — CodeMirror mermaid highlight
   definition; Preview render via the shared service.
5. **PNG export pipeline** — `export_write_asset` Rust command, SVG→canvas
   PNG, fence-swap in the export flow, failure reporting; fixture export
   test (2 diagrams + 1 broken).
6. **Context menu definition** — the diagram node's context-menu item set
   (edit/preview/copy-code/delete) specified for plan 03 (#38) to implement.
7. **Acceptance** — `p2-mermaid` harness section; startup perf gate;
   Windows manual pass (insert → edit → export PDF/DOCX).
