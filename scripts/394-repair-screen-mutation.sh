#!/usr/bin/env bash
#
# 394-repair-screen-mutation.sh — the credential gate's REACH as a runnable differential
# (Phase 394 gap round 1 · WTST-04 · T-394-43, T-394-60, T-394-61).
#
# WHAT THIS PROVES, and why `repair-credential-screen.test.ts` passing does not prove it. That file
# green says the gate refuses what it is asked about. It does not say the gate would be MISSED if
# nobody asked it — and that is the whole of what the phase verification found: the detector was
# never wrong, it was never called on the repair path, and `context` was not a field the type
# carried at all. A detector's acceptance bar is the implementation it must go RED on. This script
# is that bar, and it is TWO bars, because the two holes are two holes:
#
#   MUTATION S  the per-iteration screen call in `repair.ts` is removed. A repair patch's value
#               then reaches `runs.start` — a child process typing it into a live application —
#               and `verifyDraft` persists it in `stepTable[].stepText`.
#   MUTATION C  the `context` location is dropped from the screen's locations array. The gate then
#               runs on the repair path and on the loop path and is blind to one of the three
#               roots `EDITABLE_POINTER_ROOTS` lets a patch write.
#
# THE TWO RED SETS MUST BE DISJOINT, and the script asserts it. A pair of mutations that red the
# same cells has not shown that two properties are covered; it has shown that one cell is fragile.
# That check is what makes this a non-redundant set rather than the same measurement taken twice.
#
# A GREEN SUITE UNDER A MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red that names a
# cell the mutation does not forbid: a differential that reds on collateral has shown the corpus is
# brittle, not that it catches the thing under test.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`. A `| grep` on a verdict-feeding
# command reports the PIPE's status and swallows a red.
#
# IT RUNS THE SAME WAY WHATEVER THE CURRENT DIRECTORY IS. Every path is resolved against the
# script's own location and the script changes into the agent-qa root itself.
#
# USAGE
#   bash agent-qa/scripts/394-repair-screen-mutation.sh    # from the super-repository root
#   bash scripts/394-repair-screen-mutation.sh             # from the agent-qa root
#
# KNOBS
#   REPAIR_SCREEN_SKIP_BUILD=1       skip the dependency rebuild (iteration only — see the warning)
#   REPAIR_SCREEN_SELFTEST=neutered  apply a NO-OP edit in place of mutation S. The script must then
#                                    FATAL with "the suite stayed green under mutation S". A
#                                    mutation script that cannot fail when its mutation does nothing
#                                    is measuring nothing, and this is how that is checked without
#                                    hand-editing the subject.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPAIR_REL="packages/agent/src/authoring/repair.ts"
LOOP_REL="packages/agent/src/authoring/loop.ts"
REPAIR="$REPO_ROOT/$REPAIR_REL"
LOOP="$REPO_ROOT/$LOOP_REL"
SUITE="src/authoring"
AGENT_FILTER="@vostride/agent-qa-agent"
SCHEMA_FILTER="@vostride/agent-qa-schema"
SAFETY_FILTER="@vostride/agent-qa-safety"

# The cells each mutation must red, spelled exactly as vitest prints them.
S_SIGNATURE_CELL="repair-screen refuses a credential-carrying patch by name and starts no probe"
C_SIGNATURE_CELL="context-screen refuses a credential planted in the draft context"

# The cells allowed to be red under each mutation. Every entry is an assertion about the SAME
# property as its signature cell, observed at a second place. Widening either list to quieten a
# surprise red is how a differential stops being one.
ALLOWED_RED_CELLS_S=(
  "$S_SIGNATURE_CELL"
  "repair-screen spends the iteration and mints no receipt"
)
ALLOWED_RED_CELLS_C=(
  "$C_SIGNATURE_CELL"
  "context-screen refuses a context-planted credential through authoring.draft.edit"
)

# The mutation anchors. Each is asserted UNIQUE at preflight: a `perl -pi` over an anchor that
# matches an unknown number of places edits something nobody wrote down, and an anchor that has
# drifted to zero matches matches NOTHING and the script would otherwise sail through green.
S_ANCHOR="      screenDraftForCredentials(staged.draft)"
S_REPLACEMENT="      void staged.draft"
C_ANCHOR="draft.context === undefined"
C_REPLACEMENT="true"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/394-repair-screen-mutation.XXXXXX")"
RESTORED=0

banner() { printf '\n=== %s\n' "$1"; }
fatal() { printf 'FATAL: %s\n' "$1" >&2; exit 1; }

SUBJECT_RELS=("$REPAIR_REL" "$LOOP_REL")
SUBJECT_PATHS=("$REPAIR" "$LOOP")

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
  # Runs on EVERY exit path, including a fatal in the middle of a mutation cell. A differential that
  # can leave a subject mutated can poison the next reader's tree.
  restore_subjects
  rm -rf "$WORK"
}
trap cleanup EXIT

subject_sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# ------------------------------------------------------------------------------------------------
# preflight
# ------------------------------------------------------------------------------------------------

banner "preflight"
[ -f "$REPAIR" ] || fatal "the repair loop is not at $REPAIR_REL"
[ -f "$LOOP" ] || fatal "the authoring loop is not at $LOOP_REL"

# A mutation applied over uncommitted edits cannot be restored honestly: `git checkout --` would
# discard the caller's work and a `cp` snapshot would silently re-commit it under this script's
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
REPAIR_SHA_BEFORE="${SUBJECT_SHAS[0]}"
LOOP_SHA_BEFORE="${SUBJECT_SHAS[1]}"

S_ANCHOR_COUNT="$(grep -cF "$S_ANCHOR" "$REPAIR" || true)"
[ "$S_ANCHOR_COUNT" = "1" ] \
  || fatal "the mutation-S anchor appears $S_ANCHOR_COUNT time(s) in $REPAIR_REL, expected exactly 1"
C_ANCHOR_COUNT="$(grep -cF "$C_ANCHOR" "$LOOP" || true)"
[ "$C_ANCHOR_COUNT" = "1" ] \
  || fatal "the mutation-C anchor appears $C_ANCHOR_COUNT time(s) in $LOOP_REL, expected exactly 1"
printf 'both mutation anchors are unique\n'

if [ "${REPAIR_SCREEN_SKIP_BUILD:-0}" = "1" ]; then
  printf '!!! REPAIR_SCREEN_SKIP_BUILD=1 — this lane may be measuring a STALE dist. Iteration only.\n'
else
  banner "rebuilding dependency dists (cross-package imports resolve through dist, not src)"
  for filter in "$SCHEMA_FILTER" "$SAFETY_FILTER" "$AGENT_FILTER"; do
    set +e
    pnpm --filter "$filter" build >"$WORK/build.$(basename "$filter").log" 2>&1
    BUILD_RC=$?
    set -e
    [ "$BUILD_RC" -eq 0 ] || {
      tail -40 "$WORK/build.$(basename "$filter").log" >&2
      fatal "the $filter build exited $BUILD_RC"
    }
  done
  printf 'schema, safety and agent dists rebuilt\n'
fi

# ------------------------------------------------------------------------------------------------
# the suite runner — one shape, used by every leg
# ------------------------------------------------------------------------------------------------

run_suite() { # $1 = leg name -> writes "$WORK/<leg>.log", sets SUITE_RC
  local leg="$1"
  set +e
  pnpm --filter "$AGENT_FILTER" exec vitest run "$SUITE" >"$WORK/$leg.log" 2>&1
  SUITE_RC=$?
  set -e
}

suite_counts() { # $1 = leg name
  grep -E '^ +Tests +' "$WORK/$1.log" | tail -1 | sed 's/^ *//' || true
}

# The red cells of a leg, one per line, read out of the log FILE.
red_cells() { # $1 = leg name -> writes "$WORK/<leg>-red.txt"
  grep -E '^ FAIL ' "$WORK/$1.log" >"$WORK/$1-failed.txt" || true
  sed -E 's/^ FAIL +[^>]*> *//; s/^.*> *//' "$WORK/$1-failed.txt" | sort -u >"$WORK/$1-red.txt"
  printf 'cells red:\n'
  sed 's/^/  - /' "$WORK/$1-red.txt"
}

assert_red_set() { # $1 = leg, $2 = signature cell, $3.. = allowed cells
  local leg="$1" signature="$2"
  shift 2
  grep -Fq "$signature" "$WORK/$leg-red.txt" \
    || fatal "the $leg mutation did not red its signature cell by name: $signature"
  while IFS= read -r cell; do
    [ -n "$cell" ] || continue
    local allowed=0
    for entry in "$@"; do
      [ "$cell" = "$entry" ] && allowed=1
    done
    [ "$allowed" = "1" ] \
      || fatal "the $leg mutation red a cell it does not forbid: $cell (collateral, not the property under test)"
  done <"$WORK/$leg-red.txt"
}

# ------------------------------------------------------------------------------------------------
# CONTROL LEG — the instrument-liveness half
# ------------------------------------------------------------------------------------------------
#
# Without this, "the suite went red under the mutation" is a reading taken with an instrument that
# may have been red already, and the whole differential is vacuous.

banner "CONTROL — the authoring suite, unmutated"
run_suite control
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/control.log" >&2
  fatal "the CONTROL leg exited $SUITE_RC — the suite is red before any mutation is applied"
}
CONTROL_COUNTS="$(suite_counts control)"
printf 'control green — %s\n' "$CONTROL_COUNTS"

# ------------------------------------------------------------------------------------------------
# MUTATION S — the per-iteration screen call removed
# ------------------------------------------------------------------------------------------------
#
# THE FORBIDDEN IMPLEMENTATION, exactly: a repair iteration stages a model-emitted patch and starts
# the probe without screening it. That is the phase's signature anti-pattern — the doc block claimed
# the coverage, the call site did not exist, and the value reaches a live application and a
# persisted receipt.

banner "MUTATION S — the repair-path screen call removed"
RESTORED=0
if [ "${REPAIR_SCREEN_SELFTEST:-}" = "neutered" ]; then
  printf '!!! REPAIR_SCREEN_SELFTEST=neutered — applying a NO-OP edit instead of the mutation.\n'
  printf '!!! This script MUST now fatal. If it does not, it is measuring nothing.\n'
  perl -0pi -e "s/\Q$S_ANCHOR\E/$S_ANCHOR/" "$REPAIR"
else
  perl -0pi -e "s/\Q$S_ANCHOR\E/$S_REPLACEMENT/" "$REPAIR"
fi

REPAIR_MUTATED_SHA="$(subject_sha "$REPAIR")"
printf 'mutated  %s\n  sha256 %s\n' "$REPAIR_REL" "$REPAIR_MUTATED_SHA"

run_suite mutationS
MUTATION_S_RC="$SUITE_RC"
MUTATION_S_COUNTS="$(suite_counts mutationS)"
printf 'mutation S leg exited %s — %s\n' "$MUTATION_S_RC" "$MUTATION_S_COUNTS"

if [ "$MUTATION_S_RC" -eq 0 ]; then
  fatal "the suite stayed green under mutation S — the corpus does not catch an unscreened repair patch"
fi

red_cells mutationS
assert_red_set mutationS "$S_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_S[@]}"
cp "$WORK/mutationS-red.txt" "$WORK/red-S.txt"

banner "RESTORE S"
restore_subjects
REPAIR_SHA_AFTER="$(subject_sha "$REPAIR")"
[ "$REPAIR_SHA_AFTER" = "$REPAIR_SHA_BEFORE" ] \
  || fatal "the restored repair loop is not byte-identical: $REPAIR_SHA_BEFORE before, $REPAIR_SHA_AFTER after"
printf 'restored byte-identically — sha256 %s\n' "$REPAIR_SHA_AFTER"

run_suite recontrolS
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/recontrolS.log" >&2
  fatal "the suite did not return to green after the mutation-S restore (exited $SUITE_RC)"
}

# ------------------------------------------------------------------------------------------------
# MUTATION C — the context location dropped from the screen's domain
# ------------------------------------------------------------------------------------------------
#
# THE FORBIDDEN IMPLEMENTATION, exactly: the gate is called everywhere it should be and is blind to
# `context`. This is the hole the phase verification found to be LARGER than the review stated —
# `ParsedDraftLike` carried no such field, so it was a type-shape hole rather than a missed entry —
# and a mutation that reds here is what says the widening is load-bearing rather than decorative.

banner "MUTATION C — the context location dropped from the screen"
RESTORED=0
perl -0pi -e "s/\Q$C_ANCHOR\E/$C_REPLACEMENT/" "$LOOP"

LOOP_MUTATED_SHA="$(subject_sha "$LOOP")"
printf 'mutated  %s\n  sha256 %s\n' "$LOOP_REL" "$LOOP_MUTATED_SHA"
[ "$LOOP_MUTATED_SHA" != "$LOOP_SHA_BEFORE" ] \
  || fatal "the mutation-C edit changed nothing — the anchor did not match"

run_suite mutationC
MUTATION_C_RC="$SUITE_RC"
MUTATION_C_COUNTS="$(suite_counts mutationC)"
printf 'mutation C leg exited %s — %s\n' "$MUTATION_C_RC" "$MUTATION_C_COUNTS"

[ "$MUTATION_C_RC" -ne 0 ] \
  || fatal "the suite stayed green with context outside the screen's domain"

red_cells mutationC
assert_red_set mutationC "$C_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_C[@]}"
cp "$WORK/mutationC-red.txt" "$WORK/red-C.txt"

banner "RESTORE C"
restore_subjects
LOOP_SHA_AFTER="$(subject_sha "$LOOP")"
[ "$LOOP_SHA_AFTER" = "$LOOP_SHA_BEFORE" ] \
  || fatal "the restored authoring loop is not byte-identical: $LOOP_SHA_BEFORE before, $LOOP_SHA_AFTER after"
git -C "$REPO_ROOT" status --porcelain -- "${SUBJECT_RELS[@]}" >"$WORK/dirty-after.txt"
# An `if` rather than `[ … ] && fatal`: under `set -e` the AND-list form makes the FALSE branch —
# the healthy one — the script's own exit status.
if [ -s "$WORK/dirty-after.txt" ]; then
  cat "$WORK/dirty-after.txt" >&2
  fatal "the tree is still dirty at a subject after restore"
fi
printf 'restored byte-identically — sha256 %s\n' "$LOOP_SHA_AFTER"

run_suite recontrol
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/recontrol.log" >&2
  fatal "the suite did not return to green after restore (exited $SUITE_RC)"
}
RECONTROL_COUNTS="$(suite_counts recontrol)"

# ------------------------------------------------------------------------------------------------
# NON-REDUNDANCY — the two red sets must be disjoint
# ------------------------------------------------------------------------------------------------
#
# Two mutations that red the same cells have measured one property twice. `comm -12` over the two
# sorted red sets is the whole check, and an overlap is fatal: it would mean the reach hole and the
# domain hole are indistinguishable to this corpus, which is exactly the redundancy that makes a
# gap arc unable to tell whether either was closed.

banner "NON-REDUNDANCY"
comm -12 "$WORK/red-S.txt" "$WORK/red-C.txt" >"$WORK/overlap.txt"
if [ -s "$WORK/overlap.txt" ]; then
  sed 's/^/  - /' "$WORK/overlap.txt" >&2
  fatal "mutations S and C red overlapping cells — the two are not measuring two properties"
fi
printf 'the two red sets are disjoint:\n'
printf '  S: '; paste -sd', ' "$WORK/red-S.txt"
printf '  C: '; paste -sd', ' "$WORK/red-C.txt"

# ------------------------------------------------------------------------------------------------
# receipt
# ------------------------------------------------------------------------------------------------

banner "RECEIPT"
printf 'control           : %s\n' "$CONTROL_COUNTS"
printf 'after restore     : %s\n' "$RECONTROL_COUNTS"
printf '\n'
printf 'MUTATION S\n'
printf 'mutated file      : %s\n' "$REPAIR_REL"
printf 'mutation          : the per-iteration credential screen removed from the repair body\n'
printf 'cell red by name  : %s\n' "$S_SIGNATURE_CELL"
printf 'under mutation    : %s (exit %s)\n' "$MUTATION_S_COUNTS" "$MUTATION_S_RC"
printf 'sha256 before     : %s\n' "$REPAIR_SHA_BEFORE"
printf 'sha256 after      : %s (byte-identical)\n' "$REPAIR_SHA_AFTER"
printf '\n'
printf 'MUTATION C\n'
printf 'mutated file      : %s\n' "$LOOP_REL"
printf 'mutation          : the context location dropped from the screen locations array\n'
printf 'cell red by name  : %s\n' "$C_SIGNATURE_CELL"
printf 'under mutation    : %s (exit %s)\n' "$MUTATION_C_COUNTS" "$MUTATION_C_RC"
printf 'sha256 before     : %s\n' "$LOOP_SHA_BEFORE"
printf 'sha256 after      : %s (byte-identical)\n' "$LOOP_SHA_AFTER"
printf '\n394-repair-screen-mutation: PASS\n'
