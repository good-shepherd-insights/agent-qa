import { expect, it } from 'vitest'
import * as labels from '../../cassette/label-leg'

it('420 exact label channels', () => {
  expect(labels.LABEL_SOURCE_CHANNELS).toEqual([
    'recorded-verdict',
    'user-mark',
    'overturned-verdict',
    'self-heal-pair',
  ])
})

it('420 exact label tiers', () => {
  expect(labels.LABEL_TIERS).toEqual(['gold', 'near-gold', 'silver'])
})
