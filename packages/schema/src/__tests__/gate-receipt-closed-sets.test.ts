import { describe, expect, it } from 'vitest'
import {
  GATE_NUMBERS, GATE_VERDICTS, CROSS_CHECKS, DEGRADATIONS, BENEFITS, MARKS, STATE_VALIDITIES,
} from '../knowledge/gate-receipt'

// 2026-09-06, 416 D-02: the v54 runtime bar. Plan 06 measures these named cells with
// scripts/416-gate-mutation.sh legs G-05..G-11; relative imports measure edited source bytes.
describe('416 receipt closed vocabularies', () => {
  it('declares exactly the three gate numbers, in declaration order', () => {
    expect([...GATE_NUMBERS]).toEqual([1, 2, 3])
  })
  it('declares exactly the three gate verdicts, in declaration order', () => {
    expect([...GATE_VERDICTS]).toEqual(['pass', 'fail', 'abstain'])
  })
  it('declares exactly the four cross checks, in declaration order', () => {
    expect([...CROSS_CHECKS]).toEqual(['flipped', 'held', 'inconclusive', 'not-run'])
  })
  it('declares exactly the two degradations, in declaration order', () => {
    expect([...DEGRADATIONS]).toEqual(['replay-diff', 'tier-not-implemented'])
  })
  it('declares exactly the three benefits, in declaration order', () => {
    expect([...BENEFITS]).toEqual(['exercised-benefited', 'rode-along', 'exercised-harmed'])
  })
  it('declares exactly the three marks, in declaration order', () => {
    expect([...MARKS]).toEqual(['false-fail', 'false-pass', 'confirmed-bug'])
  })
  it('declares exactly the three state validities, in declaration order', () => {
    expect([...STATE_VALIDITIES]).toEqual(['valid', 'stale', 'unknown'])
  })
})
