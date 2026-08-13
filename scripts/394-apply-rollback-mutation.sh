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
# SEVEN MUTATIONS, SEVEN PROPERTIES, AND THE RED SETS MUST BE PAIRWISE DISJOINT:
#
#   MUTATION T  the INDEX half of the restore is removed, leaving the worktree-only restore this
#               file shipped with. A failed apply then leaves the agent's blob staged.
#   MUTATION V  the hash read after a SUCCESSFUL commit is routed back through the restore catch.
#               A commit that exists is then answered with the file reverted against it.
#   MUTATION N  the nothing-to-commit arm is removed, so an apply that staged nothing reports a
#               generic `git commit exited 1` instead of refusing by name.
#   MUTATION P  the index capture is moved INSIDE the try, below the write. Its four throw paths
#               then reach a rollback that has no captured entry to put back, so a failed capture
#               stages a DELETION of the person's own committed test.
#   MUTATION W  the target write is hoisted back OUT of the try, which is the arrangement 394-23
#               closed and the third consecutive narrowing of one hole. A write that fails
#               mid-flight then leaves a person's committed test truncated with no restore at all.
#   MUTATION U  `readTargetIfPresent` decodes and re-encodes as UTF-8, putting the round-trip back
#               on the CONSUMER side only. With a byte-true producer (`parseDraft`, 394-29) the two
#               halves of the digest contract then DISAGREE about a non-UTF-8 target nobody touched,
#               so a clean file is refused as changed — and the rollback puts U+FFFD back where
#               bytes were.
#   MUTATION U2 the PRODUCER's half of the same contract: `parseDraft` hashes the decoding instead
#               of the bytes, which is the arrangement 394-29 actually left behind. Until this leg
#               existed the differential red on 394-23's arrangement and said nothing about the one
#               the fix replaced — a fix with no mutation leg, under this phase's own bar that a
#               detector's bar is the implementation it must RED on.
#
# WHY P AND W ARE TWO LEGS AND NOT ONE. Both are about placement, and they are placements of
# DIFFERENT statements relative to the same try: P moves the capture in, W moves the write out. The
# pre-394-23 arrangement had both at once, and a single leg recreating it would have red both
# signature cells and proved neither — the two are separated here precisely so the differential can
# say which of the two placements a future edit broke.
#
# WHY U IS ONE LEG AND NOT TWO. The digest half and the restore half of WR-04 are the SAME decode,
# and they are not independently reachable through this entry point: with a byte-true digest the
# apply refuses a round-tripped target before it ever reaches the restore. So one leg reds both
# byte-fidelity cells, which is the honest shape — a pair of legs contrived to separate them would
# be measuring an arrangement the shipped code cannot be in.
#
# WHAT LEG U MEASURES AFTER 394-29, AND WHY IT NOW MEASURES ANYTHING AT ALL. Its cells used to mint
# their `sourceDigest` as a literal hash of the non-UTF-8 fixture — a value the product's only
# producer did not emit, so this leg red exclusively on an impossible input and could not tell a
# vacuous corpus from a real closure (WR-03). Those digests now arrive through `parseDraft`, which
# hashes the target's raw bytes since 394-29, so U reds the two halves of a contract the product can
# actually be in: the producer over bytes, the consumer over a decoding.
#
# DISJOINTNESS IS THE POINT, and the script asserts it with `comm -12` over the sorted red sets. A
# pair of mutations that red the same cells has measured one property twice; seven that red seven
# sets have shown the corpus distinguishes seven defects — which is what a gap round needs in order
# to say which of them was closed.
#
# AND THE ONE PAIR WHERE DISJOINTNESS IS THE WRONG LAW — U AND U2, STATED IN FULL BECAUSE AN
# EXEMPTION NOBODY JUSTIFIED IS HOW A DIFFERENTIAL STOPS BEING ONE.
#
# U and U2 are the two halves of ONE agreement, and every cell that states an agreement is red
# whichever half breaks it. That is not a weakness of the corpus, it is what an agreement means, and
# it was MEASURED here rather than assumed: the consumer mutation reds three cells, and the producer
# mutation red exactly the same three. Strict disjointness between the two is therefore unreachable —
# the only way to buy it would be to mint the apply-side fixtures' digests as literals again, which is
# precisely the vacuous-corpus defect 394-29 closed (WR-03). A leg pair cannot be made non-redundant
# by re-breaking the corpus.
#
# So this pair is checked against the property disjointness exists to enforce, rather than against
# disjointness itself, and the check is STRICTER than an exemption in the direction that matters:
#
#   1. U2 must red at least one cell U CANNOT. That witness is
#      `mints the digest over the file's RAW BYTES in the PRODUCER, with no apply in the reading`,
#      added to the suite by 394-34 for this purpose: it asks the producer a question the apply is
#      not part of, so the consumer mutation leaves it green. Without it U2 would red the same three
#      cells as U and would be measuring one property twice — which is what the first measurement
#      showed, and why the cell exists.
#   2. The overlap must be EXACTLY the named agreement cells and nothing else. A cell drifting into
#      the overlap that is not one of them is still a fatal, on the same rule as every other pair.
#
# The residual is stated rather than hidden: U's red set is a strict SUBSET of U2's, so this corpus
# can witness a producer-side regression on its own and cannot witness a consumer-side one on its
# own. A cell that pinned the consumer alone would have to drive the rollback with a digest matching
# the consumer's own mutated reading, which no fixed corpus can arrange — with a byte-true digest the
# apply refuses a round-tripped target before it ever reaches the restore, which is this file's own
# reason for U being one leg and not two.
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
P_SIGNATURE_CELL="refuses BYTE-UNCHANGED when the index capture fails, because the capture is above the write"
W_SIGNATURE_CELL="restores the person's bytes when the WRITE ITSELF fails, because the write is inside the try"
U_SIGNATURE_CELL="digests the target's RAW BYTES, so a target that is not valid UTF-8 still matches the proposal"
# U2's signature is the one cell U CANNOT red — see the U/U2 paragraph in the header. Anchoring the
# leg on a shared agreement cell would have let it pass while measuring nothing U had not.
U2_SIGNATURE_CELL="mints the digest over the file's RAW BYTES in the PRODUCER, with no apply in the reading"

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
ALLOWED_RED_CELLS_P=(
  "$P_SIGNATURE_CELL"
)
# W reds ONE cell and that is the claim: every other cell's write succeeds against a real
# filesystem, so hoisting it out of the try is invisible to all of them. The one cell that drives a
# failing write is the corpus's only witness to the placement, which is why it exists.
ALLOWED_RED_CELLS_W=(
  "$W_SIGNATURE_CELL"
)
# U's second cell is the SAME decode observed on the rollback side rather than the digest side. It
# is here rather than in a leg of its own for the reason in this file's header: with a byte-true
# digest the two are not independently reachable. The third is 394-29's producer/consumer agreement
# stated directly — the same property as the signature cell, observed at the seam where the two
# recipes meet rather than at the apply's outcome.
#
# THE REFUSAL CELL IS NOT HERE AND MUST NOT BE. `REFUSES by name when the target's bytes really
# changed` stays GREEN under U, and that is the point: a mutation that breaks the accept arm must
# not be able to hide behind a corpus that only ever asserts refusals.
ALLOWED_RED_CELLS_U=(
  "$U_SIGNATURE_CELL"
  "restores a non-UTF-8 target BYTE-IDENTICALLY, never through a decode round-trip"
  "ACCEPTS an untouched non-UTF-8 target whose sourceDigest came through parseDraft"
)

# THE AGREEMENT CELLS — the ones that state the contract rather than either half of it, and are
# therefore red whichever half is mutated. They are named here as their own concept because the U/U2
# overlap check below is written against this list, not against "whatever both happened to red": an
# overlap defined by the measurement it is checking would accept any overlap at all.
#
# They coincide exactly with U's set today, and that is a measured fact rather than a definition —
# every cell U reds is an agreement cell, which is why U alone cannot witness its own half.
AGREEMENT_CELLS=(
  "$U_SIGNATURE_CELL"
  "restores a non-UTF-8 target BYTE-IDENTICALLY, never through a decode round-trip"
  "ACCEPTS an untouched non-UTF-8 target whose sourceDigest came through parseDraft"
)

# U2's measured set: the three agreement cells plus its own witness. Recorded from the measurement,
# not from the proposal — the fix sketch predicted U's set minus the rollback cell, and the rollback
# cell reds under U2 too, because a producer digest over the decoding refuses the target before the
# rollback is ever reached.
ALLOWED_RED_CELLS_U2=(
  "$U2_SIGNATURE_CELL"
  "$U_SIGNATURE_CELL"
  "restores a non-UTF-8 target BYTE-IDENTICALLY, never through a decode round-trip"
  "ACCEPTS an untouched non-UTF-8 target whose sourceDigest came through parseDraft"
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
    restoreOrReportBoth(
      exec, configDir, identityPath, absoluteTarget, existing, indexBefore, writeTarget, error,
    )
    throw error
  }"

# THE MUTATION KEEPS THE CALL AND DISCARDS ITS ANSWER, which is a deliberate narrowing rather than
# the obvious edit. Deleting the call outright ALSO removes `git diff --cached` from the happy
# path's argv, so the two census cells — the `--` separator law and the subcommand allow-list — red
# as collateral and the differential stops being about the nothing-to-commit distinction at all.
# Measured: that form red 3 cells and the script refused it. This form reds exactly 1.
N_ANCHOR="  if (!stagedAtPath(exec, cwd, targetPath)) return { kind: 'nothing-to-commit' }"
N_REPLACEMENT="  void stagedAtPath(exec, cwd, targetPath)"

# THE ANCHORS ARE CODE LINES AND NEVER THEIR COMMENTS, so a reworded placement note cannot drift an
# anchor to zero and hand a leg an unmutated build to measure. P and W anchor on overlapping text
# and that is fine — each is applied to the PRISTINE snapshot, and each is asserted unique in it.
#
# P RE-ANCHORED IN 394-23. Its previous form moved the capture below a write that lived outside the
# try; with the write inside the try, that same edit would have moved the capture out with it and
# recreated W's arrangement as well, making the two legs red each other's cells. The capture now
# moves INTO the try instead, which is the same defect — a rollback with no captured entry — stated
# against the arrangement that actually ships.
P_ANCHOR="  const indexBefore = captureIndexEntry(exec, configDir, identityPath)
  mkdirSync(dirname(absoluteTarget), { recursive: true })

  let committed: GitCommitOutcome
  try {
    writeTarget(absoluteTarget, contents)"
P_REPLACEMENT="  let indexBefore: IndexEntry | undefined
  mkdirSync(dirname(absoluteTarget), { recursive: true })

  let committed: GitCommitOutcome
  try {
    writeTarget(absoluteTarget, contents)
    indexBefore = captureIndexEntry(exec, configDir, identityPath)"

# W — THE WRITE BACK OUT OF THE TRY. The implementation this plan's detector must red on, spelled
# as itself: the shipped arrangement through 394-22, in which a mid-write failure returned to the
# caller with a person's committed test truncated and the rollback never run.
W_ANCHOR="  let committed: GitCommitOutcome
  try {
    writeTarget(absoluteTarget, contents)
    runGitAdd(exec, configDir, identityPath)"
W_REPLACEMENT="  writeTarget(absoluteTarget, contents)

  let committed: GitCommitOutcome
  try {
    runGitAdd(exec, configDir, identityPath)"

# U — THE UTF-8 ROUND-TRIP RESTORED, as a decode-and-re-encode rather than as a change of return
# type. Keeping the signature intact is deliberate: the mutation has to be the DEFECT and not a
# compile error, or the leg measures the type checker instead of the corpus.
U_ANCHOR="    return readFileSync(absolutePath)"
U_REPLACEMENT="    return Buffer.from(readFileSync(absolutePath).toString('utf8'), 'utf8')"

# U2 — THE PRODUCER'S RECIPE, spelled as the arrangement 394-29 replaced. `parseDraft` reads the file
# once as bytes and derives `content` from them for the parse alone; hashing `content` instead of
# `bytes` is exactly the pre-394-29 producer, and it is a one-token edit that cannot be a compile
# error — the mutation has to be the DEFECT, or the leg measures the type checker.
U2_ANCHOR="          contentDigest: createHash('sha256').update(bytes).digest('hex'),"
U2_REPLACEMENT="          contentDigest: createHash('sha256').update(content).digest('hex'),"

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

for pair in "T:$T_ANCHOR" "V:$V_ANCHOR" "N:$N_ANCHOR" "P:$P_ANCHOR" "W:$W_ANCHOR" "U:$U_ANCHOR" \
            "U2:$U2_ANCHOR"; do
  name="${pair%%:*}"
  anchor="${pair#*:}"
  count="$(anchor_count "$anchor")"
  [ "$count" = "1" ] \
    || fatal "the mutation-$name anchor appears $count time(s) in $HOST_REL, expected exactly 1 — a drifted anchor edits nothing and this lane would then measure the UNMUTATED build"
done
printf 'all seven mutation anchors are unique\n'

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
# MUTATION P — the index capture moved INSIDE the try, below the write
# ------------------------------------------------------------------------------------------------
#
# CR-01's index half, restated against the arrangement that ships since 394-23. `captureIndexEntry`
# throws four ways, and it PRODUCES the value the rollback consumes — so inside the try each of
# those four throws reaches a restore holding no captured entry, which puts the index back as
# ABSENT and stages a deletion of a test the person has committed. Above the write it is an ordinary
# refusal with the repository byte-unchanged, which is the posture every other check there has.

banner "MUTATION P — the index capture moved INSIDE the try, below the write"
run_leg P "$P_ANCHOR" "$P_REPLACEMENT" "$P_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_P[@]}"

# ------------------------------------------------------------------------------------------------
# MUTATION W — the target write hoisted back OUT of the try
# ------------------------------------------------------------------------------------------------
#
# CR-01, and the arrangement this file shipped with through 394-22 — the third consecutive round in
# which `applyTestDraftAsOneCommit` carried a narrower version of one hole. `writeFileSync`
# TRUNCATES before it writes, so an ENOSPC, an EIO, an EDQUOT or a read-only remount part-way
# through returned to the caller with a person's committed test emptied, the rollback never run, and
# a doc block above it promising total restore.

banner "MUTATION W — the target write moved back outside the try"
run_leg W "$W_ANCHOR" "$W_REPLACEMENT" "$W_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_W[@]}"

# ------------------------------------------------------------------------------------------------
# MUTATION U — the UTF-8 round-trip put back on the target read
# ------------------------------------------------------------------------------------------------
#
# WR-04. The digest was taken over a DECODING of the person's test, so every byte sequence the
# decoder could not read collapsed to the same replacement characters: a target that had not moved
# at all was refused as changed, and the rollback wrote U+FFFD back where their bytes had been.

banner "MUTATION U — readTargetIfPresent decodes and re-encodes as UTF-8"
run_leg U "$U_ANCHOR" "$U_REPLACEMENT" "$U_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_U[@]}"

# ------------------------------------------------------------------------------------------------
# MUTATION U2 — the PRODUCER's digest recipe put back over the decoding
# ------------------------------------------------------------------------------------------------
#
# WR-10. 394-29's fix moved `parseDraft` to hash the target's raw bytes, and until this leg the
# differential mutated only `readTargetIfPresent` — so what it demonstrated was that the corpus reds
# on 394-23's arrangement, not on the one 394-29 replaced. A fix whose implementation has no mutation
# leg has not been shown to be detectable, which is this phase's own acceptance bar.

banner "MUTATION U2 — parseDraft digests the DECODING instead of the bytes"
run_leg U2 "$U2_ANCHOR" "$U2_REPLACEMENT" "$U2_SIGNATURE_CELL" "${ALLOWED_RED_CELLS_U2[@]}"

# ------------------------------------------------------------------------------------------------
# NON-REDUNDANCY — the seven red sets across all twenty-one pairs
# ------------------------------------------------------------------------------------------------
#
# Twenty of the twenty-one are checked for strict disjointness. The twenty-first — U and U2 — is the
# two halves of one agreement and is checked against the two conditions in this file's header, which
# are stricter than an exemption in the direction that matters. Nothing is skipped: every pair is
# named in the loop and every pair is asserted.

banner "NON-REDUNDANCY"
for pair in "T V" "T N" "T P" "T W" "T U" "T U2" \
            "V N" "V P" "V W" "V U" "V U2" \
            "N P" "N W" "N U" "N U2" \
            "P W" "P U" "P U2" \
            "W U" "W U2" \
            "U U2"; do
  set -- $pair
  comm -12 "$WORK/red-$1.txt" "$WORK/red-$2.txt" >"$WORK/overlap-$1$2.txt"

  if [ "$1 $2" = "U U2" ]; then
    # CONDITION 1 — U2 reds a cell U cannot. Without it the leg is one property measured twice.
    comm -13 "$WORK/red-U.txt" "$WORK/red-U2.txt" >"$WORK/only-U2.txt"
    [ -s "$WORK/only-U2.txt" ] \
      || fatal "mutation U2 red nothing mutation U did not — the producer half has no witness of its own in this corpus, so U2 is measuring U's property a second time"
    # CONDITION 2 — the overlap is EXACTLY the named agreement cells, never merely non-empty.
    printf '%s\n' "${AGREEMENT_CELLS[@]}" | sort -u >"$WORK/agreement-cells.txt"
    comm -23 "$WORK/overlap-UU2.txt" "$WORK/agreement-cells.txt" >"$WORK/overlap-unexplained.txt"
    if [ -s "$WORK/overlap-unexplained.txt" ]; then
      sed 's/^/  - /' "$WORK/overlap-unexplained.txt" >&2
      fatal "mutations U and U2 red overlapping cells that are NOT agreement cells — the overlap is collateral, not the contract"
    fi
    printf 'U ∩ U2 is exactly the %s named agreement cell(s); U2 additionally reds:\n' \
      "$(grep -c . "$WORK/agreement-cells.txt")"
    sed 's/^/  - /' "$WORK/only-U2.txt"
    continue
  fi

  if [ -s "$WORK/overlap-$1$2.txt" ]; then
    sed 's/^/  - /' "$WORK/overlap-$1$2.txt" >&2
    fatal "mutations $1 and $2 red overlapping cells — the two are not measuring two properties"
  fi
done
printf 'the seven red sets are non-redundant across all twenty-one pairs (20 strictly disjoint, U/U2 by the two-sided-contract rule):\n'
printf '  T:  '; paste -sd', ' "$WORK/red-T.txt"
printf '  V:  '; paste -sd', ' "$WORK/red-V.txt"
printf '  N:  '; paste -sd', ' "$WORK/red-N.txt"
printf '  P:  '; paste -sd', ' "$WORK/red-P.txt"
printf '  W:  '; paste -sd', ' "$WORK/red-W.txt"
printf '  U:  '; paste -sd', ' "$WORK/red-U.txt"
printf '  U2: '; paste -sd', ' "$WORK/red-U2.txt"

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
printf 'MUTATION P  capture moved inside the try: %s (exit %s)\n' "${COUNTS_P:-}" "${RC_P:-}"
printf 'MUTATION W  write moved outside the try : %s (exit %s)\n' "${COUNTS_W:-}" "${RC_W:-}"
printf 'MUTATION U  target read round-trips UTF8: %s (exit %s)\n' "${COUNTS_U:-}" "${RC_U:-}"
printf 'MUTATION U2 producer digests the decoding: %s (exit %s)\n' "${COUNTS_U2:-}" "${RC_U2:-}"
printf '\n394-apply-rollback-mutation: PASS\n'
