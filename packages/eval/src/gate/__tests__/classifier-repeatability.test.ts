import type { VerdictClass } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  CLASSIFIER_REPEATABILITY_SCHEMA_VERSION,
  foldClassifierRepeatability,
  guardClassifierRepeatability,
} from '../classifier-repeatability'
import type { ClassifierRunInput, ClassifierSweep } from '../classifier-repeatability'

function sweeps(classes: readonly (readonly VerdictClass[])[]): ClassifierSweep[] {
  return classes.map((row, i) => ({
    analysisDigest: `synthetic-analysis-${i}`,
    verdicts: row.map(cls => ({ class: cls })),
  }))
}

function runs(): ClassifierRunInput[] {
  return [
    { runSlug: 'stable', product: 'example-web', sweeps: sweeps([['test_bug'], ['test_bug'], ['test_bug']]) },
    { runSlug: 'class-only', product: 'example-web', sweeps: sweeps([['test_bug'], ['app_bug'], ['test_bug']]) },
    { runSlug: 'admission-flip', product: 'maps', sweeps: sweeps([['test_bug'], ['flake'], ['test_bug']]) },
    { runSlug: 'unfinished', product: 'maps', sweeps: sweeps([['flake'], ['test_bug']]) },
  ]
}

describe('classifier repeatability', () => {
  it('reports class and admission flips over completed runs with inline digests', () => {
    const result = foldClassifierRepeatability({ k: 3, runs: runs() })
    expect(CLASSIFIER_REPEATABILITY_SCHEMA_VERSION).toBe(1)
    expect(result).toMatchObject({
      schemaVersion: 1,
      k: 3,
      n: 3,
      incomplete: ['unfinished'],
      classFlips: 2,
      classFlipRate: 2 / 3,
      admitExcludeFlips: 1,
      admitExcludeFlipRate: 1 / 3,
    })
    expect(result.perRun.map(row => [row.runSlug, row.classFlip, row.admitExcludeFlip])).toEqual([
      ['stable', false, false],
      ['class-only', true, false],
      ['admission-flip', true, true],
    ])
    expect(result.perRun[1]).toEqual({
      runSlug: 'class-only',
      product: 'example-web',
      digests: ['synthetic-analysis-0', 'synthetic-analysis-1', 'synthetic-analysis-2'],
      classVectors: [['test_bug'], ['app_bug'], ['test_bug']],
      classFlip: true,
      admitExcludeFlip: false,
    })
    expect(guardClassifierRepeatability(JSON.parse(JSON.stringify(result)))).toEqual({
      kind: 'ok', repeatability: result,
    })
  })

  it('uses any exclusion-class membership per sweep, retaining verdict order for class flips', () => {
    const result = foldClassifierRepeatability({
      k: 3,
      runs: [{
        runSlug: 'multi-verdict',
        product: 'maps',
        sweeps: sweeps([
          ['test_bug', 'environment'],
          ['timeout', 'app_bug'],
          ['app_bug', 'flake'],
        ]),
      }],
    })
    expect(result).toMatchObject({ n: 1, classFlipRate: 1, admitExcludeFlipRate: 0 })
    const reordered = foldClassifierRepeatability({
      k: 2,
      runs: [{ runSlug: 'ordered', product: 'maps', sweeps: sweeps([['test_bug', 'app_bug'], ['app_bug', 'test_bug']]) }],
    })
    expect(reordered.perRun[0]).toMatchObject({ classFlip: true, admitExcludeFlip: false })
  })

  it('omits rates when all runs are incomplete, including zero-sweep input', () => {
    const result = foldClassifierRepeatability({ k: 3, runs: [runs()[3]!, { runSlug: 'no-sweeps', product: 'maps', sweeps: [] }] })
    expect(result).toEqual({
      schemaVersion: 1,
      k: 3,
      n: 0,
      incomplete: ['unfinished', 'no-sweeps'],
      classFlips: 0,
      admitExcludeFlips: 0,
      perRun: [],
    })
  })

  it('records every supplied complete sweep rather than silently discarding extra evidence', () => {
    const result = foldClassifierRepeatability({
      k: 3,
      runs: [{ runSlug: 'four-sweeps', product: 'maps', sweeps: sweeps([['test_bug'], ['test_bug'], ['test_bug'], ['flake']]) }],
    })
    expect(result.perRun[0]!.digests).toHaveLength(4)
    expect(result.perRun[0]).toMatchObject({ classFlip: true, admitExcludeFlip: true })
  })

  it('copies cost and evidence without mutating or retaining mutable inputs', () => {
    const input = {
      k: 3,
      runs: runs(),
      cost: { modelCalls: 0, wallClockMs: 2, judgeCost: { calls: 1, inputTokens: 3, outputTokens: 4, outcomesMissingUsage: 0 } },
    }
    const before = structuredClone(input)
    const result = foldClassifierRepeatability(input)
    expect(result.cost).toEqual(input.cost)
    expect(input).toEqual(before)
    result.cost!.judgeCost!.calls = 99
    expect(input).toEqual(before)
  })

  it.each([0, -1, 1.5, NaN])('rejects invalid k %s', k => {
    expect(() => foldClassifierRepeatability({ k, runs: runs() })).toThrow(TypeError)
  })

  it('rejects duplicate run identities instead of counting a run twice', () => {
    const run = runs()[0]!
    expect(() => foldClassifierRepeatability({ k: 3, runs: [run, run] })).toThrow(TypeError)
  })

  it.each([
    ['root unknown key', (result: any) => { result.extra = true }, '<root>'],
    ['per-run unknown key', (result: any) => { result.perRun[0].extra = true }, 'perRun.0'],
    ['unknown class', (result: any) => { result.perRun[0].classVectors[0][0] = 'invented' }, 'classVectors'],
    ['nested cost unknown key', (result: any) => { result.cost = { wallClockMs: 0, extra: true } }, 'cost'],
  ])('guards %s', (_name, change, path) => {
    const result = foldClassifierRepeatability({ k: 3, runs: runs() })
    change(result)
    const guarded = guardClassifierRepeatability(result)
    expect(guarded.kind).toBe('rejected')
    if (guarded.kind === 'rejected') expect(guarded.reason).toContain(path)
  })
})
