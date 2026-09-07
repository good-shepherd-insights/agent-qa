#!/usr/bin/env bash
#
# 416-gate-mutation.sh — PROM-03/04, D-02/D-03/D-16's v54 deletion bar.
#
# LEG INDEX — thirteen independent runtime projection deletions.
# G-01 posture-unavailable / PROMOTION_GATE_HOLD_REASONS — nineteen reasons
# G-02 same deletion — promotion-gate.test-d.ts:14:5
# G-03 user-sovereign / PROMOTION_PATHS — four paths
# G-04 same deletion — promotion-gate.test-d.ts:37:74
# G-05 3 / GATE_NUMBERS — three gate numbers
# G-06 abstain / GATE_VERDICTS — three gate verdicts
# G-07 not-run / CROSS_CHECKS — four cross checks
# G-08 tier-not-implemented / DEGRADATIONS — two degradations
# G-09 exercised-harmed / BENEFITS — three benefits
# G-10 confirmed-bug / MARKS — three marks
# G-11 unknown / STATE_VALIDITIES — three state validities
# G-12 evidence/gates.jsonl / MUTABLE_BUNDLE_TARGETS — seven mutable targets
# G-13 abstain / GATE_VERDICTS — gate-receipt.test-d.ts:14:5
#
# G-04/G-13 must fail at their own never-bars; measured collateral alone never satisfies
# either. Complete diagnostic messages and pointers are pinned by full sha256, not prefixes.
#
# TWO RED-PARSERS, retained from 414:
# runtime: FAIL <suite> > <describe> > <title>, normalized to describe/title.
# testd: one failed suite plus its TypeCheckError file:line:column. No runtime cell line exists.
# REQUIRED matches each line at its end; ALLOWED admits no unlisted red. The startup control
# rejects a truncated title. Exit codes come directly from the process, never through a pipe.
#
# NO DIST CROSSING: schema and bundle cells import their subjects relatively; architecture reads raw source.
# A future leg crossing built output must re-add a forced build, because stale dist is false green.
# There are no model calls, package installs, leg selectors or run-all-and-report shortcuts here.
#
# RESTORE LAWS copied from 414: refuse dirty subjects and pre-existing created paths (including
# dangling links) BEFORE taking ownership; snapshot; prove the mutation landed; restore; compare
# full sha256 digests; prove created paths absent; require the instrument green after restoration.
# Every FATAL and INT/TERM/HUP restores through the same helper, with EXIT as final cleanup.
# Five startup controls drive digest, restore-error, title-match, safe-refusal and never-bar failures.
#
# Usage: pnpm validate:gate-mutation
#        bash agent-qa/scripts/416-gate-mutation.sh
# GATE_MUTATION_SELFTEST=neutered applies no mutation; G-01 MUST FATAL when its suite stays green.
# Unrelated work is preserved: cleanliness checks are scoped to the actual mutation subjects.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_FILTER="@vostride/agent-qa-schema"
KNOWLEDGE_FILTER="@vostride/agent-qa-knowledge-local"
PROMOTION_GATE="packages/schema/src/knowledge/promotion-gate.ts"
PROMOTION_PATH="packages/schema/src/knowledge/promotion-path.ts"
GATE_RECEIPT="packages/schema/src/knowledge/gate-receipt.ts"
BUNDLE_MUTATION="packages/knowledge-local/src/journal/bundle-mutation.ts"
HOLD_SUITE="src/__tests__/promotion-gate-hold-reasons.test.ts"
PROMOTION_TESTD="src/__tests__/promotion-gate.test-d.ts"
RECEIPT_SUITE="src/__tests__/gate-receipt-closed-sets.test.ts"
RECEIPT_TESTD="src/__tests__/gate-receipt.test-d.ts"
BUNDLE_SUITE="src/__tests__/bundle-parts.test.ts"

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
# truncation this phase's own plan text reaches for (`declares exactly the nineteen promotion-gate hold reasons`,
# where the cell is `declares exactly the nineteen promotion-gate hold reasons, in declaration order`). A leg that
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
  sed "/^export const $array = /s|, $member||" "$REPO_ROOT/$subject" > "$WORK/mutated"
  cp "$WORK/mutated" "$REPO_ROOT/$subject"
}

apply_mutation () {
  case "${GATE_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    G-01|G-02)
      sed "/^export const PROMOTION_GATE_HOLD_REASONS = \\[/,/^] as const/{
        /^  'posture-unavailable',$/d
      }" "$REPO_ROOT/$PROMOTION_GATE" > "$WORK/mutated"
      cp "$WORK/mutated" "$REPO_ROOT/$PROMOTION_GATE" ;;
    G-03|G-04) remove_member "$PROMOTION_PATH" PROMOTION_PATHS "'user-sovereign'" ;;
    G-05) remove_member "$GATE_RECEIPT" GATE_NUMBERS 3 ;;
    G-06|G-13) remove_member "$GATE_RECEIPT" GATE_VERDICTS "'abstain'" ;;
    G-07) remove_member "$GATE_RECEIPT" CROSS_CHECKS "'not-run'" ;;
    G-08) remove_member "$GATE_RECEIPT" DEGRADATIONS "'tier-not-implemented'" ;;
    G-09) remove_member "$GATE_RECEIPT" BENEFITS "'exercised-harmed'" ;;
    G-10) remove_member "$GATE_RECEIPT" MARKS "'confirmed-bug'" ;;
    G-11) remove_member "$GATE_RECEIPT" STATE_VALIDITIES "'unknown'" ;;
    G-12) remove_member "$BUNDLE_MUTATION" MUTABLE_BUNDLE_TARGETS "'evidence/gates[.]jsonl'" ;;
    *) echo "FATAL: unknown leg $1" >&2; exit 1 ;;
  esac
}

# One command for preflight, live RED and restored GREEN. The lint walls must be measured through
# the registered validate:arch command, not merely by running their file in isolation.
run_instrument () {
  pnpm --filter "$1" exec vitest run "$2"
}

# Match the exact never-bar diagnostic and its following pointer as one block.
# A source-error pointer or a successful type suite cannot stand in for the bar.
testd_target_match () {
  awk -v pointer="$2" '
    /^TypeCheckError:/ { expected = ($0 == "TypeCheckError: Expected 1 arguments, but got 0.") }
    $0 == " ❯ " pointer && expected { found = 1 }
    END { exit !found }
  ' "$1"
}

testd_diagnostic_digest () {
  awk '
    /^TypeCheckError:/ { block = $0; next }
    block != "" {
      block = block "\n" $0
      if ($0 ~ /^ ❯ src\/[^ ]+:[0-9]+:[0-9]+$/) { print block; block = "" }
    }
  ' "$1" | shasum -a 256 | cut -d' ' -f1
}

testd_log_matches () {
  local log="$1" target="$2" blocks="$3" digest="$4"
  [ "$(grep -c '^TypeCheckError:' "$log")" = "$blocks" ] || return 1
  testd_target_match "$log" "$target" || return 1
  [ -z "$digest" ] || [ "$(testd_diagnostic_digest "$log")" = "$digest" ]
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
  if [ "${GATE_MUTATION_SELFTEST:-}" != neutered ]; then
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
      red="$(grep -oE '^ FAIL  [^ ]+ \[ [^ ]+ \]|❯ src/[^ ]+:[0-9]+:[0-9]+' "$LOG" | sort -u)" ;;
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

  # Count every diagnostic block; the suite line alone cannot reveal collateral errors.
  # Where collateral is measured, pin its complete messages as well as every pointer.
  if [ "$mode" = testd ]; then
    local blocks expected_blocks=1 target diagnostic_digest=""
    [ "$id" != G-04 ] || expected_blocks=2
    [ "$id" != G-13 ] || expected_blocks=9
    # Measured complete TypeCheckError blocks through their pointers, in emitted order.
    # 417-09 refresh: G-04 pointer 34 -> 112; G-13 additive arm renders 24 fields.
    # Complete blocks measured in 417-09-gate-mutation[-refreshed].log (2026-09-07).
    [ "$id" != G-04 ] || diagnostic_digest=f707c1984e440a28604de0833d90996ded063fb787d549d8dc6139a3e530aed1
    [ "$id" != G-13 ] || diagnostic_digest=874032b0f90d2290971ea87a5a06e62c31e77940aee1ec2e696008b5ff99732d
    set +e
    blocks="$(grep -c 'TypeCheckError' "$LOG" | tr -d '[:space:]')"
    set -e
    echo "  TypeCheckError blocks: $blocks"
    if [ "$blocks" -ne "$expected_blocks" ]; then
      fatal "leg $id raised $blocks TypeCheckError blocks — exactly $expected_blocks were predicted"
    fi
    target="$(printf '%s\n' "$required" | tail -1)"
    if ! testd_target_match "$LOG" "$target"; then
      fatal "leg $id did not produce the exact never-bar diagnostic at $target"
    fi
    if ! testd_log_matches "$LOG" "$target" "$expected_blocks" "$diagnostic_digest"; then
      cat "$LOG" >&2
      fatal "leg $id diagnostic messages differ from the complete measured blocks"
    fi
    if [ -n "$diagnostic_digest" ]; then
      local control="$WORK/collateral-only.log"
      awk '
        /^TypeCheckError: Expected 1 arguments, but got 0\.$/ { omit = 1; next }
        omit && /^ ❯ src\// { omit = 0; next }
        !omit { print }
      ' "$LOG" > "$control"
      if [ "$(grep -c '^TypeCheckError:' "$control")" -ne "$((expected_blocks - 1))" ]; then
        fatal "leg $id collateral-only control did not retain every collateral block"
      fi
      if testd_target_match "$control" "$target" || \
         testd_log_matches "$control" "$target" "$expected_blocks" "$diagnostic_digest"; then
        fatal "leg $id accepted all collateral without its required never-bar"
      fi
      echo "  control: all $((expected_blocks - 1)) collateral blocks without the target are rejected"
      echo "  complete diagnostic sha256: $diagnostic_digest"
    fi
  fi

  # Nothing outside the allowed list may be red: a mutation that reds the package is measuring
  # blast radius rather than the property.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ok=0
    while IFS= read -r fragment; do
      [ -z "$fragment" ] && continue
      if required_line_match "$fragment" "$line"; then ok=1; fi
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

  # The instrument must be green again before the next leg; G-01/G-02 and G-03/G-04 share subjects.
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
G01_CELL='declares exactly the nineteen promotion-gate hold reasons, in declaration order'
G03_CELL='declares exactly the four promotion paths, in declaration order'
G05_CELL='declares exactly the three gate numbers, in declaration order'
G06_CELL='declares exactly the three gate verdicts, in declaration order'
G07_CELL='declares exactly the four cross checks, in declaration order'
G08_CELL='declares exactly the two degradations, in declaration order'
G09_CELL='declares exactly the three benefits, in declaration order'
G10_CELL='declares exactly the three marks, in declaration order'
G11_CELL='declares exactly the three state validities, in declaration order'
G12_CELL='declares exactly the seven mutable bundle targets, in declaration order'
G01_TRUNCATED='declares exactly the nineteen promotion-gate hold reasons'

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

  # Control 3 — the REQUIRED comparator, driven against leg G-01's OWN cell in both directions, with
  # the exact truncation a hand reaches for. `G01_TRUNCATED` is a strict PREFIX of `G01_CELL`, so
  # under a whole-blob substring match it would report MATCHED against G-01's real red and the leg
  # would pass while naming a title that exists nowhere. The end-anchored comparator must REFUSE it.
  #
  # The blob carries a SYNTHETIC describe prefix — synthetic on purpose: the property under test is
  # about the suffix, and that the real red line has this shape is proven separately by the full
  # run's own `named cell red:` output over the live suites.
  case "$G01_CELL" in
    "$G01_TRUNCATED"?*) : ;;
    *)
      echo "FATAL: G01_TRUNCATED is no longer a strict prefix of G01_CELL — the negative control is vacuous, re-point it" >&2
      exit 1 ;;
  esac
  local sc_blob="416 self-check synthetic describe > ${G01_CELL}"
  local sc_wrong=0
  if required_line_match "$G01_CELL" "$sc_blob"; then :; else sc_wrong=1; fi
  if required_line_match "$G01_TRUNCATED" "$sc_blob"; then sc_wrong=1; fi
  if [ "$sc_wrong" -ne 0 ]; then
    echo "FATAL: the REQUIRED comparator cannot tell a named cell from a truncation of it — every leg below measures less than it claims" >&2
    exit 1
  fi
  echo "  comparator: required-line-exact — G-01's whole cell matched its own red, and the truncation '$G01_TRUNCATED' REFUSED that same red"

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
    run_leg SC-4 "self-check control: a created path that already exists" runtime "" "" "$SCHEMA_FILTER" "" "" "$sc_preexisting"
  ) > "$sc_log" 2>&1; then :; else refused_loud=1; fi
  grep -qF "FATAL: $sc_preexisting already exists — leg SC-4 would overwrite a real file" "$sc_log" || refused_loud=0
  if same_bytes "$REPO_ROOT/$sc_preexisting" "$sc_bytes"; then survived=1; fi
  rm -f "$REPO_ROOT/$sc_preexisting" "$sc_bytes" "$sc_log"
  if [ "$refused_loud" -ne 1 ] || [ "$survived" -ne 1 ]; then
    echo "FATAL: the already-exists refusal is not safe — it did not refuse loudly, or the EXIT trap removed the file it refused to overwrite (414-VERIFICATION gap 1)" >&2
    exit 1
  fi
  echo "  control: the already-exists refusal FATALs with the restore list still empty — the pre-existing file survived the EXIT trap byte-identically (sha256 compared)"

  # Control 5 — G-04 collateral alone must never certify the intended never-bar.
  local sc_target="$PROMOTION_TESTD:37:74"
  printf '%s\n' 'TypeCheckError: source collateral' \
    ' ❯ src/__tests__/gate-receipt.test.ts:112:69' > "$sc_log"
  if testd_target_match "$sc_log" "$sc_target"; then
    fatal "the path never-bar accepted collateral alone"
  fi
  printf '%s\n' 'TypeCheckError: source collateral' " ❯ $sc_target" > "$sc_log"
  if testd_target_match "$sc_log" "$sc_target"; then
    fatal "the path never-bar accepted the wrong diagnostic at its pointer"
  fi
  printf '%s\n' 'TypeCheckError: Expected 1 arguments, but got 0.' " ❯ $sc_target" > "$sc_log"
  if ! testd_target_match "$sc_log" "$sc_target"; then
    fatal "the path never-bar rejected its exact diagnostic and pointer"
  fi
  rm -f "$sc_log"
  echo "  control: the path never-bar rejects collateral alone and wrong diagnostics, accepts its exact block"
  echo "INSTRUMENT SELF-CHECK OK (5 controls)"
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
preflight_suite "$SCHEMA_FILTER" "$HOLD_SUITE"
preflight_suite "$SCHEMA_FILTER" "$PROMOTION_TESTD"
preflight_suite "$SCHEMA_FILTER" "$RECEIPT_SUITE"
preflight_suite "$SCHEMA_FILTER" "$RECEIPT_TESTD"
preflight_suite "$KNOWLEDGE_FILTER" "$BUNDLE_SUITE"
echo "PREFLIGHT OK ($PREFLIGHT_COUNT instruments)"
echo

run_leg G-01 "posture-unavailable removed from PROMOTION_GATE_HOLD_REASONS" runtime "$G01_CELL" "$G01_CELL" "$SCHEMA_FILTER" "$HOLD_SUITE" "$PROMOTION_GATE" ""
G02_CELLS="$PROMOTION_TESTD [ $PROMOTION_TESTD ]
$PROMOTION_TESTD:14:5"
run_leg G-02 "the same removal, read by the hold-reason never-bar" testd "$G02_CELLS" "$G02_CELLS" "$SCHEMA_FILTER" "$PROMOTION_TESTD" "$PROMOTION_GATE" ""
run_leg G-03 "user-sovereign removed from PROMOTION_PATHS" runtime "$G03_CELL" "$G03_CELL" "$SCHEMA_FILTER" "$HOLD_SUITE" "$PROMOTION_PATH" ""
G04_REQUIRED="$PROMOTION_TESTD [ $PROMOTION_TESTD ]
$PROMOTION_TESTD:37:74"
G04_ALLOWED="$G04_REQUIRED
src/__tests__/gate-receipt.test.ts:112:69"
run_leg G-04 "the same removal, read by the path never-bar with measured collateral" testd "$G04_REQUIRED" "$G04_ALLOWED" "$SCHEMA_FILTER" "$PROMOTION_TESTD" "$PROMOTION_PATH" ""
run_leg G-05 "3 removed from GATE_NUMBERS" runtime "$G05_CELL" "$G05_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-06 "abstain removed from GATE_VERDICTS" runtime "$G06_CELL" "$G06_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-07 "not-run removed from CROSS_CHECKS" runtime "$G07_CELL" "$G07_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-08 "tier-not-implemented removed from DEGRADATIONS" runtime "$G08_CELL" "$G08_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-09 "exercised-harmed removed from BENEFITS" runtime "$G09_CELL" "$G09_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-10 "confirmed-bug removed from MARKS" runtime "$G10_CELL" "$G10_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-11 "unknown removed from STATE_VALIDITIES" runtime "$G11_CELL" "$G11_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$GATE_RECEIPT" ""
run_leg G-12 "evidence/gates.jsonl removed from MUTABLE_BUNDLE_TARGETS" runtime "$G12_CELL" "$G12_CELL" "$KNOWLEDGE_FILTER" "$BUNDLE_SUITE" "$BUNDLE_MUTATION" ""
G13_CELLS="$RECEIPT_TESTD [ $RECEIPT_TESTD ]
$RECEIPT_TESTD:14:5"
G13_ALLOWED="$G13_CELLS
src/knowledge/__tests__/promotion-gate.test.ts:38:19
src/knowledge/__tests__/promotion-gate.test.ts:38:45
src/knowledge/__tests__/promotion-gate.test.ts:39:19
src/knowledge/__tests__/promotion-gate.test.ts:39:45
src/knowledge/__tests__/promotion-gate.test.ts:44:3
src/knowledge/__tests__/promotion-gate.test.ts:44:29
src/knowledge/promotion-gate.ts:177:7
src/knowledge/promotion-gate.ts:183:9"
run_leg G-13 "abstain removed, read by the verdict never-bar with measured collateral" testd "$G13_CELLS" "$G13_ALLOWED" "$SCHEMA_FILTER" "$RECEIPT_TESTD" "$GATE_RECEIPT" ""

# Pinned, not derived from the calls: a silently deleted leg must make the bar fail.
EXPECTED_LEGS=13
if [ "$LEGS_RUN" -ne "$EXPECTED_LEGS" ]; then
  fatal "leg count drifted — expected $EXPECTED_LEGS, ran $LEGS_RUN"
fi
echo "LEGS $LEGS_RUN"
echo "PASS — all thirteen receipt/promotion deletion legs failed in their required named cells."
echo "       Every subject was restored byte-identically and each instrument returned green."
echo "       G-04 requires its own never-bar independently of its exact measured collateral."
echo "       GATE_MUTATION_SELFTEST=neutered must FATAL at G-01."
