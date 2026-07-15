import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CurationAuthorship, Delta } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  commitCurationDelta,
  drainQueue,
  enqueueCurationCandidate,
  enumerateBundleDirs,
  loadBundle,
  verifyBundleIntegrity,
  type CommitCurationOutcome,
  type CurationCandidatePayload,
  type CuratorAuthor,
} from '../../index.js'
import { candidateAddressFixture } from '../../__tests__/fixtures/curation-candidate-fixture.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const flowAnchor = { t: 'flow', name: 'Checkout flow' } as const

describe('fallback to capable-model enrichment in place (CUR-02)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-enrichment-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function payload(
    seed: string,
    buildOrdinal: number,
  ): CurationCandidatePayload {
    const fields = candidateAddressFixture({
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: `run-enrichment-${seed}`,
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'procedure',
      anchors: [flowAnchor],
      summarySeed: 'Checkout flow needs richer authoring',
      bodySeed: 'Complete checkout using the observed sequence.',
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: 'checkout-submit', ordinal: 0 },
          flow: { name: flowAnchor.name },
          observedAtOrdinal: buildOrdinal,
        },
      ],
      evidenceToken: `evidence-enrichment-${seed}`,
      attributingObservationId: `run-enrichment-${seed}:test-0:step-0`,
      artifactInventory: [],
      emittedAt: `2026-07-15T10:0${buildOrdinal - 42}:00.000Z`,
    })
    return { candidateId: candidateContentAddress(fields), ...fields }
  }

  function enqueue(candidate: CurationCandidatePayload): void {
    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: candidate,
        artifactSources: [],
      }),
    ).toBe('enqueued')
  }

  function options(author: CuratorAuthor) {
    return {
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive' as const,
      policy,
    }
  }

  it('converts an enriched duplicate Add to Confirm on the one existing bundle', async () => {
    const fallbackCandidate = payload('fallback', 42)
    enqueue(fallbackCandidate)
    const fallbackAuthor = vi.fn<CuratorAuthor>(async () => ({
      kind: 'fallback-required',
      reason: 'no-model',
    }))

    const fallbackReport = await drainQueue(options(fallbackAuthor))

    expect(fallbackReport).toMatchObject({ committed: 1, failures: 0 })
    expect(fallbackAuthor).toHaveBeenCalledOnce()
    const fallbackDirs = enumerateBundleDirs(knowledgeRoot)
    expect(fallbackDirs).toHaveLength(1)
    const fallbackLoaded = loadBundle(fallbackDirs[0]!.dir)
    expect(fallbackLoaded.kind).toBe('loaded')
    if (fallbackLoaded.kind !== 'loaded') throw new Error('expected fallback bundle')
    expect(fallbackLoaded.bundle.provenance).toMatchObject({
      needsEnrichment: true,
      authorship: { path: 'deterministic-fallback' },
    })
    const originalId = fallbackLoaded.bundle.manifest.id

    const capableCandidate = payload('capable', 43)
    enqueue(capableCandidate)
    const enrichedSummary = 'Checkout submission sequence with verified terminal action'
    const enrichedBody =
      'Submit the resolved checkout form, wait for confirmation, and verify payment navigation.'
    const capableAuthor = vi.fn<CuratorAuthor>(async (job) => {
      const authorship: CurationAuthorship = {
        path: 'llm',
        model: { id: 'capable-curator' },
        executionContext: job.executionContext,
      }
      const delta: Delta = {
        kind: 'Add',
        origin: 'agent',
        scope: job.scope,
        citedIds: [],
        authorship,
        bundle: {
          kind: job.kind,
          anchors: job.anchors,
          scope: job.scope,
          summary: enrichedSummary,
          body: enrichedBody,
          distilledEvidenceRef: {
            id: `curation-candidate-${job.candidateId}`,
            sha: job.candidateId,
          },
          originStage: 'run-curation',
        },
      }
      return { kind: 'authored', delta, authorship }
    })
    let commitOutcome: CommitCurationOutcome | undefined

    const capableReport = await drainQueue({
      ...options(capableAuthor),
      operations: {
        commitCurationDelta(deps, job, checkpoint) {
          commitOutcome = commitCurationDelta(deps, job, checkpoint)
          return commitOutcome
        },
      },
    })

    expect(capableReport).toMatchObject({ committed: 1, failures: 0 })
    expect(capableAuthor).toHaveBeenCalledOnce()
    expect(commitOutcome).toMatchObject({
      kind: 'converted-confirm',
      bundleId: originalId,
    })
    const finalDirs = enumerateBundleDirs(knowledgeRoot)
    expect(finalDirs).toHaveLength(1)
    expect(finalDirs[0]!.dir).toBe(fallbackDirs[0]!.dir)
    const enrichedLoaded = loadBundle(finalDirs[0]!.dir)
    expect(enrichedLoaded.kind).toBe('loaded')
    if (enrichedLoaded.kind !== 'loaded') throw new Error('expected enriched bundle')
    expect(enrichedLoaded.bundle.manifest.id).toBe(originalId)
    expect(enrichedLoaded.bundle.summary).toBe(enrichedSummary)
    expect(enrichedLoaded.bundle.body).toBe(enrichedBody)
    expect(enrichedLoaded.bundle.provenance).toMatchObject({
      needsEnrichment: false,
      authorship: { path: 'llm', model: { id: 'capable-curator' } },
    })
    expect(enrichedLoaded.bundle.events).toHaveLength(2)
    expect(enrichedLoaded.bundle.events).toContainEqual(
      expect.objectContaining({
        type: 'confirmed',
        curationJobId: capableCandidate.candidateId,
        origin: 'agent-verified',
      }),
    )
    expect(verifyBundleIntegrity(finalDirs[0]!.dir)).toEqual({
      ok: true,
      violations: [],
    })
  })
})
