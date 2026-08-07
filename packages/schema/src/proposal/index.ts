// 391 D-08/D-12: the generic kind-discriminated proposal envelope and its lifecycle.
export {
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  PROPOSAL_DECISIONS,
  PROPOSAL_DURABLE_STATES,
  PROPOSAL_ENVELOPE_STATUSES,
  PROPOSAL_EVIDENCE_GRAINS,
  PROPOSAL_EXPIRY_MS,
  PROPOSAL_KINDS,
  ProposalDecisionRecordSchema,
  ProposalEvidenceRefSchema,
  ProposalOriginSchema,
  ProposalRecordSchema,
  computeProposalEnvelopeStatus,
  isProposalKind,
} from './envelope'
export type {
  ProposalDecision,
  ProposalDecisionRecord,
  ProposalDurableState,
  ProposalEnvelope,
  ProposalEnvelopeStatus,
  ProposalEvidenceGrain,
  ProposalEvidenceRef,
  ProposalKind,
  ProposalOrigin,
  ProposalRecord,
} from './envelope'
