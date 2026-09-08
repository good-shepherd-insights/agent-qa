// 419 GATE3-01: every mark door invokes this spec through the function gate.
import { RunsMarkInputSchema, RunsMarkOutcomeSchema } from '@vostride/agent-qa-schema'
import type { RunsMarkInput, RunsMarkOutcome } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionSpec } from '../spec.js'

export const RUNS_MARK_FUNCTION_ID = 'runs.mark'

export const runsMarkSpec: FunctionSpec<RunsMarkInput, RunsMarkOutcome> = {
  id: RUNS_MARK_FUNCTION_ID,
  summary: 'Mark a run or step false-fail / false-pass / confirmed-bug: freeze the marked decision as gold, triage, draft a fix proposal.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  boundThrough: 'feedback',
  input: RunsMarkInputSchema,
  output: RunsMarkOutcomeSchema,
  // D-13: a mark writes the committed eval root and files a proposal. The dashboard proves
  // presence by asking, so mutating-local would understate its risk.
  // No requiresHumanOrigin: MCP callers have origin agent; D-20 makes the bearer the grant.
  risk: {
    name: `fn:${RUNS_MARK_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
    declaredTier: 'mutating-shared',
  },
  classify(output): ClauseVerdict {
    // T-419-10: receipt text contains only governed kinds, never notes or producer strings.
    switch (output.kind) {
      case 'marked':
        return { status: 'executed', outcome: `marked ${output.receipt.kind} · ${output.receipt.disposition.kind}` }
      case 'already-marked':
        return { status: 'executed', outcome: 'already marked: identical repeat, prior receipt returned' }
      case 'run-not-found':
        return { status: 'refused', outcome: 'run not found at the requested address' }
      case 'member-not-found':
        return { status: 'refused', outcome: 'member not found at the requested run address' }
      case 'step-not-found':
        return { status: 'refused', outcome: `step ${output.stepIndex} not found at member ${output.testIndex}` }
      case 'ambiguous-address':
        return { status: 'refused', outcome: 'ambiguous run address: specify a member' }
      default:
        return output satisfies never
    }
  },
  async invoke(input, deps) {
    const feedback = deps.feedback
    if (feedback === undefined) throw new FunctionNotBoundError(RUNS_MARK_FUNCTION_ID)
    return feedback.mark(input)
  },
}
