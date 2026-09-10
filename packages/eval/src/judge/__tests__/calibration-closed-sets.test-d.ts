import { expectTypeOf, it } from 'vitest'
import { JUDGE_CALIBRATION_GAP_REASONS, JUDGE_CALIBRATION_STATUSES } from '../../index'
import type { JudgeCalibrationGapReason, JudgeCalibrationStatus } from '../../index'

it('judge calibration gaps exact', () => {
  expectTypeOf<JudgeCalibrationGapReason>().toEqualTypeOf<'panel-not-configured' | 'no-credential' | 'single-family-host'>()
  expectTypeOf<(typeof JUDGE_CALIBRATION_GAP_REASONS)[number]>().toEqualTypeOf<'panel-not-configured' | 'no-credential' | 'single-family-host'>()
  expectTypeOf<Exclude<JudgeCalibrationGapReason, (typeof JUDGE_CALIBRATION_GAP_REASONS)[number]>>().toEqualTypeOf<never>()
})
it('judge calibration statuses exact', () => {
  expectTypeOf<JudgeCalibrationStatus>().toEqualTypeOf<'calibrated' | 'uncalibrated' | 'capability-gap'>()
  expectTypeOf<(typeof JUDGE_CALIBRATION_STATUSES)[number]>().toEqualTypeOf<'calibrated' | 'uncalibrated' | 'capability-gap'>()
  expectTypeOf<Exclude<JudgeCalibrationStatus, (typeof JUDGE_CALIBRATION_STATUSES)[number]>>().toEqualTypeOf<never>()
})
