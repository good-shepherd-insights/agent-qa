#!/usr/bin/env bash
#
# 418-gate2-mutation.sh — Gate-2 governed vocabularies and the inconsistency word, v54 bar.
# LEG INDEX — eight independent deletions, exact named RED then byte-identical GREEN.
# G2-01 gate-inconsistent / PROMOTION_GATE_HOLD_REASONS — twenty reasons
# G2-02 same removal — promotion-gate.test-d.ts:14:5
# G2-03 rode-along / PAYLOAD_BENEFITS — canary-emit.ts source; three benefits
# G2-04 stale / PAYLOAD_STATE_VALIDITIES — canary-emit.ts source; three validities
# G2-05 gate2-pass-gate1-heldout-fail / GATE_INCONSISTENCY_SHAPES — two shapes
# G2-06 completionTokens / gate2SpendSchema — gate-receipt.test-d.ts:53:70
# G2-07 flake / NON_SIGNAL_CLASSES — emit-canary-outcomes.ts source; three classes
# G2-08 same removal — emit-canary-outcomes.test-d.ts:6:80
#
# TWO RED-PARSERS and RESTORE LAWS retained from 416: runtime named cells and
# testd exact diagnostics; dirty-subject refusal before ownership; snapshot,
# sha256 restoration on every exit and signal; restored instruments must be green.
# Five startup controls prove the instrument itself. No dist crossing, installs,
# model calls, leg selectors or run-all-and-report shortcuts.
# Usage: pnpm validate:gate2-mutation
# GATE2_MUTATION_SELFTEST=neutered MUST FATAL at G2-01.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_FILTER="@vostride/agent-qa-schema"
KNOWLEDGE_FILTER="@vostride/agent-qa-knowledge-local"
CLI_FILTER="agent-qa"
PROMOTION_GATE="packages/schema/src/knowledge/promotion-gate.ts"
GATE_RECEIPT="packages/schema/src/knowledge/gate-receipt.ts"
CANARY_EMIT="packages/knowledge-local/src/canary-emit.ts"
CLI_EMIT="packages/cli/src/curation/emit-canary-outcomes.ts"
HOLD_SUITE="src/__tests__/promotion-gate-hold-reasons.test.ts"
PROMOTION_TESTD="src/__tests__/promotion-gate.test-d.ts"
RECEIPT_SUITE="src/__tests__/gate-receipt-closed-sets.test.ts"
RECEIPT_TESTD="src/__tests__/gate-receipt.test-d.ts"
PAYLOAD_SUITE="src/queue/__tests__/canary-payload.test.ts"
EMIT_SUITE="src/curation/__tests__/emit-canary-outcomes.test.ts"
EMIT_TESTD="src/curation/__tests__/emit-canary-outcomes.test-d.ts"
SPEND_DIAGNOSTIC='TypeCheckError: Type '"'"'"screens" | "modelCalls" | "promptTokens" | "completionTokens"'"'"' does not satisfy the constraint '"'"'"Expected literal string screens, Actual never" | "Expected literal string modelCalls, Actual never" | "Expected literal string promptTokens, Actual never" | "Expected literal string completionTokens, Actual never"'"'"'.'
HOLD_DIGEST=663e63650b989314b773bfc6908cc2fc12942fa68b01f0b4c465ef11bc02ad56
SPEND_DIGEST=c2f27742885147577ed9852842140bbb841ec479591ca870ed8a732eed91c5c9
NON_SIGNAL_DIGEST=cddffc9267d8229e59621e749920b09c78291c001a8d924faae92be718bfc73f

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
# truncation this phase's own plan text reaches for (`declares exactly the twenty promotion-gate hold reasons`,
# where the cell is `declares exactly the twenty promotion-gate hold reasons, in declaration order`). A leg that
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
  case "${GATE2_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    G2-01|G2-02)
      sed "/^export const PROMOTION_GATE_HOLD_REASONS = \[/,/^] as const/{
        /^  'gate-inconsistent',$/d
      }" "$REPO_ROOT/$PROMOTION_GATE" > "$WORK/mutated"
      cp "$WORK/mutated" "$REPO_ROOT/$PROMOTION_GATE" ;;
    G2-03) remove_member "$CANARY_EMIT" PAYLOAD_BENEFITS "'rode-along'" ;;
    G2-04) remove_member "$CANARY_EMIT" PAYLOAD_STATE_VALIDITIES "'stale'" ;;
    G2-05) remove_member "$PROMOTION_GATE" GATE_INCONSISTENCY_SHAPES "'gate2-pass-gate1-heldout-fail'" ;;
    G2-06)
      sed '/^export const gate2SpendSchema = /,/^}).strict()/s/, completionTokens: count//' "$REPO_ROOT/$GATE_RECEIPT" > "$WORK/mutated"
      cp "$WORK/mutated" "$REPO_ROOT/$GATE_RECEIPT" ;;
    G2-07|G2-08) remove_member "$CLI_EMIT" NON_SIGNAL_CLASSES "'flake'" ;;
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
  local expected='TypeCheckError: Expected 1 arguments, but got 0.'
  [ "$2" != "$RECEIPT_TESTD:53:70" ] || expected="$SPEND_DIAGNOSTIC"
  awk -v pointer="$2" -v diagnostic="$expected" '
    /^TypeCheckError:/ { expected = ($0 == diagnostic) }
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
  if [ "${GATE2_MUTATION_SELFTEST:-}" != neutered ]; then
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
      red="$(grep -oE '^ FAIL  [^ ]+ \[ [^ ]+ \]|^ FAIL  [^ ]+ > .*|❯ src/[^ ]+:[0-9]+:[0-9]+' "$LOG" | sort -u)" ;;
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
    case "$id" in
      G2-02) diagnostic_digest="$HOLD_DIGEST" ;;
      G2-06) diagnostic_digest="$SPEND_DIGEST" ;;
      G2-08) diagnostic_digest="$NON_SIGNAL_DIGEST" ;;
      *) fatal "unregistered type diagnostic for $id" ;;
    esac
    set +e
    blocks="$(grep -c 'TypeCheckError' "$LOG" | tr -d '[:space:]')"
    set -e
    echo "  TypeCheckError blocks: $blocks"
    if [ "$blocks" -ne "$expected_blocks" ]; then
      cat "$LOG" >&2
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
    [ -z "$diagnostic_digest" ] || echo "  complete diagnostic sha256: $diagnostic_digest"
    if [ -n "$diagnostic_digest" ] && [ "$expected_blocks" -gt 1 ]; then
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

  # A later leg can share a subject; the instrument must be green before the next leg.
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
G01_CELL='declares exactly the twenty promotion-gate hold reasons, in declaration order'
G03_CELL='queued payload.json is governed by the closed benefit, stateValidity and outcome words, in declaration order'
G05_CELL='declares exactly the two gate-inconsistency shapes, in declaration order'
G07_CELL='declares exactly the three non-signal classes, in declaration order'
G01_TRUNCATED='declares exactly the twenty promotion-gate hold reasons'
# Whole permitted runtime RED sets measured from actual source deletions. Each required
# vocabulary cell remains mandatory; behavior collateral alone cannot certify a leg.
G03_ALLOWED='Pin 3 canary outcome payload > enqueueCanaryOutcome writes v3 payload.json with attribution authority
Pin 3 canary outcome payload > validates and content-addresses every optional attribution evidence field
Pin 3 canary outcome payload > queued payload.json is governed by the closed benefit, stateValidity and outcome words, in declaration order
Pin 3 canary outcome payload > reads a literal v2 payload through the load guard as rode-along / unknown
Pin 3 canary outcome payload > a v2 payload keeps its v2 content address after the fill
Pin 3 canary outcome payload > accepts only schema version 3 and the canary-outcome job kind
Pin 3 canary outcome payload > content-addresses deterministic fields independent of key order and wall clock'
G07_ALLOWED='SC2 — the shipped positive-on-any-anchor-match fixture earns no credit (418 D-02/D-05) > declares exactly the three non-signal classes, in declaration order
SC2 — the shipped positive-on-any-anchor-match fixture earns no credit (418 D-02/D-05) > 418 SC4 counts typed non-signal classes and keeps unknown failures visible
projectCanaryOutcomes (PROM-02/D-21) > excludes environment, timeout, and flake failures but attributes other failures
projectCanaryOutcomes planSource attribution (PROC-02/D-11/D-12) > keeps execution-failed replays behind the non-attributable classifier gate
projectCanaryOutcomes planSource attribution (PROC-02/D-11/D-12) > keeps verifier-rejected replays behind the non-attributable classifier gate
projectCanaryOutcomes planSource attribution (PROC-02/D-11/D-12) > gates failed replayed steps behind the shared root-cause classifier
projectCanaryOutcomes planSource attribution (PROC-02/D-11/D-12) > keeps the classifier gate over staleness misses on non-attributable failures
F-381-51-1 obs 3: verdict-gated positive procedure canaries (381-53) > P3: the classifier gate keeps misses silent on non-attributable failures
SC2 — the cross-run supersession differential (389-06, D-10) > the artifact supersedes the deterministic unknown and the RESOLVED class flips attribution
SC2 — the cross-run supersession differential (389-06, D-10) > SC2: two runs and a supersession — exactly ONE attributed observation per (runId, testId)
SC2 — the cross-run supersession differential (389-06, D-10) > a foreign artifact on run B'"'"'s OWN dir never flips B'"'"'s attribution (G-389-3A)'

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

  # Control 3 — the REQUIRED comparator, driven against leg G2-01's OWN cell in both directions, with
  # the exact truncation a hand reaches for. `G01_TRUNCATED` is a strict PREFIX of `G01_CELL`, so
  # under a whole-blob substring match it would report MATCHED against G2-01's real red and the leg
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
  local sc_blob="418 self-check synthetic describe > ${G01_CELL}"
  local sc_wrong=0
  if required_line_match "$G01_CELL" "$sc_blob"; then :; else sc_wrong=1; fi
  if required_line_match "$G01_TRUNCATED" "$sc_blob"; then sc_wrong=1; fi
  if [ "$sc_wrong" -ne 0 ]; then
    echo "FATAL: the REQUIRED comparator cannot tell a named cell from a truncation of it — every leg below measures less than it claims" >&2
    exit 1
  fi
  echo "  comparator: required-line-exact — G2-01's whole cell matched its own red, and the truncation '$G01_TRUNCATED' REFUSED that same red"

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

  # Control 5 — G2-02 collateral alone must never certify the intended never-bar.
  local sc_target="$PROMOTION_TESTD:14:5"
  printf '%s\n' 'TypeCheckError: source collateral' \
    ' ❯ src/__tests__/gate-receipt.test.ts:34:69' > "$sc_log"
  if testd_target_match "$sc_log" "$sc_target"; then
    fatal "the reasons never-bar accepted collateral alone"
  fi
  printf '%s\n' 'TypeCheckError: source collateral' " ❯ $sc_target" > "$sc_log"
  if testd_target_match "$sc_log" "$sc_target"; then
    fatal "the reasons never-bar accepted the wrong diagnostic at its pointer"
  fi
  printf '%s\n' 'TypeCheckError: Expected 1 arguments, but got 0.' " ❯ $sc_target" > "$sc_log"
  if ! testd_target_match "$sc_log" "$sc_target"; then
    fatal "the reasons never-bar rejected its exact diagnostic and pointer"
  fi
  local sc_spend_target="$RECEIPT_TESTD:53:70"
  printf '%s\n' 'TypeCheckError: source collateral' " ❯ $sc_spend_target" > "$sc_log"
  if testd_target_match "$sc_log" "$sc_spend_target"; then fatal "the spend pin accepted a wrong diagnostic"; fi
  printf '%s\n' "$SPEND_DIAGNOSTIC" " ❯ $sc_target" > "$sc_log"
  if testd_target_match "$sc_log" "$sc_spend_target"; then fatal "the spend pin accepted a wrong pointer"; fi
  printf '%s\n' "$SPEND_DIAGNOSTIC" " ❯ $sc_spend_target" > "$sc_log"
  if ! testd_target_match "$sc_log" "$sc_spend_target"; then fatal "the spend pin rejected its exact diagnostic"; fi
  rm -f "$sc_log"
  echo "  control: the reasons never-bar rejects collateral alone and wrong diagnostics, accepts its exact block"
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
preflight_suite "$KNOWLEDGE_FILTER" "$PAYLOAD_SUITE"
preflight_suite "$SCHEMA_FILTER" "$RECEIPT_SUITE"
preflight_suite "$SCHEMA_FILTER" "$RECEIPT_TESTD"
preflight_suite "$CLI_FILTER" "$EMIT_SUITE"
preflight_suite "$CLI_FILTER" "$EMIT_TESTD"
echo "PREFLIGHT OK ($PREFLIGHT_COUNT instruments)"
echo

run_leg G2-01 "gate-inconsistent removed from PROMOTION_GATE_HOLD_REASONS" runtime "$G01_CELL" "$G01_CELL" "$SCHEMA_FILTER" "$HOLD_SUITE" "$PROMOTION_GATE" ""
G02_CELLS="$PROMOTION_TESTD [ $PROMOTION_TESTD ]
$PROMOTION_TESTD:14:5"
run_leg G2-02 "the same removal, read by the hold-reason never-bar" testd "$G02_CELLS" "$G02_CELLS" "$SCHEMA_FILTER" "$PROMOTION_TESTD" "$PROMOTION_GATE" ""
run_leg G2-03 "rode-along removed from PAYLOAD_BENEFITS" runtime "$G03_CELL" "$G03_ALLOWED" "$KNOWLEDGE_FILTER" "$PAYLOAD_SUITE" "$CANARY_EMIT" ""
run_leg G2-04 "stale removed from PAYLOAD_STATE_VALIDITIES" runtime "$G03_CELL" "$G03_CELL" "$KNOWLEDGE_FILTER" "$PAYLOAD_SUITE" "$CANARY_EMIT" ""
run_leg G2-05 "gate2-pass-gate1-heldout-fail removed from GATE_INCONSISTENCY_SHAPES" runtime "$G05_CELL" "$G05_CELL" "$SCHEMA_FILTER" "$RECEIPT_SUITE" "$PROMOTION_GATE" ""
G06_CELLS="$RECEIPT_TESTD [ $RECEIPT_TESTD ]
$RECEIPT_TESTD:53:70"
run_leg G2-06 "completionTokens removed, read by the spend keyof pin" testd "$G06_CELLS" "$G06_CELLS" "$SCHEMA_FILTER" "$RECEIPT_TESTD" "$GATE_RECEIPT" ""
run_leg G2-07 "flake removed from NON_SIGNAL_CLASSES" runtime "$G07_CELL" "$G07_ALLOWED" "$CLI_FILTER" "$EMIT_SUITE" "$CLI_EMIT" ""
G08_CELLS="418 pins the complete non-signal vocabulary within verdict classes
$EMIT_TESTD:6:80"
run_leg G2-08 "the same removal, read by the non-signal never-bar" testd "$G08_CELLS" "$G08_CELLS" "$CLI_FILTER" "$EMIT_TESTD" "$CLI_EMIT" ""

# Pinned, not derived: silently deleting a leg must fail.
EXPECTED_LEGS=8
if [ "$LEGS_RUN" -ne "$EXPECTED_LEGS" ]; then
  fatal "leg count drifted — expected $EXPECTED_LEGS, ran $LEGS_RUN"
fi
echo "LEGS $LEGS_RUN"
echo "PASS — all eight Gate-2 deletion legs failed in their required named cells."
echo "       Every subject was restored byte-identically and each instrument returned green."
echo "       GATE2_MUTATION_SELFTEST=neutered must FATAL at G2-01."
