#!/usr/bin/env bash
#
# 399.1-render-mutation.sh — the acceptance bar for the chat render contract (Phase 399.1, FUNC-05;
# re-spelled 2026-10-02 by 432-44 onto the shared engine, with the approval remedies carried to their
# current absence cells and the plain production refusal held).
#
# WHAT THIS PROVES, AND WHY A GREEN CONFORMANCE DIRECTORY DOES NOT PROVE IT. Phase 393's terminating
# lesson: A DETECTOR'S BAR IS THE IMPLEMENTATION IT MUST RED ON, NEVER THE SUITE IT PASSES. 399.1
# shipped four load-bearing render mechanisms, and each of the first four legs edits shipped source
# into the implementation 399.1 forbids:
#
#   CHANNEL (H1)  the turn stops putting anything on `results[]` — the pre-399.1 drop site reborn. The
#                 payload is computed and discarded (`void answered.payload`), which is LITERALLY
#                 what the engine did before D-05 gave the turn a member that could carry one.
#   VERDICT (H2)  `config.field.set`'s fold reports the `blocked` arm as `executed` — G-399-2 itself:
#                 a guardrail declined to write a secret, the file was byte-unchanged, and chat said
#                 the change was carried out. (The fold is now `classifyConfigChangeOutput`, the one
#                 verdict all six config change ops share since 432-12.)
#   CENSUS (H3)   the declaration projection drops `classifies` for ONE op while the op keeps folding:
#                 the `as`-cast bypass the type system cannot see, stated as a projection lie.
#   ROSTER (H4)   the `fn` row is removed from `SURFACE_ROSTER`. The door still exists and still
#                 dispatches; the roster simply stops naming it.
#
# THE VERDICT LEG'S FINDING (2026-08-20) STILL STANDS: on its first run it reddened nothing, because
# every content assertion read the post-marker slice and the verdict word precedes it. The suite was
# fixed (`reports each arm's own VERDICT WORD on the receipt line, refusals and success alike`); the
# leg was never narrowed.
#
# CARRIED BY 432-44 (432-MUTATION-MAP.md: "Approval remedies -> four separate remedy rows and both
# renderer rows; plain masked production refusal stays"). The execution gate minted typed remedies
# (answer the confirm, pass the trust flag, keep the chat open, present a bearer scope) and two
# renderers printed them under a denial. D-15 deleted the vocabulary and both renderers, so:
#
#   R1-R4  each remedy kind returns as a single-member vocabulary    -> C432-RETURN-A69 / A70 / A71 / A72
#   R5     the CLI receipt grows a remedy line again                 -> C432-RETURN-A73
#   R6     the dashboard denial block grows a remedy line again      -> C432-RETURN-A74
#   P1     the production refusal suggests an approval command again -> C432-PLAIN-REFUSAL (the CLI door)
#   P2     the production refusal stops scrubbing a target name      -> the refusal-line hygiene cells
#
# P1 and P2 are the retained half: the one refusal left at the doors is a plain sentence, built by the
# shared producer, naming the target and the config line and nothing a person could answer — and a
# hostile target name cannot add, erase or overwrite that line.
#
# THE RED SETS ARE ALMOST DISJOINT, AND THAT IS THE POINT OF HAVING MANY. The nested-composition
# anchor reds under CHANNEL and under VERDICT by two different roads (CHANNEL takes away the inner
# refusal it reads for non-vacuity; VERDICT turns that refusal into a success). The four remedy rows
# share one deleted module, so each lists the other three as co-reds; every other cell is in at most
# one leg's list.
#
# THE DENOMINATOR. The old script ran the whole conformance directory with a forced workspace build
# around every measurement. The engine selects, by exact count, the four conformance files that hold
# every cell these legs name (render anchors, render parity, the classifier census and the parity
# suite), rebuilds only the agent package a leg mutates, finds the leg's own bytes in the rebuilt dist,
# and ends with a forced workspace build. The CLI bundle keeps its workspace dependencies external, so
# the spawned binary reads the rebuilt agent dist.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a
# load failure, a different selected count or a red outside a leg's list.
#
# Engine: scripts/423-mutation-engine.cjs (arrival proof, counted selection, byte-exact restoration,
# rebuilds and positive controls).
#
# USAGE
#   bash agent-qa/scripts/399.1-render-mutation.sh   # from the super-repository root
#   bash scripts/399.1-render-mutation.sh            # from the agent-qa root
#
# KNOBS — RENDER_MUTATION_SELFTEST (was SELFTEST; the old RENDER_MUTATION_NO_BUILD is retired)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# RENDER_MUTATION_LEG=<id> runs one leg; RENDER_MUTATION_LIST=1 prints the inventory and exits.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const ANCHORS_T = 'src/__tests__/conformance/render-anchors.test.ts'
const SHAPE_T = 'src/__tests__/conformance/render-parity.test.ts'
const CLASSIFIER_T = 'src/__tests__/conformance/classifier-census.test.ts'
const PARITY_T = 'src/__tests__/conformance/parity.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const PLAIN_T = 'src/__tests__/receipt-remedy-render.test.ts'
const HYGIENE_T = 'src/composition/__tests__/run-risk.test.ts'
const PRODUCTION_SRC = 'packages/schema/src/config/production.ts'
const REMEDY_MODULE = 'packages/schema/src/safety/remedies.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  conformance: { pkg: 'packages/cli', files: [ANCHORS_T, SHAPE_T, CLASSIFIER_T, PARITY_T], typecheck: false, count: 202, dist: true, env: { VITEST_MAX_WORKERS: '1' } },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
  plain: { pkg: 'packages/cli', files: [PLAIN_T], typecheck: false, count: 5, env: { VITEST_MAX_WORKERS: '1' } },
  hygiene: { pkg: 'packages/agent-local', files: [HYGIENE_T], typecheck: false, count: 9 },
}

const edit = (from, to) => ({ from, to })
const anchors = name => cell('conformance', ANCHORS_T, name)
const shape = name => cell('conformance', SHAPE_T, name)
const classifier = name => cell('conformance', CLASSIFIER_T, name)
const parity = name => cell('conformance', PARITY_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const plain = name => cell('plain', PLAIN_T, name)
const hygiene = name => cell('hygiene', HYGIENE_T, name)
const agentCrossing = marker => ({ pkg: '@vostride/agent-qa-agent', dir: 'packages/agent', marker, reference: "'@vostride/agent-qa-agent'" })
const schemaCrossing = marker => ({ pkg: '@vostride/agent-qa-schema', dir: 'packages/schema', marker })
const DELETED_FILES = census('C432-DELETED-SYMBOLS: every deleted module file is absent')
const DELETED_DECLARED = census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const NESTED = anchors('the nested composition: a refusal is never a success one composition layer up')
const VERDICT_WORD = anchors("reports each arm's own VERDICT WORD on the receipt line, refusals and success alike")
const THREE_READINGS = anchors('renders three DIFFERENT filed payloads as three different terminal readings')
const EMPTY_TURN = shape('prints no payload block, and no `undefined`, for a turn that executed nothing')

/** One remedy kind returned as a single-member vocabulary where the vocabulary lived. */
const remedyKind = (id, mapId, literal) => ({
  id, claim: `C432-RETURN-${mapId}`, instrument: 'census', subject: REMEDY_MODULE,
  operation: `the ${literal} remedy returns as a single-member vocabulary`,
  create: `export const GATE_REMEDY_KINDS = ['${literal}'] as const\n\nexport type GateRemedyKind = (typeof GATE_REMEDY_KINDS)[number]\n`,
  reds: [census(`C432-RETURN-${mapId}`, `${mapId}: the ${literal} remedy returned ('${literal}')`)],
  // One deleted module holds all four kinds, so each sibling row sees the module return.
  allowed: [...['A69', 'A70', 'A71', 'A72'].filter(other => other !== mapId).map(other => census(`C432-RETURN-${other}`)),
    DELETED_FILES, DELETED_DECLARED],
  greens: [...CENSUS_CONTROLS, census('C432-RETURN-A73'), census('C432-RETURN-A74')],
})

const legs = [
  {
    id: 'H1', claim: 'CHANNEL', instrument: 'conformance', subject: 'packages/agent/src/chat/turn-engine.ts',
    operation: 'the turn puts nothing on results[] — the pre-399.1 drop site reborn',
    edits: [edit('        results.push({ functionId: step.functionId, payload: answered.payload })\n', '        void answered.payload\n')],
    crossing: agentCrossing('void answered.payload'),
    reds: [
      shape('a mixed-outcome compound turn labels the surviving payload with its own op'),
      shape("a single-clause turn stays unlabelled (the guard's reject side)"),
      shape("prints a compound turn's payloads in the order its clauses ran"),
      anchors('prints the guardrail refusal and its findings when a mutation would write a secret'),
      anchors('prints the reviewable diff when the mutation is genuinely proposed'),
      anchors("prints the validation refusal and the validator's own words when the result is invalid"),
      anchors("renders a SECOND op's payload too, on the read door chat advertises itself"),
      NESTED,
      anchors("chat: the shipped binary prints the bytes this process renders from its own filed result"),
    ],
    allowed: [],
    // An empty channel satisfies the empty-turn cell, and three receipts still differ by verdict.
    greens: [EMPTY_TURN, THREE_READINGS, VERDICT_WORD],
  },
  {
    id: 'H2', claim: 'VERDICT', instrument: 'conformance', subject: 'packages/agent/src/functions/ops/config-propose-verdict.ts',
    operation: "config.field.set's blocked arm reports executed — G-399-2, exactly",
    edits: [edit("    case 'blocked':\n      return { status: 'refused', outcome: output.blockedReason }\n",
      "    case 'blocked': {\n      const blockedArmVerdict3991 = 'executed' as const\n      return { status: blockedArmVerdict3991, outcome: output.blockedReason }\n    }\n")],
    crossing: agentCrossing('blockedArmVerdict3991'),
    reds: [VERDICT_WORD, NESTED],
    allowed: [],
    greens: [EMPTY_TURN, THREE_READINGS],
  },
  {
    id: 'H3', claim: 'CENSUS', instrument: 'conformance', subject: 'packages/agent/src/functions/registry.ts',
    operation: 'the declaration projection drops classifies for one op that still folds',
    edits: [
      edit('    ...(spec.classify === undefined ? {} : { classifies: true as const }),\n',
        "    ...(spec.classify === undefined || spec.id === CENSUS_LIE_OP_3991\n      ? {} : { classifies: true as const }),\n"),
      edit('const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [\n',
        "const CENSUS_LIE_OP_3991 = 'runs.list'\nconst BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [\n"),
    ],
    crossing: agentCrossing('CENSUS_LIE_OP_3991'),
    reds: [
      classifier('agrees with the committed ledger, so an op that STOPS folding is a reviewed diff'),
      classifier('carries exactly one classifier per registered capability, in both directions'),
      classifier('declares a classifier on every registered capability, naming any that does not'),
      parity('matches the committed golden registry, op by op and field by field'),
    ],
    allowed: [],
    greens: [classifier('control: the census self-check fires on a missing classifier AND on a stray one')],
  },
  {
    id: 'H4', claim: 'ROSTER', instrument: 'conformance', subject: 'packages/cli/src/__tests__/conformance/roster.ts',
    operation: 'the fn row is removed from SURFACE_ROSTER while the door keeps dispatching',
    edits: [edit("  Object.freeze({ id: 'fn', adapter: fnSurfaceAdapter }),\n", '')],
    reds: [
      parity('joins every row fn expectation to the live fn listing, in both directions'),
      parity('pins the roster at the four surfaces that exist today'),
    ],
    allowed: [],
    greens: [parity('matches the committed golden registry, op by op and field by field')],
  },
  remedyKind('R1', 'A69', 'answer-confirm'),
  remedyKind('R2', 'A70', 'trust-session-flag'),
  remedyKind('R3', 'A71', 'session-pin-final'),
  remedyKind('R4', 'A72', 'present-bearer-scope'),
  {
    id: 'R5', claim: 'C432-RETURN-A73', instrument: 'census', subject: 'packages/cli/src/commands/receipt-line.ts',
    operation: 'the CLI receipt grows an approval-remedy line again',
    edits: [edit('    + `  ${pc.dim(receipt.clause)}\\n    ${pc.dim(receipt.outcome)}`\n}\n',
      '    + `  ${pc.dim(receipt.clause)}\\n    ${pc.dim(receipt.outcome)}`\n    + remedyLine((receipt as { readonly remedy?: string }).remedy)\n}\n\n'
      + "function remedyLine(remedy: string | undefined): string {\n  return remedy === undefined ? '' : `\\n    ${pc.dim(`To proceed: ${remedy}`)}`\n}\n")],
    reds: [census('C432-RETURN-A73', 'A73: the CLI remedy renderer returned (remed)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A74')],
  },
  {
    id: 'R6', claim: 'C432-RETURN-A74', instrument: 'census', subject: 'packages/dashboard-ui/src/components/run-detail/denial-block.tsx',
    operation: 'the dashboard denial block grows an approval-remedy line again',
    edits: [
      edit('export function DenialBlock({ neutralReason }: { neutralReason: string }) {',
        'export function DenialBlock({ neutralReason, remedy }: { neutralReason: string; remedy?: string }) {'),
      edit('      <p className="text-foreground">{neutralReason}</p>\n',
        '      <p className="text-foreground">{neutralReason}</p>\n      {remedy === undefined ? null : <p className="text-muted-foreground">{remedy}</p>}\n'),
    ],
    reds: [census('C432-RETURN-A74', 'A74: the dashboard remedy renderer returned (remed)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A73')],
  },
  {
    id: 'P1', claim: 'C432-PLAIN-REFUSAL', instrument: 'plain', subject: PRODUCTION_SRC,
    operation: 'the production refusal suggests an approval command again',
    edits: [edit('    + `Add ${ALLOW_PRODUCTION_OPT_IN} at the top level of agent-qa.config.yaml to allow them.`\n',
      '    + `Add ${ALLOW_PRODUCTION_OPT_IN} at the top level of agent-qa.config.yaml to allow them.`\n    + ` ${trustRemedySuggestion3991}`\n'),
      edit('export function buildProductionRefusal(', "const trustRemedySuggestion3991 = 'Or re-run with --trust-session to approve this run.'\n\nexport function buildProductionRefusal(")],
    crossing: schemaCrossing('trustRemedySuggestion3991'),
    reds: [plain('C432-PLAIN-REFUSAL: the refusal names the target and the config line, and no approval or trust command')],
    // The refused receipt carries the same producer's sentence as its outcome.
    allowed: [plain('C432-PLAIN-REFUSAL: a refused or failed receipt renders its own outcome and appends no suggested command')],
    greens: [plain('C432-PLAIN-REFUSAL: the run door prints exactly `Run denied: <reason>` for a run denial'),
      plain('C432-REMEDY-TYPES-ABSENT: receipt-line exports the receipt render and nothing that renders a remedy')],
  },
  {
    id: 'P2', claim: 'REFUSAL-LINE-HYGIENE', instrument: 'hygiene', subject: PRODUCTION_SRC,
    operation: 'the production refusal stops scrubbing a target name before quoting it',
    edits: [edit('    .map((name) => `"${scrubDisclosureText(name)}"`)\n',
      '    .map((name) => `"${unscrubbedTargetName3991(name)}"`)\n'),
      edit('export function buildProductionRefusal(', 'const unscrubbedTargetName3991 = (name: string): string => name\n\nexport function buildProductionRefusal(')],
    // The suite reaches the producer through agent-local's own re-export, which imports the schema dist.
    crossing: { ...schemaCrossing('unscrubbedTargetName3991'), reference: "'@vostride/agent-qa-schema'" },
    reds: [hygiene("a 'newline' name yields ONE line and no control bytes"),
      hygiene("a 'CSI erase' name yields ONE line and no control bytes"),
      hygiene("a 'carriage return' name yields ONE line and no control bytes"),
      hygiene('keeps a Unicode name exactly and replaces what a terminal would act on')],
    allowed: [],
    greens: [hygiene('names the target and the exact line to add, and nothing a person could answer'),
      hygiene('names every production target once, in first-occurrence order')],
  },
]

runGate({
  slug: '399.1-render-mutation', envPrefix: 'RENDER_MUTATION',
  instruments, legs, expectedLegs: 12, explicitIds: true, parseCheck: true, banner: 'RENDER_MUTATION_OK',
})
NODE
