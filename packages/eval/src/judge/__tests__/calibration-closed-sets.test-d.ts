import { expectTypeOf, it } from 'vitest'
import { JUDGE_CALIBRATION_GAP_REASONS, JUDGE_CALIBRATION_STATUSES } from '../../index'
import type { JudgeCalibrationGapReason, JudgeCalibrationStatus } from '../../index'

// Independent union/list never-bars: neither expectation derives from its subject.
it('judge calibration gaps exact type bars', () => {
  expectTypeOf<JudgeCalibrationGapReason>().toEqualTypeOf<'panel-not-configured' | 'no-credential' | 'single-family-host'>()
  expectTypeOf<(typeof JUDGE_CALIBRATION_GAP_REASONS)[number]>().toEqualTypeOf<'panel-not-configured' | 'no-credential' | 'single-family-host'>()
  expectTypeOf<Exclude<JudgeCalibrationGapReason, (typeof JUDGE_CALIBRATION_GAP_REASONS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'panel-not-configured' | 'no-credential' | 'single-family-host', JudgeCalibrationGapReason>>().toBeNever()
  expectTypeOf<Exclude<JudgeCalibrationGapReason, 'panel-not-configured' | 'no-credential' | 'single-family-host'>>().toBeNever()
  expectTypeOf<Exclude<'panel-not-configured' | 'no-credential' | 'single-family-host', (typeof JUDGE_CALIBRATION_GAP_REASONS)[number]>>().toBeNever()
  expectTypeOf<Exclude<(typeof JUDGE_CALIBRATION_GAP_REASONS)[number], 'panel-not-configured' | 'no-credential' | 'single-family-host'>>().toBeNever()
})
it('judge calibration statuses exact type bars', () => {
  expectTypeOf<JudgeCalibrationStatus>().toEqualTypeOf<'calibrated' | 'uncalibrated' | 'capability-gap'>()
  expectTypeOf<(typeof JUDGE_CALIBRATION_STATUSES)[number]>().toEqualTypeOf<'calibrated' | 'uncalibrated' | 'capability-gap'>()
  expectTypeOf<Exclude<JudgeCalibrationStatus, (typeof JUDGE_CALIBRATION_STATUSES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'calibrated' | 'uncalibrated' | 'capability-gap', JudgeCalibrationStatus>>().toBeNever()
  expectTypeOf<Exclude<JudgeCalibrationStatus, 'calibrated' | 'uncalibrated' | 'capability-gap'>>().toBeNever()
  expectTypeOf<Exclude<'calibrated' | 'uncalibrated' | 'capability-gap', (typeof JUDGE_CALIBRATION_STATUSES)[number]>>().toBeNever()
  expectTypeOf<Exclude<(typeof JUDGE_CALIBRATION_STATUSES)[number], 'calibrated' | 'uncalibrated' | 'capability-gap'>>().toBeNever()
})
