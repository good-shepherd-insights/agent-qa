// The circularity guard's evidence contracts (Phase 422, plan 11 — D-17/D-19/D-20).
//
// UNIMPLEMENTED. This module declares the surface the RED cells in
// `__tests__/misdirection-guard.test.ts` assert against; every body below answers a
// deliberately wrong value so those cells fail on their assertions rather than on a module
// that cannot load.

import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { StepEvidence } from '../handoff/step-evidence'
import type { RecordId } from '../ids/record-id'
import type { CrossCheck } from '../knowledge/gate-receipt'

export type MemoryOnPathTrust = 'candidate' | 'low-trust-active'

export interface MemoryOnPathEntry {
  readonly recordId: RecordId
  readonly trust: MemoryOnPathTrust
}

export interface MemoryOnPathSite extends MemoryOnPathEntry {
  readonly stepIndex: number
}

export type MisdirectionBacking = 'declared-only'

export interface MisdirectionSamples {
  readonly k: number
  readonly seeds: readonly number[]
  readonly modelCalls: number
}

export interface MisdirectionRecordResult {
  readonly runId: string
  readonly perTest: number
  readonly stepIndex: number
  readonly decisionOrdinal: number
  readonly recordId: RecordId
  readonly handoffBaseDigest: string
  readonly briefDigest: string
  readonly corpusDigest: string
  readonly profileDigest: string
  readonly crossCheck: CrossCheck
  readonly seedHonored: boolean
  readonly reason?: string
  readonly samples?: MisdirectionSamples
}

export interface MisdirectionEvidence {
  readonly crossCheck: CrossCheck
  readonly results: readonly MisdirectionRecordResult[]
  readonly recordId?: RecordId
  readonly reason?: string
  readonly samples?: MisdirectionSamples
  readonly backing?: MisdirectionBacking
}

export interface MisdirectionAggregationInput {
  readonly runId: string
  readonly perTest: number
  readonly handoffBaseDigest: string
  readonly sites: readonly MemoryOnPathSite[]
  readonly results: readonly MisdirectionRecordResult[]
}

export type MisdirectionAggregate =
  | { readonly outcome: 'held'; readonly records: readonly RecordId[] }
  | { readonly outcome: 'flipped'; readonly suspect: readonly RecordId[] }
  | {
      readonly outcome: 'unknown'
      readonly inconclusive: readonly RecordId[]
      readonly notRun: readonly RecordId[]
      readonly unchecked: readonly RecordId[]
    }
  | { readonly outcome: 'evidence-refused'; readonly problems: readonly string[] }

export class MisdirectionEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MisdirectionEvidenceError'
  }
}

export function deriveMemoryOnPathSites(_steps: readonly StepEvidence[]): MemoryOnPathSite[] {
  return []
}

export function deriveMemoryOnPath(_steps: readonly StepEvidence[]): MemoryOnPathEntry[] {
  return []
}

export function aggregateMisdirectionEvidence(
  _input: MisdirectionAggregationInput,
): MisdirectionAggregate {
  return { outcome: 'unknown', inconclusive: [], notRun: [], unchecked: [] }
}

export function misdirectionSourceDigest(_handoff: CompletedRunHandoff): string {
  return ''
}

export function guardMisdirectionEvidence(value: unknown): MisdirectionEvidence {
  return value as MisdirectionEvidence
}
