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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ROUTER_REL="packages/agent/src/authoring/router.ts"
ROUTER="$REPO_ROOT/$ROUTER_REL"
SUITE="src/authoring"
AGENT_FILTER="@vostride/agent-qa-agent"
SCHEMA_FILTER="@vostride/agent-qa-schema"

# The corpus row this differential must red on, spelled exactly as vitest prints it.
SIGNATURE_CELL="row clean-definitive-assertion-fail reproduces its frozen route"

# The cells allowed to be red under the mutation. Both are assertions about the SIGNATURE ROW —
# its arm, and the evidence that arm has to carry — so a red in either is the differential working.
# Anything else is collateral and is fatal. Keep this list minimal: widening it to quieten a
# surprise red is how a differential stops being one.
ALLOWED_RED_CELLS=(
  "$SIGNATURE_CELL"
  "refs the exact trace and both a11y snapshots at the failure point"
)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/394-router-mutation.XXXXXX")"
SNAPSHOT="$WORK/router.ts.snapshot"
RESTORED=0

banner() { printf '\n=== %s\n' "$1"; }
fatal() { printf 'FATAL: %s\n' "$1" >&2; exit 1; }

restore_router() {
  [ -f "$SNAPSHOT" ] || return 0
  [ "$RESTORED" = "1" ] && return 0
  cp "$SNAPSHOT" "$ROUTER"
  RESTORED=1
}

cleanup() {
  # Runs on EVERY exit path, including a fatal in the middle of the mutation cell. A differential
  # that can leave the subject mutated is a differential that can poison the next reader's tree.
  restore_router
  rm -rf "$WORK"
}
trap cleanup EXIT

# shasum over the subject, so "restored" is a measurement rather than an intention.
router_sha() { shasum -a 256 "$ROUTER" | awk '{print $1}'; }

# ------------------------------------------------------------------------------------------------
# preflight
# ------------------------------------------------------------------------------------------------

banner "preflight"
[ -f "$ROUTER" ] || fatal "the router is not at $ROUTER_REL"

# A mutation applied over uncommitted edits cannot be restored honestly: `git checkout --` would
# discard the caller's work, and a `cp` snapshot would silently re-commit it under this script's
# name. Refusing is the only correct answer.
git -C "$REPO_ROOT" status --porcelain -- "$ROUTER_REL" >"$WORK/dirty.txt"
if [ -s "$WORK/dirty.txt" ]; then
  cat "$WORK/dirty.txt" >&2
  fatal "$ROUTER_REL has uncommitted changes; this lane refuses to measure over a dirty tree"
fi

SHA_BEFORE="$(router_sha)"
cp "$ROUTER" "$SNAPSHOT"
printf 'subject %s\n  sha256 %s\n' "$ROUTER_REL" "$SHA_BEFORE"

# The mutation target must be UNIQUE, or `perl -pi` would edit an unknown number of places and the
# differential would be measuring something nobody wrote down.
TARGET_COUNT="$(grep -c "'clean-definitive-assertion-fail': 'finding'," "$ROUTER" || true)"
[ "$TARGET_COUNT" = "1" ] \
  || fatal "the mutation target appears $TARGET_COUNT time(s) in $ROUTER_REL, expected exactly 1"
printf 'mutation target is unique\n'

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
  perl -0pi -e "s/'clean-definitive-assertion-fail': 'finding',/'clean-definitive-assertion-fail': 'finding',/" "$ROUTER"
else
  perl -0pi -e "s/'clean-definitive-assertion-fail': 'finding',/'clean-definitive-assertion-fail': 'repair',/" "$ROUTER"
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
restore_router
SHA_AFTER="$(router_sha)"
[ "$SHA_AFTER" = "$SHA_BEFORE" ] \
  || fatal "the restored router is not byte-identical: $SHA_BEFORE before, $SHA_AFTER after"
git -C "$REPO_ROOT" status --porcelain -- "$ROUTER_REL" >"$WORK/dirty-after.txt"
# An `if` rather than `[ … ] && fatal`: under `set -e` the AND-list form makes the FALSE branch —
# the healthy one — the script's own exit status, which is the shape of accident this file exists
# to avoid making elsewhere.
if [ -s "$WORK/dirty-after.txt" ]; then
  cat "$WORK/dirty-after.txt" >&2
  fatal "the tree is still dirty at $ROUTER_REL after restore"
fi
printf 'restored byte-identically — sha256 %s\n' "$SHA_AFTER"

run_suite recontrol
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/recontrol.log" >&2
  fatal "the suite did not return to green after restore (exited $SUITE_RC)"
}
RECONTROL_COUNTS="$(suite_counts recontrol)"

# ------------------------------------------------------------------------------------------------
# EXTENSION POINT — plan 06's second mutation cell
# ------------------------------------------------------------------------------------------------
#
# Plan 06 wires stage 5 and lands the repair arm's consumer. Its differential — the finding branch
# proven unreachable at the CALL SITE, not merely in the derivation — belongs HERE, as MUTATION
# CELL 2, using `run_suite` and the same allowed-red-cells discipline above. Two scripts would be
# two answers to one question, and the second would drift the moment either is edited alone.
#
#   banner "MUTATION 2 — the finding branch wired into repairLoop"
#   ... perl -0pi -e '<the forbidden call-site edit>' "$LOOP"
#   run_suite mutation2 ; require a non-zero rc naming plan 06's own signature cell
#
# Whoever adds it: the subject list at the top must grow too, and `restore_router` must become a
# loop over the subjects. A second snapshot variable that only one cleanup path knows about is the
# way this script starts leaving mutated files behind.

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
printf '\n394-router-mutation: PASS\n'
