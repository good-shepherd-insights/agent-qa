import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'

declare const originStageBrand: unique symbol

export type BundleKind = 'fact' | 'procedure' | 'caution' | 'unknown' | 'policy'
export type FactSubtype =
  | 'selector'
  | 'behavioral'
  | 'navigational'
  | 'measurement'
  | 'content'

/**
 * D-06 review: no closed origin-stage vocabulary is ratified yet. Phase 378 owns closing this
 * brand when the Curator becomes the first live BundleDraft producer.
 */
export type OriginStage = string & { readonly [originStageBrand]: 'OriginStage' }

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
