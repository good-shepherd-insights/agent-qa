#!/usr/bin/env bash
#
# 415-floor-mutation.sh — FLOOR-03/05/06 and D-07's v54 bar.
#
# Phase 415 widened TEN closed sets, including CR-01's writer-refusal vocabulary. A green suite
# cannot prove the new members cannot quietly
# leave: satisfies checks each listed entry, not whether the list covers the full type, and
# runtime Vitest transforms without typechecking. Fourteen legs therefore remove one member or
# plant one forbidden line, then require the RED in the cell named BEFORE the mutation.
#
# LEG INDEX — each runtime leg reads ONLY its named suite (arch legs run pnpm validate:arch).
# Replay suite = src/replay/__tests__/replay-closed-sets.test.ts
# Gate suite   = src/gate/__tests__/gate-closed-sets.test.ts
# Stats suite  = src/stats/__tests__/stats-closed-sets.test.ts
#
# F-01  unrenderable-brief / REPLAY_REFUSAL_REASONS  runtime  seven replay refusal reasons / replay
# F-02  same array deletion                         testd    src/replay/__tests__/result.test-d.ts:18:5
# F-03  rendered / BRIEF_SOURCES                    runtime  three brief sources / replay
# F-04  removed / BRIEF_DELTA_KINDS                 runtime  two brief delta kinds / replay
# F-05  stale-floor / GATE_INCONCLUSIVE_REASONS     runtime  ten gate inconclusive reasons / gate
# F-06  gate/415-plant.ts calls Math.random()        runtime  no source ... spells Math.random / arch
# F-07  vitest config names m3-release-gate.sh       runtime  no vitest config ... references the release gate / arch
# F-08  uniform / TURN_MATCHES                     runtime  two turn matches / replay
# F-09  loop / FLOOR_AXES                          runtime  six floor axes / gate
# F-10  held-out-private / FLOOR_SPLITS            runtime  three floor splits / gate
# F-11  declared / SEED_POLICIES                   runtime  two seed policies / gate
# F-12  overfit / GENERALIZATION_VERDICTS          runtime  three generalization verdicts / stats
# F-13  unusable-measurement / FLOOR_REFUSAL_KINDS runtime  three floor refusal kinds / gate
# F-14  same array deletion                        testd    src/gate/__tests__/release-gate.test-d.ts:29:5
#
# Full cell titles below are the REQUIRED and ALLOWED set, identically: no collateral failures.
# F-02 requires the failed-suite marker AND the measured file:line:column, and exactly one
# TypeCheckError block. Its type retains unrenderable-brief while only the array loses it.
# F-14 applies the same independent type wall to the unusable-measurement writer refusal.
# F-05's union is derived from its array, so source ALSO fails to compile when stale-floor leaves;
# the runtime cell is the measured wall here (the S-07 lesson), not a whole-package tsc failure.
#
# TWO RED-PARSERS, retained from 414:
# runtime: FAIL <suite> > <describe> > <title>, normalized to describe/title.
# testd: one failed suite plus its TypeCheckError file:line:column. No runtime cell line exists.
# REQUIRED matches each line at its end; ALLOWED admits no unlisted red. The startup control
# rejects a truncated title. Exit codes come directly from the process, never through a pipe.
#
# NO DIST CROSSING: eval cells import their subjects relatively; architecture reads raw source.
# A future leg crossing built output must re-add a forced build, because stale dist is false green.
# There are no model calls, package installs, leg selectors or run-all-and-report shortcuts here.
#
# RESTORE LAWS copied from 414: refuse dirty subjects and pre-existing created paths (including
# dangling links) BEFORE taking ownership; snapshot; prove the mutation landed; restore; compare
# full sha256 digests; prove created paths absent; require the instrument green after restoration.
# Every FATAL and INT/TERM/HUP restores through the same helper, with EXIT as final cleanup.
# Four startup controls drive digest, restore-error, title-match and safe-refusal failures.
#
# Usage: pnpm validate:floor-mutation
#        bash agent-qa/scripts/415-floor-mutation.sh
# FLOOR_MUTATION_SELFTEST=neutered applies no mutation; F-01 MUST FATAL when its suite stays green.
# Unrelated work is preserved: cleanliness checks are scoped to the actual mutation subjects.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

EVAL_FILTER="@vostride/agent-qa-eval"
ARCH_FILTER="@vostride/agent-qa-arch"

REPLAY_RESULT="packages/eval/src/replay/result.ts"
BRIEF_TIERS="packages/eval/src/replay/brief-tiers.ts"
BRIEF_DELTA="packages/eval/src/replay/brief-delta.ts"
RELEASE_GATE="packages/eval/src/gate/release-gate.ts"
DECISION_VECTOR="packages/eval/src/stats/decision-vector.ts"
FLOOR_ARTEFACT="packages/eval/src/gate/floor-artefact.ts"
PROFILE_KEY="packages/eval/src/baseline/profile-key.ts"
GENERALIZATION="packages/eval/src/stats/generalization.ts"
VITEST_CONFIG="packages/eval/vitest.config.ts"
F06_PLANT_PATH="packages/eval/src/gate/415-plant.ts"

REPLAY_SUITE="src/replay/__tests__/replay-closed-sets.test.ts"
REFUSAL_TESTD="src/replay/__tests__/result.test-d.ts"
FLOOR_REFUSAL_TESTD="src/gate/__tests__/release-gate.test-d.ts"
GATE_SUITE="src/gate/__tests__/gate-closed-sets.test.ts"
STATS_SUITE="src/stats/__tests__/stats-closed-sets.test.ts"
ARCH_SUITE="src/__tests__/415-no-randomness-on-gate-paths.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
LEGS_RUN=0

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

# Byte-identity, and nothing weaker: the FULL hex digest of both files, hashed at call time — never
# a size, never an mtime, never a truncated digest. Two files that differ by one byte must compare
# non-equal, and the self-check below drives exactly that. A missing file hashes to the empty
# string; the `-n` guard stops two missing files comparing equal.
same_bytes () {
  local a b
  a="$(shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1)" || true
  b="$(shasum -a 256 "$2" 2>/dev/null | cut -d' ' -f1)" || true
  [ -n "$a" ] && [ "$a" = "$b" ]
}

# required_line_match <fragment> <red-blob> — is this named cell among the reds?
#
# PER RED LINE, AND ANCHORED AT THE LINE END. A substring match against the whole multi-line blob
# reports MATCHED for a fragment that is a strict PREFIX of a cell's real title — which is the
# truncation this phase's own plan text reaches for (`declares exactly the seven replay refusal reasons`,
# where the cell is `declares exactly the seven replay refusal reasons, in declaration order`). A leg that
# named the truncation would pass while proving nothing about the cell it meant.
#
# The suffix is the right anchor, not full-line equality: the runtime red-parser strips the
# ` FAIL  <suite> > ` prefix but leaves the describe block, so a red line reads
# `<describe> > <title>` while a REQUIRED fragment is the title alone. It is also correct for the
# `testd` parser, whose fragments are whole `grep -oE` outputs and therefore already whole lines,
# which an end anchor with a left wildcard still matches.
required_line_match () {
  local fragment="$1" line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      *"$fragment") return 0 ;;
    esac
  done <<< "$2"
  return 1
}

# Newline-separated, never associative arrays: /bin/bash here is 3.2.57.
CURRENT_SUBJECTS=""
CURRENT_CREATED=""
# `fatal`'s re-entry guard: a failure DURING cleanup, or a second interrupt, must exit rather than
# start the cleanup over.
FATAL_ACTIVE=0

# A COPY THAT DID NOT HAPPEN MUST NEVER BE REPORTED AS ONE THAT DID. `cp`'s own diagnostic reaches
# stderr and a non-zero status is FATAL: the whole guarantee rests on this copy, and the moment it
# is most needed is the moment a leg failed with a narrowed set live on disk. The created paths are
# only `rm -f`'d here; a path that survives the leg is caught by the byte-identity proof below.
#
# This function exits DIRECTLY rather than through the `fatal` helper, because that helper calls
# this one and a call back would recurse forever. An `exit` taken from inside the EXIT trap does not
# re-enter the trap, so exiting directly is safe on the trap path too.
restore_current () {
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if ! cp "$(snapshot_path "$p")" "$REPO_ROOT/$p"; then
      echo "FATAL: could not restore $p from its byte snapshot" >&2
      exit 1
    fi
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    rm -f "$REPO_ROOT/$p"
  done <<< "$CURRENT_CREATED"
}

# The byte-identity proof, hoisted out of the success path so every FATAL path reaches the same
# implementation. One implementation, two callers: a success and a failure cannot diverge into two
# accounts of the same guarantee. It prints its own FATAL and exits DIRECTLY rather than calling
# `fatal` — `fatal` calls this, so a call back would recurse.
verify_restored () {
  local p restored
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if ! same_bytes "$REPO_ROOT/$p" "$(snapshot_path "$p")"; then
      restored="$(shasum -a 256 "$REPO_ROOT/$p" 2>/dev/null | cut -d' ' -f1)" || true
      echo "FATAL: $p was not restored byte-identically ($restored)" >&2
      exit 1
    fi
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ]; then
      echo "FATAL: $p survived the leg — a created path was not removed" >&2
      exit 1
    fi
  done <<< "$CURRENT_CREATED"
  echo "  every subject restored byte-identically (sha256 compared); every created path removed"
}

# THE LEG'S CLOSE-OUT, and there is exactly one of it. Restore, then PROVE the restore. Both
# callers — the success path and the FATAL path — come through here, so a leg that passed and a leg
# that failed cannot diverge into two accounts of the same guarantee.
close_leg () {
  restore_current
  verify_restored
}

# THE ONE FATAL EXIT. Message first (a reader of the log sees the reason before the cleanup), then
# the same close-out the success path takes, then exit 1.
fatal () {
  echo "FATAL: $1" >&2
  if [ "$FATAL_ACTIVE" = 1 ]; then
    exit 1
  fi
  FATAL_ACTIVE=1
  close_leg
  exit 1
}

trap 'restore_current; rm -rf "$WORK"' EXIT
# AN INTERRUPT IS AN EXIT PATH LIKE ANY OTHER. A Ctrl-C mid-run would otherwise abandon a mutated
# tree, so the signal routes into the SAME helper a FATAL takes: the same restore, the same sha256
# proof. That makes the first interrupt deliberately slow — it restores and proves before it goes —
# and a second interrupt hits the re-entry guard and exits at once. Bash defers a trap until the
# foreground child returns, so an interrupt during a suite lands when that child finishes.
trap 'fatal "interrupted by signal — restoring every subject from its byte snapshot before exit"' INT TERM HUP

# SCOPED to the subject path, never a bare `git status`: this working tree can legitimately carry
# unrelated dirt elsewhere, and a bare status would make this bar refuse to run for a reason that
# has nothing to do with what it measures.
clean_gate () {
  local p="$1"
  if [ -n "$(git status --porcelain -- "$p")" ]; then
    echo "FATAL: $p is dirty before the snapshot — refusing to mutate it" >&2
    exit 1
  fi
}

# All selected members have a predecessor. Anchor to the named ONE-line array and remove only
# its comma/member pair: the explicit type union and all production arms remain unchanged.
remove_member () {
  local subject="$1" array="$2" member="$3"
  perl -pi -e "s/^(export const $array = \[.*), '\Q$member\E'/\${1}/" "$REPO_ROOT/$subject"
}

apply_mutation () {
  case "${FLOOR_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    F-01|F-02) remove_member "$REPLAY_RESULT" REPLAY_REFUSAL_REASONS unrenderable-brief ;;
    F-03) remove_member "$BRIEF_TIERS" BRIEF_SOURCES rendered ;;
    F-04) remove_member "$BRIEF_DELTA" BRIEF_DELTA_KINDS removed ;;
    F-05) remove_member "$RELEASE_GATE" GATE_INCONCLUSIVE_REASONS stale-floor ;;
    F-06) printf '%s\n' 'Math.random()' > "$REPO_ROOT/$F06_PLANT_PATH" ;;
    F-07) printf '%s\n' '// m3-release-gate.sh' >> "$REPO_ROOT/$VITEST_CONFIG" ;;
    F-08) remove_member "$BRIEF_TIERS" TURN_MATCHES uniform ;;
    F-09) remove_member "$DECISION_VECTOR" FLOOR_AXES loop ;;
    F-10) remove_member "$FLOOR_ARTEFACT" FLOOR_SPLITS held-out-private ;;
    F-11) remove_member "$PROFILE_KEY" SEED_POLICIES declared ;;
    F-12) remove_member "$GENERALIZATION" GENERALIZATION_VERDICTS overfit ;;
    F-13|F-14) remove_member "$FLOOR_ARTEFACT" FLOOR_REFUSAL_KINDS unusable-measurement ;;
    *) echo "FATAL: unknown leg $1" >&2; exit 1 ;;
  esac
}

# One command for preflight, live RED and restored GREEN. The lint walls must be measured through
# the registered validate:arch command, not merely by running their file in isolation.
run_instrument () {
  if [ "$1" = "$ARCH_FILTER" ]; then
    pnpm validate:arch
  else
    pnpm --filter "$1" exec vitest run "$2"
  fi
}

# run_leg <id> <label> <mode> <required> <allowed> <filter> <suite> <subjects> <created>
#
#   mode      runtime | testd — which red-parser reads the log
#   required  newline-separated fragments, every one of which must be among the reds
#   allowed   newline-separated fragments; every red must contain one of them
#   subjects  newline-separated committed paths this leg edits (snapshotted, sha256-verified)
#   created   newline-separated paths this leg brings into existence (must not exist beforehand)
run_leg () {
  local id="$1" label="$2" mode="$3" required="$4" allowed="$5" filter="$6" suite="$7"
  local subjects="$8" created="$9"

  echo "=== LEG $id — $label"

  # Refuse first: the restore lists only ever name a created path proven absent, or a subject
  # snapshotted, at the moment it joined. A refusing exit's trap can therefore remove nothing
  # that was on disk before the leg. 414-VERIFICATION.md gap 1 makes this order load-bearing:
  # populating CURRENT_CREATED before the already-exists refusal deleted the refused file.
  # Refusals exit directly, not through fatal: fatal runs close_leg, whose verify_restored would
  # print the restored-and-proven line for a leg that never started. Empty lists make exit honest.
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    clean_gate "$p"
  done <<< "$subjects"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ] || [ -L "$REPO_ROOT/$p" ]; then
      echo "FATAL: $p already exists — leg $id would overwrite a real file" >&2
      exit 1
    fi
  done <<< "$created"

  while IFS= read -r p; do
    [ -z "$p" ] && continue
    cp "$REPO_ROOT/$p" "$(snapshot_path "$p")"
    echo "  subject $p sha256 $(shasum -a 256 "$REPO_ROOT/$p" | cut -d' ' -f1)"
  done <<< "$subjects"

  CURRENT_SUBJECTS="$subjects"
  CURRENT_CREATED="$created"
  apply_mutation "$id"

  # 412's landed gate: an edit that no longer matches its anchor changes nothing and the leg would
  # report a green that measures the absence of the mutation. Skipped when neutered — a no-op edit
  # changing nothing is exactly what the self-test is for.
  if [ "${FLOOR_MUTATION_SELFTEST:-}" != neutered ]; then
    local landed=0
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      cmp -s "$REPO_ROOT/$p" "$(snapshot_path "$p")" || landed=1
    done <<< "$CURRENT_SUBJECTS"
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      [ -e "$REPO_ROOT/$p" ] && landed=1
    done <<< "$CURRENT_CREATED"
    if [ "$landed" -ne 1 ]; then
      echo "FATAL: leg $id changed nothing — the edit no longer matches" >&2
      exit 1
    fi
  fi

  set +e
  run_instrument "$filter" "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    fatal "the suite stayed green under the mutation — leg $id measures nothing"
  fi

  local red
  set +e
  case "$mode" in
    runtime)
      red="$(grep -oE "^ FAIL  [^ ]+ > .*" "$LOG" | sed -E 's|^ FAIL  [^ ]+ > ||' | sort -u)" ;;
    testd)
      red="$(grep -oE "^ FAIL  $suite \[ $suite \]|❯ $suite:[0-9]+:[0-9]+" "$LOG" | sort -u)" ;;
    *)
      set -e
      fatal "leg $id asks for mode $mode — mode not implemented" ;;
  esac
  set -e

  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  if [ -z "$red" ]; then
    fatal "leg $id did not red its named cell — the log carries no parseable red"
  fi

  # A type-test leg's ALLOWED list is "nothing else", and "nothing else" is only checkable by
  # counting the blocks: the suite line names the file but not how many walls inside it fell.
  if [ "$mode" = testd ]; then
    local blocks
    set +e
    blocks="$(grep -c 'TypeCheckError' "$LOG" | tr -d '[:space:]')"
    set -e
    echo "  TypeCheckError blocks: $blocks"
    if [ "$blocks" -ne 1 ]; then
      fatal "leg $id raised $blocks TypeCheckError blocks — exactly one was predicted"
    fi
  fi

  # Nothing outside the allowed list may be red: a mutation that reds the package is measuring
  # blast radius rather than the property.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ok=0
    while IFS= read -r fragment; do
      [ -z "$fragment" ] && continue
      case "$line" in *"$fragment"*) ok=1 ;; esac
    done <<< "$allowed"
    if [ "$ok" -eq 0 ]; then
      fatal "leg $id red a cell outside its allowed list: $line"
    fi
  done <<< "$red"

  # …and every cell this mutation EXISTS to red must be among them — matched PER RED LINE and
  # anchored at the line end. An empty fragment is skipped, never treated as a satisfied match.
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    if required_line_match "$fragment" "$red"; then
      echo "  named cell red: $fragment"
    else
      fatal "leg $id did not red its named cell: $fragment"
    fi
  done <<< "$required"

  # The same close-out `fatal` takes, through the same implementation: restore, PROVE the restore.
  close_leg

  # The instrument must be green again before the next leg; F-01/F-02 and F-03/F-08 share subjects.
  set +e
  run_instrument "$filter" "$suite" > "$LOG" 2>&1
  local back=$?
  set -e
  if [ "$back" -ne 0 ]; then
    echo "FATAL: the instrument is still red after leg $id restored (exit $back)" >&2
    exit 1
  fi
  echo "  instrument green again after restore"

  CURRENT_SUBJECTS=""
  CURRENT_CREATED=""
  LEGS_RUN=$((LEGS_RUN + 1))
  echo
}

# Named cells are transcribed verbatim, including the declaration-order suffix.
F01_CELL='declares exactly the seven replay refusal reasons, in declaration order'
F01_TRUNCATED='declares exactly the seven replay refusal reasons'
F03_CELL='declares exactly the three brief sources, in declaration order'
F04_CELL='declares exactly the two brief delta kinds, in declaration order'
F05_CELL='declares exactly the ten gate inconclusive reasons, in declaration order'
F06_CELL='no source under a gate, partition or fuzz root spells Math.random'
F07_CELL='no vitest config, turbo pipeline or package test script references the release gate'
F08_CELL='declares exactly the two turn matches, in declaration order'
F09_CELL='declares exactly the six floor axes, in declaration order'
F10_CELL='declares exactly the three floor splits, in declaration order'
F11_CELL='declares exactly the two seed policies, in declaration order'
F12_CELL='declares exactly the three generalization verdicts, in declaration order'
F13_CELL='declares exactly the three floor refusal kinds, in declaration order'

# ── INSTRUMENT SELF-CHECK ─────────────────────────────────────────────────────────────────────
#
# A gate nobody has seen fire is a comment. This phase's whole thesis is that a property nothing can
# fail on is not a property, and the gates the criterion rests on are subject to that thesis too —
# so each of them is DRIVEN IN ITS FAILING DIRECTION here, on every invocation, before any subject
# is touched. It costs milliseconds, writes nothing into a tracked path, and turns each branch from
# one that has been READ into one that has been SEEN to fire.
instrument_self_check () {
  echo "=== INSTRUMENT SELF-CHECK — the gates the criterion rests on, driven in their failing direction"

  # Control 1 — the sha256 comparator, in BOTH directions. If it cannot tell two different files
  # apart, every restore verification in this script is vacuous and every FATAL path lies.
  local sc_a="$WORK/selfcheck-same-a" sc_b="$WORK/selfcheck-same-b" sc_c="$WORK/selfcheck-different"
  printf 'the same bytes\n' > "$sc_a"
  printf 'the same bytes\n' > "$sc_b"
  printf 'the same bytes.\n' > "$sc_c"
  local accepts_identical=0 rejects_differing=0
  if same_bytes "$sc_a" "$sc_b"; then accepts_identical=1; fi
  if same_bytes "$sc_a" "$sc_c"; then :; else rejects_differing=1; fi
  rm -f "$sc_a" "$sc_b" "$sc_c"
  if [ "$accepts_identical" -ne 1 ] || [ "$rejects_differing" -ne 1 ]; then
    echo "FATAL: the sha256 comparator cannot tell two different files apart — the restore verification is vacuous" >&2
    exit 1
  fi
  echo "  comparator: sha256 rejects differing bytes and accepts identical bytes"

  # Control 2 — the restore path's THREE failure branches, driven. Every one runs in a SUBSHELL used
  # as an `if` condition: `set -e` cannot abort the run, the callee's `exit 1` ends only the
  # subshell, and — this is the load-bearing part — the assignments below never touch the parent
  # shell. A parent-shell `CURRENT_CREATED=package.json` would be `rm -f`'d by the EXIT trap and
  # would DELETE a tracked file at process exit. Output goes under $WORK, so no FATAL of a control
  # reaches the run log.
  local sc_log="$WORK/selfcheck-restore.log"
  local copy_loud=0 digest_loud=0 created_loud=0

  # (a) the failed copy. `.selfcheck-no-snapshot` was never snapshotted, so `cp` fails on a MISSING
  # SOURCE and nothing is ever written into the repository. It is driven through the `fatal` helper
  # rather than by calling the restore helper directly, so the real exit path is what gets proved —
  # including that the helper reaches the restore before it reaches anything else.
  if (
    CURRENT_SUBJECTS=".selfcheck-no-snapshot"
    CURRENT_CREATED=""
    fatal "self-check control: driving the failed-copy branch"
  ) > "$sc_log" 2>&1; then :; else copy_loud=1; fi
  grep -q 'FATAL: could not restore .selfcheck-no-snapshot from its byte snapshot' "$sc_log" || copy_loud=0

  # (b) the mismatched digest. `package.json` always exists and is never a leg subject, so its
  # snapshot name cannot collide with a real one; the bogus snapshot is removed immediately.
  local sc_snapshot
  sc_snapshot="$(snapshot_path "package.json")"
  printf 'these are not the bytes of package.json\n' > "$sc_snapshot"
  if (
    CURRENT_SUBJECTS="package.json"
    CURRENT_CREATED=""
    verify_restored
  ) > "$sc_log" 2>&1; then :; else digest_loud=1; fi
  rm -f "$sc_snapshot"
  grep -q 'FATAL: package.json was not restored byte-identically' "$sc_log" || digest_loud=0

  # (c) the surviving created path. Writes nothing at all: it names a path that already exists.
  if (
    CURRENT_SUBJECTS=""
    CURRENT_CREATED="package.json"
    verify_restored
  ) > "$sc_log" 2>&1; then :; else created_loud=1; fi
  grep -q 'FATAL: package.json survived the leg' "$sc_log" || created_loud=0

  rm -f "$sc_log"
  if [ "$copy_loud" -ne 1 ] || [ "$digest_loud" -ne 1 ] || [ "$created_loud" -ne 1 ]; then
    echo "FATAL: the restore path cannot fail — a failed copy, a mismatched digest or a surviving created path would pass unnoticed" >&2
    exit 1
  fi
  echo "  control: restore path FATALs on a failed copy, a mismatched digest and a surviving created path"

  # Control 3 — the REQUIRED comparator, driven against leg F-01's OWN cell in both directions, with
  # the exact truncation a hand reaches for. `F01_TRUNCATED` is a strict PREFIX of `F01_CELL`, so
  # under a whole-blob substring match it would report MATCHED against F-01's real red and the leg
  # would pass while naming a title that exists nowhere. The end-anchored comparator must REFUSE it.
  #
  # The blob carries a SYNTHETIC describe prefix — synthetic on purpose: the property under test is
  # about the suffix, and that the real red line has this shape is proven separately by the full
  # run's own `named cell red:` output over the live suites.
  case "$F01_CELL" in
    "$F01_TRUNCATED"?*) : ;;
    *)
      echo "FATAL: F01_TRUNCATED is no longer a strict prefix of F01_CELL — the negative control is vacuous, re-point it" >&2
      exit 1 ;;
  esac
  local sc_blob="415 self-check synthetic describe > ${F01_CELL}"
  local sc_wrong=0
  if required_line_match "$F01_CELL" "$sc_blob"; then :; else sc_wrong=1; fi
  if required_line_match "$F01_TRUNCATED" "$sc_blob"; then sc_wrong=1; fi
  if [ "$sc_wrong" -ne 0 ]; then
    echo "FATAL: the REQUIRED comparator cannot tell a named cell from a truncation of it — every leg below measures less than it claims" >&2
    exit 1
  fi
  echo "  comparator: required-line-exact — F-01's whole cell matched its own red, and the truncation '$F01_TRUNCATED' REFUSED that same red"

  # Control 4 — the already-exists refusal, through run_leg itself and the real cleanup helper.
  # Measured on bash 3.2.57: a subshell does NOT run the parent's EXIT trap; a trap set INSIDE it
  # does fire, and subshell assignments never reach the parent. Control 2 relies on that isolation;
  # this control must RE-ARM restore_current or the destructive step is never driven. Do not re-arm
  # the process trap's rm -rf "$WORK" half — the remaining self-check bookkeeping still needs WORK.
  # The path MUST be a throwaway this control creates: a regression deletes it, which is exactly
  # what we must observe. Never use a tracked file here; Control 2(c) can name package.json only
  # because verify_restored removes nothing, while this control drives the destructive path.
  local sc_preexisting=".selfcheck-already-exists" sc_bytes="$WORK/selfcheck-already-exists.bytes"
  if [ -e "$REPO_ROOT/$sc_preexisting" ] || [ -L "$REPO_ROOT/$sc_preexisting" ]; then
    echo "FATAL: $sc_preexisting already exists — this control needs a path it can create; re-point it or remove the leftover by hand" >&2
    exit 1
  fi
  printf 'self-check bytes that must survive the already-exists refusal\n' > "$REPO_ROOT/$sc_preexisting"
  cp "$REPO_ROOT/$sc_preexisting" "$sc_bytes"
  local refused_loud=0 survived=0
  if (
    trap 'restore_current' EXIT
    run_leg SC-4 "self-check control: a created path that already exists" runtime "" "" "$EVAL_FILTER" "" "" "$sc_preexisting"
  ) > "$sc_log" 2>&1; then :; else refused_loud=1; fi
  grep -qF "FATAL: $sc_preexisting already exists — leg SC-4 would overwrite a real file" "$sc_log" || refused_loud=0
  if same_bytes "$REPO_ROOT/$sc_preexisting" "$sc_bytes"; then survived=1; fi
  rm -f "$REPO_ROOT/$sc_preexisting" "$sc_bytes" "$sc_log"
  if [ "$refused_loud" -ne 1 ] || [ "$survived" -ne 1 ]; then
    echo "FATAL: the already-exists refusal is not safe — it did not refuse loudly, or the EXIT trap removed the file it refused to overwrite (414-VERIFICATION gap 1)" >&2
    exit 1
  fi
  echo "  control: the already-exists refusal FATALs with the restore list still empty — the pre-existing file survived the EXIT trap byte-identically (sha256 compared)"

  echo "INSTRUMENT SELF-CHECK OK (4 controls)"
  echo
}

instrument_self_check

# ── PREFLIGHT ─────────────────────────────────────────────────────────────────────────────────
#
# Every instrument any leg will drive, run once on the committed tree. The failure this catches that
# no leg could: a suite that was ALREADY red, whose red a leg would then read as its own
# measurement. No `dist` is rebuilt — see the header: nothing below crosses one, and the preflight
# passing is itself the proof that the built output every suite resolves is usable as it stands.
PREFLIGHT_COUNT=0

preflight_suite () {
  local filter="$1" suite="$2"
  set +e
  run_instrument "$filter" "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: already red before any mutation: $suite (filter $filter, exit $rc)" >&2
    exit 1
  fi
  echo "  preflight green: $filter $suite"
  PREFLIGHT_COUNT=$((PREFLIGHT_COUNT + 1))
}

echo "=== PREFLIGHT — every instrument must be green before any subject is touched"
preflight_suite "$EVAL_FILTER" "$REPLAY_SUITE"
preflight_suite "$EVAL_FILTER" "$REFUSAL_TESTD"
preflight_suite "$EVAL_FILTER" "$FLOOR_REFUSAL_TESTD"
preflight_suite "$EVAL_FILTER" "$GATE_SUITE"
preflight_suite "$EVAL_FILTER" "$STATS_SUITE"
preflight_suite "$ARCH_FILTER" "$ARCH_SUITE"
echo "PREFLIGHT OK ($PREFLIGHT_COUNT instruments)"
echo

# F-01/F-02 measure independent runtime and type walls for the SAME array deletion.
run_leg F-01 "unrenderable-brief removed from REPLAY_REFUSAL_REASONS" runtime \
  "$F01_CELL" "$F01_CELL" "$EVAL_FILTER" "$REPLAY_SUITE" "$REPLAY_RESULT" ""

# REQUIRED and ALLOWED are identical even for testd: both the failed suite AND its one measured
# diagnostic pointer must be present. The parser additionally demands exactly one TypeCheckError.
F02_CELLS="$REFUSAL_TESTD [ $REFUSAL_TESTD ]
$REFUSAL_TESTD:18:5"
run_leg F-02 "the same removal, read by the never-bar at result.test-d.ts:18:5" testd \
  "$F02_CELLS" "$F02_CELLS" "$EVAL_FILTER" "$REFUSAL_TESTD" "$REPLAY_RESULT" ""

run_leg F-03 "rendered removed from BRIEF_SOURCES" runtime \
  "$F03_CELL" "$F03_CELL" "$EVAL_FILTER" "$REPLAY_SUITE" "$BRIEF_TIERS" ""
run_leg F-04 "removed removed from BRIEF_DELTA_KINDS" runtime \
  "$F04_CELL" "$F04_CELL" "$EVAL_FILTER" "$REPLAY_SUITE" "$BRIEF_DELTA" ""
run_leg F-05 "stale-floor removed from GATE_INCONCLUSIVE_REASONS" runtime \
  "$F05_CELL" "$F05_CELL" "$EVAL_FILTER" "$GATE_SUITE" "$RELEASE_GATE" ""
run_leg F-06 "Math.random() planted under eval/src/gate" runtime \
  "$F06_CELL" "$F06_CELL" "$ARCH_FILTER" "$ARCH_SUITE" "" "$F06_PLANT_PATH"
run_leg F-07 "release-gate reference planted in a vitest config" runtime \
  "$F07_CELL" "$F07_CELL" "$ARCH_FILTER" "$ARCH_SUITE" "$VITEST_CONFIG" ""
run_leg F-08 "uniform removed from TURN_MATCHES" runtime \
  "$F08_CELL" "$F08_CELL" "$EVAL_FILTER" "$REPLAY_SUITE" "$BRIEF_TIERS" ""
run_leg F-09 "loop removed from FLOOR_AXES" runtime \
  "$F09_CELL" "$F09_CELL" "$EVAL_FILTER" "$GATE_SUITE" "$DECISION_VECTOR" ""
run_leg F-10 "held-out-private removed from FLOOR_SPLITS" runtime \
  "$F10_CELL" "$F10_CELL" "$EVAL_FILTER" "$GATE_SUITE" "$FLOOR_ARTEFACT" ""
run_leg F-11 "declared removed from SEED_POLICIES" runtime \
  "$F11_CELL" "$F11_CELL" "$EVAL_FILTER" "$GATE_SUITE" "$PROFILE_KEY" ""
run_leg F-12 "overfit removed from GENERALIZATION_VERDICTS" runtime \
  "$F12_CELL" "$F12_CELL" "$EVAL_FILTER" "$STATS_SUITE" "$GENERALIZATION" ""
run_leg F-13 "unusable-measurement removed from FLOOR_REFUSAL_KINDS" runtime \
  "$F13_CELL" "$F13_CELL" "$EVAL_FILTER" "$GATE_SUITE" "$FLOOR_ARTEFACT" ""
F14_CELLS="$FLOOR_REFUSAL_TESTD [ $FLOOR_REFUSAL_TESTD ]
$FLOOR_REFUSAL_TESTD:29:5"
run_leg F-14 "the same removal, read by the floor-refusal never-bar" testd \
  "$F14_CELLS" "$F14_CELLS" "$EVAL_FILTER" "$FLOOR_REFUSAL_TESTD" "$FLOOR_ARTEFACT" ""

# Pinned, not derived from the calls: a silently deleted leg must make the bar fail.
EXPECTED_LEGS=14
if [ "$LEGS_RUN" -ne "$EXPECTED_LEGS" ]; then
  fatal "leg count drifted — expected $EXPECTED_LEGS, ran $LEGS_RUN"
fi

echo "LEGS $LEGS_RUN"
echo "PASS — all ten closed sets Phase 415 widened and both lint walls have been seen to fail"
echo "       in their named cells. Each leg used identical REQUIRED and ALLOWED sets; F-02/F-14"
echo "       measured their pinned never-bars with exactly one TypeCheckError. Every subject"
echo "       was restored byte-identically (sha256 compared), every created path was removed,"
echo "       and the instrument was green again before the next leg. FLOOR_MUTATION_SELFTEST"
echo "       =neutered must FATAL on F-01 rather than report a passing mutation."
