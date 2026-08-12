// 393 (WTST-02, D-18/D-19): the keep-gate authoring vocabulary — the four separately-reported
// gate booleans, the ONE disposition derivation, and the durable per-draft receipt.

export { computeDraftDisposition, DRAFT_DISPOSITIONS, DRAFT_STABILITY_RUNS_N } from './disposition'
export type {
  DraftDisposition,
  DraftDispositionInput,
  DraftGateBooleans,
} from './disposition'
export {
  AddsValueFindingSchema,
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DRAFT_GATE_NAMES,
  DraftGateResultsSchema,
  DraftReceiptSchema,
  DraftRefSchema,
  GateRunRecordSchema,
  StepClassificationRowSchema,
} from './draft-receipt'
export type {
  AddsValueFinding,
  DraftGateName,
  DraftGateResults,
  DraftReceipt,
  DraftRef,
  GateRunRecord,
  StepClassificationRow,
} from './draft-receipt'

// 394 (WTST-07, D-20): the RFC-6902 edit vocabulary. Deliberately NOT the unified-diff `patch/`
// vocabulary — see the header of `patch-ops.ts` for why the two are not unified.
export {
  EDITABLE_POINTER_ROOTS,
  PATCH_OP_KINDS,
  PatchOpSchema,
  TestEditPatchSetSchema,
  isEditablePointer,
  parseJsonPointer,
  pointerRootOf,
} from './patch-ops'
export type {
  EditablePointerRoot,
  PatchOp,
  PatchOpKind,
  TestEditPatchSet,
} from './patch-ops'

// 394-06 (WTST-01/WTST-04, D-05/D-11): the two envelope payload arms, and the ONE evidence-ref
// vocabulary the router builds and a finding carries.
export {
  AUTHORED_SUITE_SLUG_MAX_LENGTH,
  CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
  FindingFailurePointSchema,
  authoredSuiteTargetPath,
  FindingProposalV1Schema,
  RUN_EVIDENCE_CHANNELS,
  RunEvidenceRefSchema,
  TestDraftProposalV1Schema,
} from './proposal-arms'
export type {
  FindingFailurePoint,
  FindingProposalV1,
  RunEvidenceChannel,
  RunEvidenceRef,
  TestDraftProposalV1,
} from './proposal-arms'

// 394-07 (WTST-05, D-13/D-15): the honesty funnel — the frozen four stages, the pinned ceiling
// and floor, the ONE computation, and the mechanical no-success-framing screen.
export {
  AUTHORING_FUNNEL_STAGES,
  AuthoringFunnelSchema,
  FUNNEL_MIN_DRAFTS_FLOOR,
  FUNNEL_PHRASES,
  FUNNEL_SUCCESS_FRAMING_LEXICON,
  FunnelSuccessFramingError,
  KEEP_RATE_CEILING,
  computeAuthoringFunnel,
  renderFunnelLine,
  successFramingViolations,
} from './funnel'
export type {
  AuthoringAcceptance,
  AuthoringFunnel,
  AuthoringFunnelInput,
  AuthoringFunnelStage,
  FunnelRenderParts,
  FunnelSideCounters,
} from './funnel'

// 394-08 (WTST-08, D-03/D-10): the ONE fan-out arithmetic. The dispatch confirm and the proposal's
// report both read it, so the number a person consents on and the number they are shown afterwards
// cannot be two answers.
export {
  ConsumedRunSchema,
  FAN_OUT_PHRASES,
  FAN_OUT_RUN_PURPOSES,
  FanOutBoundError,
  FanOutBoundInputSchema,
  FanOutBoundSchema,
  FanOutReportSchema,
  NO_RUNS_FAN_OUT_BOUND,
  buildFanOutReport,
  computeFanOutBound,
  renderFanOutPreview,
  renderFanOutReport,
} from './fan-out'
export type {
  ConsumedRun,
  FanOutBound,
  FanOutBoundInput,
  FanOutReport,
  FanOutRunPurpose,
} from './fan-out'

// 394-07 (WTST-05, D-14): the mixed-verdict suite-stability read — pure, and it starts ZERO runs.
export {
  NEIGHBOUR_INSTABILITY_REASONS,
  SUITE_STABILITY_POSTURES,
  assessSuiteStability,
  suiteTestRef,
} from './suite-stability'
export type {
  FlakyNeighbour,
  NeighbourInstabilityReason,
  SuiteNeighbourRow,
  SuiteStabilityAssessment,
  SuiteStabilityInput,
  SuiteStabilityPosture,
} from './suite-stability'

// 394-09 (WTST-01, D-17): procedure-by-reference. The vocabulary a compiled step is authored in,
// derived out of the anchor alone so no learned-shelf record id can reach a committed test.
export { procedureStepVocabulary } from './procedure-reference'
