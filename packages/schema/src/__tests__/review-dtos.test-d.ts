// Type-level proof for the knowledge review-verb DTO family (Phase 387 plan 02).
//
// Three claims live here because no runtime assertion can carry them:
//
//   1. `DELTA_KINDS` and `DELTA_ORIGINS` are PROJECTIONS of the §7.3 type unions, not second
//      declarations of them. The `satisfies` clause at each declaration site catches an entry
//      naming no arm; the reverse direction — an arm no entry names, which is what happens
//      when someone adds a delta kind — is caught only here.
//   2. `BRIEF_WHY_RESULT_KINDS` is the complete arm set of the union, so the "there is no
//      re-run arm" claim is checked against the union rather than against a list someone
//      remembered to update.
//   3. The proposal's `deltas` are typed as `Delta`, so the boundary's envelope-depth
//      runtime check has not silently widened the static type to `unknown`.
import { expectTypeOf } from 'vitest'

import { DELTA_KINDS } from '../delta/delta'
import type { Delta } from '../delta/delta'
import { DELTA_ORIGINS } from '../delta/envelope'
import type { DeltaEnvelope } from '../delta/envelope'
import type {
  ForgetReceiptV1,
  ForgetTargetRef,
  KnowledgeProposalV1,
  KnowledgeTargetRef,
} from '../knowledge/proposal'
import type { BriefWhyResult } from '../knowledge/review-verbs'
import { BRIEF_WHY_RESULT_KINDS } from '../knowledge/review-verbs'
import type { ServedRetrievalTraceV1 } from '../brief/retrieval-trace'

// 1. Both directions of the §7.3 projections.
expectTypeOf<Exclude<Delta['kind'], (typeof DELTA_KINDS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<(typeof DELTA_KINDS)[number], Delta['kind']>>().toEqualTypeOf<never>()
expectTypeOf<
  Exclude<DeltaEnvelope['origin'], (typeof DELTA_ORIGINS)[number]>
>().toEqualTypeOf<never>()
expectTypeOf<
  Exclude<(typeof DELTA_ORIGINS)[number], DeltaEnvelope['origin']>
>().toEqualTypeOf<never>()

// 2. The why-result union has exactly the two arms the constant names — in both directions,
// so adding a `re-run` arm to the union without touching the constant is a compile error.
expectTypeOf<Exclude<BriefWhyResult['kind'], (typeof BRIEF_WHY_RESULT_KINDS)[number]>>()
  .toEqualTypeOf<never>()
expectTypeOf<Exclude<(typeof BRIEF_WHY_RESULT_KINDS)[number], BriefWhyResult['kind']>>()
  .toEqualTypeOf<never>()

// The trace lives ONLY on the answered arm. If it appeared on the absence arm, a re-run
// result would be expressible without adding an arm at all — the drift D-15 actually risks.
expectTypeOf<Extract<BriefWhyResult, { kind: 'answered' }>['trace']>()
  .toEqualTypeOf<ServedRetrievalTraceV1>()
expectTypeOf<
  Extract<keyof Extract<BriefWhyResult, { kind: 'no-trace' }>, 'trace'>
>().toEqualTypeOf<never>()

// 3. The proposal's deltas keep their §7.3 static type through the boundary.
expectTypeOf<KnowledgeProposalV1['deltas']>().toEqualTypeOf<Delta[]>()

// The forget target is the SAME type as the proposal's target, not a parallel one.
expectTypeOf<ForgetTargetRef>().toEqualTypeOf<KnowledgeTargetRef>()
expectTypeOf<KnowledgeProposalV1['targetRef']>().toEqualTypeOf<KnowledgeTargetRef>()

// The receipt's resulting status is the MEM card's vocabulary — the fact that makes
// "designed once for both uses" (D-04 + D-19) true rather than aspirational.
expectTypeOf<ForgetReceiptV1['resultingBundleStatus']>()
  .toEqualTypeOf<'active' | 'tombstoned' | 'forgotten'>()

const target: KnowledgeTargetRef = { grain: 'bundle', shortId: 'MEM-001' }

// @ts-expect-error the target grain is closed; a product-wide forget is not expressible.
const wideTarget: KnowledgeTargetRef = { grain: 'product', product: 'shop' }

// @ts-expect-error the review verb vocabulary is closed at accept/reject/forget.
const purge: KnowledgeProposalV1['verb'] = 'purge'

void target
void wideTarget
void purge
