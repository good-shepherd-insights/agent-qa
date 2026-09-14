import { RunsEvidenceInputSchema, RunsEvidenceResultSchema } from '@vostride/agent-qa-schema'
import type { RunsEvidenceInput, RunsEvidenceResult } from '@vostride/agent-qa-schema'
import type { FunctionSpec } from '../spec.js'

export const RUNS_EVIDENCE_FUNCTION_ID = 'runs.evidence'

export const runsEvidenceSpec: FunctionSpec<RunsEvidenceInput, RunsEvidenceResult> = {
  id: RUNS_EVIDENCE_FUNCTION_ID,
  summary: 'Read validated evidence recorded on one run step or ARIA sub-action.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  boundThrough: 'runDetail',
  input: RunsEvidenceInputSchema,
  output: RunsEvidenceResultSchema,
  risk: { name: `fn:${RUNS_EVIDENCE_FUNCTION_ID}`, recognized: true, readOnly: true },
  classify(output) {
    return { status: output.outcome === 'read-error' ? 'failed' : 'executed', outcome: output.outcome }
  },
  async invoke(address) {
    return { address, outcome: 'absent', evidence: { kind: address.kind, state: 'absent', reason: 'unavailable' } }
  },
}
