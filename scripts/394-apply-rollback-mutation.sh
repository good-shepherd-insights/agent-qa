#!/usr/bin/env bash
#
# 394-apply-rollback-mutation.sh — the one-commit apply's ROLLBACK as a runnable differential
# (Phase 394 gap round 1 · CR-05 · WTST-01, T-394-70).
#
# WHAT THIS PROVES, and why `one-commit-apply.test.ts` passing did not prove it before this plan.
# That file green said the apply writes one file and refuses three named ways. It said nothing about
# what a FAILED apply leaves behind, and what it left behind was the agent's blob in the person's
# index — where the very next `git commit` would have carried it, because a commit commits the
# index. The verification named a second defect beside it: a commit that SUCCEEDED and whose hash
# could not be read routed through the same catch, so a real commit was answered with a worktree
# reverted against it.
#
# THREE MUTATIONS, THREE PROPERTIES, AND THE RED SETS MUST BE PAIRWISE DISJOINT:
#
#   MUTATION T  the INDEX half of the restore is removed, leaving the worktree-only restore this
#               file shipped with. A failed apply then leaves the agent's blob staged.
#   MUTATION V  the hash read after a SUCCESSFUL commit is routed back through the restore catch.
#               A commit that exists is then answered with the file reverted against it.
#   MUTATION N  the nothing-to-commit arm is removed, so an apply that staged nothing reports a
#               generic `git commit exited 1` instead of refusing by name.
#
# DISJOINTNESS IS THE POINT, and the script asserts it with `comm -12` over the sorted red sets. A
# pair of mutations that red the same cells has measured one property twice; three that red three
# sets have shown the corpus distinguishes three defects — which is what a gap round needs in order
# to say which of them was closed.
#
# A GREEN SUITE UNDER A MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a cell
# the mutation does not forbid: a differential that reds on collateral has shown the corpus is
# brittle rather than that it catches the thing under test.
#
# ANCHORS ARE ASSERTED UNIQUE BEFORE ANYTHING IS EDITED. An anchor that has drifted to zero matches
# edits NOTHING, and a script that then ran the suite would sail through green having measured the
# unmutated build — the failure mode this preflight exists to make impossible.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`.
#
# THE PACKAGE FILTER IS `agent-qa`, NOT `@vostride/agent-qa-cli`. That second spelling matches no
# package in this workspace and `pnpm` answers "No projects matched the filters" while EXITING 0 —
# recorded as WINDOWS 105 after three plans in a row built criteria on it.
#
# USAGE
#   bash agent-qa/scripts/394-apply-rollback-mutation.sh    # from the super-repository root
#   bash scripts/394-apply-rollback-mutation.sh             # from the agent-qa root
#
# KNOBS
#   APPLY_ROLLBACK_SKIP_BUILD=1       skip the dependency rebuild (iteration only — see the warning)
#   APPLY_ROLLBACK_SELFTEST=neutered  apply a NO-OP edit in place of mutation T. The script must then
#                                     FATAL with "the suite stayed green under mutation T". A
#                                     mutation script that cannot fail when its mutation does
#                                     nothing is measuring nothing, and this is how that is checked
#                                     without hand-editing the subject.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST_REL="packages/cli/src/composition/local-agent-host.ts"
HOST="$REPO_ROOT/$HOST_REL"
SUITE="src/__tests__/one-commit-apply.test.ts"
CLI_FILTER="agent-qa"
SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"
CORE_FILTER="@vostride/agent-qa-core"

# The cells each mutation must red, spelled exactly as vitest prints them.
T_SIGNATURE_CELL="leaves NO index entry behind when the commit fails and the target was untracked"
V_SIGNATURE_CELL="does NOT revert a file whose commit already SUCCEEDED"
N_SIGNATURE_CELL="names NOTHING-TO-COMMIT rather than reporting it as a git failure"

# The cells allowed to be red under each mutation. Every entry is an assertion about the SAME
# property as its signature cell, observed at a second place. Widening a list to quieten a surprise
# red is how a differential stops being one.
ALLOWED_RED_CELLS_T=(
  "$T_SIGNATURE_CELL"
  "restores the pre-apply INDEX ENTRY, rather than blanket-unstaging the path"
)
ALLOWED_RED_CELLS_V=(
  "$V_SIGNATURE_CELL"
)
ALLOWED_RED_CELLS_N=(
  "$N_SIGNATURE_CELL"
)

T_ANCHOR="  restoreIndexEntry(exec, cwd, identityPath, indexBefore)"
T_REPLACEMENT="  void indexBefore"

V_ANCHOR="  return {
    filePath: identityPath,
    commit: runGitHeadHash(exec, configDir, identityPath),
  }"
V_REPLACEMENT="  try {
    return {
      filePath: identityPath,
      commit: runGitHeadHash(exec, configDir, identityPath),
    }
  } catch (error) {
    restoreApplyFailure(exec, configDir, identityPath, absoluteTarget, existing, indexBefore)
    throw error
  }"

N_ANCHOR="  if (!stagedAtPath(exec, cwd, targetPath)) return { kind: 'nothing-to-commit' }"
N_REPLACEMENT="  void stagedAtPath"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/394-apply-rollback-mutation.XXXXXX")"
RESTORED=0

banner() { printf '\n=== %s\n' "$1"; }
fatal() { printf 'FATAL: %s\n' "$1" >&2; exit 1; }

restore_subject() {
  [ "$RESTORED" = "1" ] && return 0
  [ -f "$WORK/host.snapshot" ] && cp "$WORK/host.snapshot" "$HOST"
  RESTORED=1
}

cleanup() {
  # Runs on EVERY exit path, including a fatal mid-mutation. A differential that can leave a subject
  # mutated poisons the next reader's tree.
  restore_subject
  rm -rf "$WORK"
}
trap cleanup EXIT

subject_sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# ------------------------------------------------------------------------------------------------
# preflight
# ------------------------------------------------------------------------------------------------

banner "preflight"
[ -f "$HOST" ] || fatal "the local agent host is not at $HOST_REL"

# A mutation applied over uncommitted edits cannot be restored honestly: `git checkout --` would
# discard the caller's work and a `cp` snapshot would silently re-commit it under this script's
# name. Refusing is the only correct answer.
git -C "$REPO_ROOT" status --porcelain -- "$HOST_REL" >"$WORK/dirty.txt"
if [ -s "$WORK/dirty.txt" ]; then
  cat "$WORK/dirty.txt" >&2
  fatal "the subject has uncommitted changes; this lane refuses to measure over a dirty tree"
fi

HOST_SHA_BEFORE="$(subject_sha "$HOST")"
cp "$HOST" "$WORK/host.snapshot"
printf 'subject %s\n  sha256 %s\n' "$HOST_REL" "$HOST_SHA_BEFORE"

anchor_count() { # $1 = anchor
  local count
  count="$(perl -0ne 'BEGIN{$a=shift} $n=0; $n++ while /\Q$a\E/g; print $n' "$1" "$HOST")"
  printf '%s' "$count"
}

for pair in "T:$T_ANCHOR" "V:$V_ANCHOR" "N:$N_ANCHOR"; do
  name="${pair%%:*}"
  anchor="${pair#*:}"
  count="$(anchor_count "$anchor")"
  [ "$count" = "1" ] \
    || fatal "the mutation-$name anchor appears $count time(s) in $HOST_REL, expected exactly 1 — a drifted anchor edits nothing and this lane would then measure the UNMUTATED build"
done
printf 'all three mutation anchors are unique\n'

if [ "${APPLY_ROLLBACK_SKIP_BUILD:-0}" = "1" ]; then
  printf '!!! APPLY_ROLLBACK_SKIP_BUILD=1 — this lane may be measuring a STALE dist. Iteration only.\n'
else
  banner "rebuilding dependency dists (cross-package imports resolve through dist, not src)"
  for filter in "$SCHEMA_FILTER" "$CORE_FILTER" "$AGENT_FILTER"; do
    set +e
    pnpm --filter "$filter" build >"$WORK/build.$(basename "$filter").log" 2>&1
    BUILD_RC=$?
    set -e
    [ "$BUILD_RC" -eq 0 ] || {
      tail -40 "$WORK/build.$(basename "$filter").log" >&2
      fatal "the $filter build exited $BUILD_RC"
    }
  done
  printf 'schema, core and agent dists rebuilt\n'
fi

# ------------------------------------------------------------------------------------------------
# the suite runner — one shape, used by every leg
# ------------------------------------------------------------------------------------------------

run_suite() { # $1 = leg name -> writes "$WORK/<leg>.log", sets SUITE_RC
  local leg="$1"
  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$SUITE" >"$WORK/$leg.log" 2>&1
  SUITE_RC=$?
  set -e
}

suite_counts() { # $1 = leg name
  grep -E '^ +Tests +' "$WORK/$1.log" | tail -1 | sed 's/^ *//' || true
}

# A filter that matched nothing exits 0 over zero tests (WINDOWS 105). A leg with no `Tests` line at
# all has measured nothing, and reading that as green is exactly the non-failure this guards.
assert_ran() { # $1 = leg name
  grep -Eq '^ +Tests +' "$WORK/$1.log" \
    || fatal "the $1 leg produced no vitest tally — the filter or the suite path matched nothing"
}

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

apply_mutation() { # $1 = anchor, $2 = replacement
  ANCHOR="$1" REPLACEMENT="$2" perl -0pi -e '
    BEGIN { $a = $ENV{ANCHOR}; $r = $ENV{REPLACEMENT}; }
    s/\Q$a\E/$r/;
  ' "$HOST"
}

run_leg() { # $1 = leg, $2 = anchor, $3 = replacement, $4 = signature, $5.. = allowed
  local leg="$1" anchor="$2" replacement="$3" signature="$4"
  shift 4
  RESTORED=0
  apply_mutation "$anchor" "$replacement"
  local mutated_sha
  mutated_sha="$(subject_sha "$HOST")"
  printf 'mutated %s\n  sha256 %s\n' "$HOST_REL" "$mutated_sha"
  [ "$mutated_sha" != "$HOST_SHA_BEFORE" ] \
    || fatal "the mutation-$leg edit changed nothing — the anchor did not match"

  run_suite "$leg"
  assert_ran "$leg"
  local rc="$SUITE_RC"
  local counts
  counts="$(suite_counts "$leg")"
  printf '%s leg exited %s — %s\n' "$leg" "$rc" "$counts"
  [ "$rc" -ne 0 ] || fatal "the suite stayed green under mutation $leg"

  red_cells "$leg"
  assert_red_set "$leg" "$signature" "$@"
  cp "$WORK/$leg-red.txt" "$WORK/red-$leg.txt"

  banner "RESTORE $leg"
  restore_subject
  local after
  after="$(subject_sha "$HOST")"
  [ "$after" = "$HOST_SHA_BEFORE" ] \
    || fatal "the restored host is not byte-identical: $HOST_SHA_BEFORE before, $after after"
  printf 'restored byte-identically — sha256 %s\n' "$after"

  run_suite "recontrol-$leg"
  assert_ran "recontrol-$leg"
  [ "$SUITE_RC" -eq 0 ] || {
    tail -40 "$WORK/recontrol-$leg.log" >&2
    fatal "the suite did not return to green after the mutation-$leg restore (exited $SUITE_RC)"
  }
  eval "COUNTS_$leg=\"\$counts\""
  eval "RC_$leg=\"\$rc\""
}

# ------------------------------------------------------------------------------------------------
# CONTROL LEG — the instrument-liveness half
# ------------------------------------------------------------------------------------------------
#
# Without this, "the suite went red under the mutation" is a reading taken with an instrument that
# may have been red already, and the whole differential is vacuous.

banner "CONTROL — the one-commit apply suite, unmutated"
run_suite control
assert_ran control
[ "$SUITE_RC" -eq 0 ] || {
  tail -40 "$WORK/control.log" >&2
  fatal "the CONTROL leg exited $SUITE_RC — the suite is red before any mutation is applied"
}
CONTROL_COUNTS="$(suite_counts control)"
printf 'control green — %s\n' "$CONTROL_COUNTS"

# ------------------------------------------------------------------------------------------------
# MUTATION T — the index half of the restore removed
# ------------------------------------------------------------------------------------------------
#
# THE FORBIDDEN IMPLEMENTATION, exactly as this file shipped it until 394-18: the worktree goes back
# and the index does not, so the agent's blob is staged at a path the caller was told nothing was
# written to, and the person's next commit carries it.

banner "MUTATION T — the index restore removed, leaving the worktree-only rollback"
if [ "${APPLY_ROLLBACK_SELFTEST:-}" = "neutered" ]; then
  printf '!!! APPLY_ROLLBACK_SELFTEST=neutered — applying a NO-OP edit instead of the mutation.\n'
  printf '!!! This script MUST now fatal. If it does not, it is measuring nothing.\n'
  run_leg T "$T_ANCHOR" "$T_ANCHOR" "$T_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_T[@]}"
else
  run_leg T "$T_ANCHOR" "$T_REPLACEMENT" "$T_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_T[@]}"
fi

# ------------------------------------------------------------------------------------------------
# MUTATION V — the successful commit routed back through the restore
# ------------------------------------------------------------------------------------------------
#
# The second defect CR-05 named. The hash read is a question asked AFTER the commit exists, and
# routing its failure through the rollback reverts a file the repository has already recorded —
# leaving the person's checkout disagreeing with their own history at exactly the file the agent
# just wrote.

banner "MUTATION V — the post-commit hash read routed through the restore catch"
run_leg V "$V_ANCHOR" "$V_REPLACEMENT" "$V_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_V[@]}"

# ------------------------------------------------------------------------------------------------
# MUTATION N — the nothing-to-commit distinction removed
# ------------------------------------------------------------------------------------------------
#
# An accept of a draft whose bytes already ARE the target's stages nothing, and git exits 1 with an
# empty stderr. Without the index-derived arm, that is reported as a git failure — a real failure's
# sentence for a situation that is not one.

banner "MUTATION N — the nothing-to-commit arm removed"
run_leg N "$N_ANCHOR" "$N_REPLACEMENT" "$N_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_N[@]}"

# ------------------------------------------------------------------------------------------------
# NON-REDUNDANCY — the three red sets must be pairwise disjoint
# ------------------------------------------------------------------------------------------------

banner "NON-REDUNDANCY"
for pair in "T V" "T N" "V N"; do
  set -- $pair
  comm -12 "$WORK/red-$1.txt" "$WORK/red-$2.txt" >"$WORK/overlap-$1$2.txt"
  if [ -s "$WORK/overlap-$1$2.txt" ]; then
    sed 's/^/  - /' "$WORK/overlap-$1$2.txt" >&2
    fatal "mutations $1 and $2 red overlapping cells — the two are not measuring two properties"
  fi
done
printf 'the three red sets are pairwise disjoint:\n'
printf '  T: '; paste -sd', ' "$WORK/red-T.txt"
printf '  V: '; paste -sd', ' "$WORK/red-V.txt"
printf '  N: '; paste -sd', ' "$WORK/red-N.txt"

# ------------------------------------------------------------------------------------------------
# receipt
# ------------------------------------------------------------------------------------------------

banner "RECEIPT"
printf 'subject           : %s\n' "$HOST_REL"
printf 'control           : %s\n' "$CONTROL_COUNTS"
printf 'sha256 before     : %s\n' "$HOST_SHA_BEFORE"
printf 'sha256 after      : %s (byte-identical)\n' "$(subject_sha "$HOST")"
printf '\n'
printf 'MUTATION T  index restore removed       : %s (exit %s)\n' "${COUNTS_T:-}" "${RC_T:-}"
printf 'MUTATION V  commit reverted on hash read: %s (exit %s)\n' "${COUNTS_V:-}" "${RC_V:-}"
printf 'MUTATION N  nothing-to-commit collapsed : %s (exit %s)\n' "${COUNTS_N:-}" "${RC_N:-}"
printf '\n394-apply-rollback-mutation: PASS\n'
