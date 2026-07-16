import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  canonicalJson,
  sha256hex,
  supersessionKey,
  type Anchor,
  type BundleDiscriminant,
  type BundleDraft,
  type BundleOutcomeEvent,
  type BundleRelation,
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
    kind?: BundleDraft['kind']
    initialEvents?: readonly BundleOutcomeEvent[]
    relations?: readonly BundleRelation[]
    discriminant?: BundleDiscriminant
  }): PublishedBundle {
    const kind = input.kind ?? 'fact'
    const anchors = input.anchors ?? [
      { t: 'el', role: 'button', name: `${input.identity} control` },
      { t: 'page', route: `/rollback/${input.identity}` },
    ]
    const outcome = knowledgeLocal.publishBundle(config(), {
      draft: makeBundleDraftFixture({
        kind,
        anchors: [...anchors],
        scope: SCOPE,
        summary: `${input.identity} rollback fixture`,
        body: `Canonical provenance for ${input.identity}.`,
      }),
      discriminant: input.discriminant ?? (
        kind === 'unknown'
          ? { kind, conflictRecordIds: [] }
          : {
              kind: 'fact',
              subtype: 'selector',
              elementRef: { role: 'button', name: input.identity },
            }
      ),
      originClass: input.originClass ?? 'agent-verified',
      createdAtOrdinal: input.sourceBuildOrdinal,
      screenStates: [],
      initialEvents: input.initialEvents ?? [{
        type: 'confirmed',
        evidenceToken: asEvidenceToken(`${input.curationJobId}-mint-confirmed`),
        curationJobId: input.curationJobId,
        buildOrdinal: input.sourceBuildOrdinal,
        origin: input.originClass ?? 'agent-verified',
      }],
      relations: input.relations ?? [],
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

  function activeEvents(jobId: string, ordinal: number): BundleOutcomeEvent[] {
    return [
      {
        type: 'confirmed',
        evidenceToken: asEvidenceToken(`${jobId}-confirmed`),
        curationJobId: jobId,
        buildOrdinal: ordinal,
        origin: 'agent-verified',
      },
      {
        type: 'promoted',
        evidenceToken: asEvidenceToken(`${jobId}-promoted`),
        curationJobId: jobId,
        buildOrdinal: ordinal,
      },
    ]
  }

  function loaded(published: PublishedBundle) {
    const outcome = knowledgeLocal.loadBundle(published.dir)
    if (outcome.kind !== 'loaded') {
      throw new Error(`expected loaded bundle ${published.id}, got ${outcome.kind}`)
    }
    return outcome.bundle
  }

  function hasFtsRow(bundleId: string): boolean {
    const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    try {
      return reader.db.prepare(`
        SELECT 1
        FROM fts_records AS fts
        JOIN records AS record ON record.record_rowid = fts.rowid
        WHERE record.bundle_id = ?
      `).get(bundleId) !== undefined
    } finally {
      reader.db.close()
    }
  }

  async function retrieveIds(anchors: readonly Anchor[]): Promise<string[]> {
    const reader = knowledgeLocal.openKnowledgeReader(knowledgeRoot)
    try {
      const result = await knowledgeLocal.retrieve(
        reader,
        { intent: '', anchors },
        { n: 12, product: PRODUCT, asOfBuild: 30 },
      )
      return result.map(({ id }) => id)
    } finally {
      reader.close()
    }
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

  it('inverts a minted Add through a system-origin deprecation and scrubs recall rows', async () => {
    const added = publishForJob({
      identity: 'poisoned-add',
      curationJobId: 'job-poisoned-add',
      sourceBuildOrdinal: 7,
      initialEvents: activeEvents('job-poisoned-add', 7),
    })
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })
    expect(hasFtsRow(added.id)).toBe(true)

    const report = rollbackApi().rollbackCurationJob({
      knowledgeRoot,
      auditBaseDir,
      curationJobId: 'job-poisoned-add',
      resolvedAtOrdinal: 20,
    })
    const bundle = loaded(added)
    const trust = knowledgeLocal.deriveBundleTrust(bundle)
    const inverse = bundle.events.find(
      (event) => event.type === 'deprecated' && event.curationJobId === report.receiptId,
    )

    expect(report.inverseCount).toBe(1)
    expect(report.deprecatedBundles).toEqual([added.id])
    expect(report.restoredVictims).toEqual([])
    expect(trust.status).toBe('deprecated')
    expect(inverse).toMatchObject({
      type: 'deprecated',
      reason: `rollback:${report.receiptId}`,
      buildOrdinal: 20,
    })
    // An active record would be downgraded by the disposition floor under agent origin.
    // Reaching a deprecated fold without minting another bundle proves maintenance origin system.
    expect(knowledgeLocal.enumerateBundleDirs(knowledgeRoot)).toHaveLength(1)
    expect(hasFtsRow(added.id)).toBe(false)
  })

  it('retracts a Confirm on a pre-existing bundle so its counter drops on re-fold', () => {
    const target = publishForJob({
      identity: 'confirmed-target',
      curationJobId: 'job-base-confirmed',
      sourceBuildOrdinal: 4,
      initialEvents: activeEvents('job-base-confirmed', 4),
    })
    expect(knowledgeLocal.appendOutcomeEvent(config(), target.id, {
      type: 'confirmed',
      evidenceToken: asEvidenceToken('job-confirm-poison-token'),
      curationJobId: 'job-confirm-poison',
      buildOrdinal: 8,
      origin: 'agent-verified',
    })).toEqual({ kind: 'appended' })
    expect(knowledgeLocal.deriveBundleTrust(loaded(target)).counters.confirmed).toBe(2)

    const report = rollbackApi().rollbackCurationJob({
      knowledgeRoot,
      auditBaseDir,
      curationJobId: 'job-confirm-poison',
      resolvedAtOrdinal: 20,
    })
    const bundle = loaded(target)

    expect(report.inverseCount).toBe(1)
    expect(knowledgeLocal.deriveBundleTrust(bundle).counters.confirmed).toBe(1)
    expect(bundle.events).toContainEqual(expect.objectContaining({
      type: 'retracted',
      curationJobId: report.receiptId,
      retractsEvidenceToken: 'job-confirm-poison-token',
      retractsCurationJobId: 'job-confirm-poison',
      rollbackReceiptId: report.receiptId,
    }))
  })

  it('retracts both supersession effects, reopens the victim, restores recall, and replays byte-identically', async () => {
    const anchors: Anchor[] = [
      { t: 'el', role: 'button', name: 'restore checkout' },
      { t: 'page', route: '/rollback/restore-checkout' },
      { t: 'platform', platform: 'web' },
    ]
    const victim = publishForJob({
      identity: 'supersession-victim',
      curationJobId: 'job-supersession-victim',
      sourceBuildOrdinal: 3,
      anchors,
      initialEvents: activeEvents('job-supersession-victim', 3),
    })
    const replacement = publishForJob({
      identity: 'poisoned-replacement',
      curationJobId: 'job-poisoned-supersede',
      sourceBuildOrdinal: 9,
      anchors,
      initialEvents: activeEvents('job-poisoned-supersede', 9),
      relations: [{
        type: 'supersedes',
        targetId: victim.id,
        addedAtOrdinal: 9,
        curationJobId: 'job-poisoned-supersede',
      }],
    })
    const supersedeToken = asEvidenceToken('poisoned-supersede-token')
    const closeToken = asEvidenceToken(sha256hex(canonicalJson({
      token: supersedeToken,
      event: 'window-close',
    })))
    expect(knowledgeLocal.appendOutcomeEvent(config(), victim.id, {
      type: 'superseded',
      evidenceToken: supersedeToken,
      curationJobId: 'job-poisoned-supersede',
      buildOrdinal: 9,
      byRecordId: replacement.id,
    })).toEqual({ kind: 'appended' })
    expect(knowledgeLocal.appendOutcomeEvent(config(), victim.id, {
      type: 'window-close',
      evidenceToken: closeToken,
      curationJobId: 'job-poisoned-supersede',
      buildOrdinal: 9,
      closedAtOrdinal: 9,
    })).toEqual({ kind: 'appended' })
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })
    expect(hasFtsRow(victim.id)).toBe(false)
    expect(hasFtsRow(replacement.id)).toBe(true)

    const rollbackInput = {
      knowledgeRoot,
      auditBaseDir,
      curationJobId: 'job-poisoned-supersede',
      resolvedAtOrdinal: 20,
    }
    const first = rollbackApi().rollbackCurationJob(rollbackInput)
    const restored = loaded(victim)
    const replacementAfter = loaded(replacement)
    const retractedTargets = restored.events.flatMap((event) =>
      event.type === 'retracted'
        ? [`${event.retractsEvidenceToken}:${event.retractsCurationJobId}`]
        : [],
    )

    expect(first.inverseCount).toBe(3)
    expect(first.restoredVictims).toEqual([victim.id])
    expect(first.deprecatedBundles).toEqual([replacement.id])
    expect(knowledgeLocal.deriveBundleTrust(restored)).toMatchObject({
      status: 'active',
      validity: { openedAtOrdinal: 3 },
    })
    expect(knowledgeLocal.deriveBundleTrust(restored).validity.closedAtOrdinal).toBeUndefined()
    expect(knowledgeLocal.deriveBundleTrust(replacementAfter).status).toBe('deprecated')
    expect(retractedTargets).toEqual(expect.arrayContaining([
      `${supersedeToken}:job-poisoned-supersede`,
      `${closeToken}:job-poisoned-supersede`,
    ]))
    expect(hasFtsRow(victim.id)).toBe(true)
    expect(hasFtsRow(replacement.id)).toBe(false)

    const beforeReplay = {
      victim: readFileSync(join(victim.dir, 'evidence', 'outcomes.jsonl'), 'utf8'),
      replacement: readFileSync(
        join(replacement.dir, 'evidence', 'outcomes.jsonl'),
        'utf8',
      ),
    }
    const second = rollbackApi().rollbackCurationJob(rollbackInput)
    expect(second.inverseCount).toBe(0)
    expect({
      victim: readFileSync(join(victim.dir, 'evidence', 'outcomes.jsonl'), 'utf8'),
      replacement: readFileSync(
        join(replacement.dir, 'evidence', 'outcomes.jsonl'),
        'utf8',
      ),
    }).toEqual(beforeReplay)
  })

  it('deprecates a rolled-back thrash unknown so memory-off suppression lifts', async () => {
    const factAnchors: Anchor[] = [
      { t: 'el', role: 'button', name: 'resume checkout' },
      { t: 'page', route: '/rollback/resume-checkout' },
      { t: 'platform', platform: 'web' },
    ]
    const fact = publishForJob({
      identity: 'suppressed-live-fact',
      curationJobId: 'job-live-fact',
      sourceBuildOrdinal: 10,
      anchors: factAnchors,
      initialEvents: activeEvents('job-live-fact', 10),
    })
    const marker = `thrash:${supersessionKey(factAnchors)}:window:10`
    const unknown = publishForJob({
      identity: 'poisoned-thrash-unknown',
      curationJobId: 'job-thrash-unknown',
      sourceBuildOrdinal: 15,
      kind: 'unknown',
      anchors: [{ t: 'flow', name: marker }],
      discriminant: { kind: 'unknown', conflictRecordIds: [fact.id] },
      relations: [{
        type: 'conflicts-with',
        targetId: fact.id,
        addedAtOrdinal: 15,
        curationJobId: 'job-thrash-unknown',
      }],
    })
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })
    expect(await retrieveIds([factAnchors[0]!])).toEqual([unknown.id])

    const report = rollbackApi().rollbackCurationJob({
      knowledgeRoot,
      auditBaseDir,
      curationJobId: 'job-thrash-unknown',
      resolvedAtOrdinal: 20,
    })

    expect(report.deprecatedBundles).toEqual([unknown.id])
    expect(knowledgeLocal.deriveBundleTrust(loaded(unknown)).status).toBe('deprecated')
    expect(await retrieveIds([factAnchors[0]!])).toEqual([fact.id])
  })
})
