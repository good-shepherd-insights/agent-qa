import type { ModelIdentity, SamplingParams } from '@vostride/agent-qa-schema'

/** Declared and observed model identity pins for one decision (D-19). */
export interface CassetteModelReceipt {
  /** Declared provider and model identifier, when recorded (D-19). */
  declared?: ModelIdentity
  /** Provider-resolved model identifier, when exposed (D-19). */
  resolvedModelId?: string
  /** Provider-observed model fingerprint, when exposed (D-19). */
  fingerprint?: string
}

/** Declared and effective sampling pins for one decision (D-19). */
export interface CassetteSamplingReceipt {
  /** Declared sampling intent; absence means provider defaults (D-19). */
  declared?: SamplingParams
  /** Effective sampling values observed at the call boundary, when known (D-19). */
  effective?: SamplingParams
}

/** Identity of the label-producing judge paths (D-19). */
export interface CassetteJudgeReceipt {
  /** Recorded verifier identity that produced the current label, when present (D-19). */
  recordedVerifier?: ModelIdentity
  /** Reserved identifier for the later tier-4 judge contract (D-19). */
  tier4JudgeId?: string
}

/** Eight-part reproducibility receipt for a cassette decision (CASS-04/D-19). */
export interface CassetteReceipt {
  /** Full digest of the canonical serialized cassette input leg (CASS-04). */
  promptInputHash: string
  /** Declared and observed model identity component (CASS-04). */
  model: CassetteModelReceipt
  /** Declared and effective sampling component (CASS-04). */
  sampling: CassetteSamplingReceipt
  /** Recorded bound-tool-surface digest, when available (CASS-04). */
  toolSchemaDigest?: string
  /** Recomputed deterministic hash of the recorded observation (CASS-04). */
  screenStateHash: string
  /** Digest already carried by the exact served brief, when available (CASS-04). */
  memoryBriefDigest?: string
  /** Recorded verifier identity and reserved tier-4 judge slot (CASS-04/D-19). */
  judge: CassetteJudgeReceipt
  /** Monotonic build ordinal copied from the handoff root (CASS-04). */
  buildOrdinal: number
}
