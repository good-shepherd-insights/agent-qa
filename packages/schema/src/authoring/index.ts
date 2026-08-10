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
