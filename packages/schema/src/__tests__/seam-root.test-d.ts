import { expectTypeOf } from 'vitest'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  asEvidenceToken,
  asIssueId,
  asRecordId,
  asRunId,
  computeBriefDigest,
} from '../index'
import type {
  ArtifactRef,
  BriefLine,
  BundleDraft,
  CautionLine,
  CompareAndSet,
  CompletedRunHandoff,
  Delta,
  DeltaEnvelope,
  EvidenceToken,
  ExecutionContext,
  IssueDelta,
  IssueId,
  PerTestOutcome,
  ReadTrace,
  RecordId,
  RunId,
  RunStatus,
  ServedBrief,
  StepEvidence,
  SubActionEvidence,
  Verdict,
  VerdictEvidence,
} from '../index'

expectTypeOf(CURRENT_HANDOFF_SCHEMA_VERSION).toMatchTypeOf<number>()

expectTypeOf(asRunId).parameter(0).toEqualTypeOf<string>()
expectTypeOf(asRunId).returns.toEqualTypeOf<RunId>()
expectTypeOf(asRecordId).returns.toEqualTypeOf<RecordId>()
expectTypeOf(asIssueId).returns.toEqualTypeOf<IssueId>()
expectTypeOf(asEvidenceToken).returns.toEqualTypeOf<EvidenceToken>()

expectTypeOf<CompletedRunHandoff['runId']>().toEqualTypeOf<RunId>()
expectTypeOf<CompletedRunHandoff['executionContext']>().toEqualTypeOf<ExecutionContext>()
expectTypeOf<CompletedRunHandoff['aggregateVerdict']>().toEqualTypeOf<RunStatus>()
expectTypeOf<CompletedRunHandoff['tests']>().toEqualTypeOf<PerTestOutcome[]>()
expectTypeOf<PerTestOutcome['outcome']>().toEqualTypeOf<RunStatus>()
expectTypeOf<PerTestOutcome['steps']>().toEqualTypeOf<StepEvidence[]>()
expectTypeOf<StepEvidence['servedBrief']>().toEqualTypeOf<ServedBrief>()
expectTypeOf<StepEvidence['subActions']>().toEqualTypeOf<SubActionEvidence[]>()
expectTypeOf<SubActionEvidence['artifactRefs']>().toEqualTypeOf<ArtifactRef[] | undefined>()

expectTypeOf<Verdict['class']>().toEqualTypeOf<
  'app_bug' | 'test_bug' | 'environment' | 'flake' | 'config_error' | 'llm_error'
>()
expectTypeOf<Verdict['evidence']>().toEqualTypeOf<VerdictEvidence>()
expectTypeOf<VerdictEvidence['citedArtifacts']>().toEqualTypeOf<ArtifactRef[]>()

expectTypeOf<DeltaEnvelope['citedIds']>().toEqualTypeOf<RecordId[]>()
expectTypeOf<NonNullable<DeltaEnvelope['precondition']>[number]>().toEqualTypeOf<CompareAndSet>()
expectTypeOf<BundleDraft['distilledEvidenceRef']>().toEqualTypeOf<ArtifactRef>()
expectTypeOf<Extract<Delta, { kind: 'Confirm' }>['evidenceToken']>().toEqualTypeOf<
  EvidenceToken
>()
expectTypeOf<Extract<Delta, { kind: 'FileIssue' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<IssueDelta, { kind: 'Merge' }>['survivorId']>().toEqualTypeOf<IssueId>()
expectTypeOf<Extract<IssueDelta, { kind: 'Add' }>>().toEqualTypeOf<never>()

expectTypeOf(computeBriefDigest).parameter(0).toEqualTypeOf<ServedBrief>()
expectTypeOf(computeBriefDigest).returns.toEqualTypeOf<string>()
expectTypeOf<ServedBrief['channel1']>().toEqualTypeOf<BriefLine[]>()
expectTypeOf<ServedBrief['channel2']>().toEqualTypeOf<ReadTrace[]>()
expectTypeOf<ServedBrief['channel3']>().toEqualTypeOf<CautionLine[]>()
