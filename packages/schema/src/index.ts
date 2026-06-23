export {
  AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_DEPENDENCIES,
  AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_OWNERSHIP_CONTRACT,
  AGENT_QA_SCHEMA_PACKAGE_CLASSES,
  AGENT_QA_SCHEMA_PACKAGE_DIR,
  AGENT_QA_SCHEMA_PACKAGE_NAME,
  type AgentQaSchemaDependency,
  type AgentQaSchemaOwnershipContract,
  type AgentQaSchemaPackageClass,
} from './ownership-contract'

export { asRef, type Ref, type Point, type BoundingBox, type Viewport } from './primitives/index'

export type {
  Action,
  CrossPlatformAction,
  MobileAction,
  Platform,
  RefTargeted,
  TabSelector,
  WebAction,
} from './action/index'
export type { ActionExecutor, ActionsFor } from './action/adapter'
export type { ActionAnnotation, ActionResult } from './result/index'
export { normalizeAccessibleName } from './screen/index'
export type { ElementBounds, ScrollContext } from './screen/index'
export type { ElementInfo, ElementState, ElementLabels, ElementHierarchy } from './screen/index'
export type { ScreenState } from './screen/index'
export type { ScreenStateMetadata, ScreenStateMetadataBase } from './screen/index'
export type { ModelCapabilities } from './capability/index'
export type {
  AndroidPlatformConfig,
  BrowserConfig,
  DeviceConfig,
  IosPlatformConfig,
  PlatformBase,
  PlatformConfig,
  RemoteDeviceConfig,
  TimeoutConfig,
  Use,
  UseAndroid,
  UseIos,
  UseWeb,
  UseWebAuthState,
  WebAuthStateConfig,
  WebPlatformConfig,
} from './config/index'
export {
  appStateSchema,
  browserConfigSchema,
  deviceConfigSchema,
  platformBase,
  platformConfigSchema,
  remoteDeviceSchema,
  timeoutConfigSchema,
  useSchema,
  viewportSchema,
} from './config/index'
export { sha256hex, sha256hex16 } from './determinism/index'
export type { ScopeKey, ScopeTier, Anchor } from './identity/index'
export {
  screenIdentityHash,
  screenStateHash,
  relevantEnvDigest,
  computeCacheKey,
} from './determinism/index'
export type {
  CacheKey,
  CacheableStepInput,
  NonCacheableStepInput,
  RedactedEnvVar,
} from './determinism/index'

// 314 async-seam
export { asRunId } from './run/index'
export { asRecordId, asIssueId, asEvidenceToken } from './ids/index'
export { computeBriefDigest } from './brief/index'
export { CURRENT_HANDOFF_SCHEMA_VERSION } from './handoff/index'
export type { RunStatus, ExecutionContext, RunId } from './run/index'
export type { RecordId, IssueId, EvidenceToken, ArtifactRef } from './ids/index'
export type { Verdict, VerdictEvidence } from './verdict/index'
export type { DeltaEnvelope, CompareAndSet, BundleDraft, Delta, IssueDelta } from './delta/index'
export type { ServedBrief, BriefLine, ReadTrace, CautionLine } from './brief/index'
export type {
  CompletedRunHandoff,
  PerTestOutcome,
  StepEvidence,
  SubActionEvidence,
} from './handoff/index'

// 315 run+agent DTOs
export type { RunSession } from './run/index'
export type { Job, JobKind, JobStatus, JobConclusionKind, JobId } from './job/index'
export { asJobId, jobSchema } from './job/index'
export type {
  Approval,
  ActionProposal,
  QaProposalKind,
  ProposalStatus,
  ApprovalPolicy,
  ApprovalDecision,
  ApprovalId,
  ProposalId,
} from './approval/index'
export {
  asApprovalId,
  asProposalId,
  approvalSchema,
  actionProposalSchema,
} from './approval/index'
export type { Patch, FileChange, Hunk, PatchStatus, PatchId } from './patch/index'
export { asPatchId, patchSchema } from './patch/index'

// 316 seam helpers
export type { RecordedActionResult } from './result/index'
export type { VerifierVerdict, Decision } from './handoff/index'
export type { BundleKind, OriginStage } from './delta/index'
export { computeEvidenceToken } from './ids/index'
