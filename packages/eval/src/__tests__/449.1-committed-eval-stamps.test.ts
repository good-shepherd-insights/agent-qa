import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_MANIFEST_SCHEMA_VERSION,
  CLASSIFIER_REPEATABILITY_SCHEMA_VERSION,
  CONTRACT_PROJECTION_SCHEMA_VERSION,
  DECISION_VECTORS_SCHEMA_VERSION,
  LABEL_RECORD_SCHEMA_VERSION,
  NOISE_FLOOR_SCHEMA_VERSION,
  PARTITION_MANIFEST_SCHEMA_VERSION,
  RUN_EXCLUSION_SCHEMA_VERSION,
  committedFileText,
  deriveLeafCassetteId,
  deriveRunSlug,
  foldClassifierRepeatability,
  guardCampaignManifest,
  guardClassifierRepeatability,
  guardDecisionVectorsDocument,
  guardNoiseFloorArtefact,
  guardPartitionManifest,
  guardRunExclusionRecord,
  parseStandaloneLabelRecord,
  projectDecisionVectorsDocument,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
  projectPartitionManifest,
  projectRunExclusion,
} from '../index'
import type { AxisFloorSet, CampaignManifest, NoiseFloorArtefact, StandaloneLabelRecord } from '../index'

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

const exclusion = () => projectRunExclusion({
  runId: 'run-excluded',
  runSlug: deriveRunSlug('run-excluded'),
  product: 'example-web',
  verdicts: [{ class: 'flake', producer: 'analyze-run' }],
  analysisDigest: 'b'.repeat(64),
})

const labelRecord = (): StandaloneLabelRecord => ({
  schemaVersion: LABEL_RECORD_SCHEMA_VERSION,
  cassetteId: deriveLeafCassetteId({ runSlug: deriveRunSlug('run-labelled'), testIndex: 0, stepIndex: 0, decisionOrdinal: 0 }),
  label: { sourceChannel: 'recorded-verdict', tier: 'silver', verdict: { pass: false, reasoning: 'recorded' } },
  provenance: { runId: 'run-labelled', runSlug: deriveRunSlug('run-labelled'), capturedAtOrdinal: 1, receiptDigest: 'a'.repeat(64) },
})

const decisions = () => projectDecisionVectorsDocument({ batchKey: 'batch', matcherVersion: 1, vectors: [] })

const campaign = (): CampaignManifest => ({
  schemaVersion: CAMPAIGN_MANIFEST_SCHEMA_VERSION,
  phase: 'campaign',
  submoduleHead: '93c37d43',
  legs: [{
    testId: 'example-web/login.spec.ts::signs in',
    testFile: 'tests/login.spec.ts',
    product: 'example-web',
    runSlug: 'run-signs-in-1',
    repeat: 1,
    exitCode: 0,
    aggregateVerdict: 'pass',
    verdicts: [{ class: 'app_bug', producer: 'analyze-run' }],
    excluded: false,
    seeded: true,
    wallClockMs: 54_000,
    modelCalls: 12,
    promptTokens: 9_400,
    completionTokens: 810,
    steps: 7,
    proofSteps: 7,
  }],
})

const documents = [
  ['run exclusion', exclusion, (value: unknown) => guardRunExclusionRecord(value)],
  ['label record', labelRecord, (value: unknown) => {
    const parsed = parseStandaloneLabelRecord(value)
    if (!parsed.ok) throw new TypeError(parsed.issues)
    return parsed.record
  }],
  ['decision vectors document', decisions, (value: unknown) => {
    const guarded = guardDecisionVectorsDocument(value)
    if (guarded.kind !== 'ok') throw new TypeError(guarded.reason)
    return guarded.document
  }],
  ['campaign manifest', campaign, (value: unknown) => guardCampaignManifest(value)],
] as const

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

  it.each(documents)('reads a %s stamped 2', (_name, build, read) => {
    expect([RUN_EXCLUSION_SCHEMA_VERSION, LABEL_RECORD_SCHEMA_VERSION, DECISION_VECTORS_SCHEMA_VERSION,
      CAMPAIGN_MANIFEST_SCHEMA_VERSION]).toEqual([2, 2, 2, 2])
    const document = build()
    expect(document.schemaVersion).toBe(2)
    expect(read(JSON.parse(committedFileText(document)))).toEqual(document)
  })

  it.each(documents.flatMap(([name, build, read]) => [1, 3].map(stamp => [name, stamp, build, read] as const)))(
    'refuses a %s stamped %i',
    (_name, stamp, build, read) => {
      expect(() => read({ ...build(), schemaVersion: stamp })).toThrow(TypeError)
    },
  )
})
