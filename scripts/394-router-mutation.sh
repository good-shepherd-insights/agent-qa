#!/usr/bin/env bash
#
# 394-router-mutation.sh — the SC-2 acceptance bar as a runnable differential (WTST-04 · D-08).
#
# WHAT THIS PROVES, and why the hermetic suite alone does not prove it. `router.test.ts` passing
# says the router agrees with a table. It does NOT say the table would notice if the router were
# wrong, and this project's own history is that a detector which merely passes its own suite is
# worth nothing: a cell can go green under the very implementation the frozen row forbids. A
# detector's acceptance bar is the implementation it must go RED on. This script is that bar. It
# edits `packages/agent/src/authoring/router.ts` into the ONE implementation D-08 forbids — a
# clean definitive assertion-fail routed to the repair arm, which is oracle capture by
# construction — and requires the corpus to red on the signature row BY NAME.
#
# A GREEN SUITE UNDER THE MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red that names
# a different cell: a differential that reds on collateral has not shown that the corpus catches
# the thing it exists to forbid, only that the corpus is fragile.
#
# EXIT CODES ARE READ THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`. A `| grep` or `| tail` on a
# verdict-feeding command reports the PIPE's status and swallows a red, which is how a gate on
# this project once reported green for a lane that had failed.
#
# IT RUNS THE SAME WAY WHATEVER THE CURRENT DIRECTORY IS. Every path below is resolved against the
# script's own location, and the script changes into the agent-qa root itself, because a
# path-prefix mismatch between the caller's directory and the script's assumption is how a gate
# silently greps nothing.
#
# USAGE
#   bash agent-qa/scripts/394-router-mutation.sh          # from the super-repository root
#   bash scripts/394-router-mutation.sh                   # from the agent-qa root
#
# KNOBS
#   ROUTER_MUTATION_SKIP_BUILD=1     skip the dependency rebuild (iteration only — see the warning)
#   ROUTER_MUTATION_SELFTEST=neutered
#                                    apply a NO-OP edit in place of the mutation. The script must
#                                    then FATAL with "the suite stayed green under the mutation".
#                                    A mutation script that cannot fail when its mutation does
#                                    nothing is measuring nothing, and this is how that is checked
#                                    without hand-editing the file.
#
# 2026-09-02 (Phase 411): re-pinned in place — the second route was renamed to stop with the
# Issue-slot cleanup; the target spellings below follow it and both claims are unchanged — see
# DELETION-INVENTORY.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ROUTER_REL="packages/agent/src/authoring/router.ts"
ROUTER="$REPO_ROOT/$ROUTER_REL"
# 394-06: the second subject. The call site, not the derivation.
LOOP_REL="packages/agent/src/authoring/loop.ts"
LOOP="$REPO_ROOT/$LOOP_REL"
SUITE="src/authoring"
AGENT_FILTER="@vostride/agent-qa-agent"
SCHEMA_FILTER="@vostride/agent-qa-schema"

# The corpus row this differential must red on, spelled exactly as vitest prints it.
SIGNATURE_CELL="row clean-definitive-assertion-fail reproduces its frozen route"

# The cells allowed to be red under the mutation. Both are assertions about the SIGNATURE ROW —
# its arm, and the evidence that arm has to carry — so a red in either is the differential working.
# Anything else is collateral and is fatal. Keep this list minimal: widening it to quieten a
# surprise red is how a differential stops being one.
# 394-06 MEASURED AND ADDED THE LAST TWO, and they are the differential getting STRONGER rather
# than the list being widened to quieten a surprise. With stage 5 wired, a router that routes a
# clean definitive assertion-fail to repair does not merely misclassify: the loop's stop branch
# is never taken, `repairDraft` runs, and the call-site cells that measured zero probe starts red
# too. Every entry here is an assertion about the SAME signature row — a clean fail must not reach
# repair — observed at the derivation and now also at the call site. Anything else is collateral
# and is fatal.
# 411-02 MEASURED AND ADDED THE LAST THREE. They are not new assertions and they are not this list
# being widened to quieten a surprise: the abandonment bench arrived at 394-21..394-33, AFTER this
# list was last measured at 394-06, so it has carried an incomplete list ever since. Each of the
# three drives the SIGNATURE ROW's own member (`definitiveAssertionFailMember`) through the shipped
# router and states that a clean definitive assertion-fail stops. Measured under the mutation on
# 2026-09-02, the three reds are, verbatim: `expected 'indefinitive-failure' to be
# 'clean-definitive-assertion-fail'` (the clean fail went to bounded repair and the eventual stop
# carries a different class), `Error: the control must route to a stop, not repair` (thrown by name
# by the bench's own control derivation), and `expected true to be false` (`repairAbandonment` is
# now present, because repair ran on a draft it must never have reached). All three name the
# property; none is collateral.
ALLOWED_RED_CELLS=(
  "$SIGNATURE_CELL"
  "refs the exact trace and both a11y snapshots at the failure point"
  "stop-branch-never-repairs answers a stop without starting a single probe"
  "stop-branch-never-repairs carries the evidence refs the route derived"
  "EXHAUSTED: that evidence is the ORDINARY arm's derivation, not a second walk"
  "the ORDINARY routed stop carries NO abandonment at all — absent, not defaulted"
  "the ORDINARY routed stop carries NEITHER key — absent, not defaulted"
)

# ---- MUTATION CELL 2 (394-06) ------------------------------------------------------------------
#
# The cell the router's own corpus cannot carry: SC-2's claim is about the CALL SITE, and a
# derivation proven correct can still be wired to the wrong consumer. The forbidden implementation
# is `loop.ts`'s stop branch calling `repairDraft` — the app-broken branch reaching the repair
# entry point, which is oracle capture one layer out.
#
# IT MUST RED IN TWO PLACES, and each covers what the other cannot. The TYPECHECK leg is the whole
# of the structural claim — `repairDraft` takes a `RepairRoute`, so the call does not compile — and
# vitest does not typecheck `.test.ts` at all, so nothing in the behavioural suite would notice.
# The BEHAVIOURAL leg is what says the property survives a build in which somebody reached for a
# cast: esbuild transpiles the type error away, the stop branch runs, and the cell that measured
# zero probe starts reds by name.
LOOP_SIGNATURE_CELL="stop-branch-never-repairs answers a stop without starting a single probe"

# 411-02 MEASURED AND ADDED THE LAST THREE, for the same reason as cell 1's list and with the same
# discipline: every cell here drives a STOPPED outcome through stage 5, so with `repairDraft` wired
# under the stop branch every one of them enters the repair entry point the branch must never
# reach. Measured on 2026-09-02, all three red with the same sentence — `TypeError: Cannot read
# properties of undefined (reading 'map')` — raised inside `repairDraft` when it walks a route that
# carries no `mechanics`. That crash IS the property: it can only be reached by a stop that called
# repair. Nothing outside the stopped path reds.
ALLOWED_RED_CELLS_2=(
  "$LOOP_SIGNATURE_CELL"
  "stop-branch-never-repairs carries the evidence refs the route derived"
  "every stopped outcome projects to a payload the strict stop schema accepts"
  "the ORDINARY routed stop carries NO abandonment at all — absent, not defaulted"
  "the ORDINARY routed stop carries NEITHER key — absent, not defaulted"
)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/394-router-mutation.XXXXXX")"
SNAPSHOT="$WORK/router.ts.snapshot"
RESTORED=0

banner() { printf '\n=== %s\n' "$1"; }
fatal() { printf 'FATAL: %s\n' "$1" >&2; exit 1; }

# A LOOP over the subjects, not a second variable one cleanup path knows about — the warning the
# 394-05 extension point left behind. Every subject is snapshotted at preflight and every subject
# is restored on every exit path, so no ordering of fatals can leave one of them mutated.
SUBJECT_RELS=("$ROUTER_REL" "$LOOP_REL")
SUBJECT_PATHS=("$ROUTER" "$LOOP")

restore_subjects() {
  [ "$RESTORED" = "1" ] && return 0
  local index=0
  while [ "$index" -lt "${#SUBJECT_PATHS[@]}" ]; do
    local snapshot="$WORK/subject-$index.snapshot"
    [ -f "$snapshot" ] && cp "$snapshot" "${SUBJECT_PATHS[$index]}"
    index=$((index + 1))
  done
  RESTORED=1
}

cleanup() {
  # Runs on EVERY exit path, including a fatal in the middle of the mutation cell. A differential
  # that can leave the subject mutated is a differential that can poison the next reader's tree.
  restore_subjects
  rm -rf "$WORK"
}
trap cleanup EXIT

# shasum over a subject, so "restored" is a measurement rather than an intention.
subject_sha() { shasum -a 256 "$1" | awk '{print $1}'; }
router_sha() { subject_sha "$ROUTER"; }

# ------------------------------------------------------------------------------------------------
# preflight
# ------------------------------------------------------------------------------------------------

banner "preflight"
[ -f "$ROUTER" ] || fatal "the router is not at $ROUTER_REL"
[ -f "$LOOP" ] || fatal "the loop is not at $LOOP_REL"

# A mutation applied over uncommitted edits cannot be restored honestly: `git checkout --` would
# discard the caller's work, and a `cp` snapshot would silently re-commit it under this script's
# name. Refusing is the only correct answer.
git -C "$REPO_ROOT" status --porcelain -- "${SUBJECT_RELS[@]}" >"$WORK/dirty.txt"
if [ -s "$WORK/dirty.txt" ]; then
  cat "$WORK/dirty.txt" >&2
  fatal "a subject has uncommitted changes; this lane refuses to measure over a dirty tree"
fi

SUBJECT_SHAS=()
subject_index=0
while [ "$subject_index" -lt "${#SUBJECT_PATHS[@]}" ]; do
  SUBJECT_SHAS+=("$(subject_sha "${SUBJECT_PATHS[$subject_index]}")")
  cp "${SUBJECT_PATHS[$subject_index]}" "$WORK/subject-$subject_index.snapshot"
  printf 'subject %s\n  sha256 %s\n' "${SUBJECT_RELS[$subject_index]}" "${SUBJECT_SHAS[$subject_index]}"
  subject_index=$((subject_index + 1))
done
SHA_BEFORE="${SUBJECT_SHAS[0]}"
LOOP_SHA_BEFORE="${SUBJECT_SHAS[1]}"
cp "$ROUTER" "$SNAPSHOT"

# The mutation target must be UNIQUE, or `perl -pi` would edit an unknown number of places and the
# differential would be measuring something nobody wrote down.
TARGET_COUNT="$(grep -c "'clean-definitive-assertion-fail': 'stop'," "$ROUTER" || true)"
[ "$TARGET_COUNT" = "1" ] \
  || fatal "the mutation target appears $TARGET_COUNT time(s) in $ROUTER_REL, expected exactly 1"
LOOP_TARGET="  if (route.kind === 'stop') {"
LOOP_TARGET_COUNT="$(grep -cF "$LOOP_TARGET" "$LOOP" || true)"
[ "$LOOP_TARGET_COUNT" = "1" ] \
  || fatal "the cell-2 mutation target appears $LOOP_TARGET_COUNT time(s) in $LOOP_REL, expected exactly 1"
printf 'both mutation targets are unique\n'

if [ "${ROUTER_MUTATION_SKIP_BUILD:-0}" = "1" ]; then
  printf '!!! ROUTER_MUTATION_SKIP_BUILD=1 — this lane may be measuring a STALE dist. Iteration only.\n'
else
  banner "rebuilding dependency dists (cross-package imports resolve through dist, not src)"
  set +e
  pnpm --filter "$SCHEMA_FILTER" build >"$WORK/build.schema.log" 2>&1
  BUILD_SCHEMA_RC=$?
  set -e
  [ "$BUILD_SCHEMA_RC" -eq 0 ] || {
    tail -40 "$WORK/build.schema.log" >&2
    fatal "the schema build exited $BUILD_SCHEMA_RC"
  }
  set +e
  pnpm --filter "$AGENT_FILTER" build >"$WORK/build.agent.log" 2>&1
  BUILD_AGENT_RC=$?
  set -e
  [ "$BUILD_AGENT_RC" -eq 0 ] || {
    tail -40 "$WORK/build.agent.log" >&2
    fatal "the agent build exited $BUILD_AGENT_RC"
  }
  printf 'schema and agent dists rebuilt\n'
fi

# ------------------------------------------------------------------------------------------------
# the suite runner — one shape, used by every leg
# ------------------------------------------------------------------------------------------------

run_suite() { # $1 = leg name -> writes "$WORK/<leg>.log", echoes nothing, sets SUITE_RC
  local leg="$1"
  set +e
  pnpm --filter "$AGENT_FILTER" exec vitest run "$SUITE" >"$WORK/$leg.log" 2>&1
  SUITE_RC=$?
  set -e
}

# The one line vitest prints with the counts, lifted out of the log file rather than out of a pipe
# on the measured command itself.
suite_counts() { # $1 = leg name
  grep -E '^ +Tests +' "$WORK/$1.log" | tail -1 | sed 's/^ *//' || true
}

# ------------------------------------------------------------------------------------------------
# CONTROL LEG — the instrument-liveness half
# ------------------------------------------------------------------------------------------------
#
# Without this, "the suite went red under the mutation" is a reading taken with an instrument that
# may have been red already, and the whole differential is vacuous. This half is why it is a
# differential rather than a single observation.

banner "CONTROL — the authoring suite, unmutated"
run_suite control
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/control.log" >&2
  fatal "the CONTROL leg exited $SUITE_RC — the suite is red before any mutation is applied"
}
CONTROL_COUNTS="$(suite_counts control)"
printf 'control green — %s\n' "$CONTROL_COUNTS"

# ------------------------------------------------------------------------------------------------
# MUTATION CELL 1 — the routing arm
# ------------------------------------------------------------------------------------------------
#
# THE FORBIDDEN IMPLEMENTATION, exactly: the clean-definitive-assertion-fail class is mapped to the
# repair arm at the router's one mapping site. That is oracle capture by construction — "repairing"
# a clean fail can only mean rewriting what the test claims to match what the application showed.

banner "MUTATION 1 — the clean-definitive-assertion-fail class routed to REPAIR"
if [ "${ROUTER_MUTATION_SELFTEST:-}" = "neutered" ]; then
  printf '!!! ROUTER_MUTATION_SELFTEST=neutered — applying a NO-OP edit instead of the mutation.\n'
  printf '!!! This script MUST now fatal. If it does not, it is measuring nothing.\n'
  perl -0pi -e "s/'clean-definitive-assertion-fail': 'stop',/'clean-definitive-assertion-fail': 'stop',/" "$ROUTER"
else
  perl -0pi -e "s/'clean-definitive-assertion-fail': 'stop',/'clean-definitive-assertion-fail': 'repair',/" "$ROUTER"
fi
RESTORED=0

MUTATED_SHA="$(router_sha)"
printf 'mutated  sha256 %s\n' "$MUTATED_SHA"

run_suite mutation
MUTATION_RC="$SUITE_RC"
MUTATION_COUNTS="$(suite_counts mutation)"
printf 'mutation leg exited %s — %s\n' "$MUTATION_RC" "$MUTATION_COUNTS"

if [ "$MUTATION_RC" -eq 0 ]; then
  fatal "the suite stayed green under the mutation — the corpus does not catch the routing D-08 forbids"
fi

# WHICH cells went red, read out of the log FILE. A non-zero exit naming a different cell is not a
# pass with noise: it means the corpus reds on something other than the property under test.
grep -E '^ FAIL ' "$WORK/mutation.log" >"$WORK/failed.txt" || true
sed -E 's/^ FAIL +[^>]*> *//; s/^.*> *//' "$WORK/failed.txt" | sort -u >"$WORK/failed-cells.txt"
printf 'cells red under the mutation:\n'
sed 's/^/  - /' "$WORK/failed-cells.txt"

grep -Fq "$SIGNATURE_CELL" "$WORK/failed-cells.txt" \
  || fatal "the mutation did not red the signature cell by name: $SIGNATURE_CELL"

while IFS= read -r cell; do
  [ -n "$cell" ] || continue
  ALLOWED=0
  for allowed in "${ALLOWED_RED_CELLS[@]}"; do
    [ "$cell" = "$allowed" ] && ALLOWED=1
  done
  [ "$ALLOWED" = "1" ] \
    || fatal "the mutation red a cell this differential does not forbid: $cell (collateral, not the property under test)"
done <"$WORK/failed-cells.txt"

# ------------------------------------------------------------------------------------------------
# RESTORE + re-confirm the control
# ------------------------------------------------------------------------------------------------

banner "RESTORE"
restore_subjects
SHA_AFTER="$(router_sha)"
[ "$SHA_AFTER" = "$SHA_BEFORE" ] \
  || fatal "the restored router is not byte-identical: $SHA_BEFORE before, $SHA_AFTER after"
git -C "$REPO_ROOT" status --porcelain -- "${SUBJECT_RELS[@]}" >"$WORK/dirty-after.txt"
# An `if` rather than `[ … ] && fatal`: under `set -e` the AND-list form makes the FALSE branch —
# the healthy one — the script's own exit status, which is the shape of accident this file exists
# to avoid making elsewhere.
if [ -s "$WORK/dirty-after.txt" ]; then
  cat "$WORK/dirty-after.txt" >&2
  fatal "the tree is still dirty at a subject after restore"
fi
printf 'restored byte-identically — sha256 %s\n' "$SHA_AFTER"

run_suite recontrol
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/recontrol.log" >&2
  fatal "the suite did not return to green after restore (exited $SUITE_RC)"
}
RECONTROL_COUNTS="$(suite_counts recontrol)"

# ------------------------------------------------------------------------------------------------
# MUTATION CELL 2 — the stop branch wired into repairDraft (394-06, SC-2 at the CALL SITE)
# ------------------------------------------------------------------------------------------------
#
# THE FORBIDDEN IMPLEMENTATION, exactly: `loop.ts`'s stage-5 stop branch calls `repairDraft`
# before answering. That is the app-broken branch reaching the repair entry point — a test whose
# CLAIM the application did not satisfy, handed to a loop whose job is to change the test until it
# passes. Cell 1 proves the derivation refuses to route a clean fail to repair; this proves the
# call site refuses to wire it there, which is a different property and the one SC-2 states.

banner "MUTATION 2 — the stop branch wired into repairDraft"
RESTORED=0
perl -0pi -e "s/\Q  if (route.kind === 'stop') {\E/  if (route.kind === 'stop') {\n    await repairDraft(route, { draft, handoff: handoff as CompletedRunHandoff, shelf: deps.shelf, runs: deps.shelf.runs })/" "$LOOP"

LOOP_MUTATED_SHA="$(subject_sha "$LOOP")"
printf 'mutated  %s\n  sha256 %s\n' "$LOOP_REL" "$LOOP_MUTATED_SHA"
[ "$LOOP_MUTATED_SHA" != "$LOOP_SHA_BEFORE" ] \
  || fatal "the cell-2 edit changed nothing — the mutation target did not match"

# LEG A — the typecheck. `repairDraft` takes a `RepairRoute`, so the call cannot compile. This is
# the whole of the structural claim, and NOTHING in the behavioural suite can see it: vitest's
# `typecheck.include` is `*.test-d.ts`, so a `.test.ts` file is transpiled and never checked.
set +e
pnpm --filter "$AGENT_FILTER" exec tsc --noEmit >"$WORK/mutation2-tsc.log" 2>&1
TSC2_RC=$?
set -e
printf 'typecheck leg exited %s\n' "$TSC2_RC"
[ "$TSC2_RC" -ne 0 ] \
  || fatal "the stop branch compiled while calling repairDraft — the two route arms are assignable"
grep -q "authoring/loop.ts" "$WORK/mutation2-tsc.log" \
  || fatal "the typecheck red does not name $LOOP_REL"
# THE EXACT SENTENCE SC-2 ASSERTS, required verbatim rather than the token `repairDraft`. Measured
# at 394-06 and re-observed by hand at 411-02 under the renamed route: tsc reports the call as
# `Argument of type 'StopRoute' is not assignable to parameter of type 'RepairRoute'.` and never
# names the callee. Requiring the callee's name would have passed on any unrelated type error in
# this file that happened to mention it; requiring this sentence passes only on the
# non-assignability the two route arms exist to have.
grep -qF "Argument of type 'StopRoute' is not assignable to parameter of type 'RepairRoute'" \
  "$WORK/mutation2-tsc.log" \
  || fatal "the typecheck red is not the StopRoute-to-RepairRoute non-assignability"
printf 'typecheck red names %s and the non-assignability:\n' "$LOOP_REL"
grep -m1 "authoring/loop.ts" "$WORK/mutation2-tsc.log" | sed 's/^/  /'

# LEG B — the behaviour, because a build in which somebody reached for a cast still runs. esbuild
# transpiles the type error away, the stop branch enters repair, and the cell that measured zero
# probe starts reds by name.
run_suite mutation2
MUTATION2_RC="$SUITE_RC"
MUTATION2_COUNTS="$(suite_counts mutation2)"
printf 'behavioural leg exited %s — %s\n' "$MUTATION2_RC" "$MUTATION2_COUNTS"
[ "$MUTATION2_RC" -ne 0 ] \
  || fatal "the suite stayed green with the stop branch wired into repair"

grep -E '^ FAIL ' "$WORK/mutation2.log" >"$WORK/failed2.txt" || true
sed -E 's/^ FAIL +[^>]*> *//; s/^.*> *//' "$WORK/failed2.txt" | sort -u >"$WORK/failed-cells2.txt"
printf 'cells red under the cell-2 mutation:\n'
sed 's/^/  - /' "$WORK/failed-cells2.txt"

grep -Fq "$LOOP_SIGNATURE_CELL" "$WORK/failed-cells2.txt" \
  || fatal "the cell-2 mutation did not red its signature cell by name: $LOOP_SIGNATURE_CELL"

while IFS= read -r cell; do
  [ -n "$cell" ] || continue
  ALLOWED=0
  for allowed in "${ALLOWED_RED_CELLS_2[@]}"; do
    [ "$cell" = "$allowed" ] && ALLOWED=1
  done
  [ "$ALLOWED" = "1" ] \
    || fatal "the cell-2 mutation red a cell this differential does not forbid: $cell (collateral)"
done <"$WORK/failed-cells2.txt"

banner "RESTORE 2"
restore_subjects
LOOP_SHA_AFTER="$(subject_sha "$LOOP")"
[ "$LOOP_SHA_AFTER" = "$LOOP_SHA_BEFORE" ] \
  || fatal "the restored loop is not byte-identical: $LOOP_SHA_BEFORE before, $LOOP_SHA_AFTER after"
git -C "$REPO_ROOT" status --porcelain -- "${SUBJECT_RELS[@]}" >"$WORK/dirty-after2.txt"
if [ -s "$WORK/dirty-after2.txt" ]; then
  cat "$WORK/dirty-after2.txt" >&2
  fatal "the tree is still dirty at a subject after the cell-2 restore"
fi
printf 'restored byte-identically — sha256 %s\n' "$LOOP_SHA_AFTER"

set +e
pnpm --filter "$AGENT_FILTER" exec tsc --noEmit >"$WORK/recheck-tsc.log" 2>&1
TSC_RECHECK_RC=$?
set -e
[ "$TSC_RECHECK_RC" -eq 0 ] || {
  tail -20 "$WORK/recheck-tsc.log" >&2
  fatal "the package does not typecheck again after the cell-2 restore"
}

# ------------------------------------------------------------------------------------------------
# receipt
# ------------------------------------------------------------------------------------------------

banner "RECEIPT"
printf 'mutated file      : %s\n' "$ROUTER_REL"
printf 'mutation          : the clean-definitive-assertion-fail class mapped to the repair arm\n'
printf 'cell red by name  : %s\n' "$SIGNATURE_CELL"
printf 'control           : %s\n' "$CONTROL_COUNTS"
printf 'under mutation    : %s (exit %s)\n' "$MUTATION_COUNTS" "$MUTATION_RC"
printf 'after restore     : %s\n' "$RECONTROL_COUNTS"
printf 'sha256 before     : %s\n' "$SHA_BEFORE"
printf 'sha256 after      : %s (byte-identical)\n' "$SHA_AFTER"
printf '\n'
printf 'CELL 2\n'
printf 'mutated file      : %s\n' "$LOOP_REL"
printf 'mutation          : the stage-5 stop branch calling repairDraft\n'
printf 'typecheck         : exit %s, naming %s and the StopRoute-to-RepairRoute refusal\n' "$TSC2_RC" "$LOOP_REL"
printf 'cell red by name  : %s\n' "$LOOP_SIGNATURE_CELL"
printf 'under mutation    : %s (exit %s)\n' "$MUTATION2_COUNTS" "$MUTATION2_RC"
printf 'sha256 before     : %s\n' "$LOOP_SHA_BEFORE"
printf 'sha256 after      : %s (byte-identical)\n' "$LOOP_SHA_AFTER"
printf '\n394-router-mutation: PASS\n'
