import { describe, expect, it } from 'vitest'
import type { ReplaySampleOutcome } from '../../replay/result'
import * as api from '../../index'
import { asRef } from '@vostride/agent-qa-schema'

function invoke(name: string, ...args: unknown[]) {
  const fn = Reflect.get(api, name)
  expect(fn, name).toBeTypeOf('function')
  return fn(...args)
}
const gold = { opClass: 'click' }
const decision = (opClass: string): ReplaySampleOutcome => ({
  kind: 'decision',
  action: { type: 'click', ref: asRef('e1') },
  identity: { opClass },
})
const repeated = (outcome: ReplaySampleOutcome, k = 3) => Array.from({ length: k }, () => outcome)
const fold = (withRecord: ReplaySampleOutcome[], withoutRecord: ReplaySampleOutcome[]) =>
  invoke('foldRemovalSamples', { withRecord, withoutRecord, gold })

describe('cross-check sampling', () => {
  it('pins the derived seed stream, independent of the base seed', () => {
    expect(invoke('deriveSampleSeeds', 11, 3)).toEqual([1938274511, 1319274378])
    const extended = invoke('deriveSampleSeeds', 11, 5)
    expect(extended.slice(0, 2)).toEqual(invoke('deriveSampleSeeds', 11, 3))
    expect(new Set([11, ...extended]).size).toBe(5)
  })
  it.each([1, 2, 4, 3.5, NaN])('rejects invalid k=%s', (k) => {
    // Assert the public symbol separately so an absent function is not accepted as TypeError.
    expect(Reflect.get(api, 'deriveSampleSeeds')).toBeTypeOf('function')
    expect(() => invoke('deriveSampleSeeds', 11, k)).toThrow(TypeError)
  })
  it('requires three at k=3 and four at k=5', () => {
    expect(invoke('requiredAgreement', 3)).toBe(3)
    // requiredAgreement(5) = 4, preserving the strict supermajority when k grows.
    expect(invoke('requiredAgreement', 5)).toBe(4)
  })
  it('confirms a unanimous flip', () => {
    expect(fold(repeated(decision('click')), repeated(decision('scroll')))).toBe('flipped')
  })
  it('makes a 2-of-3 split in either arm inconclusive', () => {
    expect(
      fold(
        [decision('click'), decision('click'), decision('scroll')],
        repeated(decision('scroll')),
      ),
    ).toBe('inconclusive')
    expect(
      fold(repeated(decision('click')), [
        decision('scroll'),
        decision('scroll'),
        decision('click'),
      ]),
    ).toBe('inconclusive')
  })
  it('holds identical non-gold decisions and identical failures', () => {
    expect(fold(repeated(decision('scroll')), repeated(decision('scroll')))).toBe('held')
    const failure: ReplaySampleOutcome = {
      kind: 'planner-failure',
      reason: 'no-plan',
      message: 'failed',
    }
    expect(fold(repeated(failure), repeated(failure))).toBe('held')
    expect(fold(repeated(failure), repeated({ ...failure, reason: 'another' }))).toBe(
      'inconclusive',
    )
  })
  it('does not let a harness error establish a flip', () => {
    expect(
      fold(repeated(decision('click')), [
        decision('scroll'),
        decision('scroll'),
        { kind: 'harness-error', message: 'offline' },
      ]),
    ).toBe('inconclusive')
    const failure: ReplaySampleOutcome = { kind: 'harness-error', message: 'offline' }
    expect(fold(repeated(failure), repeated(failure))).toBe('held')
  })
  it('accepts four gold of five with five non-gold without', () => {
    expect(
      fold(
        [...repeated(decision('click'), 4), decision('scroll')],
        repeated(decision('scroll'), 5),
      ),
    ).toBe('flipped')
  })
  it('rejects unequal, even, or undersized arms', () => {
    expect(Reflect.get(api, 'foldRemovalSamples')).toBeTypeOf('function')
    for (const [a, b] of [
      [3, 5],
      [1, 1],
      [4, 4],
    ]) {
      expect(() => fold(repeated(decision('click'), a), repeated(decision('scroll'), b))).toThrow(
        TypeError,
      )
    }
  })
})
