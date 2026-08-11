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
  CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
  FindingFailurePointSchema,
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
