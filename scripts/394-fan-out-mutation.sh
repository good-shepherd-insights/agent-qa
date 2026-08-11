#!/usr/bin/env bash
#
# 394-fan-out-mutation.sh — the fan-out preview's acceptance bar (WTST-08 · D-03/D-10).
#
# WHAT THIS PROVES, and why a green suite does not prove it. The cells passing say the loop reports
# two numbers that agree. They do NOT say the preview is the thing that would CATCH a loop spending
# more than it disclosed, which is the whole of WTST-08 — the requirement's mitigation is the
# disclosure, so a disclosure nothing can falsify is decoration. A detector's acceptance bar is the
# implementation it must go RED on, never the suite it passes. This script edits the shipped source
# into four implementations WTST-08 forbids and requires named cells to red on each.
#
#   H  the two N terms collapsed        — one doubled term; the total is still right.
#   I  the preview recomputed INLINE    — a second arithmetic in the op, then K moved under it.
#   J  probe runs dropped from the count — the actual figure omits what repair spent.
#   K  the bound SHAVED                 — the final N term dropped from the preview.
#
# H AND K ARE DIFFERENT CLAIMS. H removes the DISTINCTION between the two N terms while keeping the
# total correct — it is caught by cells that read the terms. K removes a term from the total itself,
# which is the under-count the prohibition names, and it is caught by the worst-case cell. A file
# with only one of them would have proven half the bound.
#
# I IS TWO EDITS, AND IT HAS TO BE. Recomputing the preview inline is not observable while both
# arithmetics agree — that is exactly why a second copy is dangerous rather than merely redundant.
# So the mutation inlines the sum AND moves `REPAIR_ITERATION_CAP`, and the cells that compare the
# rendered figure against `authoringFanOutBound` are what red. A cell comparing against a LITERAL
# would have stayed green through both edits.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the allowed list: a differential that reds on collateral has shown the corpus is
# fragile, not that it catches what it forbids.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`.
#
# THE SUBJECTS ARE RESTORED FROM BYTE SNAPSHOTS AND EVERY RESTORE IS PROVEN. `git checkout --`
# cannot restore an uncommitted edit, so the snapshots are `cp` copies taken before the first
# mutation and the sha256 is compared after each restore.
#
# DEPENDENCY DISTS ARE REBUILT BEFORE EVERY LEG. `agent` and `agent-local` resolve `schema` through
# its built `dist`, so a mutation to a `schema` source that is not rebuilt measures the PREVIOUS
# implementation — a differential that would report green for the best possible reason and the
# worst possible one identically.
#
# USAGE
#   bash agent-qa/scripts/394-fan-out-mutation.sh   # from the super-repository root
#   bash scripts/394-fan-out-mutation.sh            # from the agent-qa root
#
# KNOBS
#   FAN_OUT_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation". A mutation script that cannot fail when its mutation does
#       nothing is measuring nothing, and this is how that is checked without hand-editing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT_PATHS=(
  "packages/schema/src/authoring/fan-out.ts"
  "packages/agent/src/authoring/loop.ts"
  "packages/agent/src/functions/ops/authoring-draft-write.ts"
)

SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"
AGENT_LOCAL_FILTER="@vostride/agent-qa-agent-local"

SCHEMA_SUITE="src/authoring/__tests__/fan-out.test.ts"
AGENT_SUITE="src/authoring/__tests__/fan-out-accounting.test.ts"
E2E_SUITE="src/__tests__/authoring-loop.e2e.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

restore_subjects () {
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    cp "$(snapshot_path "$path")" "$REPO_ROOT/$path" 2>/dev/null || true
  done
}

trap 'restore_subjects; rm -rf "$WORK"' EXIT

declare -a BASELINE_SHAS=()
for path in "${SUBJECT_PATHS[@]}"; do
  cp "$REPO_ROOT/$path" "$(snapshot_path "$path")"
  sha="$(shasum -a 256 "$(snapshot_path "$path")" | cut -d' ' -f1)"
  BASELINE_SHAS+=("$sha")
  echo "subject   $path"
  echo "  sha256  $sha"
done
echo

# Each mutation's allowed red cells, spelled as vitest prints them. Every entry is an assertion
# about the property the mutation removes.
#
# H removes the DISTINCTION between the two N terms; the total stays correct, so only cells that
# read the terms red.
ALLOWED_H="keeps initialN and finalN separately readable in DRAFT MODE
keeps both terms present even when they are NUMERICALLY EQUAL
reports the nominal bound as initial N + K probes + final N
states the total as an UPPER BOUND in runs, and names all three terms"
# I puts a SECOND arithmetic in the op and then moves K under it, so every cell comparing the
# rendered figure against the function reds — and only those.
ALLOWED_I="asks EXACTLY ONCE at dispatch
previews the DRAFT-MODE bound"
# J stops counting probes, so every cell that asserts what an invocation actually spent reds.
ALLOWED_J="WORST CASE: every term spent
counts PROBE runs toward the actual figure
lists the consumed runs in completion order
reports the two figures TOGETHER"
# K shaves a term off the BOUND, so the worst case now exceeds its own preview.
ALLOWED_K="WORST CASE: every term spent
reports the two figures TOGETHER"

apply_mutation () {
  case "${FAN_OUT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    H)
      perl -0pi -e 's/    initialN: input\.initialN,\n    probeK: input\.probeK,\n    finalN: input\.finalN,/    initialN: input.initialN + input.finalN,\n    probeK: input.probeK,\n    finalN: 0,/' \
        "$REPO_ROOT/packages/schema/src/authoring/fan-out.ts" ;;
    I)
      perl -0pi -e 's/    return renderFanOutPreview\(authoringFanOutBound\(input\)\)/    return renderFanOutPreview(computeFanOutBound({\n      initialN: input.draftMode === true ? 1 : DRAFT_STABILITY_RUNS_N,\n      probeK: 3,\n      finalN: DRAFT_STABILITY_RUNS_N,\n    }))/' \
        "$REPO_ROOT/packages/agent/src/functions/ops/authoring-draft-write.ts"
      perl -0pi -e 's/  AuthoringDraftWriteOutputSchema,\n  renderFanOutPreview,/  AuthoringDraftWriteOutputSchema,\n  DRAFT_STABILITY_RUNS_N,\n  computeFanOutBound,\n  renderFanOutPreview,/' \
        "$REPO_ROOT/packages/agent/src/functions/ops/authoring-draft-write.ts"
      # …and K moves. With one arithmetic this is invisible; with two it is a divergence.
      perl -0pi -e 's/    probeK: REPAIR_ITERATION_CAP,/    probeK: REPAIR_ITERATION_CAP + 1,/' \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    J)
      perl -0pi -e 's/  const probes: readonly ConsumedRun\[\] = await consumedProbeRuns\(\n    repaired\.probeRunIds,\n    deps\.shelf\.runs,\n  \)/  const probes: readonly ConsumedRun[] = []/' \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    K)
      perl -0pi -e 's/    finalN: DRAFT_STABILITY_RUNS_N,\n  \}\)\n\}/    finalN: 0,\n  })\n}/' \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

rebuild_dists () {
  # schema -> agent -> agent-local, the resolution order. Read from the process, never a pipe.
  set +e
  pnpm --filter "$SCHEMA_FILTER" build > "$WORK/build.log" 2>&1 \
    && pnpm --filter "$AGENT_FILTER" build >> "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
    restore_subjects
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3" filter="$4" suite="$5"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    echo "  $path sha256 $(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
  done
  rebuild_dists

  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $suite > .*" "$LOG" | sed "s|^ FAIL  $suite > ||" | sort -u)"
  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ok=0
    while IFS= read -r fragment; do
      [ -z "$fragment" ] && continue
      case "$line" in *"$fragment"*) ok=1 ;; esac
    done <<< "$allowed"
    if [ "$ok" -eq 0 ]; then
      echo "FATAL: mutation $name red a cell outside its allowed list: $line" >&2
      restore_subjects
      exit 1
    fi
  done <<< "$red"

  restore_subjects
  local index=0
  for path in "${SUBJECT_PATHS[@]}"; do
    local restored
    restored="$(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  rebuild_dists
  echo "  every subject restored byte-identically"
  echo
}

echo "=== PREFLIGHT — the pre-mutation suites must be green"
rebuild_dists
for leg in "$SCHEMA_FILTER $SCHEMA_SUITE" "$AGENT_FILTER $AGENT_SUITE" "$AGENT_LOCAL_FILTER $E2E_SUITE"; do
  set -- $leg
  set +e
  pnpm --filter "$1" exec vitest run "$2" > "$LOG" 2>&1
  PREFLIGHT_RC=$?
  set -e
  echo "  $2 exited $PREFLIGHT_RC"
  grep -E '^      Tests' "$LOG" || true
  if [ "$PREFLIGHT_RC" -ne 0 ]; then
    echo "FATAL: $2 is already red before any mutation" >&2
    exit 1
  fi
done
echo

run_leg H "the two N terms collapsed into a doubled term" "$ALLOWED_H" "$SCHEMA_FILTER" "$SCHEMA_SUITE"
run_leg I "the preview recomputed inline, then K moved" "$ALLOWED_I" "$AGENT_LOCAL_FILTER" "$E2E_SUITE"
run_leg J "probe runs dropped from the actual count" "$ALLOWED_J" "$AGENT_FILTER" "$AGENT_SUITE"
run_leg K "the final N term shaved off the bound" "$ALLOWED_K" "$AGENT_FILTER" "$AGENT_SUITE"

echo "PASS — the bound keeps its two N terms apart, the preview has ONE arithmetic, the actual"
echo "       figure counts probes, and a shaved bound is caught by the loop's own worst case."
