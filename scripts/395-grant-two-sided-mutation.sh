#!/usr/bin/env bash
#
# 395-grant-two-sided-mutation.sh — grant enforcement's two sides, carried to the model with no grants
# (395-07 · CFGM-01; re-spelled 2026-10-02 by 432-44 for D-05, D-07, D-12 and D-15).
#
# WHAT 395-07 PROVED, AND WHAT IS LEFT OF IT. This script used to sever D-02's two enforcement sides
# of the standing-approval grant and require each to red its own, disjoint cells in
# `config-grant-enforcement.test.ts`: the MINT side (`proposals.accept --always` on a flagged proposal
# records no grant) and the READ side (a covering grant does not open `config.proposal.apply` for a
# flagged proposal), plus a G0 leg that restored both subjects to the pre-395 commit `533a413f`.
# Phase 432 deleted the grant ledger, both grant ops, both proposal ops and the approvals they served
# (D-05, D-15): there is nothing left to sever, and the two subjects
# (`agent/src/functions/ops/proposals-accept.ts`, `config-proposal-apply.ts`) are gone.
#
# WHAT SURVIVES IS STILL TWO-SIDED, AND THE DISJOINTNESS IS STILL THE MEASUREMENT. A grant is
# established by WRITING the ledger and honoured by READING it. Both sides now have to stay absent:
#
#   G1  THE MINT, AS CODE: the grants.jsonl writer module returns       -> C432-RETURN-A20
#   G2  THE READ, AS CODE: the grants.jsonl reader module returns       -> C432-RETURN-A21
#   G3  THE READ, AS AN OP: `grants.list` registered again              -> C432-RETURN-A18
#   G4  THE REVOKE, AS AN OP: `grants.revoke` registered again          -> C432-RETURN-A19
#   G5  THE MINT, AS BEHAVIOUR: a direct config change appends a grant  -> (M0) (M1) (M2) (M1b)
#   G6  THE READ, AS BEHAVIOUR: the CLI host answers `grants.list`      -> C432-NO-GRANT-OPS: (B)
#
# G1-G4 are the mutation map's claim owners for "grant establishment/revocation" (432-MUTATION-MAP.md:
# A18/A19/A20/A21). G5 and G6 are the retained writer controls on the suite this script always
# measured: no change of any kind records an approval, and the grant read is an unknown function that
# leaves an old ledger byte-identical. Each leg names the one cell that is its RED and every cell it
# may red beside it; a red outside that list FATALs, so a mint plant that reds a read cell (or the
# reverse) fails this script exactly as it did before. G0 is retired: a revision with the grant
# machinery is not a tree this product can be in, and the union rule it checked is the per-leg
# allowed lists below.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named assertion.
#
# Engine, arrival proof, counted selection, byte-exact restoration, rebuilds and positive controls:
# scripts/423-mutation-engine.cjs. G3, G4 and G6 rebuild the agent package and find their marker in
# the rebuilt dist; the census reads the built workspace (`dist: true`).
#
# USAGE
#   bash agent-qa/scripts/395-grant-two-sided-mutation.sh   # from the super-repository root
#   bash scripts/395-grant-two-sided-mutation.sh            # from the agent-qa root
#
# KNOBS — GRANT_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# GRANT_MUTATION_LEG=G1..G6 runs one leg; GRANT_MUTATION_LIST=1 prints the inventory and exits.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const GRANTS_T = 'src/composition/__tests__/config-grant-enforcement.test.ts'
const REGISTRY_SRC = 'packages/agent/src/functions/registry.ts'
const HOST_SRC = 'packages/cli/src/composition/local-agent-host.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
  grants: { pkg: 'packages/cli', files: [GRANTS_T], typecheck: false, count: 12, env: { VITEST_MAX_WORKERS: '1' } },
}

const edit = (from, to) => ({ from, to })
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const grants = (name, count = 1, message) => cell('grants', GRANTS_T, name, count, message)
const DELETED_FILES = census('C432-DELETED-SYMBOLS: every deleted module file is absent')
const DELETED_DECLARED = census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')
const LEGACY_PATHS = census('C432-LEFTOVERS-UNREAD: no production code spells a legacy grant, proposal or execution-audit path')
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const M0 = grants('(M0) CONTROL: headless, a flagged change applies with no ask and writes no grant')
const M1 = grants('C432-NO-GIT-COMMIT: (M1) a flagged change lands, names its reasons, and leaves the ledger and history alone')
const M2 = grants('C432-NO-GIT-COMMIT: (M2) an in-scope change lands with no reasons and records nothing either')
const M1B = grants('C432-NO-GIT-COMMIT: (M1b) retrying the flagged change answers no-change and records nothing')
const READ_B = grants('C432-NO-GRANT-OPS: (B) the grant read is an unknown function, and the old ledger is untouched')
const UNDO_UNBOUND = grants('C432-NO-CONFIG-UNDO-PORT', 3)

const REGISTRY_ANCHOR = 'const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [\n'
const agentCrossing = marker => ({ pkg: '@vostride/agent-qa-agent', dir: 'packages/agent', marker })

/** A retired grant op registered again over a live spec, named through a marker the dist keeps. */
const registered = (opId, base, marker) => edit(REGISTRY_ANCHOR,
  `const ${marker} = '${opId}'\n${REGISTRY_ANCHOR}  { ...${base}, id: ${marker}, risk: { ...${base}.risk, name: 'fn:${opId}' } } as FunctionSpec,\n`)

const legs = [
  {
    id: 'G1', claim: 'C432-RETURN-A20', instrument: 'census', subject: 'packages/knowledge-local/src/grants/ledger.ts',
    operation: 'the mint as code: restore the grants.jsonl writer module',
    create: `import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const GRANT_LEDGER_FILENAME = 'grants.jsonl'

export function appendGrantLedgerEvents(knowledgeRoot: string, events: readonly object[]): void {
  mkdirSync(knowledgeRoot, { recursive: true })
  appendFileSync(join(knowledgeRoot, GRANT_LEDGER_FILENAME), events.map((event) => \`\${JSON.stringify(event)}\\n\`).join(''))
}
`,
    reds: [census('C432-RETURN-A20', 'A20: the grant ledger writer returned (appendGrantLedgerEvents)')],
    // A created module is a deleted module file and a deleted export; the writer spells the legacy path.
    allowed: [DELETED_FILES, DELETED_DECLARED, LEGACY_PATHS],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A21'), census('C432-RETURN-A18'), census('C432-RETURN-A19')],
  },
  {
    id: 'G2', claim: 'C432-RETURN-A21', instrument: 'census', subject: 'packages/knowledge-local/src/grants/reader.ts',
    operation: 'the read as code: restore the grants.jsonl reader module',
    create: `import { existsSync, readFileSync } from 'node:fs'

export function readGrantLedger(file: string): readonly unknown[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)
}
`,
    reds: [census('C432-RETURN-A21', 'A21: the grant ledger reader returned (readGrantLedger)')],
    allowed: [DELETED_FILES, DELETED_DECLARED],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A20'), census('C432-RETURN-A18'), census('C432-RETURN-A19')],
  },
  {
    id: 'G3', claim: 'C432-RETURN-A18', instrument: 'census', subject: REGISTRY_SRC,
    operation: 'the read as an op: register grants.list again over quarantineListSpec',
    edits: [registered('grants.list', 'quarantineListSpec', 'GRANT_READ_OP_395')],
    reds: [census('C432-RETURN-A18', "A18: grants.list returned ('grants.list')")],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A19'), census('C432-RETURN-A21')],
  },
  {
    id: 'G4', claim: 'C432-RETURN-A19', instrument: 'census', subject: REGISTRY_SRC,
    operation: 'the revoke as an op: register grants.revoke again over quarantineReleaseSpec',
    edits: [registered('grants.revoke', 'quarantineReleaseSpec', 'GRANT_REVOKE_OP_395')],
    reds: [census('C432-RETURN-A19', "A19: grants.revoke returned ('grants.revoke')")],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A18'), census('C432-RETURN-A20')],
  },
  {
    id: 'G5', claim: 'NO-CHANGE-RECORDS-AN-APPROVAL', instrument: 'grants', subject: HOST_SRC,
    operation: 'the mint as behaviour: the direct config writer appends a grant line after every applied change',
    edits: [edit("      if (outcome.kind === 'ok') {\n",
      "      if (outcome.kind === 'ok') {\n"
      + "        writeFileSync(join(configDir, 'agent-qa-knowledge', 'grants.jsonl'),\n"
      + "          `${JSON.stringify({ schemaVersion: 1, kind: 'grant', actionClass: 'fn:config.field.set' })}\\n`, { flag: 'a' })\n")],
    reds: [M1],
    // Every cell that compares the ledger before and after an applied change sees the same line.
    allowed: [M0, M2, M1B],
    // The read side and the refused pre-432 records never reach the writer.
    greens: [READ_B, UNDO_UNBOUND],
  },
  {
    id: 'G6', claim: 'C432-NO-GRANT-OPS', instrument: 'grants', subject: REGISTRY_SRC,
    operation: 'the read as behaviour: the CLI host answers grants.list again',
    edits: [registered('grants.list', 'quarantineListSpec', 'GRANT_READ_OP_395')],
    crossing: agentCrossing('GRANT_READ_OP_395'),
    reds: [READ_B],
    allowed: [],
    // The mint side and the refused records do not read a grant op.
    greens: [M0, M1, M2, M1B, UNDO_UNBOUND],
  },
]

runGate({
  slug: '395-grant-two-sided-mutation', envPrefix: 'GRANT_MUTATION',
  instruments, legs, expectedLegs: 6, explicitIds: true, parseCheck: true, banner: 'GRANT_TWO_SIDED_MUTATION_OK',
})
NODE
