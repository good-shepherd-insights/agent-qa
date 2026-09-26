import { describe, expect, it } from 'vitest'
import type { CommittedCorpusSnapshot } from '../derive-census'
import { deriveCensus } from '../derive-census'
import type { CampaignLeg, CampaignManifest } from '../campaign-manifest'
import { CAMPAIGN_MANIFEST_SCHEMA_VERSION, guardCampaignManifest } from '../campaign-manifest'

function emptySnapshot(): CommittedCorpusSnapshot {
  return {
    entries: [],
    labelsById: new Map(),
    cassettesById: new Map(),
    blobPresentById: new Map(),
  }
}

function fullLeg(): CampaignLeg {
  return {
    testId: 'example-web/login.spec.ts::signs in',
    testFile: 'tests/login.spec.ts',
    product: 'example-web',
    runSlug: 'run-2026-09-04-signs-in-1',
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
    rung: { schemaVersion: 1, rung: 'lexical-only', reason: 'model-not-downloaded' },
  }
}

function fullManifest(): CampaignManifest {
  return {
    schemaVersion: CAMPAIGN_MANIFEST_SCHEMA_VERSION,
    phase: '413',
    submoduleHead: '93c37d43',
    legs: [fullLeg()],
  }
}

describe('413 D-16 campaign manifest guard', () => {
  it('admits a complete schemaVersion-1 manifest unchanged', () => {
    const manifest = fullManifest()

    const guarded = guardCampaignManifest(structuredClone(manifest) as unknown)

    expect(guarded).toEqual(manifest)
    expect(guarded.legs[0]?.rung).toEqual({
      schemaVersion: 1,
      rung: 'lexical-only',
      reason: 'model-not-downloaded',
    })
  })

  it('rejects an unknown key, an unknown verdict class, an unknown producer and a future version', () => {
    const withExtraKey = { ...fullManifest(), legs: [{ ...fullLeg(), foo: 'bar' }] }
    expect(() => guardCampaignManifest(withExtraKey)).toThrow(/campaign manifest rejected:/)

    const withUnknownClass = {
      ...fullManifest(),
      legs: [{ ...fullLeg(), verdicts: [{ class: 'overlay', producer: 'analyze-run' }] }],
    }
    expect(() => guardCampaignManifest(withUnknownClass)).toThrow(TypeError)

    const withUnknownProducer = {
      ...fullManifest(),
      legs: [{ ...fullLeg(), verdicts: [{ class: 'flake', producer: 'human' }] }],
    }
    expect(() => guardCampaignManifest(withUnknownProducer)).toThrow(TypeError)

    const withFutureVersion = { ...fullManifest(), schemaVersion: 2 }
    expect(() => guardCampaignManifest(withFutureVersion)).toThrow(/campaign manifest rejected:/)
  })

  it('produces legs structurally assignable to the census campaign input', () => {
    const manifest = guardCampaignManifest(fullManifest() as unknown)

    const census = deriveCensus({
      snapshot: emptySnapshot(),
      campaign: { legs: manifest.legs, manifestDigest: 'x' },
    })

    expect(census.campaign).toMatchObject({ present: true, legs: 1, manifestDigest: 'x' })
    expect(census.campaign).toMatchObject({ modelCalls: 12, promptTokens: 9_400 })
  })

  it('admits an empty campaign and reports zero legs rather than absence', () => {
    const manifest = guardCampaignManifest({ ...fullManifest(), legs: [] } as unknown)

    const census = deriveCensus({
      snapshot: emptySnapshot(),
      campaign: { legs: manifest.legs, manifestDigest: 'empty' },
    })

    expect(census.campaign).toMatchObject({ present: true, legs: 0, runsSeeded: 0 })
  })
})
