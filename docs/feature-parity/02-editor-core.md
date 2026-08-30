# Plan 02 — WYSIWYG Editor Core Upgrade (P1)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P1/editor-core`
Depends on: P0 (dialogs for paste/asset flows) · Unblocks: P2/P3 (styles, context menus build on these commands)

## 1. Problem

The WYSIWYG surface covers inline marks and block insertion, but the everyday
paragraph-level controls from Word/Docs are missing: underline button (extension
present, unexposed), text alignment, indent/outdent, line spacing, show
formatting marks, zoom, word wrap, spellcheck, paste-as-text, and a proper
keyboard model for list/heading editing. Word's Home > Font + Paragraph groups
and Docs' Format > Text/Paragraph are the reference surface.

## 2. Scope

1. **Expose underline** — toolbar + Format menu + `Ctrl+U` + command registry
   entry. (`@tiptap/extension-underline` is already loaded in `Editor.tsx`.)
2. **Text alignment** — left/center/right for paragraphs, headings, blockquotes,
   code blocks. Markdown has no alignment, so implement as a **TipTap
   `textStyle`-adjacent block attribute** (`textAlign`) stored in an HTML
   attribute on the rendered block, serialized through the clean path as an
   HTML comment marker or a pandoc attribute (`{.align-center}`) — decision in
   §3. Toolbar buttons + Format > Paragraph submenu + context menu (P3).
3. **Indent / outdent** — for lists (native TipTap `sinkListItem`/`liftListItem`
   on selected list items) and for blockquotes (wrap/unwrap). Word parity:
   `Ctrl+]` / `Ctrl+[`. Non-list paragraphs: map to 4-space indent only in
   source view (no-op in WYSIWYG — document this; markdown has no paragraph
   indent).
4. **Line spacing** — single/1.15/1.5/double via a document-level CSS variable
   (per-doc setting stored in `DocState.settings`, rendered through the
   ProseMirror content container). No markdown representation — acceptable:
   it is a *view* preference, like view mode (which already persists per path).
5. **Show formatting marks** — View menu toggle: render pilcrows (¶) and
   hidden whitespace via CSS `::after` on block nodes + inline `pre` styling.
   Word parity: `¶` button in Paragraph group.
6. **Zoom** — 50-200% in 10% steps (Word/Docs parity): View > Zoom submenu
   (Zoom In/Out/Reset) + `Ctrl+=`/`Ctrl+-`/`Ctrl+0`; implemented as CSS
   `zoom` on the editor content container; per-doc persisted like view mode.
7. **Word wrap / no wrap** — View toggle for source + WYSIWYG (WYSIWYG wrap is
   on by default; no-wrap = horizontal scroll).
8. **Spell check** — enable `contenteditable` spellcheck in the WYSIWYG editor
   (currently `spellcheck: "false"`), plus a View/Review toggle and a status-bar
   indicator. WebKitGTK/WebView2 provide the engine; no bundled dictionary
   required. (Plan 09 adds the word-count dialog and explicit spell-check
   command on top.)
9. **Paste handling** — `Paste` (keep formatting within markdown semantics)
   and `Paste as text` (`Ctrl+Shift+V`): strip to plain text via TipTap
   `clipboardTextParser` path; both in Edit menu + context menu (P3).
10. **Heading/list keyboard ergonomics** — Tab/Shift+Tab inside lists (native
    TipTap), `Ctrl+1..6` for heading levels, `Ctrl+0` currently zoom — use
    `Ctrl+Alt+0` for "reset to Paragraph" to avoid collision (documented).

Out of scope: format painter, character-level kerning/letter-spacing, drop
caps, first-line indent.

## 3. Design notes

- **Alignment serialization decision:** use pandoc/HTML block attribute
  `class="quillmd-align-center"` inside the block's HTML, emitted by the
  serializer only when alignment differs from left. Clean-path save: docs
  with zero alignment edits remain verbatim (attribute only appears where the
  user aligned). Preview/Source views render the same classes. This keeps the
  markdown file human-readable and grep-able, and survives round-trips because
  the rehype/remark path preserves classed HTML blocks.
- All new commands join the `EDITOR_COMMANDS` registry with ids:
  `underline`, `alignLeft`, `alignCenter`, `alignRight`, `indent`, `outdent`,
  `lineSpacing` (with param), `showMarks`, `pasteAsText`. Menus, toolbar,
  context menus, and shortcuts dispatch only through the registry (non-
  negotiable #3 from the overview).
- Alignment + line spacing state lives in `DocState.settings` (persisted with
  view mode) for the *default* doc-level values; per-block alignment lives in
  the node attrs (part of the document text).
- Zoom: CSS `zoom` on `.quillmd-editor-content`; status bar shows percent;
  `Ctrl+mouse-wheel` adjusts (Word behavior).
- Formatting marks: pure CSS on a wrapper class `quillmd-show-marks`; no doc
  mutation — guarantees zero round-trip risk.

## 4. Acceptance criteria

1. Underline toggles from toolbar, menu, `Ctrl+U`, and (P3) context menu;
   serializes to `<u>` HTML that survives save/reopen byte-identically when
   untouched.
2. Center-align a heading: saved file contains the alignment class on that
   block only; reopen renders centered; a doc with no aligned blocks is
   saved verbatim.
3. Tab/Shift+Tab re-nests list items; `Ctrl+1..6` set heading levels;
   shortcuts listed in Help > Shortcuts dialog.
4. Zoom 50-200% via menu + `Ctrl+=`/`Ctrl+-` + Ctrl-wheel; resets with
   `Ctrl+0`; per-doc persisted; status bar shows current percent.
5. ¶ toggle shows pilcrows/whitespace without altering the document text
   (verified by hashing `currentText` before/after toggle).
6. Paste from Word (rich HTML) → keeps bold/italic/links/headings;
   `Ctrl+Shift+V` → plain text only. Both paths covered by a vitest using a
   captured clipboard payload.
7. Spellcheck underline appears for misspelled words in WYSIWYG; toggle in
   View menu; disabled in source view (CodeMirror).
8. All M1-M6 suites + new tests green; round-trip fixture suite green.

## 5. Tasks (each → sub-issue)

1. **Registry expansion** — add the 10 new command ids with handlers in
   `editorCommands.ts`; unit tests for active-state detection.
2. **Underline** — toolbar button, Format menu item, shortcut, registry wiring.
3. **Alignment** — node-attr plugin + serializer support + toolbar/menu UI +
   round-trip tests (aligned doc, unaligned doc verbatim).
4. **Indent/outdent + list keyboard** — sink/lift wiring, `Ctrl+]/[`, Tab
   behavior in nested lists and blockquotes.
5. **Line spacing + word wrap + formatting marks** — DocState.settings
   persistence, CSS, View menu toggles.
6. **Zoom** — zoom state, menu submenu, shortcuts, Ctrl-wheel handler, status
   bar display.
7. **Spellcheck + paste handling** — enable attr + toggle, paste-as-text
   command, clipboard vitest with a real Word-exported HTML sample.
8. **Acceptance** — `tests/acceptance-test.sh` section `p1-editor`; manual
   Windows checklist.
