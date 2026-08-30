You are implementing GitHub issue #23 ("[P0] 1.2 Wire File menu") in the QuillMD
repository (a Tauri 2 + React + TipTap markdown editor).

Working directory: /tmp/wt-quillmd-23 (git worktree, branch fp/23-1-2-wire-file-menu).
Implement the issue completely. When done, your work must be COMMITTED on
this branch. Do NOT push. Do NOT open a pull request (the harness does).
Do NOT modify files outside this worktree. Do NOT edit GitHub issues.

## Issue body (authoritative — wins over the plan doc on conflict)

Open (multi), Save As, Export, Import through dialogs.ts; delete prompt() paths; update `App.tsx` handlers.

---
Part of #21 ([P0] App shell & native file dialogs).
Plan doc: `docs/feature-parity/01-app-shell-dialogs.md` §5 task 1.2.

**Parent:** #21

## Plan doc context: docs/feature-parity/01-app-shell-dialogs.md
(Read it in the repo for background and design decisions; the issue body
above is the narrower, more recent artifact.)

## Golden rules (non-negotiable)
1. Markdown is the source of truth. Rich attributes serialize as stable
   HTML blocks / span attributes / comment tokens — never private JSON.
2. Byte-identical round-trip for untouched documents. tests/fixtures/ is
   the contract. IF you must change a fixture, you MUST also create a file
   named FIXTURE-CHANGE.md at the repo root explaining exactly why the
   fixture had to change, and commit it.
3. Local-only runtime: no network at runtime except bundled sidecars and
   user-initiated fetches. No telemetry.
4. Windows first-class: CRLF round-trip must hold; reserved-name rejection.
5. Do not weaken the save pipeline (src/lib/pipeline.ts clean-path logic)
   or the fs safety core (src-tauri/src/fs/safety.rs, snapshot.rs).

## Definition of done
- Every acceptance criterion in the issue body is implemented and covered
  by a test (vitest for TS, cargo test for Rust, or a new
  tests/acceptance-test.sh section for end-to-end behavior).
- npm test passes. npm run build passes (tsc type-check).
- If you touched anything under src-tauri/, cargo test (from src-tauri/)
  passes.
- Commits reference the issue number, e.g. "feat(<area>): <what> (#23)".

## Method
- Read the issue body and the plan doc section for your task first.
- Key files: src/lib/editorCommands.ts (the command registry — every
  toolbar/menu/context-menu action dispatches through it), src/App.tsx
  (tab state + menu-event routing), src-tauri/src/menu.rs (native menus),
  src/lib/markdown.ts (custom serialization), src/components/Editor.tsx
  (TipTap extensions and nodeviews).
- Implement, then run the tests yourself before finishing.
- Keep the change as small as the issue allows; no drive-by refactors.
