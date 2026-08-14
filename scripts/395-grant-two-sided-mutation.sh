#!/usr/bin/env bash
#
# 395-grant-two-sided-mutation.sh — the acceptance bar for D-02's two-sided grant enforcement
# (395-07 · CFGM-01 · spec/v2 §4.3, spec/v2/execution-safety.md §2.4).
#
# WHAT THIS PROVES THAT A GREEN SUITE DOES NOT. `config-grant-enforcement.test.ts` passing says
# that a flagged accept-with-always came back refused, that an in-scope one recorded a grant, that
# a flagged apply under a covering grant threw and that an in-scope one committed. It does NOT say
# those cells would CATCH the two implementations D-02 forbids — and, far more importantly here, it
# does not say that the two enforcement sides are TWO MECHANISMS. A suite whose cells all red under
# either mutation would be describing one mechanism spelled twice, which is exactly the shape this
# repository has minted six recorded one-sided-hardening regressions out of.
#
# SO THE DISJOINTNESS IS THE MEASUREMENT, and it is asserted in both directions. Each leg declares
# the cells it is ALLOWED to red, and a red outside that list FATALs — so a mint mutation that also
# reds a read cell fails this script, and so does a read mutation that reds a mint cell.
#
#   G0  THE TREE BEFORE THIS PLAN. Both subjects are restored to their content at the pre-plan
#       submodule commit and nothing else changes. This is the RED-FIRST proof and the base-commit
#       cross-check in one: the cells must red on the tree that existed before either side was
#       written, and the set they red is required to be EXACTLY the union of G1's and G2's. A base
#       leg reding more than that union would mean a cell is measuring something neither side
#       supplies; reding less would mean one side's cells pass on a tree that has neither.
#
#   G1  THE MINT SIDE SEVERED. `crossBoundaryRefusal` still reads the flag off the envelope the
#       route is holding, and then does not act on it — the shape a wiring defect really has, and
#       the one an unwary refactor produces. A flagged accept-with-always then appends a real line
#       to the committed grant ledger, which is standing approval over a change nobody approved
#       individually. ONLY the mint cell may notice.
#
#   G2  THE READ SIDE SEVERED. `coveringGrantInForce` still folds the ledger, through the same port,
#       and then reports that nothing covers the class. A covering grant — including one typed in by
#       hand, which is the whole reason this half exists — then satisfies the ask for a flagged
#       proposal and the apply commits unattended. ONLY the read cells may notice.
#
# WHY THE ALLOWED SETS ARE DISJOINT AND NOT MERELY DIFFERENT. G1's cell drives `proposals.accept`
# with `always: true` in an interactive context; G2's cells drive `config.proposal.apply` in a
# headless one with a standing approval as the only rung that can allow. The two sides are reached
# through two different verbs carrying two different action classes, because `fn:proposals.accept`
# is in the closed PROTECTED set and `fn:config.proposal.apply` deliberately is not. That is a fact
# about the codebase rather than an arrangement of this script, and it is what makes the two
# mechanisms independently necessary: the mint guards what a producer may author and cannot guard a
# line already in the file; the read guards what a committed file may authorize and cannot stop a
# line from being written.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the leg's allowed list.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECTS ARE RESTORED FROM BYTE SNAPSHOTS AND EVERY RESTORE IS PROVEN. `git checkout --`
# cannot restore an uncommitted edit — this project has destroyed in-progress work that way — so the
# snapshots are `cp` copies and the sha256 is compared after every restore.
#
# THE DIST REBUILD IS BAKED IN AND PROVEN RATHER THAN ASSUMED, and here it is load-bearing rather
# than hygienic: the SUBJECTS live in `packages/agent` and the SUITE lives in `packages/cli`, so
# vitest never sees the mutated source at all — it resolves `@vostride/agent-qa-agent` through that
# package's `dist`. A leg that skipped the rebuild would measure the previous build with complete
# conviction. Each leg therefore rebuilds `agent` and greps the built artifact for the mutation's
# own marker, and the preflight proves every dependency dist with a real exported identifier.
#
# THE MARKER IS CODE, NEVER A COMMENT. 395-04 measured the alternative first-hand: `packages/agent`'s
# bundler STRIPS comments from its dist, so a comment marker came back absent from a rebuild that
# had actually happened — a rebuild proof whose token a build step can erase proves nothing, in the
# direction that looks like a failure and is really a blind spot. Each marker is additionally
# ASSIGNED FROM A RUNTIME VALUE rather than from a literal, so no constant folding can erase it.
#
# THE MUTATIONS ARE APPLIED BY EXACT STRING REPLACEMENT with a single-occurrence assertion on the
# anchor, and confirmed applied by `diff` against the snapshot — never by grepping for the pattern
# that was written. This project has recorded two false "DID NOT APPLY" verdicts from escaping, one
# from BRE bracket handling and one from a shell-mangled multi-line `grep -F`.
#
# USAGE
#   bash agent-qa/scripts/395-grant-two-sided-mutation.sh   # from the super-repository root
#   bash scripts/395-grant-two-sided-mutation.sh            # from the agent-qa root
#
# KNOBS
#   GRANT_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — which is what proves this script itself can fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MINT_SUBJECT="packages/agent/src/functions/ops/proposals-accept.ts"
READ_SUBJECT="packages/agent/src/functions/ops/config-proposal-apply.ts"
AGENT_DIST="packages/agent/dist/index.js"

AGENT_FILTER="@vostride/agent-qa-agent"
CLI_FILTER="agent-qa"
SUITE="src/composition/__tests__/config-grant-enforcement.test.ts"

# The submodule commit this plan started from. G0 restores both subjects to their content HERE, so
# "these cells red on the tree before this plan" is a measurement against a named revision rather
# than a memory. Pinned rather than computed from HEAD~n: a later commit must not silently move it.
BASE_REV="533a413f10ff20e48004b9d791fdc57831644052"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
MINT_SNAPSHOT="$WORK/proposals-accept.ts.snapshot"
READ_SNAPSHOT="$WORK/config-proposal-apply.ts.snapshot"

restore_subjects () {
  cp "$MINT_SNAPSHOT" "$REPO_ROOT/$MINT_SUBJECT" 2>/dev/null || true
  cp "$READ_SNAPSHOT" "$REPO_ROOT/$READ_SUBJECT" 2>/dev/null || true
}
trap 'restore_subjects; rm -rf "$WORK"' EXIT

cp "$REPO_ROOT/$MINT_SUBJECT" "$MINT_SNAPSHOT"
cp "$REPO_ROOT/$READ_SUBJECT" "$READ_SNAPSHOT"
MINT_BASELINE_SHA="$(shasum -a 256 "$MINT_SNAPSHOT" | cut -d' ' -f1)"
READ_BASELINE_SHA="$(shasum -a 256 "$READ_SNAPSHOT" | cut -d' ' -f1)"
echo "mint subject  $MINT_SUBJECT"
echo "  sha256      $MINT_BASELINE_SHA"
echo "read subject  $READ_SUBJECT"
echo "  sha256      $READ_BASELINE_SHA"
echo

MARKER="MUTATION_395_07_MARKER"

# G0's set is required to be EXACTLY the union of G1's and G2's, which is the two-sidedness stated
# as arithmetic: the base tree has neither guard, so the cells that red there are precisely the
# cells the two guards between them supply, with no overlap and nothing left over.
ALLOWED_G0="(M1) refuses the mint, applies anyway, and leaves the ledger byte-identical
(R1) the covering grant does not match: the flagged apply refuses, committing nothing
(R4) a record carrying the flag with NO reasons is still refused"
# G1: only the mint cell. (M0)'s headless denial, (M2)'s in-scope mint, every read cell and the
# binding cell all stay GREEN — none of them reaches the flag consult this leg severs.
ALLOWED_G1="(M1) refuses the mint, applies anyway, and leaves the ledger byte-identical"
# G2: only the read cells. (R2) stays green because its grant is SUPPOSED to satisfy — which is what
# makes the pair a statement about the flag rather than about the class — and (R3) stays green
# because it never has a grant to be satisfied by.
ALLOWED_G2="(R1) the covering grant does not match: the flagged apply refuses, committing nothing
(R4) a record carrying the flag with NO reasons is still refused"

apply_base_revision () {
  case "${GRANT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  git show "$BASE_REV:$MINT_SUBJECT" > "$REPO_ROOT/$MINT_SUBJECT"
  git show "$BASE_REV:$READ_SUBJECT" > "$REPO_ROOT/$READ_SUBJECT"
}

apply_mutation () {
  case "${GRANT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  MUTATION_NAME="$1" MARKER="$MARKER" \
  MINT_PATH="$REPO_ROOT/$MINT_SUBJECT" READ_PATH="$REPO_ROOT/$READ_SUBJECT" python3 <<'PY'
import os
import sys

name = os.environ['MUTATION_NAME']
marker = os.environ['MARKER']

MUTATIONS = {
    # G1: the flag is still read off the envelope this route is holding, and then not acted on.
    # Every arm above it is untouched, so a blocked payload still answers `not-applyable` and a
    # non-config kind still falls through — the ONLY thing that changes is that a flagged config
    # proposal stops being refused a standing approval.
    'G1': (
        'MINT_PATH',
        "  if (!envelope.payload.crossBoundary) return undefined",
        "  const %s = envelope.payload.crossBoundary\n" % marker
        + "  if (%s === envelope.payload.crossBoundary) return undefined" % marker,
    ),
    # G2: the ledger is still folded, through the same port, and the fold is still scanned — the
    # answer is just always "nothing covers this class". A covering grant then satisfies the ask for
    # a flagged proposal, which is precisely the state D-02's read half exists to refuse.
    'G2': (
        'READ_PATH',
        "  return active.some((grant) => grant.actionClass === actionClass)",
        "  const %s = active.length\n" % marker
        + "  return %s < 0 && active.some((grant) => grant.actionClass === actionClass)" % marker,
    ),
}

if name not in MUTATIONS:
    sys.exit('FATAL: unknown mutation %s' % name)

path_key, anchor, replacement = MUTATIONS[name]
path = os.environ[path_key]
source = open(path).read()
found = source.count(anchor)
if found != 1:
    sys.exit(
        'FATAL: mutation %s expected exactly one occurrence of its anchor, found %d' % (name, found)
    )
open(path, 'w').write(source.replace(anchor, replacement, 1))
PY
}

assert_subjects_changed () {
  local name="$1"
  case "${GRANT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if diff -q "$MINT_SNAPSHOT" "$REPO_ROOT/$MINT_SUBJECT" > /dev/null \
    && diff -q "$READ_SNAPSHOT" "$REPO_ROOT/$READ_SUBJECT" > /dev/null; then
    echo "FATAL: leg $name changed nothing — the anchor no longer matches the source" >&2
    exit 1
  fi
}

rebuild_agent_dist () {
  set +e
  pnpm --filter "$AGENT_FILTER" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the agent rebuild failed — see $WORK/build.log" >&2
    exit 1
  fi
}

# THE PROOF THAT THE REBUILD TOOK. A count read off the BUILT artifact for a token that exists
# nowhere else in the repository — so a stale dist reports 0 and this script stops rather than
# reporting a measurement about a build it never made. This is the check that makes "the mutation
# reached the measurement" a fact rather than a sentence, and on this script it is not optional:
# the suite lives in another package and can only ever see this one through its dist.
assert_agent_dist_carries_marker () {
  local expected="$1"
  case "${GRANT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  local seen
  seen="$(grep -c "$MARKER" "$REPO_ROOT/$AGENT_DIST" || true)"
  echo "  agent dist marker count: $seen (expected $expected)"
  if [ "$expected" = "0" ]; then
    if [ "$seen" != "0" ]; then
      echo "FATAL: $AGENT_DIST still carries the mutation marker after the restore" >&2
      exit 1
    fi
    return 0
  fi
  if [ "$seen" -lt "$expected" ]; then
    echo "FATAL: $AGENT_DIST does not carry the mutation marker — the rebuild did not take, so any" >&2
    echo "       result measured through it is a result about the PREVIOUS build" >&2
    exit 1
  fi
}

# G0 carries no marker by construction — it is the shipped source of an earlier commit, not an edit.
# What proves ITS rebuild took is the inverse: the identifier this plan added must be ABSENT.
assert_agent_dist_lacks_this_plan () {
  case "${GRANT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  local seen
  seen="$(grep -c 'CrossBoundaryConfigApplyError' "$REPO_ROOT/$AGENT_DIST" || true)"
  echo "  agent dist carries CrossBoundaryConfigApplyError: $seen (expected 0)"
  if [ "$seen" != "0" ]; then
    echo "FATAL: the base-revision rebuild did not take — $AGENT_DIST still carries this plan's" >&2
    echo "       own identifier, so the leg would measure the CURRENT build" >&2
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3" base="$4"

  echo "=== LEG $name — $label   (measured through $SUITE)"
  restore_subjects
  if [ "$base" = "base" ]; then
    apply_base_revision
  else
    apply_mutation "$name"
  fi
  assert_subjects_changed "$name"
  echo "  mint sha256 $(shasum -a 256 "$REPO_ROOT/$MINT_SUBJECT" | cut -d' ' -f1)"
  echo "  read sha256 $(shasum -a 256 "$REPO_ROOT/$READ_SUBJECT" | cut -d' ' -f1)"

  rebuild_agent_dist
  if [ "$base" = "base" ]; then
    assert_agent_dist_lacks_this_plan
  else
    assert_agent_dist_carries_marker 1
  fi

  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — leg $name measures nothing" >&2
    restore_subjects
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $SUITE > .*" "$LOG" | sed "s|^ FAIL  $SUITE > ||" | sort -u)"
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
      echo "FATAL: leg $name red a cell outside its allowed list: $line" >&2
      restore_subjects
      exit 1
    fi
  done <<< "$red"

  # THE OTHER DIRECTION, and it is the half that makes this a two-sided proof rather than a pair of
  # one-sided ones: every cell the leg was allowed to red must ACTUALLY have red. A mutation whose
  # allowed list is wider than its effect would let a side quietly stop being measured.
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) ;;
      *)
        echo "FATAL: leg $name did NOT red an allowed cell: $fragment" >&2
        echo "       the two sides are no longer the mechanisms this script says they are" >&2
        restore_subjects
        exit 1
        ;;
    esac
  done <<< "$allowed"

  restore_subjects
  local mint_restored read_restored
  mint_restored="$(shasum -a 256 "$REPO_ROOT/$MINT_SUBJECT" | cut -d' ' -f1)"
  read_restored="$(shasum -a 256 "$REPO_ROOT/$READ_SUBJECT" | cut -d' ' -f1)"
  if [ "$mint_restored" != "$MINT_BASELINE_SHA" ] || [ "$read_restored" != "$READ_BASELINE_SHA" ]; then
    echo "FATAL: a subject was not restored byte-identically ($mint_restored / $read_restored)" >&2
    exit 1
  fi
  echo "  both subjects restored byte-identically"

  rebuild_agent_dist
  assert_agent_dist_carries_marker 0
  echo "  agent dist rebuilt from the restored sources"
  echo
}

echo "=== PREFLIGHT — every dependency dist is rebuilt, each rebuild is PROVEN, and the suite must"
echo "    be green before anything is severed"
set +e
pnpm --filter @vostride/agent-qa-schema build > "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-safety build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter "$AGENT_FILTER" build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-knowledge-local build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-agent-local build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter "$CLI_FILTER" build >> "$WORK/build.log" 2>&1
BUILD_RC=$?
set -e
if [ "$BUILD_RC" -ne 0 ]; then
  echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
  exit 1
fi

# EACH DEPENDENCY REBUILD IS PROVEN BY A REAL EXPORTED IDENTIFIER, not by a comment and not by the
# build's own exit code: a build can succeed and write nothing new. Both names below are THIS plan's,
# so a dist predating it answers 0 and the script stops.
prove_dist () {
  local artifact="$1" identifier="$2"
  local seen
  seen="$(grep -c "$identifier" "$REPO_ROOT/$artifact" || true)"
  echo "  $artifact carries $identifier: $seen"
  if [ "$seen" -lt 1 ]; then
    echo "FATAL: $artifact does not carry $identifier — that dist is stale, so every cell measured" >&2
    echo "       through it is measuring a previous build" >&2
    exit 1
  fi
}
prove_dist packages/schema/dist/index.js 'cross-boundary'
prove_dist "$AGENT_DIST" 'CrossBoundaryConfigApplyError'
assert_agent_dist_carries_marker 0

set +e
pnpm --filter "$CLI_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
PREFLIGHT_RC=$?
set -e
echo "  $SUITE exited $PREFLIGHT_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: $SUITE is already red before anything is severed" >&2
  exit 1
fi
echo

run_leg G0 "both subjects at the pre-plan commit $BASE_REV" "$ALLOWED_G0" base
run_leg G1 "the MINT side severed — the flag read and not acted on" "$ALLOWED_G1" mutation
run_leg G2 "the READ side severed — the ledger folded and never matched" "$ALLOWED_G2" mutation

echo "=== RESTORED — the suite must be green again with both sides back"
set +e
pnpm --filter "$CLI_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
FINAL_RC=$?
set -e
echo "  $SUITE exited $FINAL_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$FINAL_RC" -ne 0 ]; then
  echo "FATAL: the suite did not return to green after the last restore" >&2
  exit 1
fi
echo

echo "PASS — on the tree before this plan the mint cell and both read cells are RED and nothing else"
echo "       is; severing the mint alone reds ONLY the mint cell, and severing the read alone reds"
echo "       ONLY the read cells. The two red sets are disjoint and their union is exactly the base"
echo "       leg's, which is what makes these two mechanisms rather than one spelled twice. Every"
echo "       leg proved its own rebuild took, and every restore was proven byte-identical."
