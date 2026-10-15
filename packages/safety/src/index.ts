export { mapPromptLeaves } from './egress/map-prompt-leaves'
export { createMaskingMiddleware } from './egress/masking-middleware'
export {
  assertCommittedEgressSafe,
  CommittedEgressBlockedError,
} from './guardrail/committed-egress'
export {
  CONSTRUCTION_SCAN_DETECTORS,
  CONSTRUCTION_SCAN_EXCLUDED_DETECTORS,
  SEEDED_SECRET_DETECTOR,
  scanConstructedArtifact,
} from './guardrail/construction-scan'
// The detector PRIMITIVE, public (395-20 · F-03). `findDetectorMatches` is a pure
// text-in/matches-out function: it grants no registration capability, holds no state and reads no
// policy, so it is outside D-03's non-export rule (which is about registration capability leaving
// the public surface). It is exported because a caller outside this package needs the SAME shape
// vocabulary the guardrail uses — `config show`/`config set` recognising a credential by shape
// rather than by key name — and re-deriving those regexes in the cli would be a second answer to
// "what does a credential look like", which is precisely the drift this phase keeps paying for.
export { findDetectorMatches } from './guardrail/detectors'
export {
  defaultGuardrailPolicyInput,
  GuardrailConfigError,
  loadGuardrailPolicy,
} from './guardrail/policy-loader'
export { scan } from './guardrail/scan'
export { createMaskingContext } from './masking/context'
export { detectEmails } from './masking/detectors'
export { getActiveMaskingContext, setActiveMaskingContextResolver } from './masking/resolver'
export { getActiveAuditSink, setActiveAuditSinkResolver } from './policy/audit-sink-resolver'
export { unmaskForHumanOutput } from './masking/human-output'
// 2026-10-01 (432-19, D-15/D-16): risk classification and the tier order stay because eval scores
// side effects with them. The execution policy gate, its ask ladder and its confirm and
// standing-approval ports are deleted; the execution context and its resolver stay.
export { classifyRisk, TIER_ORDER } from './policy/risk-classifier'
export {
  getActiveExecutionContext,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from './policy/execution-context'
export { seedMaskingContext } from './masking/seed'
export {
  APP_OBSERVED_DATA_CLOSE,
  APP_OBSERVED_DATA_OPEN,
  wrapAppObservedData,
} from './serving/data-delimiters'
export type {
  BlockedDetection,
  CommittedEgressOptions,
  CommittedEgressPart,
} from './guardrail/committed-egress'
export type {
  ConstructionScanDetector,
  ConstructionScanFinding,
  ConstructionScanPart,
  ConstructionScanReport,
} from './guardrail/construction-scan'
export type { ProviderRequestParams } from './egress/map-prompt-leaves'
export type { MaskCategory } from './masking/categories'
// 405-02 (D-08): the row `snapshotRegistered()` reports. Type-only — the enumeration exists for
// the run-scoped digest sidecar writer, which turns each value into a keyed HMAC and never
// persists the value itself.
export type { RegisteredMaskingEntry } from './masking/context'
export type { MaskingContextResolver } from './masking/resolver'
export type { AuditSinkResolver } from './policy/audit-sink-resolver'
export type { MaskingSeedSources } from './masking/seed'
export type {
  ExecutionContextResolver,
  ExecutionContextSignals,
} from './policy/execution-context'
export type { AuditSink, GuardrailAuditRow } from './ports/audit-sink'
