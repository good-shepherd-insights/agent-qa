import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FLOOR_PROTOCOL_MINIMUM,
  FLOOR_SPLITS,
  NOISE_FLOOR_METHOD,
  NOISE_FLOOR_SCHEMA_VERSION,
  assertFloorArtefactCommittable,
  guardNoiseFloorArtefact,
  noiseFloorArtefactSchema,
  renderFloorRefusal,
} from '../floor-artefact'
import type { AxisFloorSet, NoiseFloorArtefact } from '../floor-artefact'

function axes(): AxisFloorSet {
  return {
    headline: { n: 0, pairs: [] },
    elementIdentity: { n: 0, pairs: [] },
    value: { n: 0, pairs: [] },
    opClass: { n: 0, pairs: [] },
    sideEffect: { n: 0, pairs: [] },
    loop: { n: 0, pairs: [] },
  }
}

export function floorFixture(): NoiseFloorArtefact {
  const minimumGateSet = {
    lowerBound: 3 as const,
    baselineRate: { correct: 0, n: 0 },
    baselineRateSource: 'reference-run' as const,
    derivation: 'No applicable reference decisions',
    searchedUpTo: 100000,
  }
  return {
    schemaVersion: 1,
    method: 'aa-repeat-spread-plus-wilson',
    profileKey: 'synthetic-profile',
    fingerprint: 'synthetic-fingerprint',
    plannerModelId: 'synthetic-planner',
    matcherVersion: 1,
    corpusDigest: 'synthetic-corpus-digest',
    partitionVersion: 1,
    seeds: [11, 29],
    repeats: 3,
    seedHonored: true,
    bootstrap: { B: 2000, seed: 19 },
    population: {
      included: { proof: 0, empty: 0 },
      excludedRendered: 0,
      refusals: {},
      unpartitioned: 0,
    },
    axes: axes(),
    products: {
      'example-web': {
        axes: axes(),
        minimumGateSet,
        census: { natural: 0, heldOutShared: 0, heldOutPrivate: 0 },
        populatedBriefs: 0,
      },
    },
    splits: {
      natural: { axes: axes() },
      'held-out-shared': { axes: axes(), nullLift: [] },
      'held-out-private': { axes: axes(), nullLift: [] },
    },
    minimumGateSet,
    runs: [],
    cost: { wallClockMs: 0 },
  }
}

describe('committed noise floor document', () => {
  it('round-trips all document levels without changing raw doubles', () => {
    const artefact = floorFixture()
    artefact.axes.headline = { n: 48, aggregateFloor: 1 / 48, pairs: [] }
    expect(NOISE_FLOOR_SCHEMA_VERSION).toBe(1)
    expect(NOISE_FLOOR_METHOD).toBe('aa-repeat-spread-plus-wilson')
    expect(FLOOR_SPLITS).toEqual(['natural', 'held-out-shared', 'held-out-private'])
    expect(FLOOR_PROTOCOL_MINIMUM).toEqual({ repeats: 3, seeds: 2 })
    expect(guardNoiseFloorArtefact(JSON.parse(JSON.stringify(artefact)))).toEqual({
      kind: 'ok',
      artefact,
    })
  })

  it.each([
    ['unknown top-level key', (a: any) => { a.extra = true }, '<root>'],
    ['new version', (a: any) => { a.schemaVersion = 2 }, 'schemaVersion'],
    ['missing digest', (a: any) => { delete a.corpusDigest }, 'corpusDigest'],
    ['non-array seeds', (a: any) => { a.seeds = 11 }, 'seeds'],
    ['missing axis', (a: any) => { delete a.axes.value }, 'axes.value'],
    ['negative denominator', (a: any) => { a.axes.value.n = -1 }, 'axes.value.n'],
    ['nested unknown key', (a: any) => { a.population.included.secret = true }, 'population.included'],
    ['product unknown key', (a: any) => { a.products['example-web'].secret = true }, 'products.example-web'],
    ['private split identity', (a: any) => { a.splits['held-out-private'].cassetteIds = ['secret'] }, 'splits.held-out-private'],
    ['floor on absent axis', (a: any) => { a.axes.value.aggregateFloor = 0 }, 'axes.value.aggregateFloor'],
    ['nonfinite floor', (a: any) => { a.axes.headline = { n: 3, pairs: [], aggregateFloor: Infinity } }, 'axes.headline.aggregateFloor'],
  ])('rejects %s and names its path', (_name, change, path) => {
    const artefact = floorFixture()
    change(artefact)
    const result = guardNoiseFloorArtefact(artefact)
    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') expect(result.reason).toContain(path)
  })

  it('declares no wall-clock identity key anywhere in the schema', () => {
    const paths: string[] = []
    function walk(value: any, prefix = ''): void {
      if (value === null || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value.properties ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key
        paths.push(path)
        walk(child, path)
      }
      if (value.items) walk(value.items, `${prefix}[]`)
      if (typeof value.additionalProperties === 'object') walk(value.additionalProperties, `${prefix}.*`)
    }
    walk(z.toJSONSchema(noiseFloorArtefactSchema))
    expect(paths).toContain('bootstrap.seed')
    expect(paths).toContain('runs[].cost.wallClockMs')
    expect(paths).toContain('splits.held-out-private.axes.value.n')
    expect(paths.filter(path => /At|timestamp|date/.test(path))).toEqual([])
  })
})

describe('floor committability', () => {
  it.each([undefined, '', ' \n '])('refuses exact zero without a nonblank explanation (%s)', explanation => {
    const artefact = floorFixture()
    artefact.axes.headline = { n: 48, aggregateFloor: 0, pairs: [] }
    if (explanation !== undefined) artefact.explanation = explanation
    expect(assertFloorArtefactCommittable(artefact)).toEqual({
      ok: false,
      refusal: { kind: 'zero-floor-without-explanation', axes: ['headline'] },
    })
  })

  it('accepts an explained zero, positive 1/n, and an absent n=0 floor', () => {
    const artefact = floorFixture()
    expect(assertFloorArtefactCommittable(artefact)).toEqual({ ok: true })
    expect(artefact.axes.value).not.toHaveProperty('aggregateFloor')
    artefact.axes.headline = { n: 48, aggregateFloor: 1 / 48, pairs: [] }
    expect(assertFloorArtefactCommittable(artefact)).toEqual({ ok: true })
    artefact.axes.headline.aggregateFloor = 0
    artefact.explanation = 'stubbed identical decisions'
    expect(assertFloorArtefactCommittable(artefact)).toEqual({ ok: true })
  })

  it('names every zero product and split axis in stable traversal order', () => {
    const artefact = floorFixture()
    artefact.products['example-web']!.axes.opClass = { n: 1, aggregateFloor: 0, pairs: [] }
    artefact.splits['held-out-private'].axes.value = { n: 1, aggregateFloor: 0, pairs: [] }
    expect(assertFloorArtefactCommittable(artefact)).toEqual({
      ok: false,
      refusal: {
        kind: 'zero-floor-without-explanation',
        axes: ['products.example-web.opClass', 'splits.held-out-private.value'],
      },
    })
  })

  it.each([
    [2, [11, 29], 2],
    [3, [11, 11], 1],
  ])('enforces protocol minimum for %s repeats and %s seeds', (repeats, seeds, distinct) => {
    expect(assertFloorArtefactCommittable({ ...floorFixture(), repeats, seeds })).toEqual({
      ok: false,
      refusal: { kind: 'below-protocol-minimum', repeats, seeds: distinct },
    })
  })

  it('renders one line naming the refusal evidence', () => {
    const zero = renderFloorRefusal({ kind: 'zero-floor-without-explanation', axes: ['headline', 'products.example-web.value'] })
    expect(zero).toContain('headline')
    expect(zero).toContain('products.example-web.value')
    expect(zero).not.toContain('\n')
    const minimum = renderFloorRefusal({ kind: 'below-protocol-minimum', repeats: 2, seeds: 1 })
    expect(minimum).toContain('2')
    expect(minimum).toContain('1')
    expect(minimum).toContain('below-protocol-minimum')
    expect(minimum).not.toContain('\n')
  })
})
