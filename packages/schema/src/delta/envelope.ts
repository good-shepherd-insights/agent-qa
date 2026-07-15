import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { ExecutionContext } from '../run/run-status'

export type BundleKind = 'fact' | 'procedure' | 'caution' | 'unknown' | 'policy'
export type FactSubtype =
  | 'selector'
  | 'behavioral'
  | 'navigational'
  | 'measurement'
  | 'content'

/** Phase 378 closes the producer vocabulary around the one-shot Curator drainer. */
export type OriginStage = 'run-curation'

export type CurationAuthorshipPath = 'llm' | 'llm-repaired' | 'deterministic-fallback'

/**
 * D-04 raw Curator authorship facts with the SAFE-01 write-posture context that produced them.
 */
export interface CurationAuthorship {
  path: CurationAuthorshipPath
  model?: {
    id: string
    family?: string
    fingerprint?: string
  }
  executionContext: ExecutionContext
}

export interface CompareAndSet {
  recordId: RecordId
  observedStatus: string
  observedOrdinal: number
}

export interface DeltaEnvelope {
  origin: 'agent' | 'user' | 'import' | 'system'
  scope: ScopeKey
  citedIds: RecordId[]
  precondition?: CompareAndSet[]
  authorship?: CurationAuthorship
}

export interface BundleDraft {
  kind: BundleKind
  subtype?: FactSubtype
  anchors: Anchor[]
  scope: ScopeKey
  summary: string
  body: string
  distilledEvidenceRef: ArtifactRef
  originStage: OriginStage
}
