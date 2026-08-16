#!/usr/bin/env bash
#
# 397-parity-mutation.sh — the acceptance bar for the conformance & parity suite (Phase 397, FUNC-06,
# D-13/D-14).
#
# WHAT THIS PROVES, AND WHY 81 GREEN CELLS DO NOT PROVE IT. `packages/cli/src/__tests__/conformance/`
# passing says that, on this tree, the two shipped surfaces enumerate the registry and nothing else,
# every capability carries a scenario row, and every refusal is two walls. It does NOT say the suite
# would CATCH the two implementations the milestone thesis forbids. Those two are the phase's whole
# subject and each of them reads as something a reasonable person would commit:
#
#   A1  A CAPABILITY OUTSIDE THE CATALOGUE, on MCP. A live `server.registerTool` added at the bottom
#       of `catalog.ts`, after the loop that walks the declared mapping. This is the natural way to
#       add "just one convenience tool" — the mapping table is data in another file, and nothing in
#       the shipped build makes you touch it. The shipped `mapping-bump-guard` cannot see this: it
#       pins the CONTENTS of `mapping.ts`, which the edit never opens. Planting the tool INSIDE
#       `mapping.ts` instead would be catalogued, would trip that guard, and would prove nothing
#       about this suite.
#
#   A2  A CAPABILITY OUTSIDE THE CATALOGUE, on chat. One row of the deterministic resolver table
#       repointed at a LITERAL function id no registry op declares. `resolver-table.ts`'s header
#       states 387 D-11's rule — every function id is IMPORTED from the module that declares it, so
#       an op renamed at its declaration breaks this file's compile. A literal is exactly how that
#       compile pin is defeated: the file still builds, the alias still resolves, and it resolves to
#       a handler nothing registers. D-03's RUNTIME membership check is the only thing left, which
#       is why D-03 exists and why this leg is the one that measures it.
#
#   B   A CAPABILITY OUTSIDE THE GATE — the v1 server's dashboard-HTTP private channel, re-created
#       deliberately. ONE op id special-cased in the chat turn engine's dispatch loop, answered from
#       inside `packages/agent` instead of through the `ChatInvokeBinding` the composition root
#       supplies. `invokeFunction` is never called, so no scope is checked, no ask is resolved, no
#       session pin is consulted and no audit row is written — and the shipped types are all still
#       satisfied. This is the class the whole "no private powers" claim is about.
#
#   C   A CAPABILITY WITH NO SCENARIO ROW — SC-4's own rule, measured rather than assumed. One row
#       deleted from the typed scenario table, which is the state a repository is in the moment a
#       new op ships and nobody adds a row for it. D-15 says SC-4's CI rule IS the census-equality
#       leg running inside `turbo run test`, and a rule nobody has seen fire is a comment. This leg
#       is here because the run MEASURED that D-14's expectation about A1/A2 was wrong: a
#       SURFACE-side stray touches neither the registry nor the table, so it cannot red the census,
#       and the census red SC-4 rests on had to be produced by the shape the census is about.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a cell
# outside the leg's allowed list, and so is an allowed cell that stayed green. Discrimination is
# enforced in BOTH directions (D-13) and no leg is ever widened to accept any-red.
#
# WHAT "FAITHFUL" MEANS HERE, AND WHY IT IS THE STANDING BAR. A detector's bar is the implementation
# it must go RED on, never the suite it passes. Twice in this project a cell was green under the very
# implementation the frozen item forbade. So each leg below is an edit a careless commit could
# plausibly produce, that compiles, that builds, and that reaches the detector. An edit which reds
# because it tripped schema validation or a type error BEFORE reaching the detector proves nothing;
# if a leg ever degenerates into that, it must be recorded as UNFAITHFUL and rewritten, never counted.
#
# WHAT THIS SCRIPT'S DISCRIMINATION IS, STATED PLAINLY SO IT IS NOT OVERSOLD. The allowed lists are
# EXACT FULL TEST NAMES, not patterns — a pattern is a hole that widens on its own. The scope of the
# claim is the conformance directory: each leg asserts that within `src/__tests__/conformance/` the
# set of failing cells EQUALS its allowed list. Other suites in the workspace (the shipped
# `packages/agent` and `packages/mcp` tests) are a separate net and are deliberately not measured
# here, because the artifact on trial is this phase's suite. A leg saying nothing about those suites
# is a scoping statement, not a claim that they are silent.
#
# WHAT THIS SCRIPT CANNOT CATCH. The strays it plants are named by constants below, and the suite's
# own deliberate control fixtures are named beside them so the two can never be confused. That
# distinction is a list of known names — which means this script can only tell ITS strays from the
# suite's OWN strays. It cannot tell a third party's stray from either, and no amount of adding
# names to the list would change that: a rule that can only refuse what it can NAME cannot be driven
# to zero by naming more things. What actually carries the weight is the suite's structural
# assertions (registry membership, mapping membership, gate audit attribution), which name nothing.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# CLASSIFICATION IS OFF VITEST'S JSON REPORT, never off scraped console lines. The report carries
# each cell's exact `fullName` and status, so an exact set comparison is possible in both directions;
# a scraped ` FAIL ` line loses the describe prefix and truncates long names.
#
# SUBJECTS ARE RESTORED FROM `cp` BYTE SNAPSHOTS, COMPARED BY sha256. `git checkout --` cannot
# restore an uncommitted edit, and a restore nobody verified is a hope.
#
# THE REBUILD IS BAKED IN AND PROVEN. `packages/cli`'s tests resolve `agent`, `agent-local`, `mcp`
# and `schema` through their BUILT dists, and the two built-binary anchors spawn `cli/dist/cli.js`.
# A mutation applied to a source file and measured through another package's suite is VACUOUS
# without a rebuild, and a rebuild that silently failed is the same thing wearing a passing build
# log. Every leg therefore carries a unique MARKER — as CODE, never as a comment, because
# `packages/agent`'s bundler strips comments from its dist (measured in 395-04, where a comment
# marker came back 0 on a rebuild that had actually taken) — and greps the built artifact for it
# before believing a single test result. After each restore the same grep must come back 0.
#
# CACHE-DEFEATING BY CONSTRUCTION. Every suite run below is `npx vitest run` from `packages/cli`,
# which never consults turbo's cache. A bare `pnpm test` can return a FULL TURBO replay and report
# green without running anything; no result in this script comes from one. The rebuilds are
# per-package `pnpm --filter <pkg> build`, which runs tsup directly for the same reason.
#
# NOTHING IS COMMITTED DURING AN APPLY CYCLE, and the script refuses to start on a dirty tree — so a
# mutation cannot be mistaken for work in progress and cannot ride into a commit.
#
# USAGE
#   bash agent-qa/scripts/397-parity-mutation.sh   # from the super-repository root
#   bash scripts/397-parity-mutation.sh            # from the agent-qa root
#
# KNOBS
#   SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "an allowed
#       cell did not red" and exit 1 — which is what proves this script itself can fail, and that a
#       PASS above is not something it prints unconditionally.
#   PARITY_MUTATION_NO_BUILD=1
#       INTERNAL, iteration only. Skips the rebuilds. Never use it for a result that is evidence.
#
# Case lookups and plain functions rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as unbound under `set -u`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
SUITE_REL="src/__tests__/conformance/"
SCRIPT_REL="scripts/397-parity-mutation.sh"

cd "$ROOT"

# ── The subjects ────────────────────────────────────────────────────────────────────────────────
SUBJECT_A1="packages/mcp/src/catalog.ts"
SUBJECT_A2="packages/agent/src/chat/resolver-table.ts"
SUBJECT_B="packages/agent/src/chat/turn-engine.ts"
SUBJECT_C="packages/cli/src/__tests__/conformance/scenario-table.ts"

DIST_MCP="packages/mcp/dist/index.js"
DIST_AGENT="packages/agent/dist/index.js"

# ── The markers. CODE in every case — a string literal the bundler must carry. ──────────────────
MARKER_A1="agent_qa_mutation_397_09_uncatalogued"
MARKER_A2="runs.private.397.09"
MARKER_B="MUTATION_397_09_LEG_B_UNGATED"

# ── The suite's OWN deliberate control fixtures. Named here so this script's strays can never be
# confused with them, and so a leg that reds only a control cell is visible as the wrong leg.
#
# DERIVED, NOT REMEMBERED. This is the complete set as of 2026-08-16, read off the conformance
# directory rather than copied from the plans that planted them:
#
#   grep -rhoE "'[a-z0-9_.-]*(397[._]?0[1-8])[a-z0-9_.-]*'" packages/cli/src/__tests__/conformance/*.ts
#
# Every plan in the phase numbers its own fixtures, which is what makes that grep exhaustive and
# what makes this script's `397_09` names unmistakably its own.
SUITE_OWN_FIXTURES="agent_qa_control_uncatalogued_397_01
control.stray.397.01
control.uncarried.397.03
control.stray.row.397.03
control.absent.397.03
control 397-03: prose in no declared class
fn:control.asking.397.03
fn:control.reading.397.03
fn:control.local.397.03
control.absent.397.04
control.row.397.05.2
control.scope.397.05
control_degraded_397_05_a
control_degraded_397_05_b
control_degraded_397_05_c
agent_qa_control_397_06
control.golden.stray.397.06
control.golden.uncatalogued.397.06
controlGoldenField39706
control.absent.397.07
control.stray.397.07
controluncatalogued39708.probe
controlmemberless39708
controlreserved39708"

# ── Vacuity floors. A leg that passed because the suite collected nothing is the CI-shaped version
# of the very failure this phase exists to prevent. Measured 2026-08-16: 81 cells in the directory.
FROZEN_MIN_TESTS=81

fatal() { echo "FATAL: $*" >&2; exit 1; }
note() { echo "[397-parity-mutation] $*"; }

# PORTABLE FORM, DELIBERATELY. `mktemp -d -t <prefix>` is a BSD idiom: on macOS it appends random
# characters to the prefix, on GNU coreutils the same call FAILS with "too few X's in template".
WORK="$(mktemp -d "${TMPDIR:-/tmp}/397parity.XXXXXXXX")"

SNAP_A1="$WORK/catalog.ts.snapshot"
SNAP_A2="$WORK/resolver-table.ts.snapshot"
SNAP_B="$WORK/turn-engine.ts.snapshot"
SNAP_C="$WORK/scenario-table.ts.snapshot"

restore_all () {
  if [ -f "$SNAP_A1" ]; then cp "$SNAP_A1" "$ROOT/$SUBJECT_A1" 2>/dev/null || true; fi
  if [ -f "$SNAP_A2" ]; then cp "$SNAP_A2" "$ROOT/$SUBJECT_A2" 2>/dev/null || true; fi
  if [ -f "$SNAP_B" ]; then cp "$SNAP_B" "$ROOT/$SUBJECT_B" 2>/dev/null || true; fi
  if [ -f "$SNAP_C" ]; then cp "$SNAP_C" "$ROOT/$SUBJECT_C" 2>/dev/null || true; fi
  return 0
}
# The subjects are restored FIRST and unconditionally on any exit path — an interrupted run must not
# leave a planted private channel in the working tree.
trap 'restore_all; rm -rf "$WORK"' EXIT

sha_of () { shasum -a 256 "$1" | cut -d' ' -f1; }

# ── The classifier. Written to a file, never passed as a shell string: a quoted argument mangled by
# the shell is how a harness ends up measuring an implementation nobody wrote. It decides NOTHING —
# it reports the total and the failing cells, and bash compares the sets.
cat > "$WORK/classify.mjs" <<'CLASSIFY_MJS'
// Read vitest's JSON report. Print `TOTAL=<n>`, then one `FAILED <fullName>` line per failing cell,
// and write every failure message to the file named by argv[3] so the caller can require that a RED
// NAMES the stray it planted. Decides nothing.
import { readFileSync, writeFileSync } from 'node:fs'
const [, , reportPath, messagePath] = process.argv
let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  process.stdout.write(`UNREADABLE ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(0)
}
const results = Array.isArray(report.testResults) ? report.testResults : []
process.stdout.write(`TOTAL=${Number(report.numTotalTests ?? 0)}\n`)
const messages = []
for (const file of results) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status !== 'failed') continue
    const name = String(assertion.fullName ?? '')
    process.stdout.write(`FAILED ${name}\n`)
    messages.push(`=== ${name}\n${(assertion.failureMessages ?? []).join('\n')}`)
  }
}
writeFileSync(messagePath, messages.join('\n\n'), 'utf8')
CLASSIFY_MJS

# ── The allowed red-cell lists ──────────────────────────────────────────────────────────────────
#
# EXACT vitest `fullName`s (describe + cell), one per line, written through a quoted heredoc so an
# apostrophe inside a cell name survives. Each list is the WHOLE of what the leg claims, in both
# directions: every name here must red, and nothing else in the directory may.
#
# The counts are MEASURED, not guessed. Where a measurement disagreed with the plan's expectation
# the list follows the measurement and the disagreement is recorded in the phase SUMMARY as a
# finding — a list edited to match a run is only honest when the edit is BY NAME.

# A1's fan-out is THREE, and the third one was a measurement rather than a prediction. This list was
# first written with two entries — the in-process reverse-completeness cell and the shipped binary's
# anchor — and the run reported a third: the config-write listing delta cell asserts `strays` empty
# under the REDUCED grant as well. That is not a leg reaching too far; it is the sharper half of the
# finding. A tool registered outside the declared mapping is not scope-filtered by anything, because
# the visibility law runs inside the loop the plant sits after — so the uncatalogued door is served
# to a caller holding the DEFAULT grant too, and this cell is the only one that asks that question.
# The list follows the measurement, BY NAME. It was never widened to any-red.
cat > "$WORK/allowed.A1" <<'ALLOWED_A1'
the parity suite ranges the registry census over every rostered surface reaches, on every rostered surface, only capabilities the registry declares
the parity suite ranges the registry census over every rostered surface pins the config-write listing delta between the every-scope and the default MCP grant
the built-binary anchors (D-02) the shipped MCP binary lists exactly the op ids the in-process adapter does
ALLOWED_A1

cat > "$WORK/allowed.A2" <<'ALLOWED_A2'
the parity suite ranges the registry census over every rostered surface reaches, on every rostered surface, only capabilities the registry declares
the parity suite ranges the registry census over every rostered surface enumerates over chat every capability the registry declares
the parity suite ranges the registry census over every rostered surface joins every row chat expectation to the live chat enumeration, in both directions
ALLOWED_A2

# B's fan-out is TWO, and the second entry is here because the RUN FOUND THE SUITE VACUOUS AND THE
# SUITE WAS FIXED — the leg was not narrowed to match it. On its first run leg B reddened exactly
# one cell, the chat surface wall, which is 397-04's measured fan-out and would have been an honest
# place to stop. It was not, because the tracer cell claims in as many words to be "the observation
# the D-14 ungated mutation has to be able to break", and it was not breaking. The reason was
# measured: `chat/banner.ts` reads `proposals.list` through the gate when a session OPENS, so an
# `fn:proposals.list` audit row exists on every drive whatever the clause does, and a presence check
# over that row cannot see a clause that dispatched outside the gate. The cell now compares against
# a second drive of a capability the banner does not read, and reds under this leg. Recorded as a
# deviation touching 397-04's file, because a leg list edited to match a vacuous cell would have
# left the phase's own thesis untested on the surface it is about.
cat > "$WORK/allowed.B" <<'ALLOWED_B'
the parity suite ranges the registry census over every rostered surface refuses at the CHAT SURFACE WALL for every capability, through its own composed dispatch
the parity suite ranges the registry census over every rostered surface drives a capability through the chat surface's own composed dispatch, model-free
ALLOWED_B

# C's list is MEASURED, and it is the list SC-4 rests on. 397-03 measured FOUR cells for this shape;
# this tree reports EIGHT, and the difference is the phase itself: 397-04's policy-identity, ask and
# gate-wall legs and 397-06's golden diff all range the same denominator, so a capability the table
# stopped carrying now goes unasserted on eight independent axes at once. The one cell 397-03 named
# that does NOT red is `types every scenario input against the contract …`: it iterates the TABLE,
# so a table one row short simply has one less row to type-check — correct, and exactly the kind of
# asymmetry a measured list preserves and a guessed one flattens.
cat > "$WORK/allowed.C" <<'ALLOWED_C'
the parity suite ranges the registry census over every rostered surface carries exactly one scenario row per registered capability, in both directions
the parity suite ranges the registry census over every rostered surface joins every row MCP expectation to the declared mapping, in both directions
the parity suite ranges the registry census over every rostered surface joins every row chat expectation to the live chat enumeration, in both directions
the parity suite ranges the registry census over every rostered surface answers identically for two callers that differ only in which surface minted them
the parity suite ranges the registry census over every rostered surface diverges between the surfaces' own mints on exactly the human-origin capabilities
the parity suite ranges the registry census over every rostered surface refuses at the GATE WALL for every capability, naming the one withheld grant
the parity suite ranges the registry census over every rostered surface reaches the ask for every ask-capable capability, identically on both surfaces' callers
the parity suite ranges the registry census over every rostered surface matches the committed golden registry, op by op and field by field
ALLOWED_C

# ── The mutations ───────────────────────────────────────────────────────────────────────────────
#
# APPLIED BY EXACT STRING REPLACEMENT with a single-occurrence assertion per edit, rather than by a
# regex over bracket-heavy lines. This project has recorded two false "DID NOT APPLY" verdicts from
# escaping — one from BRE bracket handling, one from a shell-mangled multi-line pattern — so every
# anchor is compared literally and its count is asserted to be exactly 1.
#
# A MUTATION IS A LIST OF EDITS. A1 needs three because the SDK's `registerTool` takes a config, and
# the honest way to obtain one without inventing a second projection recipe is to keep the one the
# declared loop already built. The alternative — hand-writing a config literal — would be this
# script minting a contract, which is the second catalogue the whole phase exists to forbid.
cat > "$WORK/mutate.py" <<'MUTATE_PY'
import os
import sys

name = os.environ['MUTATION_NAME']
root = os.environ['REPO_ROOT']

MUTATIONS = {
    # A1 — a live tool registered AFTER the declared projection loop. Nothing in `mapping.ts` moves,
    # so the shipped bump guard is blind to it by construction; the tool is served to every caller
    # the loop served anything to, and `tools/list` carries a name the catalogue never declared.
    'A1': ('packages/mcp/src/catalog.ts', [
        (
            "  const registered = new Set<string>()\n",
            "  let mutation39709Config: ReturnType<typeof toRegisterToolConfig> | undefined\n"
            "  const registered = new Set<string>()\n",
        ),
        (
            "    const config = toRegisterToolConfig(projection, specs, advertised, deps.maskText)\n",
            "    const config = toRegisterToolConfig(projection, specs, advertised, deps.maskText)\n"
            "    mutation39709Config ??= config\n",
        ),
        (
            "  // D-13: the six entity Resource Templates",
            "  if (mutation39709Config !== undefined) {\n"
            "    server.registerTool(\n"
            "      'agent_qa_mutation_397_09_uncatalogued',\n"
            "      mutation39709Config,\n"
            "      async (args: unknown): Promise<CallToolResult> =>\n"
            "        maskedToolResult(await invoke('runs.list', args), deps.maskText),\n"
            "    )\n"
            "  }\n"
            "\n"
            "  // D-13: the six entity Resource Templates",
        ),
    ]),
    # A2 — the `status` alias repointed at a literal id no registry op declares. One edit, at the
    # row, and it is precisely the shape `resolver-table.ts`'s own header forbids: a function id
    # written rather than imported. The file still compiles; the unused import is not an error under
    # this workspace's tsconfig, which is exactly why the compile pin cannot catch this.
    'A2': ('packages/agent/src/chat/resolver-table.ts', [
        (
            "        ? { kind: 'op', functionId: RUNS_LIST_FUNCTION_ID, input: {} }\n",
            "        ? { kind: 'op', functionId: 'runs.private.397.09', input: {} }\n",
        ),
    ]),
    # B — one op answered from inside the turn engine instead of through the composition root's
    # `ChatInvokeBinding`. `invokeFunction` is never reached, so the eight-step gate never runs: no
    # scope check, no ask, no session pin, no audit row. The receipt still reads `executed` and the
    # types still check, which is what makes this the defect class that survives review.
    'B': ('packages/agent/src/chat/turn-engine.ts', [
        (
            "        const answered = await deps.invoke(\n"
            "          step.functionId,\n"
            "          stampSessionFacts(step.functionId, step.args, sessionId),\n"
            "          caller,\n"
            "        )\n",
            "        const answered = step.functionId === 'proposals.list'\n"
            "          ? { proposals: [], via: 'MUTATION_397_09_LEG_B_UNGATED' }\n"
            "          : await deps.invoke(\n"
            "            step.functionId,\n"
            "            stampSessionFacts(step.functionId, step.args, sessionId),\n"
            "            caller,\n"
            "          )\n",
        ),
    ]),
    # C — one scenario row deleted. The table is a typed literal array, so removing a member keeps
    # the file compiling and keeps every other row correlated to its own op's contract; what is left
    # is exactly the state a repository is in the moment a capability ships without a row for it.
    'C': ('packages/cli/src/__tests__/conformance/scenario-table.ts', [
        (
            "  scenario({\n"
            "    opId: 'runs.list',\n"
            "    input: {},\n"
            "    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_list_runs' } } },\n"
            "    policyPoints: { grant: 'allow', refuse: 'deny' },\n"
            "  }),\n",
            "",
        ),
    ]),
}

if name not in MUTATIONS:
    sys.exit('FATAL: unknown mutation %s' % name)

relative, edits = MUTATIONS[name]
path = os.path.join(root, relative)
source = open(path).read()
for index, (anchor, replacement) in enumerate(edits, start=1):
    found = source.count(anchor)
    if found != 1:
        sys.exit(
            'FATAL: mutation %s edit %d expected exactly one occurrence of its anchor, found %d'
            % (name, index, found)
        )
    source = source.replace(anchor, replacement, 1)
open(path, 'w').write(source)
MUTATE_PY

subject_of () {
  case "$1" in
    A1) echo "$SUBJECT_A1" ;;
    A2) echo "$SUBJECT_A2" ;;
    B)  echo "$SUBJECT_B" ;;
    C)  echo "$SUBJECT_C" ;;
    *)  fatal "unknown leg $1" ;;
  esac
}

snapshot_of () {
  case "$1" in
    A1) echo "$SNAP_A1" ;;
    A2) echo "$SNAP_A2" ;;
    B)  echo "$SNAP_B" ;;
    C)  echo "$SNAP_C" ;;
    *)  fatal "unknown leg $1" ;;
  esac
}

marker_of () {
  case "$1" in
    A1) echo "$MARKER_A1" ;;
    A2) echo "$MARKER_A2" ;;
    B)  echo "$MARKER_B" ;;
    C)  echo "" ;;
    *)  fatal "unknown leg $1" ;;
  esac
}

dist_of () {
  case "$1" in
    A1) echo "$DIST_MCP" ;;
    A2|B) echo "$DIST_AGENT" ;;
    C)  echo "" ;;
    *)  fatal "unknown leg $1" ;;
  esac
}

apply_mutation () {
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  MUTATION_NAME="$1" REPO_ROOT="$ROOT" python3 "$WORK/mutate.py"
}

# CONFIRMED BY `diff` AGAINST THE SNAPSHOT, never by grepping for the pattern that was written — a
# `grep` verdict over a bracket-heavy replacement has produced two false "DID NOT APPLY" reports in
# this project's history.
assert_applied () {
  local leg="$1"
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if diff -q "$(snapshot_of "$leg")" "$ROOT/$(subject_of "$leg")" > /dev/null; then
    fatal "leg $leg changed nothing — the anchor no longer matches the source"
  fi
}

# THE DEPENDENCY-ORDERED REBUILD. Every package `packages/cli` reads through a dist is rebuilt, in
# the order their dists depend on one another, on every apply AND on every restore: restoring a
# source file gives it a fresh mtime, which makes its dist stale, which the suite's own freshness
# guard would (correctly) refuse on.
rebuild_dists () {
  if [ "${PARITY_MUTATION_NO_BUILD:-0}" = "1" ]; then
    note "build: SKIPPED (PARITY_MUTATION_NO_BUILD=1) — no result from this run is evidence"
    return 0
  fi
  local pkg
  for pkg in @vostride/agent-qa-schema @vostride/agent-qa-safety @vostride/agent-qa-agent \
             @vostride/agent-qa-agent-local @vostride/agent-qa-mcp agent-qa; do
    set +e
    (cd "$ROOT" && pnpm --filter "$pkg" build) >> "$WORK/build.log" 2>&1
    local rc=$?
    set -e
    [ "$rc" -eq 0 ] || { tail -40 "$WORK/build.log" >&2; fatal "the rebuild of $pkg failed — see $WORK/build.log"; }
  done
}

# THE PROOF THAT THE REBUILD TOOK. An occurrence count read off the BUILT artifact for a token that
# exists nowhere else in the repository — so a stale dist reports 0 and this script stops rather than
# measuring the previous build's behaviour through a source it never compiled.
assert_dist_marker () {
  local leg="$1" expectation="$2"
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if [ "${PARITY_MUTATION_NO_BUILD:-0}" = "1" ]; then return 0; fi
  local dist marker seen
  dist="$(dist_of "$leg")"
  marker="$(marker_of "$leg")"
  # A LEG WHOSE SUBJECT NO DIST CARRIES SAYS SO, rather than grepping an artifact that could never
  # hold its marker and reading the inevitable 0 as evidence. Leg C's subject is a TEST file, which
  # vitest loads straight from `packages/cli/src` — there is no build step between the edit and the
  # measurement, so there is nothing a rebuild proof could add. The freshness guard is unaffected:
  # it excludes `__tests__` from its scan by design.
  if [ -z "$marker" ]; then
    note "  no dist carries leg $leg's subject (a test file, loaded from source) — no rebuild proof to make"
    return 0
  fi
  # `pipefail` is on and `grep` exits 1 when it matches nothing — which is the EXPECTED reading
  # after a restore. Without the `|| true` the absent case would kill the script under `set -e`
  # before it could report the count it was asked for.
  seen="$( { grep -oF -- "$marker" "$ROOT/$dist" 2>/dev/null || true; } | wc -l | tr -d ' ')"
  note "  dist marker '$marker' in $dist: $seen occurrence(s) (expected $expectation)"
  case "$expectation" in
    present)
      [ "$seen" -ge 1 ] || fatal "$dist does not carry leg $leg's marker — the rebuild did not take, so any result measured through it is a result about the PREVIOUS build"
      ;;
    absent)
      [ "$seen" -eq 0 ] || fatal "$dist still carries leg $leg's marker after the restore — the tree is not back where it started"
      ;;
  esac
}

# ── One suite run, classified ───────────────────────────────────────────────────────────────────
#
# Sets RUN_TOTAL, RUN_FAILED (a file of exact full names) and RUN_MESSAGES (a file of failure text).
# A global rather than a printed value on purpose: `X="$(run_suite)"` would run this in a subshell,
# where `fatal`'s `exit 1` kills only that subshell and the script sails on with an empty answer.
RUN_TOTAL=0
RUN_FAILED=""
RUN_MESSAGES=""
RUN_STDOUT=""
run_suite () {
  local label="$1"
  local report="$WORK/report.$label.json"
  RUN_FAILED="$WORK/failed.$label"
  RUN_MESSAGES="$WORK/messages.$label"
  RUN_STDOUT="$WORK/run.$label.stdout"
  rm -f "$report" "$RUN_FAILED" "$RUN_MESSAGES"
  # TWO REPORTERS, AND THE SECOND ONE IS NOT DECORATION. Classification needs the JSON report's
  # exact `fullName`s. But the NAME of a stray does not survive into `failureMessages`: chai
  # truncates a deep diff to `expected [ Array(1) ] to deeply equal []`, and the actual member is
  # printed only in the unified diff the DEFAULT reporter renders. SC-3 asks for a NAMED red, and
  # the surface a person actually reads is the console — so both are captured and the name is
  # required in either. (Measured 2026-08-16: with the json reporter alone, all three of leg A1's
  # reds were correct and none of them contained the planted tool name.)
  #
  # The exit code is read from the process, never through a pipe; a red suite is EXPECTED under a
  # mutation, so the run itself must not abort the script under `set -e`.
  (cd "$CLI_DIR" && npx vitest run "$SUITE_REL" \
      --reporter=default --reporter=json --outputFile.json="$report") \
    > "$RUN_STDOUT" 2>&1 || true
  [ -f "$report" ] || { tail -40 "$WORK/run.$label.stdout" >&2; fatal "the suite produced no JSON report for $label — it did not run at all"; }

  local classified
  classified="$(node "$WORK/classify.mjs" "$report" "$RUN_MESSAGES")"
  case "$classified" in
    UNREADABLE*) fatal "the suite's JSON report could not be read: ${classified#UNREADABLE }" ;;
  esac

  RUN_TOTAL="$(printf '%s\n' "$classified" | sed -n 's/^TOTAL=//p')"
  [ -n "$RUN_TOTAL" ] || fatal "the suite's JSON report carried no test total"
  if [ "$RUN_TOTAL" -lt "$FROZEN_MIN_TESTS" ]; then
    fatal "the suite ran $RUN_TOTAL cells, fewer than the frozen floor of $FROZEN_MIN_TESTS — a leg that passes because nothing ran is not a leg"
  fi
  printf '%s\n' "$classified" | sed -n 's/^FAILED //p' | sort -u > "$RUN_FAILED"
  note "  $label: $RUN_TOTAL cells collected, $(grep -c . "$RUN_FAILED" || true) red"
}

# ── One leg ─────────────────────────────────────────────────────────────────────────────────────
run_leg () {
  local leg="$1" label="$2" needle="$3"
  local subject snapshot allowed baseline restored
  subject="$(subject_of "$leg")"
  snapshot="$(snapshot_of "$leg")"
  allowed="$WORK/allowed.$leg"
  baseline="$(sha_of "$snapshot")"

  echo
  echo "=== LEG $leg — $label"
  echo "    subject $subject"
  echo "    sha256  $baseline"

  apply_mutation "$leg"
  assert_applied "$leg"
  note "  applied; subject sha256 now $(sha_of "$ROOT/$subject")"

  rebuild_dists
  assert_dist_marker "$leg" present

  run_suite "$leg"

  echo "  cells red:"
  if [ -s "$RUN_FAILED" ]; then
    sed 's/^/    - /' "$RUN_FAILED"
  else
    echo "    (none)"
  fi

  # DIRECTION 1 — nothing outside the list. A red the leg did not intend is a finding, never a
  # licence to widen: it means either the mutation reached further than the leg claims, or the
  # allowed list is a description of a different tree.
  local line unexpected=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! grep -Fxq -- "$line" "$allowed"; then
      echo "FATAL: leg $leg red a cell OUTSIDE its allowed list: $line" >&2
      unexpected=1
    fi
  done < "$RUN_FAILED"

  # DIRECTION 2 — nothing in the list stayed green. This is the half that catches a vacuous suite,
  # and it is the half `SELFTEST=neutered` exercises.
  local missing=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! grep -Fxq -- "$line" "$RUN_FAILED"; then
      echo "FATAL: leg $leg's allowed cell did NOT red — the suite is green under an implementation it must catch: $line" >&2
      missing=1
    fi
  done < "$allowed"

  [ "$unexpected" -eq 0 ] && [ "$missing" -eq 0 ] \
    || fatal "leg $leg failed exact discrimination (see above). No leg is ever widened to accept any-red."

  # THE RED MUST NAME THE THING, ON THE SURFACE A PERSON READS. SC-3 asks for NAMED reds: a cell
  # that reds without the stray id or the escaped op id anywhere in its output tells a reviewer that
  # something is wrong and not what. Both channels are searched — the assertion message and the
  # console diff — because the name lands in whichever one the value's depth allows.
  if ! grep -Fq -- "$needle" "$RUN_MESSAGES" && ! grep -Fq -- "$needle" "$RUN_STDOUT"; then
    sed -n '1,80p' "$RUN_MESSAGES" >&2
    fatal "leg $leg red the right cells but nothing in its output NAMES '$needle' — an unnamed red is not the proof SC-3 asks for"
  fi
  note "  the red names '$needle'"

  # And it must be THIS script's stray, not one of the suite's own deliberate control fixtures.
  local fixture
  while IFS= read -r fixture; do
    [ -z "$fixture" ] && continue
    if [ "$fixture" = "$needle" ]; then
      fatal "leg $leg's needle '$needle' collides with a control fixture the suite plants itself — the leg would be measuring the suite's own scaffolding"
    fi
  done <<< "$SUITE_OWN_FIXTURES"

  # VERBATIM, BOTH CHANNELS. The assertion messages say which claim broke; the console section says
  # WHICH MEMBER broke it. A run that printed only the first would be asking the reader to take the
  # naming on trust, which is the whole thing SC-3 refuses to do.
  echo "  --- verbatim, the assertion messages ---"
  sed -n '1,60p' "$RUN_MESSAGES" | sed 's/^/  | /'
  echo "  --- verbatim, the console's own diff (the surface a person reads) ---"
  awk '/Failed Tests/ { seen = 1 } seen' "$RUN_STDOUT" | sed -n '1,120p' | sed 's/^/  | /'
  echo "  --------------------------------------------------------------------"

  # ── Restore, prove it, and return to green ───────────────────────────────────────────────────
  cp "$snapshot" "$ROOT/$subject"
  restored="$(sha_of "$ROOT/$subject")"
  [ "$restored" = "$baseline" ] || fatal "$subject was not restored byte-identically ($restored, expected $baseline)"
  note "  subject restored byte-identically"

  rebuild_dists
  assert_dist_marker "$leg" absent

  run_suite "$leg.restored"
  if [ -s "$RUN_FAILED" ]; then
    sed 's/^/    - /' "$RUN_FAILED" >&2
    fatal "leg $leg did not return to green after the revert — SC-3's revert half fails, and every red above is now unattributable"
  fi
  note "  reverted -> the suite is green again ($RUN_TOTAL cells)"
}

# ── Preflight ───────────────────────────────────────────────────────────────────────────────────

echo "=== PREFLIGHT"

# A DIRTY TREE IS REFUSED. A mutation applied over an uncommitted edit cannot be restored to
# anything meaningful, and a restore that "succeeded" would be restoring somebody's work in
# progress. This script's own file is excluded — it is the thing being written.
DIRTY="$(cd "$ROOT" && git status --porcelain | grep -vF -- "$SCRIPT_REL" || true)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" >&2
  fatal "the working tree is dirty; this script plants and reverts real edits and refuses to run over uncommitted work"
fi
note "working tree clean (this script's own file excluded)"

for pair in "A1|$SUBJECT_A1" "A2|$SUBJECT_A2" "B|$SUBJECT_B" "C|$SUBJECT_C"; do
  leg="${pair%%|*}"; path="${pair##*|}"
  [ -f "$ROOT/$path" ] || fatal "leg $leg's subject is missing: $path"
  cp "$ROOT/$path" "$(snapshot_of "$leg")"
  note "snapshot $path  sha256 $(sha_of "$(snapshot_of "$leg")")"
done

rebuild_dists
note "dists rebuilt in dependency order"
for leg in A1 A2 B C; do assert_dist_marker "$leg" absent; done

run_suite preflight
if [ -s "$RUN_FAILED" ]; then
  sed 's/^/  - /' "$RUN_FAILED" >&2
  fatal "the conformance suite is already red before any mutation — every observation below would be meaningless"
fi
note "preflight: the suite is green ($RUN_TOTAL cells)"

case "${SELFTEST:-}" in
  neutered)
    echo
    note "SELFTEST=neutered — every mutation below is a NO-OP. The script MUST fail."
    ;;
esac

# ── The legs ────────────────────────────────────────────────────────────────────────────────────

run_leg A1 "uncatalogued capability, MCP: a live tool registered outside mapping.ts" "$MARKER_A1"
run_leg A2 "uncatalogued capability, chat: a resolver row repointed at a literal non-registry id" "$MARKER_A2"
run_leg B  "ungated capability: one op answered inside packages/agent, around invokeFunction" "proposals.list"
run_leg C  "SC-4's own rule: a registered capability that no scenario row carries" "runs.list"

# ── The close ───────────────────────────────────────────────────────────────────────────────────

echo
FINAL_DIRTY="$(cd "$ROOT" && git status --porcelain | grep -vF -- "$SCRIPT_REL" || true)"
if [ -n "$FINAL_DIRTY" ]; then
  echo "$FINAL_DIRTY" >&2
  fatal "the working tree is dirty after the run — a mutation survived, which is the one outcome this script must never leave behind"
fi

echo "PASS — a capability registered outside the declared MCP catalogue is named by the reverse-"
echo "       completeness cell AND by the shipped binary's own anchor; a resolver alias repointed at"
echo "       a literal id no registry op declares is named on three independent axes; and ONE op"
echo "       answered around invokeFunction inside packages/agent is named by the chat surface wall"
echo "       and by the missing gate audit row; and a capability the registry declares that no"
echo "       scenario row carries is named by the census leg CI runs on every PR (SC-4). Every leg"
echo "       observed RED on exactly its allowed cells"
echo "       and no others, every red NAMED the subject, every restore was byte-identical by"
echo "       sha256, every leg proved its rebuild took, and reverting each mutation returned the"
echo "       suite to green."
