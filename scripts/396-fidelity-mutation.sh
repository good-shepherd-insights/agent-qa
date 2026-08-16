#!/usr/bin/env bash
#
# 396-fidelity-mutation.sh — the acceptance bar for D-16's projection cells (396-04).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `projection-fidelity.test.ts` passing
# says the advertised documents agree with the function layer's own projections today. Drift is
# IMPOSSIBLE for the reason D-16 says — the advertised schema and the validated schema are one
# object — so the only place drift can actually enter is the JOIN: `mapping.ts` naming the wrong
# contract for an op. Every leg below is exactly that, and each one is a mistake a person makes
# while editing a table of forty lines that all look alike.
#
#   P1  `runs.digest`'s contract entry re-pointed at the proposals-list contracts. A copy-paste of
#       the row above it; nothing throws, nothing typechecks differently, and `agent_qa_get_run_digest`
#       starts advertising the inbox's shape while validating a digest.
#   P2  the pipeline's advertised input swapped for its SECOND arm. `entities.get` takes a `ref` and
#       so does `entities.resolve`, so the wrong one is a plausible pick — and it advertises the
#       exact-address contract for a door whose whole purpose is accepting inexact references.
#   P3  `agent_qa_start_run` removed from `DEGRADED_OUTPUT_CONTRACTS`. Not a schema change at all:
#       a list somebody tidied. The build refuses, which is the point — left to the SDK the same
#       contract throws INSIDE `tools/list` and takes the entire listing down for every caller.
#   P4  the config fold's advertised input swapped for the knowledge fold's. The seven-arm document
#       becomes a three-arm one; the mapping still declares seven ops.
#
# MEASURED 2026-08-16: P1 RED (1 cell) · P2 RED (1) · P3 RED (8) · P4 RED (2).
#
# P2 IS THE ONE TO READ, AND IT WAS FIRST MEASURED GREEN. `entities.resolve` and `entities.get`
# both take `{ ref: string }`, so swapping one advertised contract for the other changes no
# document at all — the drift cell, which compares DOCUMENTS, could not see a tool advertising one
# object while `invokeFunction` validated with another. The identity cell
# ("advertises the op's OWN contract object, not one that merely agrees with it") exists because
# of that measurement, and it is what makes this leg red.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE SUBJECT IS IN-PACKAGE, SO NO DIST REBUILD STANDS BETWEEN AN EDIT AND ITS MEASUREMENT — and
# that is load-bearing here rather than incidental. `packages/mcp` has no vitest config, so its
# imports of `@vostride/agent-qa-schema` and `@vostride/agent-qa-agent` resolve through those
# packages' BUILT `dist`. A leg that edited either of them would measure the last build. Every leg
# below edits `packages/mcp/src/mapping.ts`, which vitest resolves from source.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. THE SUBJECT IS RESTORED FROM A BYTE
# SNAPSHOT AND EVERY RESTORE IS PROVEN BY SHA-256. THE LEG BODIES LIVE IN THE PYTHON BLOCK, NEVER IN
# A SHELL STRING (396-03's harness measured what shell quoting does to a TypeScript fragment).
#
# USAGE
#   bash agent-qa/scripts/396-fidelity-mutation.sh   # from the super-repository root
#   bash scripts/396-fidelity-mutation.sh            # from the agent-qa root
#
# KNOBS
#   FIDELITY_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green" — which is what proves this script itself can fail.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBJECT="$ROOT/packages/mcp/src/mapping.ts"
SUITE="src/__tests__/projection-fidelity.test.ts"
SELFTEST="${FIDELITY_MUTATION_SELFTEST:-}"

fatal() { echo "FATAL: $*" >&2; exit 1; }

# THE SNAPSHOT IS POPULATED BEFORE THE TRAP IS ARMED (2026-08-16, UAT item 3 · CR-05). The order
# used to be: `mktemp` (which creates an EMPTY file), arm `trap cleanup EXIT`, then check the
# subject and copy. `cleanup` guarded on the snapshot EXISTING, and `mktemp` had already made it —
# so any exit inside that window, including a Ctrl-C, copied a zero-byte file over `mapping.ts`.
# Populating first closes the window; the `-s` guard below closes it a second, independent way.
[[ -f "$SUBJECT" ]] || fatal "subject not found: $SUBJECT"
SNAPSHOT="$(mktemp)"
cp "$SUBJECT" "$SNAPSHOT"
SNAPSHOT_READY=1

# PORTABLE, AND ATOMICALLY CREATED (2026-08-16, UAT item 3 · CR-04). This was
# `LEGS_PY="$(mktemp -t 396fidlegs).py"`, which has two defects in one expression. `mktemp -t
# <prefix>` is a BSD idiom that GNU coreutils REFUSES ("too few X's in template"), and under
# `set -euo pipefail` the assignment aborts the script — so this harness could not run on the
# ubuntu CI runner at all. And appending `.py` names a path `mktemp` never created: the
# exclusively-created file leaked, and the `.py` path was a predictable name in a world-writable
# directory that a local attacker could pre-place as a symlink, through which this script then
# writes executable Python and runs it. A directory made with one atomic call fixes both.
# `396-conformance.sh` documents the same pitfall at its own `mktemp`; this is its form.
LEGS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/396fidlegs.XXXXXXXX")"
LEGS_PY="$LEGS_DIR/legs.py"

cleanup() {
  # NON-EMPTY, not merely present: an empty snapshot is a snapshot that was never taken, and
  # copying it over the subject is the truncation this ordering exists to prevent.
  if [[ "${SNAPSHOT_READY:-0}" == "1" && -s "$SNAPSHOT" ]]; then cp "$SNAPSHOT" "$SUBJECT"; fi
  rm -f "$SNAPSHOT"
  rm -rf "$LEGS_DIR"
}
trap cleanup EXIT

PRISTINE_SHA="$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)"

cat > "$LEGS_PY" <<'PYLEGS'
import sys

LEGS = {
    # The join, mis-made: a tool advertising one capability's shape and validating another's.
    "P1": (
        "  'runs.digest': Object.freeze({\n"
        "    input: RunsDigestInputSchema,\n"
        "    output: RunDigestSchema,\n"
        "  }),\n",
        "  'runs.digest': Object.freeze({\n"
        "    input: ProposalsListInputSchema,\n"
        "    output: ProposalsListOutputSchema,\n"
        "  }),\n",
    ),
    # The pipeline advertising its second arm instead of its first.
    "P2": (
        "  agent_qa_get_entity: Object.freeze({\n"
        "    input: EntitiesResolveInputSchema,\n",
        "  agent_qa_get_entity: Object.freeze({\n"
        "    input: EntitiesGetInputSchema,\n",
    ),
    # A tidied list: the degradation entry removed while the contract is still unrepresentable.
    "P3": (
        "  Object.freeze({\n"
        "    tool: 'agent_qa_start_run',\n"
        "    opId: 'runs.start',\n"
        "    schema: 'RunStartAcknowledgementSchema',\n"
        "    measured: 'Transforms cannot be represented in JSON Schema',\n"
        "    adjudication: '397',\n"
        "  }),\n",
        "",
    ),
    # One fold's document advertised for another's arms.
    "P4": (
        "  agent_qa_propose_config_change: Object.freeze({\n"
        "    input: ConfigChangeFoldInputSchema,\n",
        "  agent_qa_propose_config_change: Object.freeze({\n"
        "    input: KnowledgeChangeFoldInputSchema,\n",
    ),
}

leg, snapshot, subject, neutered = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "neutered"
anchor, replacement = LEGS[leg]
if neutered:
    replacement = anchor
src = open(snapshot).read()
# An anchor that no longer occurs exactly once FATALs rather than silently mutating nothing: a leg
# that edited no bytes and then saw a green suite would read as a passing measurement.
n = src.count(anchor)
if n != 1:
    sys.exit("anchor for %s occurs %d times in the subject, expected exactly 1" % (leg, n))
open(subject, "w").write(src.replace(anchor, replacement))
PYLEGS

restore() {
  cp "$SNAPSHOT" "$SUBJECT"
  local now
  now="$(shasum -a 256 "$SUBJECT" | cut -d' ' -f1)"
  [[ "$now" == "$PRISTINE_SHA" ]] || fatal "restore did not reproduce the subject byte-identically"
}

run_leg() {
  local leg="$1" want_reds="$2" out status reds
  python3 "$LEGS_PY" "$leg" "$SNAPSHOT" "$SUBJECT" "$SELFTEST" || fatal "$leg: anchor drift"
  out="$(cd "$ROOT/packages/mcp" && npx vitest run "$SUITE" 2>&1)" && status=0 || status=$?
  restore
  if [[ $status -eq 0 ]]; then
    fatal "$leg: the suite stayed green under the mutation — the cells aimed at it are decoration"
  fi
  reds="$(printf '%s\n' "$out" | grep -c '^ FAIL ' || true)"
  [[ "$reds" == "$want_reds" ]] || fatal "$leg: expected $want_reds failing cell(s), saw $reds"
  echo "  $leg RED ($reds failing cell(s))"
}

echo "396-04 projection-fidelity mutation legs (subject sha256 $PRISTINE_SHA)"

run_leg P1 "${P1_REDS:-1}"
run_leg P2 "${P2_REDS:-1}"
run_leg P3 "${P3_REDS:-8}"
run_leg P4 "${P4_REDS:-2}"

echo "OK — four legs red, the join is pinned."
