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

// 391 PROP-03: the inbox's three verbs — their IO contracts, the wire projection of the envelope,
// and the ONE port both `agent` (which declares against it) and `knowledge-local` (which
// implements it) consume. Minted here on the `QuarantineOperationsPort` precedent.
export {
  ProposalEnvelopeSchema,
  ProposalInboxEntrySchema,
  ProposalsListInputSchema,
  ProposalsListOutputSchema,
  ProposalsRejectInputSchema,
  ProposalsRejectOutputSchema,
  ProposalsShowInputSchema,
  ProposalsShowOutputSchema,
} from './inbox-ops'
export type {
  ProposalInboxEntryDto,
  ProposalsInboxPort,
  ProposalsListInput,
  ProposalsListOutput,
  ProposalsRejectInput,
  ProposalsRejectOutput,
  ProposalsShowInput,
  ProposalsShowOutput,
} from './inbox-ops'
