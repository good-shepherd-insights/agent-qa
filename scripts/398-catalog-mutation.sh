#!/usr/bin/env bash
#
# 398-catalog-mutation.sh — the acceptance bar for the capability catalog's guard set (Phase 398,
# D-04, plan 12).
#
# WHAT THIS PROVES, AND WHY 148 GREEN CELLS DO NOT PROVE IT. `packages/cli/src/__tests__/conformance/`
# passing says that, on this tree, the committed `capability-catalog.json` agrees with the live
# seams, `/help` is one list, the skills census closes and the v1→v2 migration map projects entry for
# entry. It does NOT say those cells would CATCH the edits that break each of those claims. A
# detector's bar is the implementation it must go RED on, never the suite it passes — and this phase
# alone has produced four cells that were green under the very implementation their own header
# forbade (398-07 leg M6, 398-09 leg M2, 398-10 legs M4–M7, 398-11's existsSync-guarded cross-check
# reporting `18 passed` while asserting nothing).
#
# THE SIX LEGS, each an edit a careless commit could plausibly produce, chosen PER DETECTOR:
#
#   A  ONE HELP LINE RENAMED. `CHAT_HELP_ENTRIES` in `resolver-table.ts` is the list a person reads;
#      `CHAT_RESOLVER_TABLE` beside it is the list that actually routes. Renaming the alias on the
#      help row and not on the rule is the drift the `/help` census exists for — the second list of
#      what chat understands, disagreeing with the first. It compiles, it ships, and `agent-qa chat`
#      still works: only the printed help is now a promise nothing keeps.
#
#   B  A SKILL RENAMED IN ITS FRONTMATTER AND NOT ON DISK. A skill row's `name` comes from SKILL.md
#      frontmatter and the directory is the other half of that identity. Renaming one and not the
#      other is a skill two consumers disagree about, and this is the only cell that looks.
#
#   C  ONE OP ROW DELETED FROM THE COMMITTED ARTIFACT, by hand, leaving `rowCount` stale — exactly
#      what "just drop that row, it's only JSON" produces. The freshness leg must name the row.
#
#   D  ONE ENTRY DELETED FROM THE SHIPPED MIGRATION MAP. The v1→v2 adjudication is retired history;
#      an entry quietly dropped is a v1 caller who gets a bare unknown-tool error instead of the
#      ruled note and route somebody wrote for them.
#
#   E  ONE OP ROW'S `surfaces` ARRAY HAND-EDITED IN THE COMMITTED ARTIFACT. C proves the freshness
#      leg sees a row LEAVE; E proves it sees a FIELD MOVE inside a row that is still there, and
#      that the red names the row AND the field rather than saying "the catalog is stale".
#
#   F  THE EXPLAIN ANSWER CHANNEL REVERTED AT ONE LINE (398-13, D-21). `turn-engine.ts` collects
#      `agent.explain`'s rendered lines onto the turn's `answer` field, which is the ONLY path by
#      which a grounded capability answer reaches a person's terminal — 398-12 measured the state
#      where it did not exist, and the whole of what a person saw was `agent.explain completed`.
#      Handing the collector an op id that exists nowhere restores exactly that state: it compiles,
#      it type-checks, it ships, and the answer is composed and discarded again.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a cell
# outside the leg's allowed list, and so is an allowed cell that stayed green. Discrimination runs in
# BOTH directions and no leg is ever widened to accept any-red. The lists are EXACT FULL TEST NAMES,
# never patterns — a pattern is a hole that widens on its own.
#
# THE THIRD DIRECTION, AND WHY THIS SCRIPT HAS ONE. A mutation can also make a cell CEASE TO EXIST,
# which is a green suite wearing a smaller denominator. Leg D does exactly that: three cells in
# `packages/mcp/src/__tests__/redirect.test.ts` are generated PER MAP ENTRY, so deleting an entry
# deletes its own coverage instead of reddening it (measured 2026-08-17: 270 cells → 267). That is a
# real property of a suite whose denominator is the subject under test, and it is pinned here BY
# NAME rather than remembered: every leg declares the exact set of cells it may make vanish, and a
# cell that vanishes off the list — or a cell that appears — is FATAL. What actually catches leg D is
# `migration-map.test.ts`'s complete-set census, whose other side is the inventory DOCUMENT, an
# independent source the mutation cannot shrink.
#
# WHAT THIS SCRIPT MEASURED AND DID NOT LIKE, RECORDED HERE BECAUSE IT IS THE FINDING AND NOT A
# FOOTNOTE. Several census cells in `catalog.test.ts` compare the LIVE mint to the LIVE tree —
# `joins every alias to a live registry op` reads its alias rows and its expected alias set from the
# same producer path, and (before leg B was re-aimed) `carries exactly the skills the shipped skills
# directory holds` read both sides off the same directory. Cells shaped that way cannot fire on tree
# drift at all: removing a skill directory outright moves BOTH sides and the census stays green,
# with only the freshness leg objecting. That is why leg B renames a skill in its FRONTMATTER rather
# than deleting its directory — the frontmatter and the directory are two genuinely different
# sources, which is the one asymmetry that census owns. The alias-join census has no such asymmetry
# available from a tree edit and is NOT claimed by any leg below; it guards a producer bug, not a
# repository state, and this script does not pretend otherwise.
#
# WHAT "FAITHFUL" MEANS HERE. An edit which reds because it tripped a schema or a type error BEFORE
# reaching the detector proves nothing. Each leg below compiles, builds, and reaches its detector; if
# a leg ever degenerates into an early failure it must be recorded UNFAITHFUL and rewritten, never
# counted. The vacuity floors below are the mechanical half of that rule: a leg that "passed" because
# the suite collected almost nothing is the CI-shaped version of the failure this phase prevents.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. CLASSIFICATION IS OFF VITEST'S JSON
# REPORT, never off scraped console lines — the report carries each cell's exact `fullName`, so an
# exact set comparison is possible in both directions. The DEFAULT reporter is captured beside it
# because the NAME of a mutated member survives only in the console's unified diff: chai truncates
# `expected [ 'digest', 'fn', 'help', …(7) ]` and the member that moved is printed nowhere else.
#
# SUBJECTS ARE RESTORED FROM `cp` BYTE SNAPSHOTS, COMPARED BY sha256. `git checkout --` cannot
# restore an uncommitted edit, and a restore nobody verified is a hope.
#
# THE REBUILD IS BAKED IN AND PROVEN, FOR THE LEGS THAT NEED IT. `packages/cli`'s conformance suite
# resolves `agent` and `mcp` through their BUILT dists, so legs A and D are vacuous without a
# rebuild — and a rebuild that silently failed is the same thing wearing a passing build log. Each of
# those legs carries a dist MARKER, as CODE rather than as a comment (`packages/agent`'s bundler
# strips comments — measured in 395-04), and the built artifact is grepped for it before a single
# test result is believed. Legs B, C and E have no dist: SKILL.md and the committed catalog JSON are
# read from source by the suite, so there is nothing a rebuild proof could add and this script says
# so rather than grepping an artifact that could never hold a marker and reading the inevitable 0 as
# evidence.
#
# CACHE-DEFEATING BY CONSTRUCTION. Every suite run below is `npx vitest run` from the package
# directory, which never consults turbo's cache. A bare `pnpm test` can return a FULL TURBO replay
# and report green without running anything; no result in this script comes from one.
#
# NOTHING IS COMMITTED DURING AN APPLY CYCLE, and the script refuses to start on a dirty tree — so a
# mutation cannot be mistaken for work in progress and cannot ride into a commit.
#
# USAGE
#   bash agent-qa/scripts/398-catalog-mutation.sh              # from the super-repository root
#   bash scripts/398-catalog-mutation.sh                       # from the agent-qa root
#   bash scripts/398-catalog-mutation.sh --selftest            # must FAIL, exit 1
#
# KNOBS
#   --selftest  (or SELFTEST=neutered)
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "an allowed
#       cell did not red" and exit 1 — which is what proves this script itself can fail, and that a
#       PASS below is not something it prints unconditionally.
#   CATALOG_MUTATION_NO_BUILD=1
#       INTERNAL, iteration only. Skips the rebuilds. Never use it for a result that is evidence.
#
# Case lookups and plain functions rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as unbound under `set -u`.

set -euo pipefail

# DETERMINISTIC COLLATION. `comm` below compares two sorted files and silently reports nonsense if
# the two were sorted under different locales; pinning it here makes the sort the same on every
# machine that runs this.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
MCP_DIR="$ROOT/packages/mcp"
CLI_SUITE_REL="src/__tests__/conformance/"
SCRIPT_REL="scripts/398-catalog-mutation.sh"

cd "$ROOT"

for arg in "$@"; do
  case "$arg" in
    --selftest) SELFTEST=neutered ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ── The subjects ────────────────────────────────────────────────────────────────────────────────
SUBJECT_A="packages/agent/src/chat/resolver-table.ts"
SUBJECT_B="packages/cli/skills/agent-qa-result-triage/SKILL.md"
SUBJECT_C="packages/cli/capability-catalog/capability-catalog.json"
SUBJECT_D="packages/mcp/src/migration-map.ts"
SUBJECT_E="packages/cli/capability-catalog/capability-catalog.json"
SUBJECT_F="packages/agent/src/chat/turn-engine.ts"

# THE ONE LIST OF LEGS. `restore_all`, the preflight snapshot loop, the at-rest dist-marker loop and
# the run loop all read it, so a leg that is added without being restored is not expressible (IN-04:
# `restore_all` used to name SNAP_A..SNAP_D by hand and silently omitted SNAP_E, which was harmless
# only because leg E's subject happened to equal leg C's).
LEGS="A B C D E F"

DIST_AGENT="packages/agent/dist/index.js"
DIST_MCP="packages/mcp/dist/index.js"

# ── The dist markers, and their polarity ────────────────────────────────────────────────────────
#
# Leg A INTRODUCES a token that exists nowhere else in the repository; leg D REMOVES one that exists
# exactly once. Both directions are proofs that the rebuild took: a stale dist reports the baseline
# count rather than the mutated one, and this script stops instead of measuring the previous build's
# behaviour through a source it never compiled.
# Leg D's marker was FIRST written as `plus SEP-2575`, a phrase from the deleted entry's `route`,
# and the first real run FATALed on it: that phrase also appears in `mapping.ts`'s unprojected reason
# for `agent.explain`, so the dist carried it whether or not the rebuild took. A marker that is not
# unique to its leg's subject is a rebuild proof that proves the wrong file. `agent_qa_discover` is
# the entry's own `v1Name` and occurs exactly once in the built artifact at rest.
# Leg F's marker is a STRING LITERAL rather than an identifier, and deliberately: the bundler strips
# comments and may rename locals, but it cannot rename a literal out from under the leg. The token
# names no op that exists anywhere, so it is unambiguously the mutation's own footprint.
MARKER_A="runs-status"          # introduced: 0 before, >=1 under the mutation
MARKER_D="agent_qa_discover"    # removed:    1 before, 0 under the mutation
MARKER_F="398F-no-such-op"      # introduced: 0 before, >=1 under the mutation

# ── Vacuity floors. Measured 2026-08-17. A leg that passed because the suite collected nothing is
# not a leg. The MCP floor is 267 rather than the baseline 270 because leg D legitimately collects
# three fewer — the three cells named in `vanished.D` below, generated per map entry.
#
# The cli floor moved 145 -> 148 on 2026-08-17 (398-13, gap round 1), READ OFF the measured
# post-change `npx vitest run src/__tests__/conformance/` total rather than computed as 145 + 3. At
# 145 a future deletion of the three cells that plan added — the only guards on the explain answer
# channel — would still clear the floor, and every leg would keep passing over a suite that no
# longer collects them. A floor that does not follow the cells it exists to protect is not a floor.
FROZEN_MIN_CLI_TESTS=148
FROZEN_MIN_MCP_TESTS=267

fatal() { echo "FATAL: $*" >&2; exit 1; }
note() { echo "[398-catalog-mutation] $*"; }

# PORTABLE FORM, DELIBERATELY. `mktemp -d -t <prefix>` is a BSD idiom: on macOS it appends random
# characters to the prefix, on GNU coreutils the same call FAILS with "too few X's in template".
WORK="$(mktemp -d "${TMPDIR:-/tmp}/398catalog.XXXXXXXX")"

SNAP_A="$WORK/resolver-table.ts.snapshot"
SNAP_B="$WORK/SKILL.md.snapshot"
SNAP_C="$WORK/capability-catalog.C.snapshot"
SNAP_D="$WORK/migration-map.ts.snapshot"
SNAP_E="$WORK/capability-catalog.E.snapshot"
SNAP_F="$WORK/turn-engine.ts.snapshot"

# DRIVEN FROM `$LEGS`, never from a hand-written list of snapshot names (IN-04). It reads only the
# `SUBJECT_*` / `SNAP_*` variables above it, so it is safe on every exit path including one taken
# before the `*_of` lookups further down have been defined; a snapshot that does not exist yet is
# skipped rather than restored from nothing.
restore_all () {
  local leg snap subj
  for leg in $LEGS; do
    eval "snap=\${SNAP_$leg:-}"
    eval "subj=\${SUBJECT_$leg:-}"
    if [ -n "$snap" ] && [ -n "$subj" ] && [ -f "$snap" ]; then
      cp "$snap" "$ROOT/$subj" 2>/dev/null || true
    fi
  done
  return 0
}
# The subjects are restored FIRST and unconditionally on any exit path — an interrupted run must not
# leave a corrupted committed artifact in the working tree.
trap 'restore_all; rm -rf "$WORK"' EXIT

sha_of () { shasum -a 256 "$1" | cut -d' ' -f1; }

# ── The classifier. Written to a file, never passed as a shell string: a quoted argument mangled by
# the shell is how a harness ends up measuring an implementation nobody wrote. It decides NOTHING —
# it reports the total, every cell name, and the failing ones, and bash compares the sets.
cat > "$WORK/classify.mjs" <<'CLASSIFY_MJS'
// argv: <report.json> <prefix> <namesOut> <failedOut> <messagesOut>
// Prints `TOTAL=<n>`. Writes every cell's prefixed fullName to namesOut, the failing ones to
// failedOut, and their failure text to messagesOut. Decides nothing.
import { readFileSync, writeFileSync } from 'node:fs'
const [, , reportPath, prefix, namesOut, failedOut, messagesOut] = process.argv
let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  process.stdout.write(`UNREADABLE ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(0)
}
const names = []
const failed = []
const messages = []
for (const file of Array.isArray(report.testResults) ? report.testResults : []) {
  for (const assertion of file.assertionResults ?? []) {
    const name = `${prefix}${String(assertion.fullName ?? '')}`
    names.push(name)
    if (assertion.status !== 'failed') continue
    failed.push(name)
    messages.push(`=== ${name}\n${(assertion.failureMessages ?? []).join('\n')}`)
  }
}
process.stdout.write(`TOTAL=${Number(report.numTotalTests ?? 0)}\n`)
writeFileSync(namesOut, `${names.sort().join('\n')}\n`, 'utf8')
writeFileSync(failedOut, `${failed.sort().join('\n')}\n`, 'utf8')
writeFileSync(messagesOut, messages.join('\n\n'), 'utf8')
CLASSIFY_MJS

# ── The allowed red-cell lists ──────────────────────────────────────────────────────────────────
#
# EXACT vitest `fullName`s, prefixed with the suite that owns them (`cli::` for
# `packages/cli/src/__tests__/conformance/`, `mcp::` for the whole of `packages/mcp`), one per line,
# through a quoted heredoc so an apostrophe inside a cell name survives. Each list is the WHOLE of
# what the leg claims, in both directions: every name here must red, and nothing else in EITHER
# suite may. Both suites are measured on every leg — a leg that says nothing about the other package
# would be scoping its own claim, and these two artifacts are census-tied to each other.
#
# The counts are MEASURED (2026-08-17), not guessed, and where a measurement disagreed with the
# plan's expectation the list follows the measurement and the disagreement is recorded in the phase
# SUMMARY as a finding.

# A's fan-out is FOUR, on four independent axes, and the plan predicted one. Renaming a help row's
# alias breaks: the help↔table join, the help↔committed-catalog join, the claim each help line makes
# about what its rule does, and the chat completer's ability to surface the alias row it advertises.
# Four cells for one edit is what a census suite looks like when its joins are genuinely independent.
cat > "$WORK/allowed.A" <<'ALLOWED_A'
cli::the /help census — one list of what chat understands names every row of the shipped resolver table, and no row it does not have
cli::the /help census — one list of what chat understands set-equals the committed catalog's aliases plus the directives plus the passthrough
cli::the /help census — one list of what chat understands each line's argument claim is what the SHIPPED rule actually does
cli::the chat host's discovery UX is a projection of the catalog offers every alias row in the form the shipped resolver actually answers
ALLOWED_A

# B's fan-out is TWO, and the second one is the whole reason this leg renames rather than deletes.
# The census cell's two sides are SKILL.md frontmatter and the directory name — the one place in the
# skills census where the two sources are genuinely different — so a frontmatter rename reds it,
# while deleting the directory outright moves both sides together and reds only the freshness leg.
cat > "$WORK/allowed.B" <<'ALLOWED_B'
cli::the capability catalog regenerates byte-identically from the live seams into the committed artifact (D-03)
cli::the capability catalog census carries exactly the skills the shipped skills directory holds (D-05)
ALLOWED_B

# C's fan-out is ONE, and the singleton is a finding rather than a disappointment. The census cell
# `carries exactly the capabilities the committed golden ledger records (D-01)` compares the
# committed GOLDEN to the LIVE catalog mint, so a row hand-deleted from the committed CATALOG is
# invisible to it; the manifest's `IS the committed catalog` cell reads the same corrupted file
# through the same loader on both sides and agrees with it. Exactly one cell in this repository
# compares the committed artifact to the tree, and this is it — which is precisely why D-04 asks for
# a standing proof that it works.
cat > "$WORK/allowed.C" <<'ALLOWED_C'
cli::the capability catalog regenerates byte-identically from the live seams into the committed artifact (D-03)
ALLOWED_C

# D's fan-out is SEVEN across BOTH packages, and it is the leg that justifies measuring two suites.
# Three pins in the bump guard, two in the complete-set census (whose other side is the inventory
# document — the only side the mutation cannot shrink), and two on the catalog side: the freshness
# leg and the manifest's entry-for-entry projection.
cat > "$WORK/allowed.D" <<'ALLOWED_D'
cli::the capability catalog regenerates byte-identically from the live seams into the committed artifact (D-03)
cli::the catalog's migration map projection (D-14, XPLN-03) lands in the COMMITTED artifact, entry for entry, as the shipped map declares it
mcp::the complete-set census (D-13), both directions covers every inventory tool row — a missing entry reds by name
mcp::the complete-set census (D-13), both directions is exactly the inventory set, as sorted lists
mcp::the pinned migration map (D-14) declares exactly the pinned sorted v1-name list
mcp::the pinned migration map (D-14) declares exactly the pinned arm for every v1 name
mcp::the pinned migration map (D-14) partitions the map into the arm sizes the pin groups
ALLOWED_D

# E's fan-out is ONE, the same cell C reds — and that is the point of running both. C asks whether
# the freshness leg sees a row LEAVE; E asks whether it sees a field MOVE inside a row that is still
# there, and whether the red names the row and the field (`op:runs.list.surfaces`) rather than
# reporting that "the catalog is stale", which is not something a person can act on.
cat > "$WORK/allowed.E" <<'ALLOWED_E'
cli::the capability catalog regenerates byte-identically from the live seams into the committed artifact (D-03)
ALLOWED_E

# F's fan-out is THREE, and all three are 398-13's own cells — the standing acceptance bar for the
# explain ANSWER CHANNEL. The mutation reverts the channel at exactly one line (the collector is
# handed an op id that exists nowhere, so it never matches and no line is collected), which is the
# revert a careless refactor would produce and which leaves a build that compiles and ships.
#
# READ OUT OF THE HARNESS'S OWN JSON REPORT (`$WORK/names.*`), never hand-composed: `fullName` is
# the describe and the test joined, and a hand-written name is how an allowed list becomes a
# description of a different tree. `vanished.F` is empty — this mutation deletes no cell.
cat > "$WORK/allowed.F" <<'ALLOWED_F'
cli::the built-binary anchors (D-02) the shipped chat binary PRINTS a capability line quoted out of the committed catalog (398-13, D-21)
cli::the grounded explain answer rides the turn a person reads (398-13, D-21) puts the cited row's OWN rendered line on the turn's answer field
cli::the grounded explain answer rides the turn a person reads (398-13, D-21) leaves the receipt the MAP, and no model prose anywhere on the turn
ALLOWED_F

# ── The cells each leg may make VANISH ──────────────────────────────────────────────────────────
#
# Empty for every leg but D. See the header: `redirect.test.ts` generates three cells per migration
# map entry, so leg D deletes its own coverage rather than reddening it. Pinned by exact name so the
# property is enforced on every future run instead of remembered.
: > "$WORK/vanished.A"
: > "$WORK/vanished.B"
: > "$WORK/vanished.C"
cat > "$WORK/vanished.D" <<'VANISHED_D'
mcp::the redirect fires on exact members, and only errors (D-15 · T-398-12) answers agent_qa_discover with a teaching error and never a result
mcp::caller-invariance on the retired and pending arms (T-398-13 · Pitfall 8) answers agent_qa_discover identically under three different scope sets
mcp::v1RedirectMessage, driven directly carries agent_qa_discover’s own ruled note and route
VANISHED_D
: > "$WORK/vanished.E"
: > "$WORK/vanished.F"

# ── The mutations ───────────────────────────────────────────────────────────────────────────────
#
# APPLIED BY EXACT STRING REPLACEMENT with a single-occurrence assertion per edit, rather than by a
# regex over bracket-heavy lines. This project has recorded two false "DID NOT APPLY" verdicts from
# escaping — one from BRE bracket handling, one from a shell-mangled multi-line pattern — so every
# anchor is compared literally and its count is asserted to be exactly 1.
cat > "$WORK/mutate.py" <<'MUTATE_PY'
import os
import sys

name = os.environ['MUTATION_NAME']
root = os.environ['REPO_ROOT']

# A — the alias on ONE help row renamed, and the routing rule beside it left alone. The file still
# compiles (the two lists are independent literals), `agent-qa chat` still answers `status`, and the
# only thing now wrong is the list a person reads.
A_ANCHOR = (
    "  Object.freeze({ alias: 'status', syntax: 'status', summary: 'the recent runs' }),\n"
)
A_REPLACEMENT = (
    "  Object.freeze({ alias: 'runs-status', syntax: 'status', summary: 'the recent runs' }),\n"
)

# B — a skill renamed in its frontmatter and not on disk. Both halves of the skill's identity are
# still strings, still parse, and still produce a row; they have simply stopped agreeing.
B_ANCHOR = "name: agent-qa-result-triage\n"
B_REPLACEMENT = "name: agent-qa-triage-results\n"

# C — one op row deleted from the COMMITTED artifact by hand. `rowCount` is deliberately left at its
# old value, because that is what a hand edit leaves behind and the freshness leg pins it too.
C_ANCHOR = '''    {
      "description": "List the completed runs recorded for this project.",
      "docAbsentReason": "D-07 (dated 2026-08-16): no canonical doc ships for this capability yet. The explicit absence is the honest state — a guessed path would existence-check green and mislead a reader — and the abstention coverage log is the demand signal for writing one.",
      "docPath": null,
      "exampleCall": {
        "arguments": {}
      },
      "id": "runs.list",
      "kind": "op",
      "mcpTool": "agent_qa_list_runs",
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {},
        "type": "object"
      },
      "requiredScopes": [
        "read"
      ],
      "surfaces": [
        "chat",
        "mcp"
      ]
    },
'''

# D — one entry deleted from the shipped v1 -> v2 migration map. A frozen array literal one member
# short: it compiles, it type-checks, and every other entry is still correct. Raw string, so the TS
# source's own backslash-escaped apostrophe survives byte for byte.
D_ANCHOR = r'''  // 1
  Object.freeze({
    v1Name: 'agent_qa_discover',
    arm: 'retired',
    note:
      'not-a-gap (397, 2026-08-16): the protocol answers discovery itself, so a hand-written '
      + 'catalogue tool beside it would be a second, drifting answer to one question.',
    route:
      '`tools/list` (plus SEP-2575 `server/discover`) answers machine discovery; 398\'s build-time '
      + 'capability catalog, carried by `agent-qa init --agent`, answers the human-facing version.',
  }),
'''

# E — one op row's `surfaces` array hand-edited in the COMMITTED artifact. The row is still there and
# still parses against the published contract; one field now claims a smaller reach than the tree
# gives it. Anchored through the row's own `id` line so the edit cannot land on a different row.
E_ANCHOR = '''      "id": "runs.list",
      "kind": "op",
      "mcpTool": "agent_qa_list_runs",
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {},
        "type": "object"
      },
      "requiredScopes": [
        "read"
      ],
      "surfaces": [
        "chat",
        "mcp"
      ]
'''
E_REPLACEMENT = '''      "id": "runs.list",
      "kind": "op",
      "mcpTool": "agent_qa_list_runs",
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {},
        "type": "object"
      },
      "requiredScopes": [
        "read"
      ],
      "surfaces": [
        "chat"
      ]
'''

# F — the explain ANSWER CHANNEL reverted at one line (398-13, D-21). The collector is handed a
# string literal naming an op that exists nowhere instead of the step's own function id, so it never
# matches, no rendered lines are collected, and the turn's `answer` field goes back to what it was
# before the channel existed. It compiles, it type-checks, it ships — and no person can read a
# grounded capability answer again, which is exactly the state 398-12 measured and this leg guards.
F_ANCHOR = (
    "        answerLines.push(...explainAnswerLines(step.functionId, answered))\n"
)
F_REPLACEMENT = (
    "        answerLines.push(...explainAnswerLines('398F-no-such-op', answered))\n"
)

MUTATIONS = {
    'A': ('packages/agent/src/chat/resolver-table.ts', [(A_ANCHOR, A_REPLACEMENT)]),
    'B': ('packages/cli/skills/agent-qa-result-triage/SKILL.md', [(B_ANCHOR, B_REPLACEMENT)]),
    'C': ('packages/cli/capability-catalog/capability-catalog.json', [(C_ANCHOR, '')]),
    'D': ('packages/mcp/src/migration-map.ts', [(D_ANCHOR, '')]),
    'E': ('packages/cli/capability-catalog/capability-catalog.json', [(E_ANCHOR, E_REPLACEMENT)]),
    'F': ('packages/agent/src/chat/turn-engine.ts', [(F_ANCHOR, F_REPLACEMENT)]),
}

if name not in MUTATIONS:
    sys.exit('FATAL: unknown mutation %s' % name)

relative, edits = MUTATIONS[name]
path = os.path.join(root, relative)
with open(path, encoding='utf-8') as handle:
    source = handle.read()
for index, (anchor, replacement) in enumerate(edits, start=1):
    found = source.count(anchor)
    if found != 1:
        sys.exit(
            'FATAL: mutation %s edit %d expected exactly one occurrence of its anchor, found %d'
            % (name, index, found)
        )
    source = source.replace(anchor, replacement, 1)
with open(path, 'w', encoding='utf-8') as handle:
    handle.write(source)
MUTATE_PY

subject_of () {
  case "$1" in
    A) echo "$SUBJECT_A" ;;
    B) echo "$SUBJECT_B" ;;
    C) echo "$SUBJECT_C" ;;
    D) echo "$SUBJECT_D" ;;
    E) echo "$SUBJECT_E" ;;
    F) echo "$SUBJECT_F" ;;
    *) fatal "unknown leg $1" ;;
  esac
}

snapshot_of () {
  case "$1" in
    A) echo "$SNAP_A" ;;
    B) echo "$SNAP_B" ;;
    C) echo "$SNAP_C" ;;
    D) echo "$SNAP_D" ;;
    E) echo "$SNAP_E" ;;
    F) echo "$SNAP_F" ;;
    *) fatal "unknown leg $1" ;;
  esac
}

marker_of () {
  case "$1" in
    A) echo "$MARKER_A" ;;
    D) echo "$MARKER_D" ;;
    F) echo "$MARKER_F" ;;
    *) echo "" ;;
  esac
}

# `introduced` — 0 at rest, >=1 under the mutation. `removed` — >=1 at rest, 0 under the mutation.
marker_polarity_of () {
  case "$1" in
    A) echo "introduced" ;;
    D) echo "removed" ;;
    F) echo "introduced" ;;
    *) echo "" ;;
  esac
}

dist_of () {
  case "$1" in
    A) echo "$DIST_AGENT" ;;
    D) echo "$DIST_MCP" ;;
    F) echo "$DIST_AGENT" ;;
    *) echo "" ;;
  esac
}

needle_of () {
  case "$1" in
    A) echo "runs-status" ;;
    B) echo "agent-qa-triage-results" ;;
    C) echo "op:runs.list.row" ;;
    D) echo "agent_qa_discover" ;;
    E) echo "op:runs.list.surfaces" ;;
    F) echo "op:runs.start" ;;
    *) fatal "unknown leg $1" ;;
  esac
}

label_of () {
  case "$1" in
    A) echo "one /help line's alias renamed, the routing rule left alone" ;;
    B) echo "a skill renamed in SKILL.md frontmatter and not on disk" ;;
    C) echo "one op row hand-deleted from the COMMITTED catalog" ;;
    D) echo "one entry deleted from the shipped v1 -> v2 migration map" ;;
    E) echo "one committed op row's surfaces array hand-edited" ;;
    F) echo "the explain answer channel reverted at one line (D-21)" ;;
    *) fatal "unknown leg $1" ;;
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

# THE DEPENDENCY-ORDERED REBUILD. Every package the two suites read through a dist, in the order
# their dists depend on one another, on every apply AND on every restore.
rebuild_dists () {
  if [ "${CATALOG_MUTATION_NO_BUILD:-0}" = "1" ]; then
    note "build: SKIPPED (CATALOG_MUTATION_NO_BUILD=1) — no result from this run is evidence"
    return 0
  fi
  local pkg rc
  for pkg in @vostride/agent-qa-schema @vostride/agent-qa-safety @vostride/agent-qa-agent \
             @vostride/agent-qa-agent-local @vostride/agent-qa-mcp agent-qa; do
    set +e
    (cd "$ROOT" && pnpm --filter "$pkg" build) >> "$WORK/build.log" 2>&1
    rc=$?
    set -e
    [ "$rc" -eq 0 ] || { tail -40 "$WORK/build.log" >&2; fatal "the rebuild of $pkg failed — see $WORK/build.log"; }
  done
}

# THE PROOF THAT THE REBUILD TOOK, in whichever direction the leg moves its marker.
assert_dist_marker () {
  local leg="$1" phase="$2"   # phase: mutated | at-rest
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if [ "${CATALOG_MUTATION_NO_BUILD:-0}" = "1" ]; then return 0; fi
  local dist marker polarity seen expectation
  dist="$(dist_of "$leg")"
  marker="$(marker_of "$leg")"
  polarity="$(marker_polarity_of "$leg")"
  # A LEG WHOSE SUBJECT NO DIST CARRIES SAYS SO, rather than grepping an artifact that could never
  # hold its marker and reading the inevitable 0 as evidence. Legs B, C and E edit a SKILL.md and a
  # committed JSON file, both of which the suite reads straight from source.
  if [ -z "$marker" ]; then
    note "  no dist carries leg $leg's subject (read from source) — no rebuild proof to make"
    return 0
  fi
  case "$polarity:$phase" in
    introduced:mutated|removed:at-rest) expectation="present" ;;
    introduced:at-rest|removed:mutated) expectation="absent" ;;
    *) fatal "leg $leg has no marker expectation for $polarity:$phase" ;;
  esac
  # `pipefail` is on and `grep` exits 1 when it matches nothing — which is an EXPECTED reading in
  # half the cases here. Without the `|| true` the absent case would kill the script under `set -e`
  # before it could report the count it was asked for.
  seen="$( { grep -oF -- "$marker" "$ROOT/$dist" 2>/dev/null || true; } | wc -l | tr -d ' ')"
  note "  dist marker '$marker' in $dist: $seen occurrence(s) (expected $expectation, $polarity/$phase)"
  case "$expectation" in
    present)
      [ "$seen" -ge 1 ] || fatal "$dist does not carry leg $leg's marker — the rebuild did not take, so any result measured through it is a result about the PREVIOUS build"
      ;;
    absent)
      [ "$seen" -eq 0 ] || fatal "$dist still carries leg $leg's marker — the rebuild did not take, or the tree is not back where it started"
      ;;
  esac
}

# ── One measurement: BOTH suites, classified ────────────────────────────────────────────────────
#
# Sets RUN_NAMES / RUN_FAILED / RUN_MESSAGES / RUN_STDOUT (files) and RUN_TOTAL_CLI / RUN_TOTAL_MCP.
# Globals rather than printed values on purpose: `X="$(run_suites)"` would run this in a subshell,
# where `fatal`'s `exit 1` kills only that subshell and the script sails on with an empty answer.
RUN_NAMES=""
RUN_FAILED=""
RUN_MESSAGES=""
RUN_STDOUT=""
RUN_TOTAL_CLI=0
RUN_TOTAL_MCP=0

# SETS A GLOBAL RATHER THAN PRINTING ITS ANSWER. `TOTAL="$(run_one_suite …)"` would run this in a
# subshell, where `fatal`'s `exit 1` kills only that subshell and the script sails on with an empty
# answer — the exact trap 397's script documents.
RUN_ONE_TOTAL=0
run_one_suite () {
  local label="$1" dir="$2" prefix="$3" floor="$4" spec="$5"
  local report="$WORK/report.$label.json"
  local names="$WORK/names.$label" failed="$WORK/failed.$label"
  local messages="$WORK/messages.$label" stdout="$WORK/stdout.$label"
  rm -f "$report" "$names" "$failed" "$messages"
  # TWO REPORTERS, AND THE SECOND IS NOT DECORATION. Classification needs the JSON report's exact
  # `fullName`s; but the NAME of a mutated member does not survive into `failureMessages` — chai
  # truncates a deep diff to `expected [ 'digest', 'fn', 'help', …(7) ]` and prints the member that
  # moved only in the unified diff the DEFAULT reporter renders. Both are captured, and the needle
  # is required in either.
  #
  # The exit code is read from the process, never through a pipe; a red suite is EXPECTED under a
  # mutation, so the run itself must not abort the script under `set -e`.
  if [ -n "$spec" ]; then
    (cd "$dir" && npx vitest run "$spec" \
        --reporter=default --reporter=json --outputFile.json="$report") > "$stdout" 2>&1 || true
  else
    (cd "$dir" && npx vitest run \
        --reporter=default --reporter=json --outputFile.json="$report") > "$stdout" 2>&1 || true
  fi
  [ -f "$report" ] || { tail -40 "$stdout" >&2; fatal "$label produced no JSON report — the suite did not run at all"; }

  local classified total
  classified="$(node "$WORK/classify.mjs" "$report" "$prefix" "$names" "$failed" "$messages")"
  case "$classified" in
    UNREADABLE*) fatal "$label's JSON report could not be read: ${classified#UNREADABLE }" ;;
  esac
  total="$(printf '%s\n' "$classified" | sed -n 's/^TOTAL=//p')"
  [ -n "$total" ] || fatal "$label's JSON report carried no test total"
  # THE UNFAITHFUL RULE, MECHANISED. A mutation that killed collection rather than reaching a
  # detector reports a total under the floor, and this is where the run stops.
  if [ "$total" -lt "$floor" ]; then
    tail -40 "$stdout" >&2
    fatal "UNFAITHFUL: $label collected $total cells, fewer than the frozen floor of $floor — the mutation broke collection instead of reaching its detector, so nothing measured here is evidence"
  fi
  RUN_ONE_TOTAL="$total"
}

run_suites () {
  local label="$1"
  RUN_NAMES="$WORK/names.$label"
  RUN_FAILED="$WORK/failed.$label"
  RUN_MESSAGES="$WORK/messages.$label"
  RUN_STDOUT="$WORK/stdout.$label"

  run_one_suite "$label.cli" "$CLI_DIR" "cli::" "$FROZEN_MIN_CLI_TESTS" "$CLI_SUITE_REL"
  RUN_TOTAL_CLI="$RUN_ONE_TOTAL"
  run_one_suite "$label.mcp" "$MCP_DIR" "mcp::" "$FROZEN_MIN_MCP_TESTS" ""
  RUN_TOTAL_MCP="$RUN_ONE_TOTAL"

  cat "$WORK/names.$label.cli" "$WORK/names.$label.mcp" | { grep -v '^$' || true; } | sort -u > "$RUN_NAMES"
  cat "$WORK/failed.$label.cli" "$WORK/failed.$label.mcp" | { grep -v '^$' || true; } | sort -u > "$RUN_FAILED"
  cat "$WORK/messages.$label.cli" "$WORK/messages.$label.mcp" > "$RUN_MESSAGES"
  cat "$WORK/stdout.$label.cli" "$WORK/stdout.$label.mcp" > "$RUN_STDOUT"
  note "  $label: cli $RUN_TOTAL_CLI cells + mcp $RUN_TOTAL_MCP cells, $(grep -c . "$RUN_FAILED" || true) red"
}

BASELINE_NAMES="$WORK/baseline-cell-names.txt"
SUMMARY="$WORK/summary.txt"

# ── One leg ─────────────────────────────────────────────────────────────────────────────────────
run_leg () {
  local leg="$1"
  local subject snapshot allowed vanished needle label baseline restored
  subject="$(subject_of "$leg")"
  snapshot="$(snapshot_of "$leg")"
  allowed="$WORK/allowed.$leg"
  vanished="$WORK/vanished.$leg"
  needle="$(needle_of "$leg")"
  label="$(label_of "$leg")"
  baseline="$(sha_of "$snapshot")"

  echo
  echo "=== LEG $leg — $label"
  echo "    subject $subject"
  echo "    sha256  $baseline"

  apply_mutation "$leg"
  assert_applied "$leg"
  note "  applied; subject sha256 now $(sha_of "$ROOT/$subject")"

  rebuild_dists
  assert_dist_marker "$leg" mutated

  run_suites "$leg"

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
  # and it is the half `--selftest` exercises.
  local missing=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! grep -Fxq -- "$line" "$RUN_FAILED"; then
      echo "FATAL: leg $leg's allowed cell did NOT red — the suite is green under an implementation it must catch: $line" >&2
      missing=1
    fi
  done < "$allowed"

  # DIRECTION 3 — the denominator. A cell that ceased to exist is not a cell that passed, and a cell
  # that appeared under a mutation is a suite measuring the mutation rather than the tree.
  local gone appeared=0 wrong_vanish=0
  comm -23 "$BASELINE_NAMES" "$RUN_NAMES" > "$WORK/vanished.observed.$leg"
  comm -13 "$BASELINE_NAMES" "$RUN_NAMES" > "$WORK/appeared.observed.$leg"
  while IFS= read -r gone; do
    [ -z "$gone" ] && continue
    if ! grep -Fxq -- "$gone" "$vanished"; then
      echo "FATAL: leg $leg made a cell CEASE TO EXIST that its vanish list does not name: $gone" >&2
      wrong_vanish=1
    fi
  done < "$WORK/vanished.observed.$leg"
  while IFS= read -r gone; do
    [ -z "$gone" ] && continue
    if ! grep -Fxq -- "$gone" "$WORK/vanished.observed.$leg"; then
      echo "FATAL: leg $leg's vanish list names a cell that did NOT vanish: $gone" >&2
      wrong_vanish=1
    fi
  done < "$vanished"
  if [ -s "$WORK/appeared.observed.$leg" ]; then
    sed 's/^/    + /' "$WORK/appeared.observed.$leg" >&2
    echo "FATAL: leg $leg made cells APPEAR — the suite's denominator moves with the mutation" >&2
    appeared=1
  fi
  if [ -s "$WORK/vanished.observed.$leg" ]; then
    echo "  cells that ceased to exist (pinned, see the header):"
    sed 's/^/    ~ /' "$WORK/vanished.observed.$leg"
  fi

  [ "$unexpected" -eq 0 ] && [ "$missing" -eq 0 ] && [ "$wrong_vanish" -eq 0 ] && [ "$appeared" -eq 0 ] \
    || fatal "leg $leg failed exact discrimination (see above). No leg is ever widened to accept any-red."

  # THE RED MUST NAME THE THING, ON THE SURFACE A PERSON READS. A cell that reds without naming the
  # member that moved tells a reviewer that something is wrong and not what. Both channels are
  # searched — the assertion message and the console diff — because the name lands in whichever one
  # the value's depth allows.
  if ! grep -Fq -- "$needle" "$RUN_MESSAGES" && ! grep -Fq -- "$needle" "$RUN_STDOUT"; then
    sed -n '1,80p' "$RUN_MESSAGES" >&2
    fatal "leg $leg red the right cells but nothing in its output NAMES '$needle' — an unnamed red is not a proof a person can act on"
  fi
  note "  the red names '$needle'"

  # VERBATIM, BOTH CHANNELS. The assertion messages say which claim broke; the console section says
  # WHICH MEMBER broke it. A run that printed only the first would be asking the reader to take the
  # naming on trust.
  echo "  --- verbatim, the assertion messages ---"
  sed -n '1,40p' "$RUN_MESSAGES" | sed 's/^/  | /'
  echo "  --- verbatim, the console's own diff (the surface a person reads) ---"
  awk '/Failed Tests/ { seen = 1 } seen' "$RUN_STDOUT" | sed -n '1,60p' | sed 's/^/  | /'
  echo "  --------------------------------------------------------------------"

  {
    echo "LEG $leg — $label"
    echo "  subject: $subject (sha256 $baseline)"
    echo "  red:"
    sed 's/^/    - /' "$RUN_FAILED"
    if [ -s "$WORK/vanished.observed.$leg" ]; then
      echo "  vanished:"
      sed 's/^/    ~ /' "$WORK/vanished.observed.$leg"
    fi
    echo "  named: $needle"
    echo
  } >> "$SUMMARY"

  # ── Restore, prove it, and return to green ───────────────────────────────────────────────────
  cp "$snapshot" "$ROOT/$subject"
  restored="$(sha_of "$ROOT/$subject")"
  [ "$restored" = "$baseline" ] || fatal "$subject was not restored byte-identically ($restored, expected $baseline)"
  note "  subject restored byte-identically (sha256 $restored)"

  rebuild_dists
  assert_dist_marker "$leg" at-rest

  run_suites "$leg.restored"
  if [ -s "$RUN_FAILED" ]; then
    sed 's/^/    - /' "$RUN_FAILED" >&2
    fatal "leg $leg did not return to green after the revert — every red above is now unattributable"
  fi
  if ! diff -q "$BASELINE_NAMES" "$RUN_NAMES" > /dev/null; then
    diff "$BASELINE_NAMES" "$RUN_NAMES" >&2 || true
    fatal "leg $leg returned to green with a DIFFERENT set of cells than the baseline — a green suite with a moved denominator is not a restored one"
  fi
  note "  reverted -> both suites green again (cli $RUN_TOTAL_CLI + mcp $RUN_TOTAL_MCP cells)"
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

for leg in $LEGS; do
  path="$(subject_of "$leg")"
  [ -f "$ROOT/$path" ] || fatal "leg $leg's subject is missing: $path"
  cp "$ROOT/$path" "$(snapshot_of "$leg")"
  note "snapshot $path  sha256 $(sha_of "$(snapshot_of "$leg")")"
done

rebuild_dists
note "dists rebuilt in dependency order"
for leg in $LEGS; do assert_dist_marker "$leg" at-rest; done

run_suites baseline
if [ -s "$RUN_FAILED" ]; then
  sed 's/^/  - /' "$RUN_FAILED" >&2
  fatal "the suites are already red before any mutation — every observation below would be meaningless"
fi
cp "$RUN_NAMES" "$BASELINE_NAMES"
note "preflight: both suites green (cli $RUN_TOTAL_CLI + mcp $RUN_TOTAL_MCP cells)"

: > "$SUMMARY"

case "${SELFTEST:-}" in
  neutered)
    echo
    note "SELFTEST=neutered — every mutation below is a NO-OP. The script MUST fail."
    ;;
esac

# ── The legs ────────────────────────────────────────────────────────────────────────────────────

for leg in $LEGS; do run_leg "$leg"; done

# ── The close ───────────────────────────────────────────────────────────────────────────────────

echo
FINAL_DIRTY="$(cd "$ROOT" && git status --porcelain | grep -vF -- "$SCRIPT_REL" || true)"
if [ -n "$FINAL_DIRTY" ]; then
  echo "$FINAL_DIRTY" >&2
  fatal "the working tree is dirty after the run — a mutation survived, which is the one outcome this script must never leave behind"
fi

echo "=== RUN SUMMARY"
cat "$SUMMARY"

echo "PASS — six per-detector mutations, each RED on exactly its allowed cells in BOTH suites and"
echo "       on no others, each red NAMING the member that moved, each denominator change pinned by"
echo "       name, every subject restored byte-identically by sha256, every rebuild proven by a dist"
echo "       marker in the direction its leg moves it, and every revert returning both suites to"
echo "       green with the same set of cells they started with."
