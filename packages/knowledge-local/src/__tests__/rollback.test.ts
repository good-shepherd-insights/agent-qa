import { mkdirSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  canonicalJson,
  sha256hex,
  supersessionKey,
  type Anchor,
  type OriginClass,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import type {
  BundleStoreConfig,
  PublishBundleOutcome,
} from '../index.js'
import { makeBundleDraftFixture } from './fixtures/bundle-fixture.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface RollbackCounterEvent {
  recordId: string
  evidenceToken: string
  curationJobId: string
  type: string
}

interface RollbackReport {
  receiptId: string
  inverseCount: number
  restoredVictims: string[]
  deprecatedBundles: string[]
  affected: {
    mintedBundleIds: string[]
    counterEvents: RollbackCounterEvent[]
  }
}

interface RollbackApi {
  rollbackCurationJob(input: {
    knowledgeRoot: string
    auditBaseDir: string
    curationJobId: string
    resolvedAtOrdinal: number
  }): RollbackReport
  rollbackCampaign(input: {
    knowledgeRoot: string
    auditBaseDir: string
    resolvedAtOrdinal: number
    fromOrdinal?: number
    toOrdinal?: number
    anchorClusterKey?: string
    originClass?: OriginClass
  }): RollbackReport
  rollbackReceiptId(
    kind: 'job' | 'campaign',
    keys: Readonly<Record<string, unknown>>,
    resolvedAtOrdinal: number,
  ): string
}

function rollbackApi(): RollbackApi {
  const candidate = knowledgeLocal as unknown as Partial<RollbackApi>
  if (
    typeof candidate.rollbackCurationJob !== 'function'
    || typeof candidate.rollbackCampaign !== 'function'
    || typeof candidate.rollbackReceiptId !== 'function'
  ) {
    throw new Error('rollback public API is not implemented')
  }
  return candidate as RollbackApi
}

const PRODUCT = 'rollback-storefront'
const SCOPE = { tier: 'product', key: PRODUCT } as const

describe('DCAY-05 provenance-keyed rollback resolution', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-rollback-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    mkdirSync(knowledgeRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir,
      commitArtifacts: 'none',
    }
  }

  function publishForJob(input: {
    identity: string
    curationJobId: string
    sourceBuildOrdinal: number
    anchors?: readonly Anchor[]
    originClass?: OriginClass
  }): PublishedBundle {
    const anchors = input.anchors ?? [
      { t: 'el', role: 'button', name: `${input.identity} control` },
      { t: 'page', route: `/rollback/${input.identity}` },
    ]
    const outcome = knowledgeLocal.publishBundle(config(), {
      draft: makeBundleDraftFixture({
        anchors: [...anchors],
        scope: SCOPE,
        summary: `${input.identity} rollback fixture`,
        body: `Canonical provenance for ${input.identity}.`,
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'button', name: input.identity },
      },
      originClass: input.originClass ?? 'agent-verified',
      createdAtOrdinal: input.sourceBuildOrdinal,
      screenStates: [],
      initialEvents: [{
        type: 'confirmed',
        evidenceToken: asEvidenceToken(`${input.curationJobId}-mint-confirmed`),
        curationJobId: input.curationJobId,
        buildOrdinal: input.sourceBuildOrdinal,
        origin: input.originClass ?? 'agent-verified',
      }],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `run-${input.curationJobId}`,
        testId: `test-${input.curationJobId}`,
        stepIndex: 0,
        curationJobId: input.curationJobId,
        sourceBuildOrdinal: input.sourceBuildOrdinal,
      },
      artifacts: [],
    })
    if (outcome.kind !== 'published') {
      throw new Error(`expected ${input.identity} publication, got ${outcome.kind}`)
    }
    return outcome
  }

  it('resolves exactly one job\'s minted bundles and counter events on other bundles', () => {
    const jobA = publishForJob({
      identity: 'job-a-bundle',
      curationJobId: 'job-a',
      sourceBuildOrdinal: 3,
    })
    const jobB = publishForJob({
      identity: 'job-b-bundle',
      curationJobId: 'job-b',
      sourceBuildOrdinal: 4,
    })
    publishForJob({
      identity: 'job-c-bundle',
      curationJobId: 'job-c',
      sourceBuildOrdinal: 5,
    })
    expect(knowledgeLocal.appendOutcomeEvent(config(), jobA.id, {
      type: 'confirmed',
      evidenceToken: asEvidenceToken('job-b-confirmed-existing'),
      curationJobId: 'job-b',
      buildOrdinal: 4,
      origin: 'agent-verified',
    })).toEqual({ kind: 'appended' })

    const report = rollbackApi().rollbackCurationJob({
      knowledgeRoot,
      auditBaseDir,
      curationJobId: 'job-b',
      resolvedAtOrdinal: 20,
    })

    expect(report.affected.mintedBundleIds).toEqual([jobB.id])
    expect(report.affected.counterEvents).toEqual([{
      recordId: jobA.id,
      evidenceToken: 'job-b-confirmed-existing',
      curationJobId: 'job-b',
      type: 'confirmed',
    }])
  })

  it('resolves campaign axes independently and composes predicates with AND semantics', () => {
    const alphaAnchors: Anchor[] = [
      { t: 'el', role: 'button', name: 'alpha control' },
      { t: 'page', route: '/rollback/alpha' },
    ]
    const betaAnchors: Anchor[] = [
      { t: 'el', role: 'button', name: 'beta control' },
      { t: 'page', route: '/rollback/beta' },
    ]
    const lowAlpha = publishForJob({
      identity: 'low-alpha',
      curationJobId: 'campaign-low-alpha',
      sourceBuildOrdinal: 2,
      anchors: alphaAnchors,
    })
    const highAlphaVerified = publishForJob({
      identity: 'high-alpha-verified',
      curationJobId: 'campaign-high-alpha-verified',
      sourceBuildOrdinal: 8,
      anchors: alphaAnchors,
    })
    const highBetaObserved = publishForJob({
      identity: 'high-beta-observed',
      curationJobId: 'campaign-high-beta-observed',
      sourceBuildOrdinal: 9,
      anchors: betaAnchors,
      originClass: 'agent-observed',
    })
    const highAlphaObserved = publishForJob({
      identity: 'high-alpha-observed',
      curationJobId: 'campaign-high-alpha-observed',
      sourceBuildOrdinal: 10,
      anchors: alphaAnchors,
      originClass: 'agent-observed',
    })

    const base = { knowledgeRoot, auditBaseDir, resolvedAtOrdinal: 20 }
    expect(rollbackApi().rollbackCampaign({ ...base, fromOrdinal: 8 })
      .affected.mintedBundleIds).toEqual([
      highAlphaVerified.id,
      highBetaObserved.id,
      highAlphaObserved.id,
    ].sort())
    expect(rollbackApi().rollbackCampaign({
      ...base,
      anchorClusterKey: supersessionKey(alphaAnchors),
    }).affected.mintedBundleIds).toEqual([
      lowAlpha.id,
      highAlphaVerified.id,
      highAlphaObserved.id,
    ].sort())
    expect(rollbackApi().rollbackCampaign({ ...base, originClass: 'agent-observed' })
      .affected.mintedBundleIds).toEqual([
      highBetaObserved.id,
      highAlphaObserved.id,
    ].sort())
    expect(rollbackApi().rollbackCampaign({
      ...base,
      fromOrdinal: 8,
      toOrdinal: 10,
      anchorClusterKey: supersessionKey(alphaAnchors),
      originClass: 'agent-observed',
    }).affected.mintedBundleIds).toEqual([highAlphaObserved.id])
  })

  it('derives the receipt from canonical kind, keys, and resolution ordinal bytes', () => {
    const keys = {
      originClass: 'agent-observed',
      anchorClusterKey: 'cluster-a',
      fromOrdinal: 8,
    }
    const expected = `rollback:${sha256hex(canonicalJson({
      kind: 'campaign',
      keys,
      resolvedAtOrdinal: 20,
    }))}`

    const first = rollbackApi().rollbackReceiptId('campaign', keys, 20)
    const second = rollbackApi().rollbackReceiptId(
      'campaign',
      { fromOrdinal: 8, anchorClusterKey: 'cluster-a', originClass: 'agent-observed' },
      20,
    )
    expect(first).toBe(expected)
    expect(second).toBe(expected)
    expect(first).toMatch(/^rollback:[0-9a-f]{64}$/)
  })
})
