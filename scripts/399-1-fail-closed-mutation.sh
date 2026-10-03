#!/usr/bin/env bash
#
# 399-1-fail-closed-mutation.sh — the D-03 fail-closed guard's acceptance bar (399.1-04; re-spelled
# 2026-10-02 by 432-44 onto the shared engine, with the two fail-closed claims phase 432 left).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. D-03's asymmetry is the whole of the
# G-399-2 repair: a result the declared fold cannot read reports `failed`/`unclassifiable-result`
# and NEVER `executed`, because an unreadable result might be a refusal and success is the one claim
# a receipt must not default to. A DETECTOR'S ACCEPTANCE BAR IS THE IMPLEMENTATION IT MUST GO RED ON,
# never the suite it passes. Each leg edits shipped source into an implementation that is forbidden:
#
#   U  the absent-classifier branch goes fail-OPEN — the pre-399.1-04 legacy `executed`
#   V  the verdict CHECK becomes a shape sniff, so any object at all is put on a receipt
#   W  CARRIED (432-44): the execution gate's fail-closed policy returns. `requiresFailClosed` was the
#      rule that refused an ask-tier action in `ci`/`cloud`; D-15 deleted it with the gate, so the
#      fail-closed refusal it stood for has one claim left — that it is absent (C432-RETURN-A66, the
#      mutation map's dedicated fail-closed return row). `detectExecutionContext` stays.
#   X  NEW (432-44): a masking failure stops refusing. The MCP result masker WITHHOLDS a value it
#      cannot mask in place; this leg serves it raw instead, and the fail-closed cell (X5) must red.
#      "Masking failures still refuse" is the one fail-closed refusal phase 432 keeps on a result.
#
# THE RED SETS ARE DISJOINT, AND THAT IS THE POINT OF HAVING SEVERAL. U reds the absent-fold cell
# alone; V reds the two non-verdict cells and neither of the others; W reds its census cell; X reds
# the masking withhold cell. A file whose mutations all red the same rows would have proven its cells
# are restatements of one another.
#
# NEITHER U NOR V MAY RED THE CONTROL. `control: a probe answering a REAL verdict is reported
# verbatim` is what stops the assertions above it from passing against a wrapper that answers
# `unclassifiable-result` for everything; it is a named GREEN on both legs, so a red there is FATAL.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a
# load failure, a different selected count or a red outside a leg's list.
#
# Engine, arrival proof, counted selection, byte-exact restoration, the closing rebuild and the
# positive controls: scripts/423-mutation-engine.cjs. U, V and X mutate the package their suite lives
# in, which vitest resolves from source; the census reads the built workspace (`dist: true`).
#
# USAGE
#   bash agent-qa/scripts/399-1-fail-closed-mutation.sh   # from the super-repository root
#   bash scripts/399-1-fail-closed-mutation.sh            # from the agent-qa root
#
# KNOBS — FAIL_CLOSED_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# FAIL_CLOSED_MUTATION_LEG=U1|V1|W1|X1 runs one leg; FAIL_CLOSED_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const CLASSIFY_SRC = 'packages/agent/src/functions/classify.ts'
const CLASSIFIERS_T = 'src/functions/__tests__/refusal-classifiers.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const MASKING_T = 'src/__tests__/masked-serialization.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  // 2026-10-03 (quick 261003-cpv): classifiers 24 -> 26, the two C261003-CPV-ONE-KNOWLEDGE-FOLD cells.
  classifiers: { pkg: 'packages/agent', files: [CLASSIFIERS_T], typecheck: false, count: 26 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
  masking: { pkg: 'packages/mcp', files: [MASKING_T], typecheck: false, count: 11 },
}

const edit = (from, to) => ({ from, to })
const classifiers = name => cell('classifiers', CLASSIFIERS_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const masking = name => cell('masking', MASKING_T, name)

const NO_FOLD = classifiers('reports failed/unclassifiable-result for an op that declares NO fold at all')
const NOT_A_VERDICT = classifiers('reports failed/unclassifiable-result for a WELL-FORMED answer that is not a verdict')
const OUTCOME_NOT_STRING = classifiers('reports failed/unclassifiable-result when the OUTCOME is not a string')
const UNKNOWN_OP = classifiers('reports failed/unclassifiable-result for an op the registry does not hold')
const REAL_VERDICT = classifiers('control: a probe answering a REAL verdict is reported verbatim')
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const legs = [
  {
    id: 'U1', claim: 'ABSENT-FOLD-FAILS-CLOSED', instrument: 'classifiers', subject: CLASSIFY_SRC,
    // Not a straw man: the exact line 399.1-04 deleted, correct while `classify` was optional.
    operation: 'the absent-classifier branch answers the legacy executed verdict',
    edits: [edit("  if (typeof spec.classify !== 'function') return UNCLASSIFIABLE\n",
      "  if (typeof spec.classify !== 'function') return { status: 'executed', outcome: '' }\n")],
    reds: [NO_FOLD],
    allowed: [],
    greens: [NOT_A_VERDICT, OUTCOME_NOT_STRING, UNKNOWN_OP, REAL_VERDICT],
  },
  {
    id: 'V1', claim: 'VERDICT-CHECK-NOT-A-SNIFF', instrument: 'classifiers', subject: CLASSIFY_SRC,
    // The `null` guard is kept deliberately, so the cell that hands the fold `null` stays green and
    // the two red sets stay disjoint.
    operation: 'the verdict check becomes a shape sniff that accepts any object',
    edits: [edit("  const candidate = value as { status?: unknown; outcome?: unknown }\n  if (typeof candidate.outcome !== 'string') return false\n  return candidate.status === 'executed' || candidate.status === 'refused'\n    || candidate.status === 'failed'\n",
      '  void (value as { status?: unknown; outcome?: unknown })\n  return true\n')],
    reds: [NOT_A_VERDICT, OUTCOME_NOT_STRING],
    allowed: [],
    greens: [NO_FOLD, UNKNOWN_OP, REAL_VERDICT],
  },
  {
    id: 'W1', claim: 'C432-RETURN-A66', instrument: 'census', subject: 'packages/safety/src/policy/execution-context.ts',
    operation: 'the gate’s fail-closed policy returns: requiresFailClosed beside the retained execution context',
    edits: [edit('export function getActiveExecutionContext(): ExecutionContext {\n  return active()\n}\n',
      "export function getActiveExecutionContext(): ExecutionContext {\n  return active()\n}\n\nexport function requiresFailClosed(context: ExecutionContext): boolean {\n  return context === 'ci' || context === 'cloud'\n}\n")],
    reds: [census('C432-RETURN-A66', 'A66: the fail-closed policy returned (requiresFailClosed)')],
    // A declared export the census lists as deleted.
    allowed: [census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')],
    greens: CENSUS_CONTROLS,
  },
  {
    id: 'X1', claim: 'MASKING-FAILURE-REFUSES', instrument: 'masking', subject: 'packages/mcp/src/masked-result.ts',
    operation: 'a value the masker cannot hide in place is served raw instead of withheld',
    edits: [edit("      content: [{ type: 'text' as const, text: WITHHELD_TEXT }],\n      isError: true,\n",
      "      content: [{ type: 'text' as const, text: JSON.stringify(output) ?? 'null' }],\n      structuredContent: output as CallToolResult['structuredContent'],\n")],
    reds: [masking('(X5) FAIL-CLOSED: a value that cannot be masked in place is WITHHELD, not served')],
    allowed: [],
    greens: [masking('(X0) CONTROL: the masker holds every plant, and a plain value is masked on both channels'),
      masking('(X2) the two channels are the same data — the invariant this module exists for')],
  },
]

runGate({
  slug: '399-1-fail-closed-mutation', envPrefix: 'FAIL_CLOSED_MUTATION',
  instruments, legs, expectedLegs: 4, explicitIds: true, parseCheck: true, banner: 'FAIL_CLOSED_MUTATION_OK',
})
NODE
