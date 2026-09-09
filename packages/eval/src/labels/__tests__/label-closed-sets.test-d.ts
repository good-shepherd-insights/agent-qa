import { expectTypeOf, it } from 'vitest'
import { LABEL_SOURCE_CHANNELS, LABEL_TIERS } from '../../cassette/label-leg'
import type { LabelSourceChannel, LabelTier } from '../../cassette/label-leg'

type ExpectedChannels = 'recorded-verdict' | 'user-mark' | 'overturned-verdict' | 'self-heal-pair'
type ExpectedTiers = 'gold' | 'near-gold' | 'silver'
type ListedChannels = (typeof LABEL_SOURCE_CHANNELS)[number]
type ListedTiers = (typeof LABEL_TIERS)[number]

it('420 exact label channels type bars', () => {
  expectTypeOf<Exclude<LabelSourceChannel, ExpectedChannels>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ExpectedChannels, LabelSourceChannel>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<LabelSourceChannel, ListedChannels>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ListedChannels, LabelSourceChannel>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<LabelSourceChannel, 'judge-panel' | 'calibrated'>>().toEqualTypeOf<never>()
})

it('420 exact label tiers type bars', () => {
  expectTypeOf<Exclude<LabelTier, ExpectedTiers>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ExpectedTiers, LabelTier>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<LabelTier, ListedTiers>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ListedTiers, LabelTier>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<LabelTier, 'platinum' | 'bronze'>>().toEqualTypeOf<never>()
})
