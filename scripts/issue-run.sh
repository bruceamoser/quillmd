#!/usr/bin/env bash
# issue-run.sh — implement one QuillMD feature-parity sub-issue via OpenCode.
#
# Usage:
#   bash scripts/issue-run.sh <issue-number> [--force] [--merge]
#
#   --force  re-run even if the issue already has an open/merged PR
#   --merge  squash-merge the PR right after it opens (gates must pass)
#
# What it does (see docs/feature-parity/workflow.md for the full contract):
#   1. Fetches the issue (must be a sub-issue: title matches "[PN] X.Y ...").
#   2. Creates a git worktree /tmp/wt-quillmd-<n> on branch fp/<n>-<slug>.
#   3. Runs `opencode run --auto` with the issue body + plan doc + rules.
#   4. Gates: npm test, npm run build, cargo test (if rust touched),
#      fixture-justification check.
#   5. Pushes branch + opens a PR (never merges).
#   6. Removes the worktree (branch is kept on the remote).
#
# Exit codes: 0 = PR opened, 1 = usage/setup error, 2 = agent failed,
#             3 = gate failed (branch left pushed for inspection).

set -u -o pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="bruceamoser/quillmd"
OPENCODE="${OPENCODE:-$HOME/.opencode/bin/opencode}"
WT_BASE="/tmp/wt-quillmd"
# Reuse the main repo's warm cargo target so worktree gates don't rebuild
# the entire Tauri tree from scratch (a cold 16-way build OOMs this box).
CARGO_TARGET_SHARED="$REPO_DIR/src-tauri/target"
RUNS_DIR="$REPO_DIR/scripts/.fp-runs"
STATE_FILE="$REPO_DIR/scripts/.fp-pipeline-state.json"

ISSUE=""
FORCE=0
MERGE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --merge) MERGE=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    [0-9]*) ISSUE="$arg" ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done
[ -n "$ISSUE" ] || { echo "usage: $0 <issue-number> [--force]" >&2; exit 1; }
[ -x "$OPENCODE" ] || { echo "opencode not found at $OPENCODE" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
mkdir -p "$RUNS_DIR"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# --- 1. fetch issue ---------------------------------------------------------
ISSUE_JSON="$(gh issue view "$ISSUE" --repo "$REPO" --json number,title,body,labels 2>&1)" \
  || { echo "cannot fetch issue #$ISSUE: $ISSUE_JSON" >&2; exit 1; }
TITLE="$(jq -r '.title' <<<"$ISSUE_JSON")"
BODY="$(jq -r '.body' <<<"$ISSUE_JSON")"

# sub-issues are numbered "X.Y" after the [PN] tag
if ! grep -qE '^\[P[0-9]\] [0-9]+\.[0-9]+ ' <<<"$TITLE"; then
  echo "#$ISSUE ($TITLE) is not a sub-issue (no 'X.Y' in title). Refusing." >&2
  exit 1
fi
PLAN_NUM="$(grep -oE '^\[P[0-9]\] [0-9]+' <<<"$TITLE" | grep -oE '[0-9]+$')"
PARENT_LINE="$(grep -oE '\*\*Parent:\*\* *#[0-9]+' <<<"$BODY" | grep -oE '[0-9]+')"
[ -n "$PARENT_LINE" ] || { echo "no **Parent:** #N found in issue body" >&2; exit 1; }
PARENT="$PARENT_LINE"

# plan doc name from parent issue title (parents are "docs/feature-parity/<NN>-*.md")
PARENT_TITLE="$(gh issue view "$PARENT" --repo "$REPO" --json title --jq .title)"
PLAN_DOC="$(printf '%02d' "$PLAN_NUM")-"*.md
PLAN_DOC_PATH="$(ls "$REPO_DIR"/docs/feature-parity/${PLAN_DOC} 2>/dev/null | head -1)"
[ -n "$PLAN_DOC_PATH" ] || { echo "plan doc for plan $PLAN_NUM not found" >&2; exit 1; }

SLUG="$(printf '%s' "$TITLE" | sed -E 's/^\[P[0-9]\] //; s/[^a-z0-9]+/-/gi' | tr '[:upper:]' '[:lower:]' | cut -c1-32 | sed -E 's/-$//')"
BRANCH="fp/${ISSUE}-${SLUG}"
WT="$WT_BASE-$ISSUE"
LOGFILE="$RUNS_DIR/${ISSUE}.log"

# --- resume / force handling ------------------------------------------------
if [ "$FORCE" -eq 0 ]; then
  STATE_PR="$(jq -r --argjson n "$ISSUE" '.[$n|tostring].pr // empty' "$STATE_FILE" 2>/dev/null)"
  if [ -n "$STATE_PR" ]; then
    PR_STATE="$(gh pr view "$STATE_PR" --repo "$REPO" --json state --jq .state 2>/dev/null)"
    case "$PR_STATE" in
      OPEN|open|MERGED|merged) log "issue #$ISSUE already has PR #$STATE_PR ($PR_STATE) — skipping (use --force to redo)"; exit 0 ;;
    esac
  fi
fi
if [ "$FORCE" -eq 1 ] && [ -n "${STATE_PR:-}" ]; then
  gh pr close "$STATE_PR" --repo "$REPO" --comment "superseded by re-run of issue #$ISSUE" >/dev/null 2>&1 || true
fi
if [ -d "$WT" ]; then
  # Recovery net: if a prior (possibly OOM-killed) run left uncommitted work,
  # commit it as a WIP safety-net on the existing branch before discarding the
  # worktree, so the work is never irrecoverably lost. The re-run still starts
  # from a fresh origin/main (below); the WIP commit is reachable via the
  # branch's reflog if you need to cherry-pick it back.
  if [ -n "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; then
    git -C "$WT" add -A >/dev/null 2>&1
    if git -C "$WT" commit -q -m "wip(#${ISSUE}): salvage uncommitted work from prior run" 2>/dev/null; then
      log "salvaged uncommitted work from prior run as WIP commit (see branch reflog)"
    fi
  fi
  git -C "$REPO_DIR" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
fi

# --- 2. worktree ------------------------------------------------------------
log "issue #$ISSUE: $TITLE"
log "plan: $(basename "$PLAN_DOC_PATH")  parent: #$PARENT  branch: $BRANCH"
git -C "$REPO_DIR" fetch origin main --quiet
git -C "$REPO_DIR" worktree add -B "$BRANCH" "$WT" origin/main >/dev/null
cd "$WT" || exit 1

# deps (real install per worktree; npm cache makes repeat runs fast)
npm install --no-audit --no-fund --loglevel=error >/dev/null || { log "npm install FAILED"; exit 3; }

# --- 3. opencode ------------------------------------------------------------
PROMPT_FILE="$RUNS_DIR/${ISSUE}-prompt.md"
{
  cat <<PROMPT
You are implementing GitHub issue #${ISSUE} ("${TITLE}") in the QuillMD
repository (a Tauri 2 + React + TipTap markdown editor).

Working directory: ${WT} (git worktree, branch ${BRANCH}).
Implement the issue completely. When done, your work must be COMMITTED on
this branch. Do NOT push. Do NOT open a pull request (the harness does).
Do NOT modify files outside this worktree. Do NOT edit GitHub issues.

## Issue body (authoritative — wins over the plan doc on conflict)

${BODY}

## Plan doc context: docs/feature-parity/$(basename "$PLAN_DOC_PATH")
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
- Commits reference the issue number, e.g. "feat(<area>): <what> (#${ISSUE})".

## Method
- Read the issue body and the plan doc section for your task first.
- Key files: src/lib/editorCommands.ts (the command registry — every
  toolbar/menu/context-menu action dispatches through it), src/App.tsx
  (tab state + menu-event routing), src-tauri/src/menu.rs (native menus),
  src/lib/markdown.ts (custom serialization), src/components/Editor.tsx
  (TipTap extensions and nodeviews).
- Implement, then run the tests yourself before finishing.
- Keep the change as small as the issue allows; no drive-by refactors.
PROMPT
} > "$PROMPT_FILE"

log "running opencode (log: $LOGFILE) ..."
"$OPENCODE" run --auto --dir "$WT" --title "fp-$ISSUE" \
  "$(cat "$PROMPT_FILE")" >"$LOGFILE" 2>&1
AGENT_RC=$?
if [ "$AGENT_RC" -ne 0 ]; then
  log "opencode exited rc=$AGENT_RC — see $LOGFILE"
  # leave worktree for inspection
  log "worktree kept at $WT for inspection"
  exit 2
fi
# agent must have committed something
if git -C "$WT" log origin/main..HEAD --oneline | grep -q .; then
  log "agent committed $(git -C "$WT" log origin/main..HEAD --oneline | wc -l | tr -d ' ') commit(s)"
else
  log "agent made no commits — inspect $LOGFILE"
  exit 2
fi

# --- 4. gates ----------------------------------------------------------------
gate_fail() {
  log "GATE FAILED: $1"
  log "branch pushed for inspection; worktree kept at $WT"
  git -C "$WT" push -u origin "$BRANCH" >/dev/null 2>&1 || true
  exit 3
}
# run_gate <name> <workdir> <command...>
# A single failing gate run is not trusted to be deterministic: jsdom/Tiptap
# suites occasionally flake (shared editor globals, async act() timing). The
# gate runs up to 3 times; a pass on any attempt is a pass, a fail on all is a
# real gate failure. Without this, one flaky run halts the whole 70-issue
# run (see issue #55: 736/736 green twice, one flaky assertion on the 3rd).
run_gate() {
  local name="$1" dir="$2"; shift 2
  local attempt=1 max=3
  while [ "$attempt" -le "$max" ]; do
    log "gate: $name (attempt $attempt/$max)"
    if (cd "$dir" && "$@") >>"$LOGFILE" 2>&1; then
      [ "$attempt" -eq 1 ] || log "gate: $name passed on attempt $attempt (flake)"
      return 0
    fi
    [ "$attempt" -eq 1 ] && log "gate: $name failed — re-running to rule out flake"
    attempt=$((attempt + 1))
  done
  gate_fail "$name"
}
run_gate "npm test" "$WT" npm test
run_gate "npm run build" "$WT" npm run build
if git -C "$WT" diff origin/main..HEAD --name-only | grep -q '^src-tauri/'; then
  # CARGO_BUILD_JOBS=4: full-core parallel rustc OOMs this box (swap 8G);
  # hard rule is -j 4 for local builds.
  (cd "$WT/src-tauri" && CARGO_TARGET_DIR="$CARGO_TARGET_SHARED" CARGO_BUILD_JOBS=4 cargo test) >>"$LOGFILE" 2>&1 \
    || gate_fail "cargo test"
fi
if git -C "$WT" diff origin/main..HEAD --name-only | grep -q '^tests/fixtures/'; then
  [ -f "$WT/FIXTURE-CHANGE.md" ] || gate_fail "fixture changed without FIXTURE-CHANGE.md justification"
  log "gate: fixture change justified (FIXTURE-CHANGE.md present)"
fi
log "all gates passed"

# --- 5. PR -------------------------------------------------------------------
git -C "$WT" push -u origin "$BRANCH" >/dev/null 2>&1 || gate_fail "git push"

PR_BODY_FILE="$RUNS_DIR/${ISSUE}-pr.md"
{
  echo "## Issue"
  echo "Closes #$ISSUE — ${TITLE}"
  echo
  echo "Parent: #$PARENT · Plan: \`docs/feature-parity/$(basename "$PLAN_DOC_PATH")\`"
  echo
  echo "## Commits"
  git -C "$WT" log origin/main..HEAD --oneline | sed 's/^/- /'
  echo
  echo "## Verification"
  echo "- [x] npm test (incl. round-trip fixtures)"
  echo "- [x] npm run build (tsc + vite)"
  if git -C "$WT" diff origin/main..HEAD --name-only | grep -q '^src-tauri/'; then
    echo "- [x] cargo test"
  fi
  if [ -f "$WT/FIXTURE-CHANGE.md" ]; then
    echo
    echo "## Fixture change justification"
    cat "$WT/FIXTURE-CHANGE.md"
  fi
  echo
  echo "## Acceptance mapping"
  echo "(see issue body; each criterion covered by tests listed in commits)"
} > "$PR_BODY_FILE"

PR_URL="$(gh pr create --repo "$REPO" --base main --head "$BRANCH" \
  --title "$TITLE" --body-file "$PR_BODY_FILE" 2>&1)" \
  || gate_fail "gh pr create"
PR_NUM="$(basename "$PR_URL")"
log "PR opened: $PR_URL"

if [ "$MERGE" -eq 1 ]; then
  if gh pr merge "$PR_NUM" --repo "$REPO" --squash --delete-branch >/dev/null 2>&1; then
    log "PR #$PR_NUM merged (squash)"
  else
    log "warning: merge of PR #$PR_NUM failed (conflict?); PR left open for manual merge"
  fi
fi

# --- bookkeeping -----------------------------------------------------------
git -C "$REPO_DIR" worktree remove --force "$WT" >/dev/null 2>&1 || true
if [ ! -s "$STATE_FILE" ] || ! jq -e . "$STATE_FILE" >/dev/null 2>&1; then
  echo '{}' > "$STATE_FILE"
fi
TMP_STATE="$(mktemp)"
if jq --argjson n "$ISSUE" --arg pr "$PR_NUM" --arg br "$BRANCH" \
  '.[$n|tostring] = {pr: ($pr|tonumber), branch: $br}' "$STATE_FILE" >"$TMP_STATE"; then
  mv "$TMP_STATE" "$STATE_FILE"
else
  rm -f "$TMP_STATE"
  echo "warning: state update failed (PR still opened: $PR_URL)" >&2
fi
log "DONE issue #$ISSUE -> PR #$PR_NUM"
