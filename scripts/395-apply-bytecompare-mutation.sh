#!/usr/bin/env bash
#
# 395-apply-bytecompare-mutation.sh — the acceptance bar for the config apply's discipline (395-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `config-apply.test.ts` and
# `config-apply-discipline.test.ts` passing says that a doctored payload was refused, that two
# commits appeared in the right order under the right names, that a dirty non-proposal file stayed
# dirty and that an interrupted two-file apply put both files back. It does NOT say those cells would
# CATCH the implementations D-05/D-18/D-19 forbid — and every mutation below reads as a
# simplification a reasonable person would write.
#
#   A1  THE D-19 BYTE COMPARISON SEVERED. The digests are still recomputed, through the same
#       primitive, and the comparison is still visibly there; it just cannot fail. This is the
#       shape a wiring defect really has, and it is the leg D-19 names: "shown == applied is
#       MEASURED, not asserted" is a claim about exactly this branch. A payload doctored between the
#       render a person read and the accept then commits bytes nobody saw.
#
#   A2  THE HUMAN-FIRST COMMIT GIVEN THE AGENT'S AUTHOR. Two commits still appear, in the right
#       order, with the right messages and the right file lists — a cell asserting a COUNT of two
#       passes this completely. What changes is that git now attributes the person's own bytes to
#       `agent-qa (proposed by chat)`, which is the repudiation defect D-05/D-06 exist to prevent,
#       and the only thing that catches it is an assertion about AUTHORSHIP.
#
#   A3  THE DIRTY SCAN WIDENED FROM THE PROPOSAL'S FILES TO THE PINNED CONFIG SET. The most natural
#       over-reach there is: the set is right there, it is what this apply consults one line later,
#       and using it here sweeps a person's unrelated uncommitted `.gitignore` edit into a commit
#       whose message says "preserve human edits". D-05's prohibition is exactly that sentence.
#
#       THE CELL THAT CATCHES IT IS THE ONE WHOSE FIXTURE DIRTIES A CONFIG-SET MEMBER, and the
#       discrimination is worth stating: the two-commit cells and the idempotency cell all leave
#       `.gitignore` clean, so they stay GREEN under this mutation. A suite whose only "extra dirty
#       file" was a README would pass this leg completely — a README is not in the set, so a
#       set-scoped preserve commit never touches it.
#
#       IT ALSO REDS THE OUT-OF-SET CELL, and that is the mutation telling the truth rather than
#       leaking: a dirty scan that iterates the SET can never meet a proposal file outside it, so
#       the refusal guarding that case stops existing at the same stroke. One over-reach, two
#       controls gone — which is itself worth knowing about this line.
#
#   A4  THE MULTI-FILE ROLLBACK NARROWED TO ONE FILE. The restore still runs, still reports both
#       errors when it fails, still touches worktree and index — for the last file written. The
#       first one stays on disk carrying the agent's bytes with no commit that explains them, which
#       is 394's CR-01/CR-05 class reappearing the moment an apply grew a second path.
#
#   A5  THE D-18 FRESHNESS RE-CHECK SEVERED, AND NOTHING ELSE. This is the control leg. Several
#       cells in this phase drive an out-of-band edit and assert a refusal; a refusal could equally
#       come from the dirty check, from validation, or from the byte comparison downstream. With
#       only the digest comparison disabled, whichever cells go red are the cells that really depend
#       on the freshness guard — and the ones that stay green are the ones that were measuring
#       something else.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the leg's allowed list.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND EVERY RESTORE IS PROVEN. `git checkout --` cannot
# restore an uncommitted edit — this project has destroyed in-progress work that way — so the
# snapshot is a `cp` copy and the sha256 is compared after every restore.
#
# THE DIST REBUILD IS BAKED IN AND PROVEN RATHER THAN ASSUMED. The subject lives in
# `packages/cli/src` and the suites live in the same package, so vitest resolves the MUTATION from
# source; what it resolves through `dist` is every DEPENDENCY — `schema`, `safety`, `agent`,
# `agent-local` — and a stale one of those means the cells are measuring a previous build's
# behaviour. So the preflight rebuilds the whole chain and proves each rebuild took by grepping a
# real exported IDENTIFIER out of the built artifact, and each leg rebuilds `cli` and greps the
# built CLI for the mutation's own marker. That last check is not needed for the mutation to reach
# the suite; it is what makes "the mutation reached the measurement" a fact this script establishes
# rather than a sentence it asserts.
#
# THE MARKER IS CODE, NEVER A COMMENT. 395-04 measured the alternative: `packages/agent`'s bundler
# STRIPS comments from its dist, so a comment marker came back absent from a rebuild that had
# actually happened — a rebuild proof whose token a build step can erase proves nothing, in the
# direction that looks like a failure and is really a blind spot.
#
# THE MUTATIONS ARE APPLIED BY EXACT STRING REPLACEMENT with a single-occurrence assertion on the
# anchor, and confirmed applied by `diff` against the snapshot — never by grepping for the pattern
# that was written. This project has recorded two false "DID NOT APPLY" verdicts from escaping, one
# from BRE bracket handling and one from a shell-mangled multi-line `grep -F`.
#
# USAGE
#   bash agent-qa/scripts/395-apply-bytecompare-mutation.sh   # from the super-repository root
#   bash scripts/395-apply-bytecompare-mutation.sh            # from the agent-qa root
#
# KNOBS
#   APPLY_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — which is what proves this script itself can fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT="packages/cli/src/composition/local-agent-host.ts"
CLI_DIST="packages/cli/dist/cli.cjs"

CLI_FILTER="agent-qa"
TRACER_SUITE="src/composition/__tests__/config-apply.test.ts"
DISCIPLINE_SUITE="src/composition/__tests__/config-apply-discipline.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
SNAPSHOT="$WORK/local-agent-host.ts.snapshot"

restore_subject () { cp "$SNAPSHOT" "$REPO_ROOT/$SUBJECT" 2>/dev/null || true; }
trap 'restore_subject; rm -rf "$WORK"' EXIT

cp "$REPO_ROOT/$SUBJECT" "$SNAPSHOT"
BASELINE_SHA="$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)"
echo "subject   $SUBJECT"
echo "  sha256  $BASELINE_SHA"
echo

MARKER="MUTATION_395_06_MARKER"

# A1 severs the D-19 comparison. The doctored-payload cells are the only ones that can see it: every
# other cell in both suites files an HONEST proposal, whose recomputed diff equals its stored one, so
# the branch this mutation disables never fires for them. That asymmetry is the point — a suite in
# which A1 red everything would be a suite whose payloads were all doctored.
ALLOWED_A1="(f) a payload widened after the render refuses at the byte comparison, before any write"
# A2 mis-attributes the human's commit. ONLY the authorship cell sees it; the order, the count, the
# messages, the file lists and the trailer are all still exactly right.
ALLOWED_A2="(1) a dirty proposal file produces TWO commits"
# A3 widens the dirty scan to the whole pinned set. TWO cells red and both are the mutation's own
# doing: the no-sweeping cell, because an unrelated dirty config-set member is now committed, and
# the out-of-set cell, because a scan that iterates the SET never looks at a proposal file outside
# it and the refusal that guards that case therefore stops existing. The two-commit cells and the
# idempotency cell stay GREEN — their `.gitignore` is clean — which is the discrimination.
ALLOWED_A3="(2) dirty bytes in files the proposal does not touch stay uncommitted
(3) a dirty proposal file OUTSIDE the pinned config set is refused, never preserved"
# A4 narrows the rollback to one file. Only the multi-file cell can see it.
ALLOWED_A4="(8) a write that fails on the SECOND file restores both worktree bytes and both index entries"
# A5 severs the freshness re-check. Every cell that really depends on it reds, and the list is the
# measurement: these are the cells whose refusal was the DIGEST guard rather than something upstream.
ALLOWED_A5="(4) two applies racing over one file: the second refuses at the digest re-check
(5) the stale refusal names the file, the fact, and a recovery command that EXISTS
(6) a refusal on a DIRTY file mutates nothing
(7) re-proposing after a stale refusal reads the human
(d) an out-of-band edit between propose and accept refuses, writing nothing"

apply_mutation () {
  case "${APPLY_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  MUTATION_NAME="$1" MARKER="$MARKER" SUBJECT_PATH="$REPO_ROOT/$SUBJECT" python3 <<'PY'
import os
import sys

name = os.environ['MUTATION_NAME']
marker = os.environ['MARKER']
path = os.environ['SUBJECT_PATH']

MUTATIONS = {
    # A1: the comparison still computes, still reads both digests, and can no longer fail.
    'A1': (
        "  if (recomputed.diffDigest !== request.payload.shownDiffDigest) {",
        "  const %s = recomputed.diffDigest\n" % marker
        + "  if (%s === undefined && recomputed.diffDigest !== request.payload.shownDiffDigest) {"
          % marker,
    ),
    # A2: the person's own bytes committed under the agent's name.
    'A2': (
        "        exec, configDir, dirtyPaths, humanFirstCommitMessage(dirtyPaths),\n      )",
        "        exec, configDir, dirtyPaths, humanFirstCommitMessage(dirtyPaths),\n"
        "        AGENT_CONFIG_COMMIT_AUTHOR,\n"
        "      )\n"
        "      const %s = AGENT_CONFIG_COMMIT_AUTHOR\n"
        "      void %s" % (marker, marker),
    ),
    # A3: the dirty SCAN widened from the proposal's files to the pinned config set, so the
    # preserve commit carries every dirty config file rather than the ones the approval implicated.
    'A3': (
        "  const dirty: typeof pending = []\n  for (const file of pending) {",
        "  const %s = input.pinnedFileSet.map((identityPath) => ({ identityPath }))\n" % marker
        + "  const dirty: typeof pending = []\n"
        + "  for (const file of %s as unknown as typeof pending) {" % marker,
    ),
    # A4: the rollback narrowed to the last file written.
    'A4': (
        "  for (const file of [...files].reverse()) {\n    try {\n      restoreApplyFailure(",
        "  const %s = 1\n" % marker
        + "  for (const file of [...files].reverse().slice(0, %s)) {\n    try {\n"
          "      restoreApplyFailure(" % marker,
    ),
    # A5: the D-18 freshness comparison severed, AND NOTHING ELSE.
    'A5': (
        "    if (foundDigest !== file.baseDigest) {",
        "    const %s = foundDigest\n" % marker
        + "    if (%s === undefined && foundDigest !== file.baseDigest) {" % marker,
    ),
}

if name not in MUTATIONS:
    sys.exit('FATAL: unknown mutation %s' % name)

anchor, replacement = MUTATIONS[name]
source = open(path).read()
found = source.count(anchor)
if found != 1:
    sys.exit(
        'FATAL: mutation %s expected exactly one occurrence of its anchor, found %d' % (name, found)
    )
open(path, 'w').write(source.replace(anchor, replacement, 1))
PY
}

assert_mutation_applied () {
  local name="$1"
  case "${APPLY_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if diff -q "$SNAPSHOT" "$REPO_ROOT/$SUBJECT" > /dev/null; then
    echo "FATAL: mutation $name changed nothing — the anchor no longer matches the source" >&2
    exit 1
  fi
}

rebuild_cli_dist () {
  set +e
  pnpm --filter "$CLI_FILTER" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the cli rebuild failed — see $WORK/build.log" >&2
    exit 1
  fi
}

# THE PROOF THAT THE REBUILD TOOK. A count read off the built artifact, for a marker that exists
# nowhere else in the repository — so a stale dist reports 0 and this script stops rather than
# reporting a measurement about a build it never made.
assert_cli_dist_carries_marker () {
  local expected="$1"
  case "${APPLY_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  local seen
  seen="$(grep -c "$MARKER" "$REPO_ROOT/$CLI_DIST" || true)"
  echo "  cli dist marker count: $seen (expected at least $expected)"
  if [ "$expected" = "0" ]; then
    if [ "$seen" != "0" ]; then
      echo "FATAL: $CLI_DIST still carries the mutation marker after the restore" >&2
      exit 1
    fi
    return 0
  fi
  if [ "$seen" -lt "$expected" ]; then
    echo "FATAL: $CLI_DIST does not carry the mutation marker — the rebuild did not take, so any" >&2
    echo "       result measured through it is a result about the PREVIOUS build" >&2
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3" suite="$4"

  echo "=== MUTATION $name — $label   (measured through $suite)"
  restore_subject
  apply_mutation "$name"
  assert_mutation_applied "$name"
  echo "  subject sha256 $(shasum -a 256 "$REPO_ROOT/$SUBJECT" | cut -d' ' -f1)"

  rebuild_cli_dist
  assert_cli_dist_carries_marker 1

  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subject
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
      restore_subject
      exit 1
    fi
  done <<< "$red"

  restore_subject
  local restored
  restored="$(shasum -a 256 "$REPO_ROOT/$SUBJECT" | cut -d' ' -f1)"
  if [ "$restored" != "$BASELINE_SHA" ]; then
    echo "FATAL: $SUBJECT was not restored byte-identically ($restored)" >&2
    exit 1
  fi
  echo "  subject restored byte-identically"

  rebuild_cli_dist
  assert_cli_dist_carries_marker 0
  echo "  cli dist rebuilt from the restored source"
  echo
}

echo "=== PREFLIGHT — every dependency dist is rebuilt, each rebuild is PROVEN, and both suites"
echo "    must be green before any mutation is applied"
set +e
pnpm --filter @vostride/agent-qa-schema build > "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-safety build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-agent build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-agent-local build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter "$CLI_FILTER" build >> "$WORK/build.log" 2>&1
BUILD_RC=$?
set -e
if [ "$BUILD_RC" -ne 0 ]; then
  echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
  exit 1
fi

# EACH DEPENDENCY REBUILD IS PROVEN BY A REAL EXPORTED IDENTIFIER, not by a comment and not by the
# build's own exit code: a build can succeed and write nothing new. These names are this phase's, so
# a dist predating it answers 0 and the script stops.
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
prove_dist packages/schema/dist/index.js 'no-agent-commit'
prove_dist packages/agent/dist/index.d.ts 'configUndoSource'
prove_dist packages/agent-local/dist/index.js 'configUndoSource'
prove_dist "$CLI_DIST" 'ConfigApplyStaleError'
assert_cli_dist_carries_marker 0

for suite in "$TRACER_SUITE" "$DISCIPLINE_SUITE"; do
  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$suite" > "$LOG" 2>&1
  PREFLIGHT_RC=$?
  set -e
  echo "  $suite exited $PREFLIGHT_RC"
  grep -E '^      Tests' "$LOG" || true
  if [ "$PREFLIGHT_RC" -ne 0 ]; then
    echo "FATAL: $suite is already red before any mutation" >&2
    exit 1
  fi
done
echo

run_leg A1 "the D-19 byte comparison severed" "$ALLOWED_A1" "$TRACER_SUITE"
run_leg A2 "the human-first commit given the agent's author" "$ALLOWED_A2" "$DISCIPLINE_SUITE"
run_leg A3 "the preserve commit widened to the whole pinned set" "$ALLOWED_A3" "$DISCIPLINE_SUITE"
run_leg A4 "the multi-file rollback narrowed to one file" "$ALLOWED_A4" "$DISCIPLINE_SUITE"
run_leg A5 "the D-18 freshness re-check severed, and nothing else" "$ALLOWED_A5" "$DISCIPLINE_SUITE"

echo "PASS — a doctored payload commits bytes nobody saw the moment the D-19 comparison stops being"
echo "       able to fail, and exactly one cell notices; the person's own commit is mis-attributed"
echo "       without changing its order, its message or its file list, and only an authorship"
echo "       assertion catches it; a preserve commit scoped to the config SET sweeps an unrelated"
echo "       edit past every count-shaped cell; a rollback narrowed to one path abandons the first"
echo "       file of a two-file apply; and severing the freshness check alone names exactly the"
echo "       cells whose refusal really was the digest guard. Every leg observed RED, every restore"
echo "       was proven byte-identical, and every leg proved its rebuild took."
