import { expect, it } from 'vitest'
import * as calibration from '../calibration'

it('judge calibration gaps exact', () => {
  expect(calibration.JUDGE_CALIBRATION_GAP_REASONS).toEqual([
    'panel-not-configured', 'no-credential', 'single-family-host',
  ])
})
it('judge calibration statuses exact', () => {
  expect(calibration.JUDGE_CALIBRATION_STATUSES).toEqual([
    'calibrated', 'uncalibrated', 'capability-gap',
  ])
})
it('records the independent default and explicit minimum provenance', () => {
  expect(calibration.JUDGE_CALIBRATION_MIN_N).toBe(20)
  expect(calibration.resolveJudgeCalibrationMinimum()).toEqual({ value: 20, source: 'default' })
  expect(calibration.resolveJudgeCalibrationMinimum(2)).toEqual({ value: 2, source: 'flag' })
  expect(calibration.resolveJudgeCalibrationMinimum(20)).toEqual({ value: 20, source: 'flag' })
  expect(calibration.resolveJudgeCalibrationMinimum(Number.MAX_SAFE_INTEGER)).toEqual({ value: Number.MAX_SAFE_INTEGER, source: 'flag' })
})
it.each([NaN, Infinity, -Infinity, -1, 0, 1, 2.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid minimum %s before work', value => {
  expect(() => calibration.resolveJudgeCalibrationMinimum(value)).toThrow('min-n must be a safe integer at least 2')
})
