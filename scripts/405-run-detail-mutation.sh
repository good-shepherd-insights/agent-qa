#!/usr/bin/env bash
#
# 405-run-detail-mutation.sh — the acceptance bar for criteria 1 and 2 (405-12, D-04 / D-11).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `conformance/run-detail-dom.test.ts`
# asserts that ten facts are visible on run detail. A cell that asserts a fact is PRESENT is
# exactly the kind that passes for free when it is looking at the wrong element, waiting on the
# wrong node, or reading a fixture it accidentally produced itself. The only way to know a cell
# measures its fact is to take the fact away and watch the cell go red — and to watch its
# NEIGHBOURS stay green, because a mutation that reds the whole file is measuring blast radius.
#
# THREE MUTATIONS, ONE PER PRODUCER, ACROSS THREE PACKAGES:
#
#   M1  the dashboard subscriber's `subActionRecorded` arm silenced — the envelope still travels
#       the bus, the run still reaches a verdict, and no `run_sub_actions` row is ever written
#   M2  the runner loop's `stepFinalized` emit stripped of `tokenUsage` — the step is still
#       finalized and the legacy trace still carries the triple; the BUS stops carrying it
#   M3  the display-unmask seam made a marker pass — it still reads the sidecar, still resolves
#       the host key and still re-derives every candidate, and restores NOTHING
#
# WHAT EACH LEG IS EXPECTED TO REACH IS STATED IN ADVANCE, AND SO IS WHAT IT MUST NOT.
#
# M1 IS BROAD ON PURPOSE, AND ITS BREADTH IS ITS MEANING. The plan for this script predicted reds
# in the sub-action, screenshot and screen-context cells "and no other". Measured, the blast is
# wider and correctly so: the reasoning sentence, the restored secret, the email chip and the
# declared-secret marker all live in the SUB-ACTION's own `plan` string, so a projection with no
# sub-action row cannot show any of them. What the leg therefore demonstrates is sharper than the
# prediction — every cell whose fact is carried BY the sub-action row reds, and the two whose facts
# are carried elsewhere (the step's token spend, the at-rest scan) stay green. Those two are named
# below as the control, so the log records what did NOT move as well as what did.
#
# M2 AND M3 ARE SHARP. M2 reds the token cell alone: nine cells keep every other fact, which is
# what makes "this cell is about tokens" a measurement rather than a claim. M3 reds the two
# restore cells alone — and specifically NOT the masked-side scan and NOT the email chip, which is
# the whole point of that pair: the at-rest guarantee and the chip vocabulary do not depend on
# restoration, so a seam that stopped restoring must not be able to make them look fine or make
# them look broken.
#
# EVERY LEG CROSSES A `dist` BOUNDARY AND THE REBUILD IS PART OF THE MUTATION. All three subjects
# are resolved by the spawned `agent-qa dashboard` as BUILT workspace dependencies, and the DOM
# file's own `buildFreshness` guard compares source mtimes against those artifacts — so a
# restored-but-unbuilt source is "newer than" the build and every cell refuses to run at all. That
# is a red the leg never measured. `--force` is required for the same guard's sake in the other
# direction: a byte-identical restore is a turbo CACHE HIT, so a plain build reports FULL TURBO and
# refreshes no dist mtime.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE VERDICTS ARE READ PER CELL FROM THE JSON REPORTER, never scraped out of prose. A cell name
# that gains a comma would silently stop matching a line-oriented grep, and the failure mode of
# that is a leg that reports "the named cell stayed green" about a cell that was red.
#
# THIS SCRIPT IS SLOW AND IT IS SLOW FOR A REASON. Seven forced workspace builds (preflight plus
# mutate-and-restore per leg) and four passes of a suite that spawns the built binary twice,
# launches a real Chromium, executes a real run through a real planning turn and kills and respawns
# the dashboard. Minutes, not seconds. It is the phase's ACCEPTANCE, run at wave merge and before
# `/gsd-verify-work`; the per-commit sample is the fast unit cells.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/405-run-detail-mutation.sh   # from the super-repository root
#   bash scripts/405-run-detail-mutation.sh            # from the agent-qa root
#   pnpm validate:run-detail-mutation                  # from the agent-qa root
#
# KNOBS
#   RUN_DETAIL_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLI_FILTER="agent-qa"

SUBSCRIBER_SUBJECT="packages/dashboard-server/src/reporter/dashboard-subscriber.ts"
LOOP_SUBJECT="packages/runner/src/loop/index.ts"
UNMASK_SUBJECT="packages/cli/src/composition/display-unmask.ts"

SUBJECT_PATHS=("$SUBSCRIBER_SUBJECT" "$LOOP_SUBJECT" "$UNMASK_SUBJECT")

DOM_SUITE="src/__tests__/conformance/run-detail-dom.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
VERDICTS="$WORK/verdicts.json"

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

sha_of () {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1
  fi
}

# RESTORING IS A NO-OP WHEN THE BYTES ALREADY MATCH, and that is not tidiness. `cp` bumps an mtime
# whether or not it changes a byte, and the DOM cell's `buildFreshness` guard compares source
# mtimes against the dists it drives — so an unconditional restore in the EXIT trap, which runs
# AFTER this script's last rebuild, leaves every source "newer than" the artifacts and the next
# person to run the suite gets ten refusals that read exactly like a red. Measured by 404-04.
restore_subjects () {
  local path snapshot
  for path in "${SUBJECT_PATHS[@]}"; do
    snapshot="$(snapshot_path "$path")"
    [ -f "$snapshot" ] || continue
    cmp -s "$snapshot" "$REPO_ROOT/$path" && continue
    cp "$snapshot" "$REPO_ROOT/$path"
  done
}

trap 'restore_subjects; rm -rf "$WORK"' EXIT

declare -a BASELINE_SHAS=()
for path in "${SUBJECT_PATHS[@]}"; do
  cp "$REPO_ROOT/$path" "$(snapshot_path "$path")"
  sha="$(sha_of "$(snapshot_path "$path")")"
  BASELINE_SHAS+=("$sha")
  echo "subject   $path"
  echo "  sha256  $sha"
done
echo

# ── The named cells, by the ordinal each carries in its own name. REQUIRED is every cell the
# mutation exists to red; ALLOWED is everything a red is permitted to be; GREEN is the control —
# cells this mutation must NOT reach, asserted by name so the log carries what stayed still.
#
# The ordinals are the contract between this script and the suite. A cell renamed without its
# ordinal reds nothing here and this script says so by name rather than passing quietly.

REQUIRED_M1="(1b)
(1c)
(1e)"
# (1a) the reasoning sentence, (2a) the restored secret inside it, (2c) the email chip minted from
# it and (2d) the same sentence after the restart, plus (2e) the declared-secret marker in it: all
# five are the sub-action's own `plan`, and a projection with no sub-action row has no plan.
ALLOWED_M1="(1a)
(1b)
(1c)
(1e)
(2a)
(2c)
(2d)
(2e)"
GREEN_M1="(1d)
(2b)"

REQUIRED_M2="(1d)"
ALLOWED_M2="(1d)"
GREEN_M2="(1a)
(1b)
(1c)
(1e)
(2a)
(2b)
(2c)
(2d)
(2e)"

REQUIRED_M3="(2a)
(2d)"
ALLOWED_M3="(2a)
(2d)"
# The two that carry M3's real point: the at-rest scan and the chip vocabulary do not depend on
# restoration, so a seam that restores nothing must leave both exactly as they were.
GREEN_M3="(1a)
(1b)
(1c)
(1d)
(1e)
(2b)
(2c)
(2e)"

apply_mutation () {
  case "${RUN_DETAIL_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # The arm silenced at the dispatch. Everything above it is byte-identical — the envelope is
      # still published, the step row is still written and the run still reaches a verdict — so the
      # only thing this leg removes is the sub-action ROW the page reads.
      perl -0pi -e "s/          handleSubActionRecorded\(envelope\.payload as SubActionRecordedPayload\)\n/          void \(envelope.payload as SubActionRecordedPayload\)\n/" \
        "$REPO_ROOT/$SUBSCRIBER_SUBJECT" ;;
    M2)
      # The additive-optional field dropped at the ONE emit that carries it to the bus. The
      # accumulator and the legacy trace two lines below are untouched, so this is precisely the
      # 405-04 append being undone and nothing else.
      perl -0pi -e "s/, error, tokenUsage: tokenUsage\(\) \}\)\n/, error \}\)\n/" \
        "$REPO_ROOT/$LOOP_SUBJECT" ;;
    M3)
      # The seam still reads the sidecar, still resolves the host key, still re-derives every
      # candidate and still matches the digests — and then puts the placeholder back in place of
      # the value it matched, so the marker pass that runs last rewrites every one into a chip.
      # A leg that had disabled the whole seam would also have removed the marker pass, which is a
      # different mutation with a different meaning.
      perl -0pi -e "s/            restore\.set\(placeholder, candidate\.value\)\n/            restore.set\(placeholder, placeholder\)\n/" \
        "$REPO_ROOT/$UNMASK_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

# THE MUTATION IS ASSERTED TO HAVE LANDED. A `perl` substitution that matched nothing exits 0 and
# leaves the file untouched, and the leg would then measure an unmutated tree and report a green
# suite as the mutation "measuring nothing" — the right verdict for the wrong reason, and one that
# sends a reader looking at the cell instead of at this script's own pattern.
assert_mutated () {
  local index=0 path current
  for path in "${SUBJECT_PATHS[@]}"; do
    current="$(sha_of "$REPO_ROOT/$path")"
    if [ "$current" != "${BASELINE_SHAS[$index]}" ]; then return 0; fi
    index=$((index + 1))
  done
  return 1
}

build_all () {
  set +e
  pnpm turbo run build --force > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the forced workspace build failed — see $WORK/build.log" >&2
    tail -40 "$WORK/build.log" >&2
    restore_subjects
    exit 1
  fi
}

assert_restored () {
  local index=0 path restored
  for path in "${SUBJECT_PATHS[@]}"; do
    restored="$(sha_of "$REPO_ROOT/$path")"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  echo "  every subject restored byte-identically (sha256 compared)"
}

# Run the suite, leaving per-cell verdicts in $VERDICTS. Answers the process's own exit code.
#
# IT DOES NOT TOUCH `errexit` ITSELF, and that is a correctness point rather than a style one. A
# helper that ends with `set -e; return "$rc"` re-arms errexit and then returns non-zero — which
# aborts the caller at the call site, before the caller can read the code it asked for. The whole
# purpose of a mutation leg is to read a NON-ZERO exit, so the one function that produces it must
# leave the shell exactly as it found it. Every caller wraps the call in its own `set +e`/`set -e`.
run_suite () {
  rm -f "$VERDICTS"
  pnpm --filter "$CLI_FILTER" exec vitest run "$DOM_SUITE" \
    --reporter=json --outputFile="$VERDICTS" > "$LOG" 2>&1
}

# Every cell whose recorded status is not `passed`, one ordinal per line.
reds_from_verdicts () {
  node -e '
    const fs = require("node:fs")
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const out = []
    for (const file of report.testResults ?? []) {
      for (const cell of file.assertionResults ?? []) {
        if (cell.status !== "passed") out.push(cell.title)
      }
    }
    process.stdout.write(out.join("\n"))
  ' "$VERDICTS"
}

# run_leg <name> <label> <required> <allowed> <green>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" green="$5"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"

  case "${RUN_DETAIL_MUTATION_SELFTEST:-}" in
    neutered) echo "  SELFTEST=neutered: applying a NO-OP edit in place of $name" ;;
    *)
      if ! assert_mutated; then
        echo "FATAL: mutation $name changed no byte — its pattern no longer matches the subject" >&2
        exit 1
      fi ;;
  esac

  echo "  rebuilding every dist the spawned dashboard resolves, so it IS the mutated source"
  build_all

  set +e
  run_suite
  local rc=$?
  set -e
  echo "  leg exited $rc"

  if [ ! -f "$VERDICTS" ]; then
    echo "FATAL: mutation $name produced no per-cell verdicts — the suite never ran" >&2
    sed -n '1,60p' "$LOG" >&2
    restore_subjects
    build_all
    exit 1
  fi

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    build_all
    exit 1
  fi

  local red
  red="$(reds_from_verdicts)"
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
      build_all
      exit 1
    fi
  done <<< "$red"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  REQUIRED red observed: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        restore_subjects
        build_all
        exit 1 ;;
    esac
  done <<< "$required"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        restore_subjects
        build_all
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_subjects
  build_all
  assert_restored
  echo
}

echo "=== PREFLIGHT — the dists these cells drive, then the pre-mutation suite"
build_all
set +e
run_suite
PREFLIGHT_RC=$?
set -e
echo "  $DOM_SUITE exited $PREFLIGHT_RC"
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: $DOM_SUITE is already red before any mutation" >&2
  sed -n '1,100p' "$LOG" >&2
  exit 1
fi
echo

run_leg M1 "the subscriber's subActionRecorded arm silenced" "$REQUIRED_M1" "$ALLOWED_M1" "$GREEN_M1"
run_leg M2 "the loop's stepFinalized emit stripped of tokenUsage" "$REQUIRED_M2" "$ALLOWED_M2" "$GREEN_M2"
run_leg M3 "the display-unmask seam made a marker pass, restoring nothing" "$REQUIRED_M3" "$ALLOWED_M3" "$GREEN_M3"

echo "PASS — silencing the sub-action projection, dropping the token triple at the bus emit and"
echo "       taking restoration away from the display seam each red exactly the cells that measure"
echo "       those facts, while the step's own spend, the at-rest scan and the chip vocabulary"
echo "       stayed green under the mutations that do not touch them."
