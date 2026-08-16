#!/usr/bin/env bash
#
# 396-resources-mutation.sh — the acceptance bar for D-13's entity Resource Templates (396-03).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `resources.test.ts` passing says the
# handler resolved a URI and registered six templates. It does NOT say those cells would CATCH the
# implementations D-13 forbids. Each leg below is a simplification a reasonable person would write:
#
#   R1  the codec replaced by a LOCAL agentqa:// regex that splits segment from id. The most natural
#       shortcut there is, and the one T-396-08 exists to forbid: a second, weaker reading of a
#       caller-supplied string, which hands `agentqa://memory/TST-001` to the op as `TST-001` and
#       answers about a test the caller never addressed.
#   R2  a seventh template planted in the derived list — the "derived, never restated" claim.
#   R3  the D-05 visibility gate removed, registering unconditionally.
#   R4  the masker severed where the card is masked (T-396-07, the success channel).
#   R5  the raw URI passed to the op as `ref` instead of the parsed canonical short-ID — the leg
#       that makes the parse LOAD-BEARING rather than a check that runs before a string is
#       forwarded untouched.
#   R6  maskText dropped from the OP-refusal path.
#   R7  maskText dropped from the URI-refusal path. THIS LEG WAS MEASURED GREEN when the suite was
#       first written: the module masks three strings and only two were pinned, and the unpinned one
#       was the only one composed ENTIRELY of caller-supplied text. The cell
#       "masks the echoed URI when the codec refuses it" exists because of this measurement.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# NO DIST REBUILD IS NEEDED, and that is a property rather than an omission: the subject and its
# suite live in the SAME package (`packages/mcp`) and vitest resolves the import from source. No leg
# crosses a package boundary, so no built artifact stands between the edit and the measurement.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND EVERY RESTORE IS PROVEN. `git checkout --` could
# not restore this file while it was still untracked, and a restore nobody checked is how a mutation
# survives into a commit — so the snapshot is a `cp` copy and sha256 is compared after each restore.
#
# THE LEG BODIES ARE TYPESCRIPT AND LIVE IN THE PYTHON BLOCK, NEVER IN A SHELL STRING. A first draft
# passed them as bash arguments; the quoting mangled `?? ''` into `?? ` and the leg then measured an
# implementation nobody wrote. Anything containing a quote is data, and data goes through the file.
#
# USAGE
#   bash agent-qa/scripts/396-resources-mutation.sh   # from the super-repository root
#   bash scripts/396-resources-mutation.sh            # from the agent-qa root
#
# KNOBS
#   RESOURCES_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green" — which is what proves this script itself can fail.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBJECT="$ROOT/packages/mcp/src/resources.ts"
SUITE="src/__tests__/resources.test.ts"
SELFTEST="${RESOURCES_MUTATION_SELFTEST:-}"

fatal() { echo "FATAL: $*" >&2; exit 1; }

# THE SNAPSHOT IS POPULATED BEFORE THE TRAP IS ARMED (2026-08-16, UAT item 3 · CR-05). The order
# used to be: `mktemp` (which creates an EMPTY file), arm `trap cleanup EXIT`, then check the
# subject and copy. `cleanup` guarded on the snapshot EXISTING, and `mktemp` had already made it —
# so any exit inside that window, including a Ctrl-C, copied a zero-byte file over `resources.ts`.
# Populating first closes the window; the `-s` guard below closes it a second, independent way.
[[ -f "$SUBJECT" ]] || fatal "subject not found: $SUBJECT"
SNAPSHOT="$(mktemp)"
cp "$SUBJECT" "$SNAPSHOT"
SNAPSHOT_READY=1

# PORTABLE, AND ATOMICALLY CREATED (2026-08-16, UAT item 3 · CR-04). This was
# `LEGS_PY="$(mktemp -t 396legs).py"`, which has two defects in one expression. `mktemp -t
# <prefix>` is a BSD idiom that GNU coreutils REFUSES ("too few X's in template"), and under
# `set -euo pipefail` the assignment aborts the script — so this harness could not run on the
# ubuntu CI runner at all. And appending `.py` names a path `mktemp` never created: the
# exclusively-created file leaked, and the `.py` path was a predictable name in a world-writable
# directory that a local attacker could pre-place as a symlink, through which this script then
# writes executable Python and runs it. A directory made with one atomic call fixes both.
# `396-conformance.sh` documents the same pitfall at its own `mktemp`; this is its form.
LEGS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/396reslegs.XXXXXXXX")"
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
    "R1": (
        "    const parsed = parseEntityUri(uri.href)\n",
        "    const match = /^agentqa:\\/\\/([a-z]+)\\/([^/]+)$/u.exec(uri.href)\n"
        "    const localSegment = match?.[1]\n"
        "    const localKind = ENTITY_KINDS.find((c) => ENTITY_URI_SEGMENTS[c] === localSegment)\n"
        "    const parsed =\n"
        "      match === null || localKind === undefined\n"
        "        ? undefined\n"
        "        : { kind: localKind, shortId: match[2] ?? '' }\n",
    ),
    "R2": (
        "  ENTITY_KINDS.map(templateFor)\n",
        "  ENTITY_KINDS.map(templateFor).concat([\n"
        "    {\n"
        "      kind: 'MEM',\n"
        "      segment: 'note',\n"
        "      name: 'agent_qa_entity_note',\n"
        "      uriTemplate: 'agentqa://note/{id}',\n"
        "      title: 'agent-qa note entity',\n"
        "      description: 'The entity card for one note.',\n"
        "    },\n"
        "  ])\n",
    ),
    "R3": (
        "  if (!visibleToCaller(declaration.requiredScopes, deps.caller.grantedScopes)) return []\n",
        "",
    ),
    # RE-ANCHORED 2026-08-16 (UAT item 1): the subject line was
    # `text: deps.maskText(JSON.stringify(card)),` — masking the ESCAPED serialisation, which is the
    # CR-01 defect. The card is now masked as a VALUE through the shared `maskJsonDocument`, so this
    # leg severs the masker where it is now passed rather than deleting a call that no longer exists.
    # Handing the helper an identity function keeps every other byte of the handler intact, so the
    # leg measures masking and nothing else.
    "R4": (
        "    const masked = maskJsonDocument(card, deps.maskText)\n",
        "    const masked = maskJsonDocument(card, (text) => text)\n",
    ),
    "R5": (
        "      card = await deps.invoke(ENTITIES_GET_OP_ID, { ref: parsed.shortId })\n",
        "      card = await deps.invoke(ENTITIES_GET_OP_ID, { ref: uri.href })\n",
    ),
    "R6": (
        "        deps.maskText(err instanceof Error ? err.message : String(err)),\n",
        "        err instanceof Error ? err.message : String(err),\n",
    ),
    "R7": (
        "      throw new EntityResourceUriError(deps.maskText(uri.href))\n",
        "      throw new EntityResourceUriError(uri.href)\n",
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
    sys.exit(f"anchor for {leg} occurs {n} times in the subject, expected exactly 1")
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

echo "396-03 resources.ts mutation legs (subject sha256 $PRISTINE_SHA)"

# R1 reds FOUR cells, and the fourth is the R7 cell: a local regex accepts
# `agentqa://memory/sk-live-SECRET` as an address and asks the op about it, so the URI the codec
# should have refused never reaches the refusal path at all. One leg, two independent claims.
run_leg R1 4
run_leg R2 4
run_leg R3 2
run_leg R4 1
run_leg R5 1
run_leg R6 1
run_leg R7 1

# THE ONE-PARSER GREP, PINNED BY INTENT RATHER THAN BY THE PLAN'S LITERAL.
#
# 396-03-PLAN.md's acceptance grep is `grep -c "new RegExp\|agentqa://" resources.ts | grep -qx '0'`.
# It cannot pass for any correct implementation — a ResourceTemplate must literally contain
# `agentqa://${segment}/{id}` — and, measured, it is worse than unsatisfiable: it returns 8 for the
# correct module AND 8 under R1, the exact second parser it claims to forbid. A check that answers
# identically on both sides of the line it draws is not a check. These three discriminate: R1 moves
# the first from 0 to 1 and the third from 1 to 0.
echo "one-parser greps:"
regexes="$(grep -cE 'new RegExp|RegExp\(|/\^agentqa|\.exec\(|\.match\(' "$SUBJECT" || true)"
handrolled="$(grep -cE '\.split\(|\.slice\(|\.substring\(|\.indexOf\(|\.startsWith\(|\.endsWith\(|\.replace' "$SUBJECT" || true)"
codec="$(grep -cE 'parseEntityUri\(' "$SUBJECT" || true)"
[[ "$regexes" == "0" ]]    || fatal "resources.ts constructs or executes a pattern of its own ($regexes)"
[[ "$handrolled" == "0" ]] || fatal "resources.ts hand-parses a string ($handrolled)"
[[ "$codec" == "1" ]]      || fatal "expected exactly one parseEntityUri call site, saw $codec"
echo "  regex construction 0 · hand-parsing 0 · parseEntityUri call sites 1"

echo "OK — seven legs red, the codec is the only parser."
