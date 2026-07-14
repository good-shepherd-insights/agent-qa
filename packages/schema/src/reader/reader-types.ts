import type { BriefLine, CautionLine } from '../brief/served-brief'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { RecordId } from '../ids/record-id'

export interface IndexEntry {
  id: RecordId
  kind: string
  subtype?: string
  title: string
  summary: string
  trust: number
  anchors: Anchor[]
  status: string
  servedAsCanary: boolean
  /** D-14 temporal serving role; distinct from whether this entry was served to a canary. */
  servedAs?: 'current' | 'prior-build-hypothesis'
  /** D-16 active-conflict annotation linking the surviving peer and minted unknown record. */
  conflict?: { peerRecordId: RecordId; unknownRecordId: RecordId }
  /** D-15 audit-read state; absent from ordinary serving-path reads. */
  audit?: { status: string; openedAtOrdinal: number; closedAtOrdinal: number | null }
  scope: ScopeKey
  validity: string
}

export interface RecordBody {
  id: RecordId
  title: string
  body: string
  anchors: Anchor[]
  evidenceDigest: string
  measurement?: string
  relations: { kind: string; targetId: RecordId }[]
}

export interface BriefBlock {
  tiers: { L0: string; L1: string; L2: string }
  lines: BriefLine[]
  truncation: string
}

export interface CautionBlock {
  cautions: CautionLine[]
  budgetUsed: number
}

export interface ProcedureMatch {
  id: RecordId
  flowAnchor: Anchor
  confidence: number
  authoringModelTier: string
  parameterSchema: { name: string; type: string; required: boolean }[]
  replayRecommendation: 'replay' | 'hint'
}
