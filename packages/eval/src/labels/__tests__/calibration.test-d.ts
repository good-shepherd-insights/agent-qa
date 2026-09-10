import { expectTypeOf, it } from 'vitest'
import { CHANNEL_TO_ORIGIN_CLASS, LABEL_CALIBRATION_STATUSES } from '../../index'
import type { LabelCalibrationStatus, NoisyChannelCalibration } from '../../index'

it('420 exact channel mapping', () => {
  expectTypeOf<typeof CHANNEL_TO_ORIGIN_CLASS>().toEqualTypeOf<{
    readonly 'recorded-verdict': 'agent-verified'
    readonly 'self-heal-pair': 'agent-observed'
    readonly 'user-mark': 'user'
    readonly 'overturned-verdict': 'user'
  }>()
})
it('420 exact calibration status', () => {
  expectTypeOf<LabelCalibrationStatus>().toEqualTypeOf<'uncalibrated' | 'calibrated'>()
  expectTypeOf<(typeof LABEL_CALIBRATION_STATUSES)[number]>().toEqualTypeOf<'uncalibrated' | 'calibrated'>()
  expectTypeOf<Extract<NoisyChannelCalibration, { status: 'uncalibrated' }>>().toEqualTypeOf<{ status: 'uncalibrated'; n: number; n_gold: number }>()
})

type Mapping = typeof CHANNEL_TO_ORIGIN_CLASS
type Mapped<K> = K extends keyof Mapping ? Mapping[K] : never
it('420 exact channel mapping keys type bar', () => {
  expectTypeOf<keyof Mapping>().toEqualTypeOf<'recorded-verdict' | 'self-heal-pair' | 'user-mark' | 'overturned-verdict'>()
})
it('420 exact channel mapping value recorded-verdict type bar', () => {
  expectTypeOf<Mapped<'recorded-verdict'>>().toEqualTypeOf<'agent-verified'>()
})
it('420 exact channel mapping value self-heal-pair type bar', () => {
  expectTypeOf<Mapped<'self-heal-pair'>>().toEqualTypeOf<'agent-observed'>()
})
it('420 exact channel mapping value user-mark type bar', () => {
  expectTypeOf<Mapped<'user-mark'>>().toEqualTypeOf<'user'>()
})
it('420 exact channel mapping value overturned-verdict type bar', () => {
  expectTypeOf<Mapped<'overturned-verdict'>>().toEqualTypeOf<'user'>()
})
