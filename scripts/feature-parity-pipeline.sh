#!/usr/bin/env bash
# feature-parity-pipeline.sh — drive OpenCode through the entire QuillMD
# feature-parity plan suite, wave by wave (see docs/feature-parity/workflow.md).
#
# Usage:
#   bash scripts/feature-parity-pipeline.sh [options]
#
# Options:
#   --dry-run          print the execution order; do nothing else
#   --pause            stop at the end of each wave for human review
#   --wave <n>         run only wave <n> (1-5)
#   --force <n>        re-run issue <n> even if it already has a PR
#                      (closes the old PR first)
#   --stop-on-fail     default; fail the wave on the first failed issue
#
# Waves (dependency order):
#   1: plan 1 (app shell & dialogs)
#   2: plans 2, 7, 8 (editor core, find/replace, links/media)
#   3: plans 4, 5, 6, 11 (fonts, styles, tables, mermaid)
#   4: plan 3 (context menus)
#   5: plans 9, 10 (document tools, view/settings)
#
# Resume-safe: issues with an open or merged PR (tracked in
# scripts/.fp-pipeline-state.json or visible on GitHub) are skipped.

set -u -o pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="bruceamoser/quillmd"
MILESTONE="Feature Parity (v2)"
ISSUE_RUN="$REPO_DIR/scripts/issue-run.sh"
STATE_FILE="$REPO_DIR/scripts/.fp-pipeline-state.json"
LOG="$REPO_DIR/scripts/.fp-pipeline.log"

DRY=0
PAUSE=0
WAVE_ONLY=0
FORCE_ISSUE=""
FAIL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --pause) PAUSE=1 ;;
    --wave) shift; WAVE_ONLY="${1:?--wave needs a number}" ;;
    --force) shift; FORCE_ISSUE="${1:?--force needs an issue number}" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

mkdir -p "$REPO_DIR/scripts/.fp-runs"
if [ ! -s "$STATE_FILE" ] || ! jq -e . "$STATE_FILE" >/dev/null 2>&1; then
  echo '{}' > "$STATE_FILE"
fi
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# plan number -> wave
wave_for_plan() {
  case "$1" in
    1) echo 1 ;;
    2|7|8) echo 2 ;;
    4|5|6|11) echo 3 ;;
    3) echo 4 ;;
    9|10) echo 5 ;;
    *) echo 0 ;;
  esac
}

# --- build the work list from GitHub (live) ---------------------------------
mapfile -t ISSUES < <(gh issue list --repo "$REPO" --state open \
  --milestone "$MILESTONE" --limit 200 --json number,title 2>/dev/null \
  | jq -r '.[] | "\(.number)\t\(.title)"')

if [ "${#ISSUES[@]}" -eq 0 ]; then
  log "no open issues in milestone '$MILESTONE' — nothing to do"
  exit 0
fi

# work list: "wave<TAB>plan<TAB>task<TAB>number"
WORK=()
for line in "${ISSUES[@]}"; do
  num="${line%%$'\t'*}"
  title="${line#*$'\t'}"
  # sub-issues only: "[PN] X.Y ..."
  if [[ "$title" =~ ^\[P[0-9]\]\ ([0-9]+)\.([0-9]+)\ (.*) ]]; then
    plan="${BASH_REMATCH[1]}"
    task="${BASH_REMATCH[2]}"
    wave="$(wave_for_plan "$plan")"
    [ "$wave" -eq 0 ] && continue
    WORK+=("$wave"$'\t'"$plan"$'\t'"$task"$'\t'"$num")
  fi
done
# sort by wave, plan, task (all zero-padded numeric fields)
IFS=$'\n' WORK_SORTED=($(printf '%s\n' "${WORK[@]}" | sort -t$'\t' -k1,1n -k2,2n -k3,3n)); unset IFS

has_pr() { # $1 = issue number -> 0 if open/merged PR exists
  local n="$1" pr state
  pr="$(jq -r --argjson n "$n" '.[$n|tostring].pr // empty' "$STATE_FILE" 2>/dev/null)"
  if [ -n "$pr" ]; then
    state="$(gh pr view "$pr" --repo "$REPO" --json state --jq .state 2>/dev/null)"
    case "$state" in open|OPEN|merged|MERGED) return 0 ;; esac
  fi
  return 1
}

# --- dry run -----------------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  echo "Execution order (milestone: $MILESTONE):"
  echo
  cur_wave=0
  for entry in "${WORK_SORTED[@]}"; do
    IFS=$'\t' read -r wave plan task num <<<"$entry"
    if [ "$wave" != "$cur_wave" ]; then
      cur_wave="$wave"
      echo "WAVE $wave"
    fi
    if [ "$WAVE_ONLY" -ne 0 ] && [ "$wave" != "$WAVE_ONLY" ]; then continue; fi
    if has_pr "$num"; then
      echo "  [skip] #$num (PR exists)  plan $plan task $task"
    else
      echo "  [run]  #$num  plan $plan task $task"
    fi
  done
  exit 0
fi

# --- single-issue force mode --------------------------------------------------
if [ -n "$FORCE_ISSUE" ]; then
  log "force re-run of issue #$FORCE_ISSUE"
  bash "$ISSUE_RUN" "$FORCE_ISSUE" --force 2>&1 | tee -a "$LOG"
  exit ${PIPESTATUS[0]}
fi

# --- main loop ----------------------------------------------------------------
log "=== pipeline start (milestone: $MILESTONE, pause=$PAUSE, wave=${WAVE_ONLY:-all}) ==="
cur_wave=0
TOTAL_RUN=0
TOTAL_SKIP=0
for entry in "${WORK_SORTED[@]}"; do
  IFS=$'\t' read -r wave plan task num <<<"$entry"
  if [ "$WAVE_ONLY" -ne 0 ] && [ "$wave" != "$WAVE_ONLY" ]; then continue; fi
  if [ "$wave" != "$cur_wave" ]; then
    cur_wave="$wave"
    log "----- WAVE $wave -----"
  fi
  if has_pr "$num"; then
    log "skip #$num (plan $plan.$task) — PR already exists"
    TOTAL_SKIP=$((TOTAL_SKIP + 1))
    continue
  fi
  log "RUN issue #$num (plan $plan.$task)"
  if bash "$ISSUE_RUN" "$num" 2>&1 | tee -a "$LOG"; then
    TOTAL_RUN=$((TOTAL_RUN + 1))
  else
    rc=${PIPESTATUS[0]}
    log "STOP: issue #$num failed (rc=$rc). Wave $wave halted."
    log "Inspect scripts/.fp-runs/$num.log, fix, then re-run this script (resume-safe)."
    FAIL=1
    break
  fi
done

# --- wave pause (human review point) ------------------------------------------
if [ "$FAIL" -eq 0 ] && [ "$PAUSE" -eq 1 ]; then
  log "wave checkpoint — open PRs for review:"
  gh pr list --repo "$REPO" --state open --json number,title --jq '.[] | "  #\(.number) \(.title)"'
  log "re-run the pipeline to continue (or merge PRs first)."
fi

if [ "$FAIL" -eq 0 ]; then
  log "=== pipeline complete: ran $TOTAL_RUN, skipped $TOTAL_SKIP ==="
else
  log "=== pipeline stopped early: ran $TOTAL_RUN, skipped $TOTAL_SKIP ==="
fi
exit "$FAIL"
