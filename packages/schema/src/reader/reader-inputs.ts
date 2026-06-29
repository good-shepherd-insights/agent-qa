import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { RecordId } from '../ids/record-id'

export interface BuildRange {
  from?: number
  to?: number
}

export interface SearchOptions {
  scope: ScopeKey
  kind?: string
  anchors?: Anchor[]
  asOfBuild?: number
  includeSuperseded?: boolean
  asOfRange?: BuildRange
  includeCandidates?: boolean
}

export interface ReadOptions {
  detailLevel?: string
}

export interface CanaryOutcome {
  candidateId: RecordId
  runOutcome: string
  attribution: string
  exercisedAnchor: Anchor
}
