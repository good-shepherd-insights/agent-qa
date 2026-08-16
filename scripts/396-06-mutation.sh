#!/usr/bin/env bash
#
# 396-06-mutation.sh — the acceptance bar for MCPS-03 at the wire (396-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `mcp-apply-differential.test.ts`
# passing says the write path agrees with itself today. The claims it carries are NEGATIVE ones —
# nothing commits unconfirmed, a replay commits nothing further, a caller that cannot answer a form
# is never sent one — and a negative claim is the easiest kind to fake: it passes over a door that
# never opens, over a gate nobody reaches, and over a repository nothing writes to. So each leg
# below removes one mechanism and requires that the cells aimed at THAT mechanism go red.
#
# THE LEGS
#
#   A1  the refusal branch severed: an unconfirmed first call applies directly. This is plan 02's
#       mutation M2 restated at the WIRE, which is the only place it can be measured as a COMMIT in
#       a person's repository rather than as a call count against a double.
#   A2  `args.confirmed === true` widened to `if (args.confirmed)` — plan 02's M1. Its expected
#       result here is ZERO reds, and that is a MEASUREMENT rather than a failure: at the wire the
#       SDK validates the call against the advertised `inputSchema` before the handler runs, so the
#       string `'true'` — the only input that distinguishes a boolean gate from a truthiness gate —
#       cannot reach the handler at all. The leg therefore requires the HERMETIC suite to red in the
#       same run, which is where that wall is reachable. Recorded rather than dropped, because "this
#       suite cannot see that mutation" is a fact about this suite that a reader must be told.
#   A3  the capability check inverted so the `input_required` form is attached to EVERY refusal —
#       i.e. the behaviour that shipped before this plan measured it. The SDK then replaces the whole
#       result with a capability error on a 2025-era connection, and fails the call with `-32021` on
#       a 2026-era connection whose client did not declare `elicitation`. Group 6 must red.
#   A4  the structured refusal deleted, leaving `content` alone. The advertised `outputSchema` then
#       has nothing to validate and the SDK refuses to serve the result at all — the leg that shows
#       why the refusal needed an arm of its own on the output side.
#
# A GREEN SUITE UNDER A1, A3 OR A4 IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# DIST REBUILDS ARE MANDATORY AND ARE PERFORMED HERE. `packages/cli`'s vitest config declares no
# aliases, so its import of `@vostride/agent-qa-mcp` resolves through that package's BUILT `dist`. A
# leg that edited the source and skipped the build would measure the previous implementation and
# report a confident green — the stale-dist trap, which is exactly how a mutation harness lies.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND EVERY RESTORE IS PROVEN by sha256, because a
# restore nobody checked is how a mutation survives into a commit.
#
# THE LEG BODIES ARE TYPESCRIPT AND LIVE IN THE PYTHON BLOCK, NEVER IN A SHELL STRING — 396-03's
# harness learned that the hard way: shell quoting mangled `?? ''` into `?? ` and the leg then
# measured an implementation nobody wrote. Anything containing a quote is data, and data goes
# through the file.
#
# USAGE
#   bash agent-qa/scripts/396-06-mutation.sh   # from the super-repository root
#   bash scripts/396-06-mutation.sh            # from the agent-qa root
#
# KNOBS
#   APPLY_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL — which is what
#       proves this script itself can fail.
#   SHOW_REDS=1
#       print the name of every cell that red under each leg. The SUMMARY quotes this output rather
#       than a hand-transcribed scrollback.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIRE_SUITE="src/__tests__/mcp-apply-differential.test.ts"
UNIT_SUITE="src/__tests__/apply-refusal.test.ts"
SUBJECT="$ROOT/packages/mcp/src/apply-refusal.ts"
SELFTEST="${APPLY_MUTATION_SELFTEST:-}"

# Case lookups rather than associative arrays: macOS ships bash 3.2, where `declare -A` silently
# becomes an indexed array and every named key reads as an unbound variable under `set -u`. A
# harness that dies on the operator's default shell is a harness nobody runs.

# How many cells of the WIRE suite this leg must red. `0` means the leg is deliberately invisible
# there and the hermetic suite carries the bar instead (see A2).
wire_reds_of() {
  case "$1" in
    A1) echo "${A1_REDS:-7}" ;;
    A2) echo "${A2_REDS:-0}" ;;
    A3) echo "${A3_REDS:-5}" ;;
    A4) echo "${A4_REDS:-5}" ;;
    *) return 1 ;;
  esac
}

# Must the HERMETIC suite red under this leg? `yes` for the leg the wire cannot see.
unit_must_red_of() {
  case "$1" in
    A2) echo "yes" ;;
    *) echo "" ;;
  esac
}

fatal() { echo "FATAL: $*" >&2; exit 1; }

SNAP_DIR="$(mktemp -d)"
cp "$SUBJECT" "$SNAP_DIR/subject"
# THE LEGS SCRIPT LIVES INSIDE THE SNAPSHOT DIRECTORY (2026-08-16, UAT item 3 · CR-04). This was
# `LEGS_PY="$(mktemp -t 396applylegs).py"` at the top of the file, which has two defects in one
# expression. `mktemp -t <prefix>` is a BSD idiom that GNU coreutils REFUSES ("too few X's in
# template"), and under `set -euo pipefail` the assignment aborts the script — so this harness
# could not run on the ubuntu CI runner at all. And appending `.py` names a path `mktemp` never
# created: the exclusively-created file leaked, and the `.py` path was a predictable name in a
# world-writable directory that a local attacker could pre-place as a symlink, through which this
# script then writes executable Python and runs it. The directory above is made by ONE atomic
# `mktemp -d`, is already removed by the cleanup below, and holds the snapshots — so putting the
# generated script in it fixes both defects and adds no second thing to clean up.
LEGS_PY="$SNAP_DIR/legs.py"

shasum -a 256 "$SNAP_DIR/subject" | cut -d' ' -f1 > "$SNAP_DIR/subject.sha"

rebuild() {
  (cd "$ROOT" && pnpm --filter @vostride/agent-qa-mcp build >/dev/null 2>&1)
}

restore() {
  local now
  cp "$SNAP_DIR/subject" "$SUBJECT"
  now="$(shasum -a 256 "$SUBJECT" | cut -d' ' -f1)"
  [[ "$now" == "$(cat "$SNAP_DIR/subject.sha")" ]] \
    || fatal "restore did not reproduce the subject byte-identically"
  rebuild || fatal "rebuild after restore failed"
}

cleanup() {
  [[ -f "$SNAP_DIR/subject" ]] && cp "$SNAP_DIR/subject" "$SUBJECT"
  rm -rf "$SNAP_DIR"
}
trap cleanup EXIT

cat > "$LEGS_PY" <<'PYLEGS'
import re
import sys

LEGS = {
    # The refusal branch severed: the first, unconfirmed call applies. Everything above it is left
    # in place, which is the honest shape of this mistake — somebody removes the "extra" round trip.
    "A1": (
        "    return refuse(proposalId, mismatch, clientCanAnswerAForm(ctx))\n",
        "    return apply(proposalId)\n",
    ),
    # The strict boolean gate widened to a truthiness gate.
    "A2": (
        "    if (args.confirmed === true) return apply(proposalId)\n",
        "    if (args.confirmed) return apply(proposalId)\n",
    ),
    # The capability check inverted: the form is attached to every refusal, on every connection.
    # This is the behaviour that shipped before 396-06 measured what the SDK does with it.
    "A3": (
        "  if (typeof declared !== 'object' || declared === null) return false\n"
        "  return (declared as { elicitation?: unknown }).elicitation !== undefined\n",
        "  return declared === declared\n",
    ),
}

# A4 IS ANCHORED AS A REGION, NOT AS BYTES — and that is a repair, dated 2026-08-16 (CR-04 review,
# UAT item 2). This leg used to spell its anchor as the seven literal lines of the object literal,
# including `proposal_id: proposalId,`. Commit 13b584d7 masked that field and wrote a six-line
# comment INSIDE the literal, so the anchor stopped occurring at all: the leg `sys.exit`ed, the
# shell turned that into `fatal`, and the script exited 1 on A4 every run from that commit onward.
# The `A4 RED(5)` figure in 396-06-SUMMARY.md was measured before it and did not reproduce.
#
# The lesson is the anchor's SHAPE, not the one edit that broke it: an anchor that quotes prose is
# invalidated by editing prose, which is the one thing this repository does constantly. The region
# below is delimited by the object's own opening and closing lines, so any body — fields, comments,
# masking calls — is deleted whole and no comment edit can silence the leg.
REGION_LEGS = {
    # The structured refusal deleted. `content` still carries the whole teach, so a reader would
    # call this a tidy-up — and the advertised outputSchema then has nothing to validate.
    "A4": (
        re.compile(r"\n      structuredContent: \{\n.*?\n      \},\n", re.DOTALL),
        "\n",
    ),
}


def mutate(leg, src, neutered):
    """Return the mutated source, or exit naming the drift. Never silently edits nothing."""
    if leg in REGION_LEGS:
        pattern, replacement = REGION_LEGS[leg]
        found = pattern.findall(src)
        if len(found) != 1:
            sys.exit("anchor for %s matches %d regions in the subject, expected exactly 1"
                     % (leg, len(found)))
        if neutered:
            return src
        return pattern.sub(lambda _match: replacement, src, count=1)

    anchor, replacement = LEGS[leg]
    if neutered:
        replacement = anchor
    # An anchor that no longer occurs exactly once FATALs rather than silently mutating nothing: a
    # leg that edited no bytes and then saw a green suite would read as a passing measurement.
    n = src.count(anchor)
    if n != 1:
        sys.exit("anchor for %s occurs %d times in the subject, expected exactly 1" % (leg, n))
    return src.replace(anchor, replacement)


# `--check <leg> <snapshot>` resolves the anchor and writes nothing. The pre-flight below runs it
# for every leg BEFORE any mutation, so anchor rot reds at the top of the run rather than three legs
# in — which is how CR-04 stayed invisible: A1..A3 passed and the script died on the fourth.
if sys.argv[1] == "--check":
    mutate(sys.argv[2], open(sys.argv[3]).read(), False)
    sys.exit(0)

leg, snapshot, subject, neutered = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "neutered"
open(subject, "w").write(mutate(leg, open(snapshot).read(), neutered))
PYLEGS

run_wire() {
  local out status
  out="$(cd "$ROOT/packages/cli" && npx vitest run "$WIRE_SUITE" --typecheck.enabled=false 2>&1)" \
    && status=0 || status=$?
  SUITE_OUT="$out"
  SUITE_STATUS="$status"
}

run_unit() {
  local out status
  out="$(cd "$ROOT/packages/mcp" && npx vitest run "$UNIT_SUITE" 2>&1)" && status=0 || status=$?
  UNIT_OUT="$out"
  UNIT_STATUS="$status"
}

run_leg() {
  local leg="$1" want reds unit_red
  want="$(wire_reds_of "$leg")"
  unit_red="$(unit_must_red_of "$leg")"

  python3 "$LEGS_PY" "$leg" "$SNAP_DIR/subject" "$SUBJECT" "$SELFTEST" || fatal "$leg: anchor drift"
  rebuild || { restore; fatal "$leg: rebuild under the mutation failed"; }

  run_wire
  reds="$(printf '%s\n' "$SUITE_OUT" | grep -c '^ FAIL ' || true)"

  if [[ "$want" == "0" ]]; then
    if [[ $SUITE_STATUS -ne 0 ]]; then
      restore
      fatal "$leg: the wire suite red ($reds), but this leg is recorded as invisible there"
    fi
  else
    if [[ $SUITE_STATUS -eq 0 ]]; then
      restore
      fatal "$leg: the wire suite stayed green — the cells aimed at it are decoration"
    fi
    [[ "$reds" == "$want" ]] \
      || { restore; fatal "$leg: expected $want failing wire cell(s), saw $reds"; }
  fi

  if [[ -n "${SHOW_REDS:-}" && "$reds" != "0" ]]; then
    printf '%s\n' "$SUITE_OUT" | grep -E '^ FAIL |^AssertionError|^ProtocolError' | sed "s/^/    $leg| /"
  fi

  if [[ -n "$unit_red" ]]; then
    run_unit
    if [[ $UNIT_STATUS -eq 0 ]]; then
      restore
      fatal "$leg: the hermetic suite stayed green too — nothing anywhere bars this mutation"
    fi
    local ureds
    ureds="$(printf '%s\n' "$UNIT_OUT" | grep -c '^ FAIL ' || true)"
    if [[ -n "${SHOW_REDS:-}" ]]; then
      printf '%s\n' "$UNIT_OUT" | grep -E '^ FAIL |^AssertionError' | sed "s/^/    $leg| unit: /"
    fi
    echo "  $leg wire GREEN by design (0) · hermetic RED ($ureds cell(s))"
  else
    echo "  $leg wire RED ($reds failing cell(s))"
  fi

  restore
}

echo "396-06 MCPS-03 apply-path mutation legs"

# PRE-FLIGHT: every leg's anchor must resolve before any leg runs (2026-08-16, UAT item 2).
# An anchor that stops matching is the same failure as a grep that cannot see what it forbids, and
# it is silent in exactly the way that matters: the legs before it still pass and the run still
# prints their numbers. Resolving all four first makes anchor rot the FIRST thing the run says.
for leg in A1 A2 A3 A4; do
  python3 "$LEGS_PY" --check "$leg" "$SNAP_DIR/subject" \
    || fatal "$leg: anchor drift (pre-flight) — the leg cannot be applied to the live subject"
done
echo "  pre-flight: A1 A2 A3 A4 anchors each resolve exactly once"

# APPLY_MUTATION_LEGS selects which legs run. The default is all four; the knob exists so the
# `neutered` self-test can be pointed at ONE leg. Without it the self-test can only ever prove that
# the FIRST leg fatals when it edits nothing, which is the same "measures one thing" trap the legs
# themselves are here to catch (2026-08-16, UAT item 2).
for leg in ${APPLY_MUTATION_LEGS:-A1 A2 A3 A4}; do
  run_leg "$leg"
done

# THE WIRING GREPS, EACH MEASURED ON BOTH SIDES OF THE LINE IT DRAWS.
#
# None of these counts an IMPORT LINE. 396-04 measured that an import left behind by a deleted call
# makes an import-count grep answer identically on both sides of its own line, and a check that
# cannot tell "wired" from "unwired" is not a check.
echo "wiring greps:"
MAPPING="$ROOT/packages/mcp/src/mapping.ts"

form_gate="$(grep -c 'clientCanAnswerAForm(ctx)' "$SUBJECT" || true)"
strict_gate="$(grep -c 'args.confirmed === true' "$SUBJECT" || true)"
composed_output="$(grep -c 'composeApplyToolOutput(' "$MAPPING" || true)"
accept_verb="$(grep -c 'proposals.accept' "$SUBJECT" || true)"

[[ "$form_gate" == "1" ]] \
  || fatal "expected exactly one capability-gated refusal call site, saw $form_gate"
[[ "$strict_gate" == "1" ]] \
  || fatal "the confirmation gate is no longer a strict boolean identity ($strict_gate)"
[[ "$composed_output" == "2" ]] \
  || fatal "expected both apply doors to advertise the composed output union, saw $composed_output"
[[ "$accept_verb" == "0" ]] \
  || fatal "the human-origin accept verb is named in the apply module ($accept_verb) — T-396-06"

echo "  form-gate 1 · strict-gate 1 · composed-output 2 · human-origin-accept 0"

echo "OK — every leg measured, and the one the wire cannot see says so."
