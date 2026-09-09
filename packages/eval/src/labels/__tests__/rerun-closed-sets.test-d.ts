import { expectTypeOf, it } from 'vitest'
import type { StandaloneLabelRecord } from '../label-record'
import type { SilverExclusionReason } from '../silver-sampling'
import { SILVER_EXCLUSION_REASONS, LABEL_QUARANTINE_MARKERS } from '../silver-sampling'

type ExpectedExclusions = 'test-not-passed' | 'step-verdict-failed' | 'self-heal-step'
  | 'evidence-incomplete' | 'cap-exceeded' | 'procedure-granularity' | 'rerun-overturn-quarantined'
type Quarantine = NonNullable<StandaloneLabelRecord['quarantine']>

it('420 exact silver exclusions type bars', () => {
  expectTypeOf<Exclude<SilverExclusionReason, ExpectedExclusions>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ExpectedExclusions, SilverExclusionReason>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<SilverExclusionReason, typeof SILVER_EXCLUSION_REASONS[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<typeof SILVER_EXCLUSION_REASONS[number], SilverExclusionReason>>().toEqualTypeOf<never>()
})

it('420 exact quarantine marker type bars', () => {
  expectTypeOf<Exclude<Quarantine, 'rerun-overturned'>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'rerun-overturned', Quarantine>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Quarantine, typeof LABEL_QUARANTINE_MARKERS[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<typeof LABEL_QUARANTINE_MARKERS[number], Quarantine>>().toEqualTypeOf<never>()
})
