import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { RecordId } from '../ids/record-id'

export interface BriefLine {
  id: RecordId
  kind: string
  summary: string
  trust: number
  status: string
  servedAsCanary: boolean
  tier: string
}

export interface ReadTrace {
  id: RecordId
  detailLevel: string
  bodyDigest: string
}

export interface CautionLine {
  id: RecordId
  anchors: Anchor[]
  summary: string
}

export interface ServedBrief {
  scope: ScopeKey
  asOfBuild: number
  budget: number
  truncation: string
  channel1: BriefLine[]
  channel2: ReadTrace[]
  channel3: CautionLine[]
  briefDigest: string
}
