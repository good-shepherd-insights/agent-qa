import { expectTypeOf } from 'vitest'
import type { BriefLine, CautionLine } from '../brief/served-brief'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { RecordId } from '../ids/record-id'
import type {
  BriefBlock,
  BuildRange,
  CanaryOutcome,
  CautionBlock,
  IndexEntry,
  ProcedureMatch,
  ReadOptions,
  RecordBody,
  SearchOptions,
} from '../reader/index'

expectTypeOf<IndexEntry>().toEqualTypeOf<{
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
}>()

expectTypeOf<keyof IndexEntry>().toEqualTypeOf<
  | 'id'
  | 'kind'
  | 'subtype'
  | 'title'
  | 'summary'
  | 'trust'
  | 'anchors'
  | 'status'
  | 'servedAsCanary'
  | 'scope'
  | 'validity'
>()

expectTypeOf<RecordBody>().toEqualTypeOf<{
  id: RecordId
  title: string
  body: string
  anchors: Anchor[]
  evidenceDigest: string
  measurement?: string
  relations: { kind: string; targetId: RecordId }[]
}>()

expectTypeOf<keyof RecordBody>().toEqualTypeOf<
  'id' | 'title' | 'body' | 'anchors' | 'evidenceDigest' | 'measurement' | 'relations'
>()

expectTypeOf<BriefBlock>().toEqualTypeOf<{
  tiers: { L0: string; L1: string; L2: string }
  lines: BriefLine[]
  truncation: string
}>()

expectTypeOf<BriefBlock['lines']>().toEqualTypeOf<BriefLine[]>()

expectTypeOf<CautionBlock>().toEqualTypeOf<{
  cautions: CautionLine[]
  budgetUsed: number
}>()

expectTypeOf<CautionBlock['cautions']>().toEqualTypeOf<CautionLine[]>()

expectTypeOf<ProcedureMatch>().toEqualTypeOf<{
  id: RecordId
  flowAnchor: Anchor
  confidence: number
  authoringModelTier: string
  parameterSchema: { name: string; type: string; required: boolean }[]
  replayRecommendation: 'replay' | 'hint'
}>()

expectTypeOf<ProcedureMatch['replayRecommendation']>().toEqualTypeOf<'replay' | 'hint'>()
expectTypeOf<IndexEntry['anchors']>().toEqualTypeOf<Anchor[]>()

expectTypeOf<BuildRange>().toEqualTypeOf<{
  from?: number
  to?: number
}>()

expectTypeOf<SearchOptions>().toEqualTypeOf<{
  scope: ScopeKey
  kind?: string
  anchors?: Anchor[]
  asOfBuild?: number
  includeSuperseded?: boolean
  asOfRange?: BuildRange
  includeCandidates?: boolean
}>()

expectTypeOf<SearchOptions['asOfRange']>().toEqualTypeOf<BuildRange | undefined>()

expectTypeOf<ReadOptions>().toEqualTypeOf<{
  detailLevel?: string
}>()

expectTypeOf<CanaryOutcome>().toEqualTypeOf<{
  candidateId: RecordId
  runOutcome: string
  attribution: string
  exercisedAnchor: Anchor
}>()

expectTypeOf<keyof CanaryOutcome>().toEqualTypeOf<
  'candidateId' | 'runOutcome' | 'attribution' | 'exercisedAnchor'
>()
