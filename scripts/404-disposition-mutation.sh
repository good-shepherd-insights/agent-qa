#!/usr/bin/env bash
#
# 404-disposition-mutation.sh — the acceptance bar for LIFE-02's posture claims (404-04, D-12).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. After 404-01 and 404-04 the value in
# `runFinished.disposition` is DECIDED — by a step the runner shell awaits, over a writer lease on
# disk, on every door — and it is one of `drained | handedOff | detached`. Two of those three are
# reachable only when something outside the process is true, and that is exactly what a passing
# suite cannot tell you: `detached` was the HARDCODED literal this phase replaced, so a build that
# forgot the whole step still publishes a legal value on every run and every consumer still parses
# it. The same shape of blindness covers D-08's gate-run skip (an enqueue that happens anyway is
# invisible in a suite that never counts rows) and RESEARCH Pitfall 3 (a tail that re-consults the
# lease reports a posture that reads perfectly reasonable). So the bar is measured by mutation:
#
#   M1  the `'detached'` LITERAL restored in the shell's `runFinished` publish
#   M2  the D-08 gate-run skip deleted from the post-verdict step
#   M3  the tail IGNORES the lease the step handed it and consults for itself (Pitfall 3)
#
# EACH MUTATION MUST RED THE CELLS THIS SCRIPT NAMES IN ADVANCE, AND ONLY THOSE. A red somewhere is
# not the claim; a red in the cell that exists to catch that specific return is. Each leg therefore
# carries a REQUIRED list (every one of them must be among the reds) and an ALLOWED list (nothing
# else may be red) — a mutation that reds half the suite is measuring blast radius, not a property.
#
# THE GREEN NON-CATCHERS ARE THE CONTROL, AND THEY ARE THE HALF PEOPLE SKIP. M1 restores the
# literal `'detached'`, so the two cells that EXPECT `detached` — `--detach` and the gate-run — must
# stay GREEN. If they went red too, the mutation would be reding the file rather than the claim,
# and "M1 reds the disposition cells" would mean nothing. The ALLOWED list is what enforces that:
# a non-catcher going red is a name outside the list and a FATAL.
#
# EVERY LEG CROSSES A `dist` BOUNDARY, AND THE REBUILD IS PART OF THE MUTATION.
#   M1 mutates `packages/runner`, which the built CLI resolves as its own dist — so the runner is
#      rebuilt after mutating and again after restoring.
#   M2 mutates `packages/cli`, whose `dist/cli.js` IS the binary these cells spawn — so the CLI is
#      rebuilt on both edges, and the cells' own `buildFreshness` guard would refuse to run
#      otherwise (it compares source mtimes against the artifact's).
#   M3 mutates `packages/cli`, whose cell is source-resolved under vitest — but the CLI is rebuilt
#      anyway, for the reason below.
# A leg that mutated a source and ran a spawned binary without rebuilding would be measuring the
# PREVIOUS revision and calling the resulting green a measurement.
#
# EVERY LEG REBUILDS THE CLI, INCLUDING THE ONE THAT MUTATES ONLY THE RUNNER, and that is not
# belt-and-braces. Restoring a subject `cp`s a snapshot over it, which bumps its MTIME — and the
# posture cells' own `buildFreshness` guard compares source mtimes against `cli/dist/cli.js`. A
# restored-but-untouched `packages/cli/**` source is therefore "newer than" the artifact, and the
# guard refuses to run at all: every cell would report SKIPPED and the leg would read as a red it
# never measured. Measured, not reasoned about — that is exactly how M1 first failed.
#
# THE DAEMON LEG IS REAL AND IT IS SLOW. M1's `handedOff` cell spawns an actual `agent-qa daemon`,
# waits for it to publish its own registration, spawns an actual `agent-qa run` over the same
# project root, and stops the daemon gracefully. Roughly six seconds on a warm machine; the whole
# script is minutes rather than seconds, because a lease held by a second process is not something
# a fixture can stand in for.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/404-disposition-mutation.sh   # from the super-repository root
#   bash scripts/404-disposition-mutation.sh            # from the agent-qa root
#
# KNOBS
#   DISPOSITION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RUNNER_FILTER="@vostride/agent-qa-runner"
CLI_FILTER="agent-qa"

SHELL_SUBJECT="packages/runner/src/run/shell.ts"
STEP_SUBJECT="packages/cli/src/curation/post-verdict-step.ts"
TAIL_SUBJECT="packages/cli/src/curation/post-run-tail.ts"

SUBJECT_PATHS=("$SHELL_SUBJECT" "$STEP_SUBJECT" "$TAIL_SUBJECT")

POSTURE_SUITE="src/__tests__/post-run-disposition.test.ts"
TAIL_SUITE="src/__tests__/post-run-tail.test.ts"

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

# ── The named cells. REQUIRED is every cell the mutation exists to red; ALLOWED is everything a red
# is permitted to be. Both are matched as substrings of the cell name a red prints.
#
# M1 — the literal is back, so both cells that expect a DECIDED posture must red. The two cells
# that expect `detached` are the CONTROL and must stay green; they are absent from ALLOWED, so a
# red in either is a FATAL.
REQUIRED_M1="writes disposition: drained, after its own verdict
writes disposition: handedOff"
ALLOWED_M1="writes disposition: drained, after its own verdict
writes disposition: handedOff"
GREEN_M1="--detach writes disposition: detached AND still leaves the durable row (Pitfall 8)
a gate-run writes disposition: detached and enqueues NOTHING (D-08)"

# M2 — the gate-run skip is gone, so a keep-filter probe queues a row. Only the gate-run cell can
# see that; the other three postures are byte-identical.
REQUIRED_M2="a gate-run writes disposition: detached and enqueues NOTHING (D-08)"
ALLOWED_M2="a gate-run writes disposition: detached and enqueues NOTHING (D-08)"
GREEN_M2="writes disposition: drained, after its own verdict
writes disposition: handedOff
--detach writes disposition: detached AND still leaves the durable row (Pitfall 8)"

# M3 — the tail re-consults a lease its own process is holding, is answered `held` by itself, and
# hands the chain off to nobody.
REQUIRED_M3="pumps under a HANDED lease and never consults the writer lease again (Pitfall 3)"
ALLOWED_M3="pumps under a HANDED lease and never consults the writer lease again (Pitfall 3)"
GREEN_M3="hands off with a nudge and returns immediately when the lease is held
drains the chain in-process through the full authority dance when the lease is free
ENQUEUES NOTHING — leg 1 belongs to the post-verdict step now (404 D-05)"

apply_mutation () {
  case "${DISPOSITION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # The M1 literal, restored exactly where it lived: the shell publishes a value nobody
      # decided. `as typeof disposition` keeps the decided variable referenced, so what this leg
      # measures is the PUBLISH and not an unused-local diagnostic.
      perl -0pi -e "s/      aggregateVerdict: verdict,\n      disposition,\n/      aggregateVerdict: verdict,\n      disposition: 'detached' as typeof disposition,\n/" \
        "$REPO_ROOT/$SHELL_SUBJECT" ;;
    M2)
      # D-08's skip deleted. The step then loads the handoff, composes a host and queues a row for
      # a `write_test` keep-filter probe — the analysis cost per gate iteration this arm exists to
      # avoid, and the draft evidence it exists to keep out of curation.
      perl -0pi -e "s/      if \(input\.gateRun === true \|\| input\.excludedFromOutcomes === true\) \{\n        return settle\(dispositionOf\(\{ enqueue: 'skipped', leaseSkipped: true \}\)\)\n      \}\n//" \
        "$REPO_ROOT/$STEP_SUBJECT" ;;
    M3)
      # The tail ignores what the step handed it. RESEARCH Pitfall 3: a process that holds the
      # writer lease and calls `acquireWriterLease` again is answered `held` — by ITSELF.
      perl -0pi -e "s/        const handed = input\.lease\n/        const handed = undefined as typeof input.lease\n/" \
        "$REPO_ROOT/$TAIL_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

build_package () {
  local filter
  for filter in $1; do
    set +e
    pnpm --filter "$filter" build > "$WORK/build.log" 2>&1
    local rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      echo "FATAL: rebuilding $filter failed — see $WORK/build.log" >&2
      restore_subjects
      exit 1
    fi
  done
}

assert_restored () {
  local index=0 path restored
  for path in "${SUBJECT_PATHS[@]}"; do
    restored="$(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  echo "  every subject restored byte-identically (sha256 compared)"
}

# run_leg <name> <label> <required> <allowed> <green> <filter> <suite> <rebuild-filters>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" green="$5" filter="$6" suite="$7" rebuild="${8:-}"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  if [ -n "$rebuild" ]; then
    echo "  rebuilding $rebuild so the cells resolve the MUTATED source"
    build_package "$rebuild"
  fi

  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    [ -n "$rebuild" ] && build_package "$rebuild"
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

  # Nothing outside the allowed list may be red.
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
      [ -n "$rebuild" ] && build_package "$rebuild"
      exit 1
    fi
  done <<< "$red"

  # …every cell this mutation EXISTS to red must be among them…
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  named cell red: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        restore_subjects
        [ -n "$rebuild" ] && build_package "$rebuild"
        exit 1 ;;
    esac
  done <<< "$required"

  # …and the CONTROL cells — the ones this mutation must NOT reach — stayed green. Asserted by
  # absence from the red set, which is the same reading the allowed list makes, stated by name so
  # the log carries the control rather than only the catch.
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        restore_subjects
        [ -n "$rebuild" ] && build_package "$rebuild"
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_subjects
  [ -n "$rebuild" ] && build_package "$rebuild"
  assert_restored
  echo
}

echo "=== PREFLIGHT — the dists these cells drive, then the pre-mutation suites"
build_package "$RUNNER_FILTER $CLI_FILTER"
for preflight in "$POSTURE_SUITE" "$TAIL_SUITE"; do
  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$preflight" > "$LOG" 2>&1
  PREFLIGHT_RC=$?
  set -e
  echo "  $preflight exited $PREFLIGHT_RC"
  grep -E '^      Tests' "$LOG" || true
  if [ "$PREFLIGHT_RC" -ne 0 ]; then
    echo "FATAL: $preflight is already red before any mutation" >&2
    exit 1
  fi
done
echo

run_leg M1 "the 'detached' literal restored in the shell's runFinished publish" \
  "$REQUIRED_M1" "$ALLOWED_M1" "$GREEN_M1" "$CLI_FILTER" "$POSTURE_SUITE" "$RUNNER_FILTER $CLI_FILTER"
run_leg M2 "the D-08 gate-run skip deleted from the post-verdict step" \
  "$REQUIRED_M2" "$ALLOWED_M2" "$GREEN_M2" "$CLI_FILTER" "$POSTURE_SUITE" "$CLI_FILTER"
run_leg M3 "the tail ignores the handed lease and consults for itself (Pitfall 3)" \
  "$REQUIRED_M3" "$ALLOWED_M3" "$GREEN_M3" "$CLI_FILTER" "$TAIL_SUITE" "$CLI_FILTER"

echo "PASS — the M1 literal reds both DECIDED postures while the two detached postures stay green,"
echo "       deleting the D-08 skip reds the gate-run cell and nothing else, and a tail that"
echo "       re-consults a lease its own process holds reds the one-lease cell."
