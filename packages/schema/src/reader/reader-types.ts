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
