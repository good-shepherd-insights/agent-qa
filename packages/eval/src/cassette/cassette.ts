import type {
  AssertValueEvidence,
  MemberTestOutcome,
  VerifierVerdict,
} from '@vostride/agent-qa-schema'
import type { CassetteCompleteness } from './completeness'
import type { CassetteInputLeg } from './input-leg'
import type { CassetteLabelLeg } from './label-leg'
import type { CassetteReceipt } from './receipt-leg'
import type { CassetteSidecarLeg } from './sidecar-leg'

/** The single schema version shared by the envelope and all four legs (D-14). */
export const CASSETTE_SCHEMA_VERSION = 1

/** One complete live planner decision assembled from the four cassette legs (D-03). */
export interface DecisionRecord {
  /** Reconstructable planner input (D-03). */
  input: CassetteInputLeg
  /** Matcher-owned gold action and target context (D-03). */
  sidecar: CassetteSidecarLeg
  /** Recorded outcome plus label provenance (D-16). */
  label: CassetteLabelLeg
  /** Reproducibility pins for attribution (D-19). */
  receipt: CassetteReceipt
}

/** A procedure entry backed by a live planner decision (D-08). */
export interface ProcedureDecisionStepRecord {
  /** Discriminator for a fully replayable decision entry (D-08). */
  kind: 'decision'
  /** Recorded step position (D-08). */
  stepIndex: number
  /** Recorded decision position within the step (D-08). */
  decisionOrdinal: number
  /** Fully self-contained four-leg decision record (D-08). */
  record: DecisionRecord
}

/** A truthful procedure entry for an action served from cache (D-08). */
export interface ProcedureCacheServedStepRecord {
  /** Discriminator for a non-replayable cache-served entry (D-08). */
  kind: 'cache-served'
  /** Recorded step position (D-08). */
  stepIndex: number
  /** Recorded cached-action position within the step (D-08). */
  decisionOrdinal: number
}

/** A truthful procedure entry for a step whose outcome was synthesized (D-08). */
export interface ProcedureSynthesizedStepRecord {
  /** Discriminator for a step with no recorded action decision (D-08). */
  kind: 'synthesized'
  /** Recorded step position (D-08). */
  stepIndex: number
}

/** Ordering-faithful union of procedure entries (D-08). */
export type ProcedureStepRecord =
  | ProcedureDecisionStepRecord
  | ProcedureCacheServedStepRecord
  | ProcedureSynthesizedStepRecord

/** Purely recorded terminal state for one procedure cassette (D-18). */
export interface ProcedureEndState {
  /** Recorded member-test outcome (D-18). */
  outcome: MemberTestOutcome
  /** Final recorded verifier outcome, when one exists (D-18). */
  finalVerdict?: VerifierVerdict
  /** Final recorded deterministic assertion outcome, when the last decision was one (D-18). */
  finalAssert?: AssertValueEvidence
}

interface CassetteEnvelopeBase {
  /** Single version gate for the complete cassette document (D-14). */
  schemaVersion: number
  /** Deterministic run-derived cassette identity (D-07). */
  id: string
  /** Source run identity copied as a plain wire string (D-03). */
  runId: string
  /** Source test identity (D-03). */
  testId: string
  /** Recorded test position within the source run (D-03). */
  testIndex: number
  /** Complete ordered closure of required content digests (D-08). */
  blobs: readonly string[]
  /** Unified status and structured missing-evidence details (D-11). */
  completeness: CassetteCompleteness
}

/** Self-contained single-decision cassette (D-08). */
export interface LeafCassette extends CassetteEnvelopeBase {
  /** Leaf-granularity discriminator (D-08). */
  granularity: 'leaf'
  /** Recorded step position for this decision (D-08). */
  stepIndex: number
  /** Recorded decision position within the step (D-08). */
  decisionOrdinal: number
  /** Reconstructable planner input leg (D-03). */
  input: CassetteInputLeg
  /** Gold action and target sidecar leg (D-03). */
  sidecar: CassetteSidecarLeg
  /** Recorded outcome label leg (D-16). */
  label: CassetteLabelLeg
  /** Reproducibility receipt leg (D-19). */
  receipt: CassetteReceipt
}

/** Self-contained procedure cassette scored as independent recorded decisions (D-08). */
export interface ProcedureCassette extends CassetteEnvelopeBase {
  /** Procedure-granularity discriminator (D-08). */
  granularity: 'procedure'
  /** Ordered decision, cache-served, and synthesized entries (D-08). */
  steps: readonly ProcedureStepRecord[]
  /** Purely recorded procedure outcome and terminal assertions (D-18). */
  endState: ProcedureEndState
}

/** Supported cassette granularities for the v1 contract (D-08). */
export type CassetteGranularity = 'leaf' | 'procedure'

/** Complete versioned cassette wire contract (CASS-01). */
export type Cassette = LeafCassette | ProcedureCassette
