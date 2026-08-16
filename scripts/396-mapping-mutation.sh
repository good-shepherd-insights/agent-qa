#!/usr/bin/env bash
#
# 396-mapping-mutation.sh — the acceptance bar for D-04's bump guard (396-04).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `mapping-bump-guard.test.ts` passing
# says the catalogue agrees with itself today. It does NOT say the guard would CATCH the drift D-04
# exists to forbid. Each leg below is a change somebody would plausibly make and believe harmless:
#
#   M1  a thirteenth tool planted (`agent_qa_cancel_run` over the already-dispositioned `runs.get`).
#       The shape of "we needed one more verb" — and D-15's whole point is that a v1 capability with
#       no registry op behind it does not come back as an MCP-local handler.
#   M2  `agent_qa_start_run` RENAMED, adding and removing nothing. This is the leg a count-only
#       guard cannot see, and the reason D-04 forbids one by name.
#   M3  `agent_qa_show_proposal` REMAPPED onto `proposals.list`. Neither the name list nor the count
#       moves; what moves is which capability a caller reaches through that door.
#   M4  `config.get` added to the config fold WITHOUT removing it from `UNPROJECTED_OPS` — an op in
#       both sets. The partition law is the only cell that can see this, and it is exactly how an op
#       ships while the dated scoping note still says it is deferred.
#
# MEASURED 2026-08-16: M1 RED (6 cells) · M2 RED (4) · M3 RED (4) · M4 RED (5). The number worth
# reading is M2's: a pure RENAME, adding and removing nothing, reds four named cells. That is the
# case a count-only guard cannot see at all, and it is why D-04 forbids one.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# NO DIST REBUILD IS NEEDED, and that is a property rather than an omission: the subject
# (`packages/mcp/src/mapping.ts`) and its suite live in the SAME package and vitest resolves the
# import from source. The registry the suite enumerates comes from `@vostride/agent-qa-agent`, which
# no leg touches.
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
#   bash agent-qa/scripts/396-mapping-mutation.sh   # from the super-repository root
#   bash scripts/396-mapping-mutation.sh            # from the agent-qa root
#
# KNOBS
#   MAPPING_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green" — which is what proves this script itself can fail.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBJECT="$ROOT/packages/mcp/src/mapping.ts"
SUITE="src/__tests__/mapping-bump-guard.test.ts"
SELFTEST="${MAPPING_MUTATION_SELFTEST:-}"

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
# `LEGS_PY="$(mktemp -t 396maplegs).py"`, which has two defects in one expression. `mktemp -t
# <prefix>` is a BSD idiom that GNU coreutils REFUSES ("too few X's in template"), and under
# `set -euo pipefail` the assignment aborts the script — so this harness could not run on the
# ubuntu CI runner at all. And appending `.py` names a path `mktemp` never created: the
# exclusively-created file leaked, and the `.py` path was a predictable name in a world-writable
# directory that a local attacker could pre-place as a symlink, through which this script then
# writes executable Python and runs it. A directory made with one atomic call fixes both.
# `396-conformance.sh` documents the same pitfall at its own `mktemp`; this is its form.
LEGS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/396maplegs.XXXXXXXX")"
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
    # A thirteenth tool, over an op the scoping note has already dispositioned.
    "M1": (
        "  Object.freeze({\n"
        "    name: 'agent_qa_list_runs',\n",
        "  Object.freeze({\n"
        "    name: 'agent_qa_cancel_run',\n"
        "    ops: Object.freeze(['runs.get']),\n"
        "    kind: 'read',\n"
        "  }),\n"
        "  Object.freeze({\n"
        "    name: 'agent_qa_list_runs',\n",
    ),
    # A rename and nothing else: the leg a count cannot see.
    "M2": (
        "    name: 'agent_qa_start_run',\n",
        "    name: 'agent_qa_begin_run',\n",
    ),
    # A remap: same name, same count, different capability behind the door.
    "M3": (
        "    name: 'agent_qa_show_proposal',\n"
        "    ops: Object.freeze(['proposals.show']),\n",
        "    name: 'agent_qa_show_proposal',\n"
        "    ops: Object.freeze(['proposals.list']),\n",
    ),
    # An op in BOTH sets — shipped by a tool while the dated note still defers it.
    "M4": (
        "      'config.undo.propose',\n"
        "    ]),\n",
        "      'config.undo.propose',\n"
        "      'config.get',\n"
        "    ]),\n",
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

echo "396-04 mapping.ts bump-guard mutation legs (subject sha256 $PRISTINE_SHA)"

run_leg M1 "${M1_REDS:-6}"
run_leg M2 "${M2_REDS:-4}"
run_leg M3 "${M3_REDS:-4}"
run_leg M4 "${M4_REDS:-5}"

# THE PROHIBITION GREPS, EACH ONE MEASURED ON BOTH SIDES OF THE LINE IT DRAWS.
#
# 396-03 measured that a grep answering identically on both sides of its own line is not a check, so
# none of these counts import LINES: they count CALL SITES and symbol occurrences, which is what
# moves when the behaviour moves. The column headings say what each one reads under the drift it
# forbids; `deleting the call` is the mutation, and it is the honest one to check because an import
# left behind by a deleted call is precisely the residue that makes an import-count grep pass.
echo "wiring greps (catalog.ts):"
CATALOG="$ROOT/packages/mcp/src/catalog.ts"
apply_calls="$(grep -c 'createApplyToolHandler(' "$CATALOG" || true)"
resource_calls="$(grep -c 'registerEntityResources(' "$CATALOG" || true)"
prompts="$(grep -c 'registerPrompt' "$CATALOG" || true)"
task_seam="$(grep -cE '^import .*task-seam' "$CATALOG" || true)"
[[ "$apply_calls" == "1" ]]    || fatal "expected exactly one createApplyToolHandler call site, saw $apply_calls"
[[ "$resource_calls" == "1" ]] || fatal "expected exactly one registerEntityResources call site, saw $resource_calls"
[[ "$prompts" == "0" ]]        || fatal "catalog.ts names the prompt registration verb ($prompts) — D-14"
[[ "$task_seam" == "0" ]]      || fatal "catalog.ts imports the task seam ($task_seam) — MCPS-06/D-12"
echo "  apply primitive 1 · resources 1 · prompts 0 · task-seam imports 0"

echo "OK — four legs red, the wiring greps discriminate."
