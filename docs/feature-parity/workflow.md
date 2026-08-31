# QuillMD Feature-Parity Execution Workflow

How the v2 plan suite (`docs/feature-parity/00-11`) gets built: a pipeline
script drives **OpenCode** through every sub-issue, one git worktree and one
PR per issue, with automated gates and resume/stop semantics.

Status: operational · Milestone: **Feature Parity (v2)**

## 1. Architecture

```
feature-parity-pipeline.sh          (orchestrator, human-invoked)
  └─ issue-run.sh <issue#>          (one sub-issue, one worktree)
       ├─ git worktree add  fp/<n>-<slug>
       ├─ opencode run --auto       (agent: reads issue + plan doc, implements)
       ├─ gates: npm test · npm run build · cargo test (if rust touched)
       ├─ git push + gh pr create   (body: issue, verification, acceptance map)
       └─ git worktree remove
```

- **One sub-issue = one branch = one PR.** Parent issues stay open until
  their sub-issue PRs are all merged (checked manually or by the pipeline
  on resume).
- **Worktrees** live under `/tmp/wt-quillmd-<n>`; the main checkout
  (`~/repos/quillmd`) is never modified by the pipeline.
- **OpenCode runs with `--auto`** (auto-approve permissions) inside the
  worktree only. The model is whatever `~/.config/opencode/opencode.jsonc`
  points at (currently local Qwen3.8-27B).

## 2. Execution order

The pipeline walks the milestone in dependency order. Within a wave,
sub-issues of the same parent run **sequentially** (they share files);
different parents in the same wave could run in parallel, but the default
is sequential to keep review load and merge conflicts manageable.

| Wave | Parents (issues) | Rationale |
|---|---|---|
| 1 (P0) | #21 app shell & dialogs | Everything downstream touches dialogs/confirm |
| 2 (P1) | #29 editor core, #68 find/replace, #75 links/media | Editing core + real find + media |
| 3 (P2) | #46 fonts, #53 styles, #60 tables, #99 mermaid | Presentation layer |
| 4 (P3) | #38 context menus, (file-menu remainder of #21 if any) | Interaction |
| 5 (P4) | #83 doc tools, #92 view/settings | Document tools + settings |

Ordering inside a wave follows issue number. The pipeline derives the list
live from GitHub (label + milestone + sub-issue numbering), so it is correct
even after the suite is edited.

## 3. Per-issue contract (injected into every opencode prompt)

The prompt given to OpenCode contains, in order:

1. **Identity** — you are implementing GitHub issue `#<n>` of
   bruceamoser/quillmd in worktree `<path>` on branch `fp/<n>-<slug>`.
2. **The issue body verbatim** (fetched with `gh issue view <n> --json body`).
3. **The parent plan doc** (`docs/feature-parity/<doc>.md`) — read for
   context; the issue body wins on conflict.
4. **The golden rules** (below), condensed.
5. **Definition of done** (below).
6. **Constraints** — do not push to main; do not modify other branches;
   do not edit issues; stop and report if a golden rule would be violated
   (implement the simplest compliant version instead).

### Golden rules (invariant summary)

1. Markdown is the source of truth; rich attributes serialize as stable
   HTML/comment tokens, never private JSON.
2. Byte-identical round-trip for untouched docs — `tests/fixtures/` is the
   contract; changing a fixture requires explicit justification in the PR.
3. Local-only runtime: no network except bundled sidecars and
   user-initiated fetches.
4. Windows first-class: CRLF round-trip, reserved-name rejection.
5. Clean-path save pipeline untouched unless the issue says so.
6. Never weaken `src-tauri/src/fs/safety.rs` or `snapshot.rs`.

### Definition of done

- Issue acceptance criteria pass.
- New behavior has tests (vitest / cargo test / acceptance section).
- `npm test` + `npm run build` green; `cargo test` if Rust touched.
- Commit(s) reference the issue number; PR body maps each acceptance
  criterion to its test.

## 4. Gates

After the agent exits, `issue-run.sh` runs, in order (failure aborts the PR
and closes the worktree, leaving the branch pushed for inspection):

1. `npm test` (includes all round-trip fixtures)
2. `npm run build` (type-check + bundle)
3. `cd src-tauri && cargo test` (only if the diff touches `src-tauri/`)
4. Fixture-diff check: if `tests/fixtures/*` changed, the PR body must
   contain the string `fixture-change-justified:` — otherwise the gate
   fails (forces the agent to explain).

## 5. Resume, stop, and human checkpoints

- **Resume-safe:** the pipeline keeps state in
  `scripts/.fp-pipeline-state.json` (`{issue: pr_number}`). On re-run it
  skips issues that already have an open or merged PR, and continues.
- **Stop-on-fail (default):** a failed *gate* (rc=3) halts the wave; the
  failed issue is left with its branch pushed and a `FAILED <issue#> <gate>`
  line in the log. Fix manually (or re-run the pipeline after the agent fixes).
  An agent that exits **without committing** (rc=2, usually ran out of turns
  mid-plan) is retried **once automatically** before the wave halts.
- **`--merge`:** squash-merge each PR the moment it passes the gates.
  Without it, PRs in a wave all branch from the same `main`, and because
  tasks in a wave share files (App.tsx, menu.rs, editorCommands.ts), the
  queue will conflict after a few land. With it, every issue builds on the
  freshly updated `main`, so a full 74-issue run stays conflict-free.
  Everything is still fully reviewable (PR diffs + squash commits); revert
  with `git revert <squash-sha>` if needed.
- **`--force <issue#>`:** re-run a specific issue even if it has a PR
  (the old PR is closed first).
- **Tier pauses (default OFF, flag `--pause`):** after each wave, the
  pipeline stops and prints the wave's PRs for human review before
  continuing. Recommended for wave 1 and 3 (highest blast radius).
- **Merging is opt-in (`--merge`).** Default runs stop at a green PR and
  leave merging to a human. With `--merge` (the mode for the full
  74-issue run), each passing PR is squash-merged immediately.
- **Memory guard:** before each issue the pipeline checks
  `MemAvailable`; below 6 GiB it waits (60s polls) instead of starting a
  new opencode run. This box is shared with llama-server (which also
  serves the agent and the chat), and a run started on thin headroom can
  be OOM-killed mid-issue.
- **Salvage net:** if a worktree is found with uncommitted work from a
  prior killed run, `issue-run.sh` commits it as a `wip(#N)` safety-net
  before discarding the worktree. The re-run still starts from a fresh
  `origin/main`; the WIP commit survives in the branch reflog for
  cherry-pick if it was real work.

## 6. Usage

```bash
cd ~/repos/quillmd

# Full run (all remaining sub-issues, wave order, auto-merge each PR):
bash scripts/feature-parity-pipeline.sh --merge

# With human review checkpoints after each wave:
bash scripts/feature-parity-pipeline.sh --pause

# One specific sub-issue (any time, manual mode):
bash scripts/issue-run.sh 22

# Re-run a failed/older issue (closes its old PR first):
bash scripts/issue-run.sh 22 --force

# Dry run: print the execution order without doing anything:
bash scripts/feature-parity-pipeline.sh --dry-run
```

Logs: `scripts/.fp-pipeline.log` (append per run), per-issue opencode output
under `scripts/.fp-runs/<issue#>.log`.

## 7. Failure playbook

| Symptom | First move |
|---|---|
| Gate fails on fixtures | Read the fixture diff; agent broke round-trip. Re-run the issue with a prompt addendum quoting the diff. |
| Agent loops / doom-loop | Stop it; read `scripts/.fp-runs/<n>.log`; usually a missing dep or a wrong API. Add a hint to the issue body and `--force`. |
| PR conflicts with a later merge | `git rebase main` in a fresh worktree, push, PR updates itself. |
| Model produces broken TS that `npm test` passes but `npm run build` rejects | Expected: build is the type gate. Re-run with `--force`; the agent sees the error in the gate output. |
| Rust gate fails but TS is green | The agent touched Rust without `cargo test` discipline. Re-run; if twice, demote the sub-issue to a human task. |

## 8. What this workflow deliberately does NOT do

- No auto-merge, no auto-close of issues (human merges; issues close via
  PR `Closes #n` on merge).
- No parallel worktrees by default (conflict risk on shared files like
  `editorCommands.ts`, `App.tsx`, `menu.rs` outweighs wall-clock savings).
- No changes to the plan suite from inside the pipeline; plan edits are a
  separate human/agent task.
