import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'

declare const bundleKindBrand: unique symbol
declare const originStageBrand: unique symbol

export type BundleKind = string & { readonly [bundleKindBrand]: 'BundleKind' }
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
  subtype?: string
  anchors: Anchor[]
  scope: ScopeKey
  summary: string
  body: string
  distilledEvidenceRef: ArtifactRef
  originStage: OriginStage
}
