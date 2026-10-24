import { slugBranch } from '@vostride/agent-qa-schema'

export interface DeriveLeafCassetteIdInput {
  runSlug: string
  testIndex: number
  stepIndex: number
  decisionOrdinal: number
}

export interface DeriveProcedureCassetteIdInput {
  runSlug: string
  testIndex: number
}

function ordinal(value: number): string {
  return String(value).padStart(2, '0')
}

/** 2026-09-08, 419 D-05/D-11: each mark mints a distinct case; provenance retains the leaf id. */
export function deriveGoldCassetteId(input: { leafCassetteId: string; markOrdinal: number }): string {
  return `${input.leafCassetteId}-gold-m${ordinal(input.markOrdinal)}`
}

/** Derive the one traversal-safe slug shared by every cassette from a run (D-07). */
export function deriveRunSlug(runId: string): string {
  return slugBranch(runId)
}

/** Derive a deterministic, human-navigable single-decision cassette id (D-07). */
export function deriveLeafCassetteId(input: DeriveLeafCassetteIdInput): string {
  return `${input.runSlug}/test-${ordinal(input.testIndex)}-step-${ordinal(input.stepIndex)}-d${ordinal(input.decisionOrdinal)}-leaf`
}

/** Derive a deterministic, human-navigable per-test procedure cassette id (D-07). */
export function deriveProcedureCassetteId(input: DeriveProcedureCassetteIdInput): string {
  return `${input.runSlug}/test-${ordinal(input.testIndex)}-procedure`
}
