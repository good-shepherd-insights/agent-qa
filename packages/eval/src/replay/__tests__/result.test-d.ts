// Plan 12 mutation anchors (file:line:column at each assertion's toEqualTypeOf):
// packages/eval/src/replay/__tests__/result.test-d.ts:18:5 — refusal coverage
// packages/eval/src/replay/__tests__/result.test-d.ts:19:71 — historical refusal retained
// packages/eval/src/replay/__tests__/result.test-d.ts:20:69 — unshipped refusal excluded
// packages/eval/src/replay/__tests__/result.test-d.ts:21:70 — brief-source coverage
// packages/eval/src/replay/__tests__/result.test-d.ts:22:67 — turn-match coverage
// packages/eval/src/replay/__tests__/result.test-d.ts:23:77 — brief-delta coverage
import { expectTypeOf } from 'vitest'
import type { BriefSource, TurnMatch } from '../brief-tiers'
import { BRIEF_SOURCES, TURN_MATCHES } from '../brief-tiers'
import type { ReplayRefusal } from '../result'
import { REPLAY_REFUSAL_REASONS } from '../result'
import type { BriefDeltaKind } from '../brief-delta'
import { BRIEF_DELTA_KINDS } from '../brief-delta'

expectTypeOf<
  Exclude<ReplayRefusal['reason'], (typeof REPLAY_REFUSAL_REASONS)[number]>
>().toEqualTypeOf<never>()
expectTypeOf<Extract<ReplayRefusal['reason'], 'unsupported-brief'>>().toEqualTypeOf<'unsupported-brief'>()
expectTypeOf<Extract<ReplayRefusal['reason'], 'brief-too-large'>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<BriefSource, (typeof BRIEF_SOURCES)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<TurnMatch, (typeof TURN_MATCHES)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<BriefDeltaKind, (typeof BRIEF_DELTA_KINDS)[number]>>().toEqualTypeOf<never>()
