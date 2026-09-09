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
