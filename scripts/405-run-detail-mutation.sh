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
# FOUR MUTATIONS, ONE PER PRODUCER, ACROSS THREE PACKAGES:
#
#   M1   the dashboard subscriber's `subActionRecorded` arm silenced — the envelope still travels
#        the bus, the run still reaches a verdict, and no `run_sub_actions` row is ever written
#   M2   the MEMBER's final step publication stripped of its usage — the step is still finalized,
#        with its evidence and variables, and the bus stops carrying any token spend for it
#   M2L  the standalone loop's `stepFinalized` emit stripped of `tokenUsage` — the loop's own
#        synchronous callback contract, measured on the loop's own unit cell
#   M3   the display-unmask seam made a marker pass — it still reads the sidecar, still resolves
#        the host key and still re-derives every candidate, and restores NOTHING
#
# WHY M2 MOVED AND M2L EXISTS (423-22). Until Phase 423 the loop's emit was the one place a step's
# token triple reached the bus, and M2 took it away there. 423-04 put a member-only terminal
# boundary in front of that emit (`run/step-read-finalization.ts`): a member run's loop terminal
# is BUFFERED, enriched with evidence and variables, and published once. 423-31 then made the
# member forward its finished model scope, and the schema projection REPLACES the loop's triple
# with that population. Measured at 423-22: with the old subject mutated, `(1d)` stayed green,
# because the page's spend no longer comes from the loop's emit on a member run. A leg that stays
# green is not evidence of anything, so M2 now takes the usage away at the member publisher that
# actually carries it. The loop's emit is still a real contract — the standalone callback path
# every non-member caller uses — so it keeps a leg of its own rather than being deleted: M2L,
# measured by `loop-events.test.ts (d)`, with the cache-hit cell `(e)` as its absent-is-not-zero
# control.
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
# THE DOM LEGS CROSS A `dist` BOUNDARY AND THE REBUILD IS PART OF THE MUTATION. M1, M2 and M3's
# subjects are resolved by the spawned `agent-qa dashboard` as BUILT workspace dependencies, and
# the DOM file's own `buildFreshness` guard compares source mtimes against those artifacts — so a
# restored-but-unbuilt source is "newer than" the build and every cell refuses to run at all. That
# is a red the leg never measured. `--force` is required for the same guard's sake in the other
# direction: a byte-identical restore is a turbo CACHE HIT, so a plain build reports FULL TURBO and
# refreshes no dist mtime.
#
# THE LOOP LEG DOES NOT. `loop-events.test.ts` imports the loop by relative source path, so M2L
# runs its cell without a build. Its RESTORE still moves a runner source mtime, and the next DOM
# leg — or the next person to run the DOM suite — would then refuse, so M2L rebuilds after it
# restores exactly as the DOM legs do.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE VERDICTS ARE READ PER CELL FROM THE JSON REPORTER, never scraped out of prose. A cell name
# that gains a comma would silently stop matching a line-oriented grep, and the failure mode of
# that is a leg that reports "the named cell stayed green" about a cell that was red. Every
# REQUIRED and GREEN cell must also be PRESENT in the verdicts: a renamed control would otherwise
# "stay green" by not existing.
#
# EVERY SUBJECT IS RESTORED ON EVERY EXIT. Success, FATAL, error and SIGINT/SIGTERM/SIGHUP alike
# restore the subjects from the byte snapshot taken before the first mutation, and a build that
# ran over mutated source is rebuilt from the restored tree before the script exits. A subject
# that is dirty or untracked when the script starts is REFUSED and left alone — restoring it from
# a snapshot taken after the dirt landed would launder someone's uncommitted work.
#
# THIS SCRIPT IS SLOW AND IT IS SLOW FOR A REASON. Nine forced workspace builds (preflight plus
# mutate-and-restore per DOM leg, restore after the loop leg) and four passes of a suite that
# spawns the built binary twice, launches a real Chromium, executes a real run through a real
# planning turn and kills and respawns the dashboard. Minutes, not seconds. It is the phase's
# ACCEPTANCE, run at wave merge and before `/gsd-verify-work`; the per-commit sample is the fast
# unit cells.
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
#   RUN_DETAIL_MUTATION_LEG=M1|M2|M2L|M3
#       run one declared leg (and only the preflight its instrument needs). Combined with
#       `neutered`, it proves THAT leg's refusal rather than only the first leg's. An undeclared
#       name refuses before any byte is owned.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLI_FILTER="agent-qa"
RUNNER_FILTER="@vostride/agent-qa-runner"

SUBSCRIBER_SUBJECT="packages/dashboard-server/src/reporter/dashboard-subscriber.ts"
FINALIZER_SUBJECT="packages/runner/src/run/step-read-finalization.ts"
LOOP_SUBJECT="packages/runner/src/loop/index.ts"
UNMASK_SUBJECT="packages/cli/src/composition/display-unmask.ts"

SUBJECT_PATHS=("$SUBSCRIBER_SUBJECT" "$FINALIZER_SUBJECT" "$LOOP_SUBJECT" "$UNMASK_SUBJECT")

DOM_SUITE="src/__tests__/conformance/run-detail-dom.test.ts"
LOOP_SUITE="src/loop/__tests__/loop-events.test.ts"

ALL_LEGS="M1 M2 M2L M3"

case "${RUN_DETAIL_MUTATION_SELFTEST:-}" in
  ''|neutered) ;;
  *) echo "FATAL: unknown RUN_DETAIL_MUTATION_SELFTEST=${RUN_DETAIL_MUTATION_SELFTEST}" >&2; exit 1 ;;
esac

SELECTED_LEGS="$ALL_LEGS"
if [ -n "${RUN_DETAIL_MUTATION_LEG+set}" ]; then
  case " $ALL_LEGS " in
    *" ${RUN_DETAIL_MUTATION_LEG} "*)
      [ -n "$RUN_DETAIL_MUTATION_LEG" ] || { echo "FATAL: RUN_DETAIL_MUTATION_LEG must name a declared leg" >&2; exit 1; }
      SELECTED_LEGS="$RUN_DETAIL_MUTATION_LEG" ;;
    *) echo "FATAL: RUN_DETAIL_MUTATION_LEG must name a declared leg (${ALL_LEGS})" >&2; exit 1 ;;
  esac
fi

leg_subject () {
  case "$1" in
    M1) echo "$SUBSCRIBER_SUBJECT" ;;
    M2) echo "$LOOP_SUBJECT" ;;
    M2L) echo "$LOOP_SUBJECT" ;;
    M3) echo "$UNMASK_SUBJECT" ;;
  esac
}

leg_instrument () {
  case "$1" in
    M2L) echo loop ;;
    *) echo dom ;;
  esac
}

# A subject someone is editing is not this script's to own. Checked BEFORE any snapshot exists.
for path in "${SUBJECT_PATHS[@]}"; do
  if ! git ls-files --error-unmatch -- "$path" > /dev/null 2>&1 \
    || [ -n "$(git status --porcelain -- "$path")" ]; then
    echo "FATAL: $path is dirty or untracked — refusing mutation" >&2
    exit 1
  fi
done

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
    echo "  restored $path"
  done
}

# Set while a subject is mutated and not yet rebuilt from its restored bytes. The exit path rebuilds
# whenever it is set, so an interrupted leg cannot leave a mutated artifact — or a restored source
# newer than its dist — behind.
DIST_MAY_BE_MUTATED=0

on_exit () {
  local rc=$?
  trap - EXIT INT TERM HUP
  restore_subjects
  if [ "$DIST_MAY_BE_MUTATED" -eq 1 ]; then
    echo "  exit path: rebuilding every dist from the restored subjects" >&2
    pnpm turbo run build --force > "$WORK/exit-build.log" 2>&1 \
      || { echo "FATAL: the exit-path rebuild failed — run pnpm turbo run build --force" >&2; tail -20 "$WORK/exit-build.log" >&2; rc=1; }
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap on_exit EXIT
trap 'echo "FATAL: interrupted by SIGINT" >&2; exit 130' INT
trap 'echo "FATAL: interrupted by SIGTERM" >&2; exit 143' TERM
trap 'echo "FATAL: interrupted by SIGHUP" >&2; exit 129' HUP

declare -a BASELINE_SHAS=()
for path in "${SUBJECT_PATHS[@]}"; do
  cp "$REPO_ROOT/$path" "$(snapshot_path "$path")"
  sha="$(sha_of "$(snapshot_path "$path")")"
  BASELINE_SHAS+=("$sha")
  echo "subject   $path"
  echo "  sha256  $sha"
done
echo

baseline_sha_of () {
  local index=0 path
  for path in "${SUBJECT_PATHS[@]}"; do
    if [ "$path" = "$1" ]; then echo "${BASELINE_SHAS[$index]}"; return 0; fi
    index=$((index + 1))
  done
  return 1
}

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

# The loop's own cells. (d) is the planner-reported spend on the emit; (e) is the cache-hit step
# that must carry NO triple, which a mutation removing the triple cannot make look broken; (a)-(c)
# are the emission and cache-key cells that do not read usage at all.
REQUIRED_M2L="(d)"
ALLOWED_M2L="(d)"
GREEN_M2L="(a)
(b)
(c)
(e)"

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

# Every anchor a leg edits must occur EXACTLY ONCE before it is touched. An edit that moved the
# declaration turns this script red by name rather than quietly mutating nothing.
require_anchor () {
  local leg="$1" path="$2" anchor="$3" count
  count="$(grep -cF -- "$anchor" "$REPO_ROOT/$path" || true)"
  if [ "$count" != "1" ]; then
    echo "FATAL: mutation $leg anchor occurs $count times in $path (expected exactly 1): $anchor" >&2
    exit 1
  fi
}

apply_mutation () {
  case "${RUN_DETAIL_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # The arm silenced at the dispatch. Everything above it is byte-identical — the envelope is
      # still published, the step row is still written and the run still reaches a verdict — so the
      # only thing this leg removes is the sub-action ROW the page reads.
      require_anchor M1 "$SUBSCRIBER_SUBJECT" '          handleSubActionRecorded(envelope.payload as SubActionRecordedPayload)'
      perl -0pi -e "s/          handleSubActionRecorded\(envelope\.payload as SubActionRecordedPayload\)\n/          void \(envelope.payload as SubActionRecordedPayload\)\n/" \
        "$REPO_ROOT/$SUBSCRIBER_SUBJECT" ;;
    M2)
      # Pre-423 spelling, kept until re-measured: the loop's emit as the carrier of the page's spend.
      require_anchor M2 "$LOOP_SUBJECT" ', error, tokenUsage: tokenUsage() })'
      perl -0pi -e "s/, error, tokenUsage: tokenUsage\(\) \}\)\n/, error \}\)\n/" \
        "$REPO_ROOT/$LOOP_SUBJECT" ;;
    M2L)
      # The additive-optional field dropped at the loop's ONE emit that carries it. The accumulator
      # and the legacy trace two lines below are untouched, so this is precisely the 405-04 append
      # being undone on the standalone callback path and nothing else.
      require_anchor M2L "$LOOP_SUBJECT" ', error, tokenUsage: tokenUsage() })'
      perl -0pi -e "s/, error, tokenUsage: tokenUsage\(\) \}\)\n/, error \}\)\n/" \
        "$REPO_ROOT/$LOOP_SUBJECT" ;;
    M3)
      # The seam still reads the sidecar, still resolves the host key, still re-derives every
      # candidate and still matches the digests — and then puts the placeholder back in place of
      # the value it matched, so the marker pass that runs last rewrites every one into a chip.
      # A leg that had disabled the whole seam would also have removed the marker pass, which is a
      # different mutation with a different meaning.
      require_anchor M3 "$UNMASK_SUBJECT" '            restore.set(placeholder, candidate.value)'
      perl -0pi -e "s/            restore\.set\(placeholder, candidate\.value\)\n/            restore.set\(placeholder, placeholder\)\n/" \
        "$REPO_ROOT/$UNMASK_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

# THE MUTATION IS ASSERTED TO HAVE LANDED, ON THE LEG'S OWN SUBJECT, HUNK BY HUNK. A `perl`
# substitution that matched nothing exits 0 and leaves the file untouched, and the leg would then
# measure an unmutated tree and report a green suite as the mutation "measuring nothing" — the
# right verdict for the wrong reason, and one that sends a reader looking at the cell instead of at
# this script's own pattern.
assert_landed () {
  local leg="$1" subject current
  subject="$(leg_subject "$leg")"
  current="$(sha_of "$REPO_ROOT/$subject")"
  if [ "$current" = "$(baseline_sha_of "$subject")" ]; then
    echo "FATAL: mutation $leg changed no byte — its pattern no longer matches the subject" >&2
    exit 1
  fi
  if false; then
    if grep -qF 'modelObservations === undefined ? {} : { modelObservations }' "$REPO_ROOT/$subject" \
      || ! grep -qF 'tokenUsage: _tokenUsage, ...extra' "$REPO_ROOT/$subject"; then
      echo "FATAL: mutation M2 landed only one of its two hunks" >&2
      exit 1
    fi
  fi
}

build_all () {
  set +e
  pnpm turbo run build --force > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the forced workspace build failed — see the build log below" >&2
    tail -40 "$WORK/build.log" >&2
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

# Run one instrument, leaving per-cell verdicts in $VERDICTS. Answers the process's own exit code.
#
# IT DOES NOT TOUCH `errexit` ITSELF, and that is a correctness point rather than a style one. A
# helper that ends with `set -e; return "$rc"` re-arms errexit and then returns non-zero — which
# aborts the caller at the call site, before the caller can read the code it asked for. The whole
# purpose of a mutation leg is to read a NON-ZERO exit, so the one function that produces it must
# leave the shell exactly as it found it. Every caller wraps the call in its own `set +e`/`set -e`.
run_suite () {
  rm -f "$VERDICTS"
  case "$1" in
    dom)
      pnpm --filter "$CLI_FILTER" exec vitest run "$DOM_SUITE" \
        --reporter=json --outputFile="$VERDICTS" > "$LOG" 2>&1 ;;
    loop)
      pnpm --filter "$RUNNER_FILTER" exec vitest run "$LOOP_SUITE" --typecheck.enabled=false \
        --reporter=json --outputFile="$VERDICTS" > "$LOG" 2>&1 ;;
  esac
}

# Every cell whose recorded status is not `passed`, one title per line. `all` answers every title.
titles_from_verdicts () {
  node -e '
    const fs = require("node:fs")
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const out = []
    for (const file of report.testResults ?? []) {
      for (const cell of file.assertionResults ?? []) {
        if (process.argv[2] === "all" || cell.status !== "passed") out.push(cell.title)
      }
    }
    process.stdout.write(out.join("\n"))
  ' "$VERDICTS" "$1"
}

# A named cell that no longer exists would "stay green" by not being there.
assert_cells_present () {
  local name="$1" names="$2" all fragment
  all="$(titles_from_verdicts all)"
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$all" in
      *"$fragment"*) ;;
      *) echo "FATAL: mutation $name names a cell the suite did not run: $fragment" >&2; exit 1 ;;
    esac
  done <<< "$names"
}

preflight () {
  local instrument="$1" rc suite
  case "$instrument" in dom) suite="$DOM_SUITE" ;; loop) suite="$LOOP_SUITE" ;; esac
  echo "=== PREFLIGHT ($instrument) — the pre-mutation suite, on freshly built dists"
  build_all
  set +e
  run_suite "$instrument"
  rc=$?
  set -e
  echo "  $suite exited $rc"
  if [ "$rc" -ne 0 ] || [ ! -f "$VERDICTS" ]; then
    echo "FATAL: $suite is already red before any mutation" >&2
    sed -n '1,100p' "$LOG" >&2
    exit 1
  fi
  echo
}

# run_leg <name> <label> <required> <allowed> <green>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" green="$5"
  local instrument
  instrument="$(leg_instrument "$name")"

  echo "=== MUTATION $name ($instrument) — $label"
  restore_subjects
  apply_mutation "$name"

  case "${RUN_DETAIL_MUTATION_SELFTEST:-}" in
    neutered) echo "  SELFTEST=neutered: applying a NO-OP edit in place of $name" ;;
    *)
      assert_landed "$name"
      # From here until the restored rebuild, a dist or a source mtime may disagree with the
      # restored tree; the exit path rebuilds whenever this is set.
      DIST_MAY_BE_MUTATED=1 ;;
  esac

  if [ "$instrument" = "dom" ]; then
    echo "  rebuilding every dist the spawned dashboard resolves, so it IS the mutated source"
    build_all
  fi

  set +e
  run_suite "$instrument"
  local rc=$?
  set -e
  echo "  leg exited $rc"

  if [ ! -f "$VERDICTS" ]; then
    echo "FATAL: mutation $name produced no per-cell verdicts — the suite never ran" >&2
    sed -n '1,60p' "$LOG" >&2
    exit 1
  fi

  assert_cells_present "$name" "$required"
  assert_cells_present "$name" "$green"

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    exit 1
  fi

  local red
  red="$(titles_from_verdicts red)"
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
      exit 1
    fi
  done <<< "$red"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  REQUIRED red observed: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        exit 1 ;;
    esac
  done <<< "$required"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_subjects
  build_all
  DIST_MAY_BE_MUTATED=0
  assert_restored
  echo
}

leg_selected () { case " $SELECTED_LEGS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

NEEDS_DOM=0
NEEDS_LOOP=0
for leg in $SELECTED_LEGS; do
  case "$(leg_instrument "$leg")" in dom) NEEDS_DOM=1 ;; loop) NEEDS_LOOP=1 ;; esac
done
[ "$NEEDS_DOM" -eq 1 ] && preflight dom
[ "$NEEDS_LOOP" -eq 1 ] && preflight loop

leg_selected M1 && run_leg M1 "the subscriber's subActionRecorded arm silenced" "$REQUIRED_M1" "$ALLOWED_M1" "$GREEN_M1"
leg_selected M2 && run_leg M2 "the member's final step publication stripped of its usage" "$REQUIRED_M2" "$ALLOWED_M2" "$GREEN_M2"
leg_selected M2L && run_leg M2L "the standalone loop's stepFinalized emit stripped of tokenUsage" "$REQUIRED_M2L" "$ALLOWED_M2L" "$GREEN_M2L"
leg_selected M3 && run_leg M3 "the display-unmask seam made a marker pass, restoring nothing" "$REQUIRED_M3" "$ALLOWED_M3" "$GREEN_M3"

echo "PASS — silencing the sub-action projection, dropping the step's usage at the member's final"
echo "       publication and at the standalone loop's emit, and taking restoration away from the"
echo "       display seam each red exactly the cells that measure those facts, while the step's"
echo "       own spend, the at-rest scan and the chip vocabulary stayed green under the mutations"
echo "       that do not touch them. legs=$(echo $SELECTED_LEGS | wc -w | tr -d ' ')"
