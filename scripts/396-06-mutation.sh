#!/usr/bin/env bash
#
# 396-06-mutation.sh — the acceptance bar for MCPS-03 at the wire (396-06; rebuilt 2026-10-02 by
# 432-45 on the shared 423 engine for D-05, D-12 and D-14).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Until 432-12 this script tore the two MCP
# apply doors' refuse-and-teach round (`apply-refusal.ts`): the first call refused, `confirmed: true`
# applied once, and an elicitation form rode only where it could be answered. D-05/D-14 deleted that
# round with the tools: a change tool writes on its one call and answers what it changed, `confirmed`
# is not an input anywhere, no form is sent, and a refusal is a masked error. The suites were
# re-spelled in place (`mcp-apply-differential.test.ts` at the wire over the shipped composition and a
# real store, `apply-refusal.test.ts` hermetically), and each claim is carried here to its direct
# form. Every leg must red its OWN named cell:
#
#   A1  CARRIES A1 (the refusal branch severed). The confirmation round RETURNS: a change tool refuses
#       its first, unconfirmed call (mcp dist rebuilt).
#                    -> wire 2 · C432-MCP-DIRECT-RECEIPT: accept, reject and forget each change the
#                       real store once
#   A2  CARRIES A2 (the leg the wire could not see, measured hermetically). The same returned round on
#       the hermetic suite.       -> unit C432-MCP-DIRECT-RECEIPT: the change tool applies once
#   A3  CARRIES A3 (the form attached to every refusal). The deleted refuse-and-teach module returns,
#       measured by the deletion census.   -> C432-DELETED-SYMBOLS: every deleted module file is absent
#   A4  CARRIES A4 (the refusal's own arm on the output side). The retained error channel: a writer
#       refusal stops being masked.
#                    -> unit C432-MCP-DIRECT-RECEIPT: a typed absence is data and a writer refusal is
#                       a masked error
#   A5  NEW (432-45, "direct masked receipts"): the receipt's structured channel is answered from the
#       unmasked output while the text stays masked.
#                    -> unit C432-MCP-DIRECT-RECEIPT: the change tool applies once and masks both
#                       result channels from one serialization
#   A6  NEW (432-45, "actual tool mapping"): a retired apply door is projected again (mcp dist
#       rebuilt).    -> wire 5 · lists none of the retired names
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named cell. Co-reds were measured by
# planting every leg once (432-45) and are listed per leg with the reason.
#
# DIST REBUILDS: `packages/cli`'s vitest config declares no aliases, so the wire suite's import of
# `@vostride/agent-qa-mcp` resolves through that package's BUILT dist. A1 and A6 rebuild it and find
# their own string marker there; A2, A4 and A5 are measured by the hermetic suite in `packages/mcp`,
# which vitest resolves from source; A3's census reads source text.
#
# THE WIRING GREPS (re-spelled 2026-10-02, 432-45): `apply-refusal.ts` is deleted, so its capability
# gate, strict boolean gate and accept-verb counts left with it; mapping.ts composes no apply output
# union (`composeApplyToolOutput`, was two) and catalog.ts calls no apply primitive.
#
# Engine, arrival proof, counted selection, byte-exact restoration, rebuilds and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-06-mutation.sh   # from the super-repository root
#   bash scripts/396-06-mutation.sh            # from the agent-qa root
#
# KNOBS — APPLY_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# APPLY_MUTATION_LEG=A1..A6 runs one leg; APPLY_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${APPLY_MUTATION_LIST:-}" != "1" ]]; then
  composed="$(grep -c 'composeApplyToolOutput(' packages/mcp/src/mapping.ts || true)"
  apply_calls="$(grep -c 'createApplyToolHandler(' packages/mcp/src/catalog.ts || true)"
  [[ ! -e packages/mcp/src/apply-refusal.ts ]] || { echo "FATAL: the refuse-and-teach module is back — D-05" >&2; exit 1; }
  [[ "$composed" == "0" ]]    || { echo "FATAL: mapping.ts composes an apply output union again ($composed) — D-05" >&2; exit 1; }
  [[ "$apply_calls" == "0" ]] || { echo "FATAL: catalog.ts calls the deleted apply primitive ($apply_calls) — D-05" >&2; exit 1; }
  echo "wiring greps: apply-refusal.ts absent · composed apply output 0 · apply primitive 0"
fi

exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const WIRE_T = 'src/__tests__/mcp-apply-differential.test.ts'
const UNIT_T = 'src/__tests__/apply-refusal.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const CATALOG = 'packages/mcp/src/catalog.ts'
const MASKED = 'packages/mcp/src/masked-result.ts'
const MAPPING = 'packages/mcp/src/mapping.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-45).
const instruments = {
  wire: { pkg: 'packages/cli', files: [WIRE_T], typecheck: false, count: 8, env: { VITEST_MAX_WORKERS: '1' } },
  unit: { pkg: 'packages/mcp', files: [UNIT_T], typecheck: false, count: 8 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
}

const edit = (from, to) => ({ from, to })
const wire = name => cell('wire', WIRE_T, name)
const unit = name => cell('unit', UNIT_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const W_CONFIG = wire('1 · changing config writes in the call and commits nothing > writes the change on the first call, files nothing, and leaves history exactly where it was')
const W_DIRECT = wire('2 · C432-MCP-DIRECT-RECEIPT: knowledge changes apply on their one call > C432-MCP-DIRECT-RECEIPT: accept, reject and forget each change the real store once and answer the records they changed')
const W_ABSENCE = wire('2 · C432-MCP-DIRECT-RECEIPT: knowledge changes apply on their one call > C432-MCP-DIRECT-RECEIPT: a typed absence is data, and a malformed id is refused before any write')
const W_RETRY = wire('3 · a repeated operation identity is the same change > answers the same records for a retried identity and lands the change once')
const W_NO_FORM = wire('4 · C432-MCP-NO-ELICITATION: there is no confirmation round on either era > C432-MCP-NO-ELICITATION: a 2026 client that can answer a form is never asked, and its one call lands')
const W_NO_CONFIRMED = wire('4 · C432-MCP-NO-ELICITATION: there is no confirmation round on either era > C432-MCP-NO-ELICITATION: `confirmed` is not an input — refused at the schema wall, and nothing changes')
const W_RETIRED = wire('5 · the retired doors are unknown, and each change tool reaches only its own ops > lists none of the retired names and answers a call to one as an unknown tool, changing nothing')
const W_CROSSED = wire('5 · the retired doors are unknown, and each change tool reaches only its own ops > the knowledge tool cannot reach a config op, nor the config tool a knowledge op')

const U_TOKENLESS_MARK = unit('419 sovereign mark credential refusal > C432-TOKENLESS-MCP-MARK: a tokenless mark is invoked once with its input unchanged, and nothing refuses for a credential')
const U_MARK_MASKED = unit('419 sovereign mark credential refusal > passes the mark input unchanged through the sole invoke and masks both result channels')
const U_REMEDY = unit('419 sovereign mark credential refusal > C432-REMEDY-TYPES-ABSENT: renders every refusal as its own masked message, with no remedy appended')
const U_RECEIPT = unit('C432-MCP-DIRECT-RECEIPT: a knowledge change answers its receipt on the first call > C432-MCP-DIRECT-RECEIPT: the change tool applies once and masks both result channels from one serialization')
const U_ERROR = unit('C432-MCP-DIRECT-RECEIPT: a knowledge change answers its receipt on the first call > C432-MCP-DIRECT-RECEIPT: a typed absence is data and a writer refusal is a masked error, both after one call')
const U_NO_FORM = unit('C432-MCP-NO-ELICITATION: no confirmation input, no elicitation, no apply round > C432-MCP-NO-ELICITATION: a client that can answer a form is never asked, and the change lands on its one call')
const U_NO_CONFIRMED = unit('C432-MCP-NO-ELICITATION: no confirmation input, no elicitation, no apply round > C432-MCP-NO-ELICITATION: no listed tool takes a confirmation or a proposal id, and confirmed is refused at the schema wall')
const U_MODULE_GONE = unit('C432-MCP-NO-ELICITATION: no confirmation input, no elicitation, no apply round > C432-MCP-NO-ELICITATION: the refuse-and-teach module is gone, and the op layer takes no confirmation')

// The returned confirmation round: a change tool refuses its first, unconfirmed call and teaches the
// re-call, as the deleted apply doors did.
const HANDLER_TRY = '  return async (args: unknown): Promise<CallToolResult> => {\n    try {\n'
const CONFIRM_ROUND = HANDLER_TRY
  + "      if (projection.kind === 'workflow' && (args as { readonly confirmed?: unknown } | undefined)?.confirmed !== true) {\n"
  + "        return maskedToolError(new Error('confirmLeg39606A1: call again with confirmed: true to apply this change'), maskText)\n"
  + '      }\n'

const APPLY_REFUSAL_MODULE = `// 432-45 A3: the deleted refuse-and-teach primitive, returned.
export interface ApplyRefusal {
  readonly confirmed: false
  readonly recall: Readonly<Record<string, unknown>>
}

export function refuseAndTeach(args: Readonly<Record<string, unknown>>): ApplyRefusal {
  return { confirmed: false, recall: { ...args, confirmed: true } }
}
`

const legs = [
  {
    id: 'A1', claim: 'C432-MCP-DIRECT-RECEIPT', instrument: 'wire', subject: CATALOG,
    operation: 'the confirmation round returns at the wire: a change tool refuses its first, unconfirmed call',
    edits: [edit(HANDLER_TRY, CONFIRM_ROUND)],
    crossing: { pkg: '@vostride/agent-qa-mcp', dir: 'packages/mcp', marker: 'confirmLeg39606A1' },
    reds: [W_DIRECT],
    // Every first call of a change tool is refused, on both eras and both tools (measured 2026-10-02).
    allowed: [W_CONFIG, W_ABSENCE, W_RETRY, W_NO_FORM],
    greens: [W_NO_CONFIRMED, W_RETIRED, W_CROSSED],
  },
  {
    id: 'A2', claim: 'C432-MCP-DIRECT-RECEIPT', instrument: 'unit', subject: CATALOG,
    operation: 'the same returned confirmation round, measured hermetically',
    edits: [edit(HANDLER_TRY, CONFIRM_ROUND)],
    reds: [U_RECEIPT],
    // Every first change call is refused before the port (measured 2026-10-02).
    allowed: [U_ERROR, U_NO_FORM],
    greens: [U_TOKENLESS_MARK, U_MARK_MASKED, U_REMEDY, U_NO_CONFIRMED, U_MODULE_GONE],
  },
  {
    id: 'A3', claim: 'C432-DELETED-SYMBOLS', instrument: 'census', subject: 'packages/mcp/src/apply-refusal.ts',
    operation: 'the deleted refuse-and-teach module returns',
    create: APPLY_REFUSAL_MODULE,
    reds: [census('C432-DELETED-SYMBOLS: every deleted module file is absent', 'mcp/src/apply-refusal.ts')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A36'), census('C432-RETURN-A38')],
  },
  {
    id: 'A4', claim: 'C432-MCP-DIRECT-RECEIPT', instrument: 'unit', subject: MASKED,
    operation: 'the retained error channel stops masking: a writer refusal is answered raw',
    edits: [edit('        text: maskText(message),\n', '        text: unmaskedLeg39606A4(message),\n'),
      edit('  const message = err instanceof Error ? err.message : String(err)\n',
        '  const message = err instanceof Error ? err.message : String(err)\n'
        + '  const unmaskedLeg39606A4 = (text: string): string => maskText === undefined ? text : text\n')],
    reds: [U_ERROR],
    // The plain-refusal cell renders the same error channel (measured 2026-10-02).
    allowed: [U_REMEDY],
    greens: [U_RECEIPT, U_NO_FORM, U_NO_CONFIRMED, U_MODULE_GONE, U_TOKENLESS_MARK],
  },
  {
    id: 'A5', claim: 'C432-MCP-DIRECT-RECEIPT', instrument: 'unit', subject: MASKED,
    operation: "the receipt's structured channel is answered from the unmasked output",
    edits: [edit("  return {\n    content: [{ type: 'text' as const, text: masked.text }],\n    structuredContent: masked.value as CallToolResult['structuredContent'],\n  }\n",
      "  const rawChannelLeg39606A5 = output\n  return {\n    content: [{ type: 'text' as const, text: masked.text }],\n    structuredContent: rawChannelLeg39606A5 as CallToolResult['structuredContent'],\n  }\n")],
    reds: [U_RECEIPT],
    // The mark door answers through the same success path (measured 2026-10-02).
    allowed: [U_MARK_MASKED],
    greens: [U_ERROR, U_NO_FORM, U_NO_CONFIRMED, U_MODULE_GONE, U_TOKENLESS_MARK],
  },
  {
    id: 'A6', claim: 'C432-MCP-RETIRED-DOORS', instrument: 'wire', subject: MAPPING,
    operation: 'a retired apply door is projected again over the direct config writer',
    edits: [edit('export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([\n',
      'export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([\n'
      + "  Object.freeze({\n    name: 'agent_qa_apply_config_proposal',\n    ops: Object.freeze(['config.field.set']),\n    kind: 'workflow',\n  }),\n")],
    crossing: { pkg: '@vostride/agent-qa-mcp', dir: 'packages/mcp', marker: 'agent_qa_apply_config_proposal' },
    reds: [W_RETIRED],
    allowed: [],
    greens: [W_CONFIG, W_DIRECT, W_NO_FORM, W_NO_CONFIRMED, W_CROSSED],
  },
]

runGate({
  slug: '396-06-mutation', envPrefix: 'APPLY_MUTATION',
  instruments, legs, expectedLegs: 6, explicitIds: true, parseCheck: true, banner: 'APPLY_MUTATION_OK',
})
NODE
