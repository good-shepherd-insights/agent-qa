// 2026-09-08, 418 D-19: deterministic content, no model. No authorship: fallback.ts
// refuses deterministic-fallback Deprecate; follow propose-review.ts's system delta recipe.
import {
  canonicalJson, KnowledgeProposalV1Schema, ProposalIdSchema, sha256hex,
  type GateInconsistency, type KnowledgeProposalV1, type RecordId, type ScopeKey,
} from '@vostride/agent-qa-schema'
import { writePendingProposal } from './proposals-store.js'
import { GATE_INCONSISTENCY_REASON_PREFIX, gateInconsistencyProposalState } from './gate-inconsistency-read.js'
export { GATE_INCONSISTENCY_REASON_PREFIX, pendingGateInconsistencyFor, gateInconsistencyDetails } from './gate-inconsistency-read.js'

export const GATE_INCONSISTENCY_EMITTED_BY = 'knowledge.canary.record'

export function gateInconsistencyProposalId(input: {
  candidateId: string; gate1Digest: string; gate2Digest: string
}): string {
  const { candidateId, gate1Digest, gate2Digest } = input
  return ProposalIdSchema.parse(`prop_${sha256hex(canonicalJson({ candidateId, gate1Digest, gate2Digest })).slice(0, 16)}`)
}

export function buildGateInconsistencyProposal(input: GateInconsistency & {
  candidateId: RecordId; scope: ScopeKey; proposedAt: number
}): KnowledgeProposalV1 {
  return KnowledgeProposalV1Schema.parse({
    schemaVersion: 1, proposalId: gateInconsistencyProposalId(input), verb: 'accept',
    targetRef: { grain: 'record', recordId: input.candidateId },
    deltas: [{ kind: 'Deprecate', origin: 'system', scope: input.scope,
      citedIds: [input.candidateId], targetId: input.candidateId,
      reason: `${GATE_INCONSISTENCY_REASON_PREFIX}${input.shape}:${input.gate1Digest}:${input.gate2Digest}` }],
    proposedAt: input.proposedAt, status: 'pending',
  })
}

export function fileGateInconsistencyProposal(agentQaRoot: string, proposal: KnowledgeProposalV1,
  origin: { runId?: string; at: number },
) {
  // Drain writers are serialized by the knowledge lease; human claim/decision writers are not.
  const existing = gateInconsistencyProposalState(agentQaRoot, proposal.proposalId)
  if (existing !== undefined) return { kind: 'already-filed' as const, state: existing.state }
  writePendingProposal(agentQaRoot, proposal, { emittedBy: GATE_INCONSISTENCY_EMITTED_BY, ...origin })
  return { kind: 'filed' as const, proposalId: proposal.proposalId }
}
