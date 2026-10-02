#!/usr/bin/env bash
#
# 396-fidelity-mutation.sh — the acceptance bar for D-16's projection cells (396-04; rebuilt 2026-10-02
# by 432-45 on the shared 423 engine, closure extension for 432-12 deferred item 5).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `projection-fidelity.test.ts` passing
# says the advertised documents agree with the function layer's own projections today. Drift is
# IMPOSSIBLE for the reason D-16 says — the advertised schema and the validated schema are one
# object — so the only place drift can actually enter is the JOIN: `mapping.ts` naming the wrong
# contract for an op. Every leg is exactly that, and each must red its OWN named cell:
#
#   P1  RE-AIMED 2026-10-02 (432-45). `runs.digest`'s contract entry re-pointed at another read's
#       contracts. It used the proposals-list contracts, which 432-12 removed from the table and 432-17
#       deleted; the row above it now is `runs.list`, so the copy-paste is that row.
#                                                   -> matches the registry projection for every tool
#   P2  the pipeline's advertised input swapped for its SECOND arm (`entities.get` for
#       `entities.resolve`). First measured GREEN in 2026-08; the identity cell exists because of that.
#                                                   -> advertises the op's OWN contract object
#   P3  `agent_qa_start_run` removed from `DEGRADED_OUTPUT_CONTRACTS` — a list somebody tidied. The
#       build refuses, which is the point.          -> advertises no outputSchema for exactly the
#                                                      declared degradations, and says so
#   P4  RE-ANCHORED 2026-10-02 (432-45). The config change tool's advertised input swapped for the
#       knowledge change tool's; the tool was `agent_qa_propose_config_change` until 432-12 renamed it
#       `agent_qa_change_config`.                   -> matches the registry projection for every tool
#
# Under the twenty-tool model these legs are the inherited projection-fidelity proof (D-12 kept
# every door; the projection itself did not change shape).
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named cell. Co-reds were measured by
# planting every leg once (432-45) and are listed per leg with the reason.
#
# THE SUBJECT IS IN-PACKAGE, SO NO DIST REBUILD STANDS BETWEEN AN EDIT AND ITS MEASUREMENT: every leg
# edits `packages/mcp/src/mapping.ts`, which vitest resolves from source.
#
# Engine, arrival proof, counted selection, byte-exact restoration and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-fidelity-mutation.sh   # from the super-repository root
#   bash scripts/396-fidelity-mutation.sh            # from the agent-qa root
#
# KNOBS — FIDELITY_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# FIDELITY_MUTATION_LEG=P1..P4 runs one leg; FIDELITY_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const MAPPING = 'packages/mcp/src/mapping.ts'
const SUITE = 'src/__tests__/projection-fidelity.test.ts'

// Count measured from a fresh Vitest JSON report of exactly this file (2026-10-02, 432-45).
const instruments = {
  fidelity: { pkg: 'packages/mcp', files: [SUITE], typecheck: false, count: 15 },
}

const edit = (from, to) => ({ from, to })
const fid = name => cell('fidelity', SUITE, name)

const LISTED = fid('the advertised catalogue is what the mapping declares > advertises every declared tool, in the declared order, on a real build')
const LISTED_READ = fid('the advertised catalogue is what the mapping declares > advertises every declared tool to a caller granted only read, as to every caller')
const MATCHES = fid("the advertised schema equals the function layer's own projection (D-16) > matches the registry projection for every tool, on both sides")
const IDENTITY = fid("the advertised schema equals the function layer's own projection (D-16) > advertises the op's OWN contract object, not one that merely agrees with it")
const DESCRIPTION = fid("the advertised schema equals the function layer's own projection (D-16) > carries a field description from the zod contract all the way to the wire")
const DEGRADED = fid('degradation is explicit, never a silently narrowed document (D-16) > advertises no outputSchema for exactly the declared degradations, and says so')
const REAL_OUTPUT = fid('degradation is explicit, never a silently narrowed document (D-16) > advertises a real outputSchema for every other tool')
const REMEASURED = fid('degradation is explicit, never a silently narrowed document (D-16) > re-measures the converter refusal each entry records')
const DEEP_EQUAL = fid('the build is deterministic (idempotency) > advertises deep-equal documents across two independent builds')
const SAME_ORDER = fid('the build is deterministic (idempotency) > advertises the same order across two independent builds')
const ANNOTATIONS = fid('the build is deterministic (idempotency) > derives annotations from the ops rather than from the tool name')
const CARRIER_META = fid('the App carrier declaration is registry data (408 D-05) > derives _meta.ui.resourceUri for a carrier and NO _meta at all for a non-carrier')
const CARRIER_DOC = fid('the App carrier declaration is registry data (408 D-05) > carries the App reference through to the advertised document, on a real build')

const legs = [
  {
    id: 'P1', claim: 'PROJECTION-JOIN', instrument: 'fidelity', subject: MAPPING,
    operation: "runs.digest's contract entry re-pointed at the runs.list contracts above it",
    edits: [edit("  'runs.digest': Object.freeze({\n    input: RunsDigestInputSchema,\n    output: RunDigestSchema,\n  }),\n",
      "  'runs.digest': Object.freeze({\n    input: RunsListInputSchema,\n    output: RunsListOutputContract,\n  }),\n")],
    reds: [MATCHES],
    allowed: [],
    greens: [IDENTITY, LISTED, DEGRADED, REAL_OUTPUT, DEEP_EQUAL],
  },
  {
    id: 'P2', claim: 'OWN-CONTRACT-OBJECT', instrument: 'fidelity', subject: MAPPING,
    operation: "the pipeline advertises its second arm's input contract",
    edits: [edit('  agent_qa_get_entity: Object.freeze({\n    input: EntitiesResolveInputSchema,\n',
      '  agent_qa_get_entity: Object.freeze({\n    input: EntitiesGetInputSchema,\n')],
    reds: [IDENTITY],
    allowed: [],
    greens: [MATCHES, LISTED, DEGRADED, DEEP_EQUAL],
  },
  {
    id: 'P3', claim: 'DEGRADATION-EXPLICIT', instrument: 'fidelity', subject: MAPPING,
    operation: 'agent_qa_start_run removed from DEGRADED_OUTPUT_CONTRACTS while its contract is still unrepresentable',
    edits: [edit("  Object.freeze({\n    tool: 'agent_qa_start_run',\n    opId: 'runs.start',\n    schema: 'RunStartAcknowledgementSchema',\n"
      + "    measured: 'Transforms cannot be represented in JSON Schema',\n    adjudication: '397',\n  }),\n", '')],
    reds: [DEGRADED],
    // The build refuses, so every cell that builds a real server reds with it (measured 2026-10-02).
    allowed: [LISTED, LISTED_READ, MATCHES, DESCRIPTION, REAL_OUTPUT, REMEASURED, DEEP_EQUAL, SAME_ORDER, ANNOTATIONS,
      CARRIER_META, CARRIER_DOC],
    greens: [IDENTITY],
  },
  {
    id: 'P4', claim: 'PROJECTION-JOIN', instrument: 'fidelity', subject: MAPPING,
    operation: "the config change tool advertises the knowledge change tool's input",
    edits: [edit('  agent_qa_change_config: Object.freeze({\n    input: ConfigChangeFoldInputSchema,\n',
      '  agent_qa_change_config: Object.freeze({\n    input: KnowledgeChangeFoldInputSchema,\n')],
    reds: [MATCHES],
    // The description cell reads a field description off the config fold's advertised input
    // (measured 2026-10-02).
    allowed: [DESCRIPTION],
    greens: [IDENTITY, LISTED, DEGRADED, REAL_OUTPUT, DEEP_EQUAL],
  },
]

runGate({
  slug: '396-fidelity-mutation', envPrefix: 'FIDELITY_MUTATION',
  instruments, legs, expectedLegs: 4, explicitIds: true, parseCheck: true, banner: 'FIDELITY_MUTATION_OK',
})
NODE
