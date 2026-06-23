import { expectTypeOf } from 'vitest'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'
import type { BriefLine, CautionLine, ReadTrace, ServedBrief } from '../brief/served-brief'

expectTypeOf<ServedBrief>().toEqualTypeOf<{
  scope: ScopeKey
  asOfBuild: number
  budget: number
  truncation: string
  channel1: BriefLine[]
  channel2: ReadTrace[]
  channel3: CautionLine[]
  briefDigest: string
}>()

expectTypeOf<keyof ServedBrief>().toEqualTypeOf<
  | 'scope'
  | 'asOfBuild'
  | 'budget'
  | 'truncation'
  | 'channel1'
  | 'channel2'
  | 'channel3'
  | 'briefDigest'
>()

expectTypeOf<BriefLine>().toMatchTypeOf<{
  trust: number
  status: string
  servedAsCanary: boolean
  tier: string
}>()

expectTypeOf<ServedBrief['channel1']>().toEqualTypeOf<BriefLine[]>()
expectTypeOf<ServedBrief['channel2']>().toEqualTypeOf<ReadTrace[]>()
expectTypeOf<ServedBrief['channel3']>().toEqualTypeOf<CautionLine[]>()

expectTypeOf<CautionLine['anchors']>().toEqualTypeOf<Anchor[]>()
