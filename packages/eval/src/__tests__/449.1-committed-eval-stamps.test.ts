import { describe, expect, it } from 'vitest'

import {
  CLASSIFIER_REPEATABILITY_SCHEMA_VERSION,
  CONTRACT_PROJECTION_SCHEMA_VERSION,
  NOISE_FLOOR_SCHEMA_VERSION,
  PARTITION_MANIFEST_SCHEMA_VERSION,
  committedFileText,
  foldClassifierRepeatability,
  guardClassifierRepeatability,
  guardNoiseFloorArtefact,
  guardPartitionManifest,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
  projectPartitionManifest,
} from '../index'
import type { AxisFloorSet, NoiseFloorArtefact } from '../index'

const contracts = [
  ['judge', projectJudgeConfigContract],
  ['matcher', projectMatcherConfigContract],
] as const

const partition = () => projectPartitionManifest({
  product: 'example-web',
  saltHex: 'a'.repeat(64),
  heldOutFraction: 0.25,
  privateFraction: 0.5,
})

const emptyAxes = (): AxisFloorSet => ({
  headline: { n: 0, pairs: [] },
  elementIdentity: { n: 0, pairs: [] },
  value: { n: 0, pairs: [] },
  opClass: { n: 0, pairs: [] },
  sideEffect: { n: 0, pairs: [] },
  loop: { n: 0, pairs: [] },
})

const empty = { correct: 0, n: 0 }

function floor(): NoiseFloorArtefact {
  const minimumGateSet = {
    lowerBound: 3 as const,
    baselineRate: empty,
    baselineRateSource: 'reference-run' as const,
    derivation: 'No applicable reference decisions',
    searchedUpTo: 100000,
  }
  return {
    schemaVersion: NOISE_FLOOR_SCHEMA_VERSION,
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
    population: { included: { proof: 0, empty: 0 }, excludedRendered: 0, refusals: {}, unpartitioned: 0 },
    axes: emptyAxes(),
    products: {
      'example-web': {
        axes: emptyAxes(),
        minimumGateSet,
        census: { natural: 0, heldOutShared: 0, heldOutPrivate: 0 },
        populatedBriefs: 0,
      },
    },
    splits: {
      natural: { axes: emptyAxes() },
      'held-out-shared': { axes: emptyAxes(), nullLift: [] },
      'held-out-private': { axes: emptyAxes(), nullLift: [] },
    },
    minimumGateSet,
    runs: [11, 11, 11, 29].map((seed, index) => ({
      index,
      seed,
      headline: empty,
      axes: { headline: empty, elementIdentity: empty, value: empty, opClass: empty, sideEffect: empty, loop: empty },
      refusalCounts: {},
      briefSourceCounts: { proof: 0, empty: 0, rendered: 0 },
      harnessErrorCount: 0,
      cost: { wallClockMs: 0 },
      reportDigest: 'synthetic-report-digest',
    })),
    cost: { wallClockMs: 0 },
    classifierRepeatability: foldClassifierRepeatability({ k: 3, runs: [] }),
  }
}

describe('committed eval stamps', () => {
  it.each(contracts)('projects the %s contract stamped 2', (_name, project) => {
    expect(CONTRACT_PROJECTION_SCHEMA_VERSION).toBe(2)
    expect(project().schemaVersion).toBe(2)
  })

  it.each(contracts.flatMap(([name, project]) => [1, 3].map(stamp => [name, stamp, project] as const)))(
    'a %s contract stamped %i is not the projected constitution',
    (_name, stamp, project) => {
      expect(committedFileText({ ...project(), schemaVersion: stamp })).not.toBe(committedFileText(project()))
    },
  )

  it('reads a partition manifest stamped 2', () => {
    expect(PARTITION_MANIFEST_SCHEMA_VERSION).toBe(2)
    expect(guardPartitionManifest(JSON.parse(committedFileText(partition())))).toEqual(partition())
  })

  it.each([1, 3])('refuses a partition manifest stamped %i', (stamp) => {
    expect(() => guardPartitionManifest({ ...partition(), schemaVersion: stamp })).toThrow(/schemaVersion/)
  })

  it('reads a noise floor and its classifier repeatability stamped 2', () => {
    expect(NOISE_FLOOR_SCHEMA_VERSION).toBe(2)
    expect(CLASSIFIER_REPEATABILITY_SCHEMA_VERSION).toBe(2)
    const artefact = floor()
    expect(artefact.classifierRepeatability?.schemaVersion).toBe(2)
    expect(guardNoiseFloorArtefact(JSON.parse(committedFileText(artefact)))).toEqual({ kind: 'ok', artefact })
  })

  it.each([1, 3])('refuses a noise floor stamped %i', (stamp) => {
    const result = guardNoiseFloorArtefact({ ...floor(), schemaVersion: stamp })
    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') expect(result.reason).toContain('schemaVersion')
  })

  it.each([1, 3])('refuses a noise floor whose classifier repeatability is stamped %i', (stamp) => {
    const artefact = floor()
    const block = { ...artefact.classifierRepeatability!, schemaVersion: stamp }
    expect(guardClassifierRepeatability(block).kind).toBe('rejected')
    const result = guardNoiseFloorArtefact({ ...artefact, classifierRepeatability: block })
    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') expect(result.reason).toContain('classifierRepeatability.schemaVersion')
  })
})
