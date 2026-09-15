#!/usr/bin/env bash
# 423-feedback-read-mutation.sh — feedback reads stay pure, keep runs.mark's own plan, and their
# result and binding vocabularies stay closed (423-23, PXH-FDBK-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `runs.marks.history` and
# `runs.mark.preview` are READS over the stores a mark writes: the ledger, its in-flight intent,
# gold, knowledge and proposals. A read that tidies up an intent, or leaves a breadcrumb of its own,
# still returns the right answer, so the only oracle that can object is one that compares every
# path and byte before and after. The preview is also runs.mark's plan for an exact input: the
# repeat rule, the refusal order and the correlated evidence a false-pass overturns are the
# writer's decisions, and a preview that decides them differently looks like a feature. So each
# leg plants one of those regressions in production source and requires its named cell to red
# while the listed controls hold. The result and binding unions are widened COHERENTLY (runtime
# list, schema arm and, for the binding, the FunctionDeps member together) so production still
# compiles and only the independent runtime and counted type oracles can object.
#
# THE LEGS
#   F01  a quarantined preview records a preview intent in the run directory   -> PREVIEW-WRITES-NOTHING
#   F02  history reaps the run's in-flight mark intent                         -> HISTORY-WRITES-NOTHING
#   F03  the repeat rule counts the note, so a note-only change re-plans       -> NOTE-ONLY-REPEAT
#   F04  quarantine is decided after the ambiguous-correction refusal          -> QUARANTINE-ORDER
#   F05  the preview drops the correlated unserved records the plan reached    -> CORRELATED-EVIDENCE (read host)
#   F06  the evidence planner skips correlated unserved records                -> CORRELATED-EVIDENCE (planner)
#   F07  marks history gains a ledger-locked outcome arm and list member       -> C423-FEEDBACK-RESULTS-EXACT runtime+type
#   F08  preview gains an effects outcome arm and list member                  -> C423-FEEDBACK-RESULTS-EXACT runtime+type
#   F09  a feedbackDrafts binding joins the dep-key union, roster and deps     -> C423-FEEDBACK-BINDINGS-EXACT runtime+type
#
# The independent oracles F07-F09 read are the schema-owned 423-feedback-contracts runtime and
# `.test-d.ts` walls, and the agent-owned optional-dep-keys / port-split walls, all run with
# --typecheck in the engine's preflight before any byte is owned.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-feedback-read-mutation         # from the agent-qa root
#   bash agent-qa/scripts/423-feedback-read-mutation.sh  # from the super-repository root
#
# KNOBS — AGENT_QA_423_FEEDBACK_READ_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_FEEDBACK_READ_MUTATION_LEG=F01..F09 runs one leg (normal or neutered runs only).
# AGENT_QA_423_FEEDBACK_READ_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const HOST = 'packages/cli/src/gates/feedback-read-host.ts'
const PLAN = 'packages/cli/src/gates/feedback-plan.ts'
const PLANNER = 'packages/knowledge-local/src/feedback/mark-evidence-plan.ts'
const FEEDBACK = 'packages/schema/src/functions/feedback.ts'
const SPEC = 'packages/agent/src/functions/spec.ts'

const READS = 'src/__tests__/423-feedback-reads.test.ts'
const EVIDENCE = 'src/feedback/__tests__/423-mark-evidence-plan.test.ts'
const RESULTS = 'src/__tests__/423-feedback-contracts.test.ts'
const RESULTS_D = 'src/__tests__/423-feedback-contracts.test-d.ts'
const KEYS = 'src/functions/__tests__/optional-dep-keys.test.ts'
const PORTS_D = 'src/functions/__tests__/port-split.test-d.ts'

const instruments = {
  'feedback-reads': { pkg: 'packages/cli', files: [READS], typecheck: false, count: 26 },
  'evidence-planner': { pkg: 'packages/knowledge-local', files: [EVIDENCE], typecheck: false, count: 4 },
  'feedback-results': { pkg: 'packages/schema', files: [RESULTS, RESULTS_D], typecheck: true, count: 11 },
  'feedback-bindings': { pkg: 'packages/agent', files: [KEYS, PORTS_D], typecheck: true, count: 7 },
}

const reads = name => cell('feedback-reads', READS, name)
const planner = name => cell('evidence-planner', EVIDENCE, name)
const RESULTS_ID = 'C423-FEEDBACK-RESULTS-EXACT'
const results = title => cell('feedback-results', RESULTS, `${RESULTS_ID} > ${title}`)
const resultsD = title => cell('feedback-results', RESULTS_D, `${RESULTS_ID} > ${title}`)
const BINDINGS_ID = 'C423-FEEDBACK-BINDINGS-EXACT'
const keys = (describe, title) => cell('feedback-bindings', KEYS, `${describe} > ${title}`)
const portsD = title => cell('feedback-bindings', PORTS_D, `${BINDINGS_ID} > ${title}`)
const ROSTER_419 = 'optional function dep keys (419 GATE3-01)'

const legs = [
  {
    subject: HOST, instrument: 'feedback-reads', claim: 'PREVIEW-WRITES-NOTHING', operation: 'record a preview intent in the run directory for a quarantined preview',
    edits: [
      { from: "import { existsSync } from 'node:fs'\n", to: "import { existsSync, writeFileSync } from 'node:fs'\n" },
      { from: '      canDraftTestEdit: deps.canDraftTestEdit === true }, input)\n    const prospective',
        to: "      canDraftTestEdit: deps.canDraftTestEdit === true }, input)\n    if (previewed.kind === 'quarantined') writeFileSync(join(deps.agentQaRoot, RUNS_SUBDIR, slugBranch(input.runId), 'preview-intent.json'), '{\"stage\":\"previewed\"}\\n')\n    const prospective" },
    ],
    reds: [reads('PREVIEW-WRITES-NOTHING')],
    allowed: [],
    greens: [reads('INTENT-UNCHANGED'), reads('BASIS-RACE'), reads('PREVIEW-CONTENT'), reads('PREVIEW-FN-PARITY'),
      reads('FEEDBACK-HTTP-WRITES-NOTHING'), reads('HISTORY-WRITES-NOTHING')],
  },
  {
    subject: HOST, instrument: 'feedback-reads', claim: 'HISTORY-WRITES-NOTHING', operation: "reap the run's in-flight mark intent while reading history",
    edits: [
      { from: "import { existsSync } from 'node:fs'\n", to: "import { existsSync, rmSync } from 'node:fs'\n" },
      { from: "      if (!existsSync(join(deps.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), HANDOFF_FILE))) return { kind: 'run-not-found' }\n",
        to: "      if (!existsSync(join(deps.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), HANDOFF_FILE))) return { kind: 'run-not-found' }\n      rmSync(join(deps.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), 'mark-intent.json'), { force: true })\n" },
    ],
    reds: [reads('HISTORY-WRITES-NOTHING')],
    allowed: [],
    greens: [reads('PROPOSAL-CURRENT/MISSING'), reads('HISTORY-CORRUPT'), reads('HISTORY-FN-PARITY'), reads('HTTP-MARKS-HISTORY'),
      reads('FEEDBACK-HTTP-WRITES-NOTHING'), reads('PREVIEW-WRITES-NOTHING')],
  },
  {
    subject: PLAN, instrument: 'feedback-reads', claim: 'NOTE-ONLY-REPEAT', operation: 'count the note in the identical-repeat rule',
    edits: [{ from: '  return prior.kind === input.kind && prior.correctedExpectation === input.correctedExpectation\n',
      to: '  return prior.kind === input.kind && prior.note === input.note && prior.correctedExpectation === input.correctedExpectation\n' }],
    reds: [reads('NOTE-ONLY-REPEAT')],
    allowed: [reads('PRIOR-WITHDRAWAL'), reads('PREVIEW-WRITES-NOTHING'), reads('BASIS-RACE')],
    greens: [reads('PREVIEW-REFUSAL-PARITY'), reads('QUARANTINE-ORDER'), reads('MARK-PLAN-PARITY'), reads('CORRELATED-EVIDENCE'),
      reads('FALSE-PASS-TWO-LABELS')],
  },
  {
    subject: PLAN, instrument: 'feedback-reads', claim: 'QUARANTINE-ORDER', operation: 'decide quarantine after the ambiguous-correction refusal',
    edits: [
      { from: "  if (triage.kind === 'quarantined') return { kind: 'quarantined', class: triage.class, resolvedStep, latest, basis }\n", to: '' },
      { from: '      testIndex: member.testIndex, decisionCount: resolution.decisionCount } }\n  }\n',
        to: "      testIndex: member.testIndex, decisionCount: resolution.decisionCount } }\n  }\n  if (triage.kind === 'quarantined') return { kind: 'quarantined', class: triage.class, resolvedStep, latest, basis }\n" },
    ],
    reds: [reads('QUARANTINE-ORDER')],
    allowed: [],
    greens: [reads('PREVIEW-REFUSAL-PARITY'), reads('NOTE-ONLY-REPEAT'), reads('PRIOR-WITHDRAWAL'), reads('MARK-PLAN-PARITY'),
      reads('PREVIEW-WRITES-NOTHING')],
  },
  {
    subject: PLAN, instrument: 'feedback-reads', claim: 'CORRELATED-EVIDENCE', operation: 'drop the correlated unserved records from the previewed knowledge',
    edits: [{ from: '    const joinFor = await joinReachedRecords(reader, evidencePlan.targets.map(target => target.recordId))\n    const records = evidencePlan.targets.map(',
      to: '    const joinFor = await joinReachedRecords(reader, evidencePlan.targets.map(target => target.recordId))\n    const records = evidencePlan.targets.filter(target => plan.knowledge.servedRecordIds.includes(target.recordId)).map(' }],
    reds: [reads('CORRELATED-EVIDENCE')],
    allowed: [],
    greens: [reads('PREVIEW-CONTENT'), reads('FALSE-PASS-TWO-LABELS'), reads('MARK-PLAN-PARITY'), reads('PREVIEW-WRITES-NOTHING'),
      reads('HTTP-MARK-PREVIEW')],
  },
  {
    subject: PLANNER, instrument: 'evidence-planner', claim: 'CORRELATED-EVIDENCE', operation: 'skip every unserved record, correlated or not',
    edits: [{ from: '    if (!served.has(recordId) && hits.length === 0) continue\n', to: '    if (!served.has(recordId)) continue\n' }],
    reds: [planner('CORRELATED-EVIDENCE')],
    allowed: [],
    greens: [planner('SERVED-BOTH-DIRECTIONS'), planner('EVIDENCE-UNREADABLE'), planner('EVIDENCE-DEDUP')],
  },
  {
    subject: FEEDBACK, instrument: 'feedback-results', claim: RESULTS_ID, operation: 'widen marks history with a ledger-locked outcome arm and list member',
    edits: [
      { from: "export const MARKS_HISTORY_OUTCOMES = ['history', 'run-not-found', 'ledger-corrupt', 'ledger-unavailable'] as const\n",
        to: "export const MARKS_HISTORY_OUTCOMES = ['history', 'run-not-found', 'ledger-corrupt', 'ledger-unavailable', 'ledger-locked'] as const\n" },
      { from: "  z.object({ kind: z.literal('ledger-unavailable'), runId: runIdSchema }).strict(),\n])",
        to: "  z.object({ kind: z.literal('ledger-unavailable'), runId: runIdSchema }).strict(),\n  z.object({ kind: z.literal('ledger-locked'), runId: runIdSchema }).strict(),\n])" },
    ],
    reds: [results('pins the marks-history outcome arms: runtime list, schema arms and parser'),
      resultsD('pins the four marks-history outcome arms in both directions')],
    allowed: [],
    greens: [results('pins the preview outcome arms: runtime list, schema arms and parser'),
      results('pins the current proposal states: runtime list, schema arms and parser'),
      resultsD('pins the eight preview outcome arms in both directions'),
      resultsD('pins the six current proposal states in both directions')],
  },
  {
    subject: FEEDBACK, instrument: 'feedback-results', claim: RESULTS_ID, operation: 'widen the preview result with an effects outcome arm and list member',
    edits: [
      { from: "export const MARK_PREVIEW_OUTCOMES = ['consequences', 'quarantined', 'already-marked', ...MARK_PREVIEW_REFUSALS] as const\n",
        to: "export const MARK_PREVIEW_OUTCOMES = ['consequences', 'quarantined', 'already-marked', 'effects', ...MARK_PREVIEW_REFUSALS] as const\n" },
      { from: '  markRunNotFoundArm,\n  markMemberNotFoundArm,\n',
        to: "  z.object({ kind: z.literal('effects'), runId: runIdSchema }).strict(),\n  markRunNotFoundArm,\n  markMemberNotFoundArm,\n" },
    ],
    reds: [results('pins the preview outcome arms: runtime list, schema arms and parser'),
      resultsD('pins the eight preview outcome arms in both directions')],
    allowed: [],
    greens: [results('pins the marks-history outcome arms: runtime list, schema arms and parser'),
      results('pins the preview refusals as exactly runs.mark refusal arms, and keeps the runs.mark and MARKS sets'),
      resultsD('pins the four marks-history outcome arms in both directions'),
      resultsD('pins the preview refusals to runs.mark refusal objects and keeps the runs.mark and MARKS sets')],
  },
  {
    subject: SPEC, instrument: 'feedback-bindings', claim: BINDINGS_ID, operation: 'add a feedbackDrafts binding to the dep-key union, roster and FunctionDeps together',
    edits: [
      { from: "  | 'feedbackReads' // 2026-09-15, 423 D-19/D-16: read-only mark history and preview, no writer authority\n",
        to: "  | 'feedbackReads' // 2026-09-15, 423 D-19/D-16: read-only mark history and preview, no writer authority\n  | 'feedbackDrafts'\n" },
      { from: "  'feedbackReads',\n] as const satisfies readonly OptionalFunctionDepKey[]",
        to: "  'feedbackReads',\n  'feedbackDrafts',\n] as const satisfies readonly OptionalFunctionDepKey[]" },
      { from: '  feedbackReads?: FeedbackReadsPort\n', to: '  feedbackReads?: FeedbackReadsPort\n  feedbackDrafts?: FeedbackReadsPort\n' },
    ],
    reds: [keys(BINDINGS_ID, 'pins the runtime roster exactly, with no missing, extra or repeated binding'),
      portsD('pins the optional dep key union and its runtime roster in both directions'),
      portsD('binds the feedback writer and the read-only feedback observations as two optional deps')],
    allowed: [keys(ROSTER_419, 'pins every host binding by name and declaration order'), keys(ROSTER_419, 'has exactly 29 optional bindings')],
    greens: [keys(BINDINGS_ID, 'binds the mark writer through feedback and both feedback reads through feedbackReads'),
      portsD('pins the read binding to history and preview, with no writer verb')],
  },
]

runGate({
  slug: '423-feedback-read-mutation', envPrefix: 'AGENT_QA_423_FEEDBACK_READ_MUTATION', idPrefix: 'F',
  instruments, legs, expectedLegs: 9, banner: 'FEEDBACK_READ_MUTATION_OK',
})
NODE
