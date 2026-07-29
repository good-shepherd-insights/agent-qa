import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CurationAuthorship, Delta, ExecutionContext } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { scaffoldKnowledgeRoot } from '../../__tests__/fixtures/bundle-fixture.js'
import {
  enqueueArtifactFreeCandidateProjection,
  type ArtifactFreeCandidateProjectionInput,
} from '../../__tests__/fixtures/curation-candidate-fixture.js'
import { deriveBundleTrust, loadBundle } from '../../bundle-read.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import {
  claimNextJob,
  listQueuedCandidates,
  type ClaimedCurationJob,
} from '../../queue/curation-queue.js'
import { readJobState } from '../../queue/job-state.js'
import type { CuratorAuthor } from '../author-contract.js'
import { drainQueue, type DrainOperations } from '../drain.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const NO_INDEX_MAINTENANCE = {
  indexAbsent: false,
  pendingEmbeddings: 0,
  renderingEpochStale: false,
  vectorReconciliationOutstanding: false,
} as const

describe('drainQueue daemon substrate', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-drain-daemon-substrate-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function projectionInput(
    seed: string,
    executionContext: ExecutionContext,
  ): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: 'run-mixed-context',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext,
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [
        { t: 'el', role: 'button', name: seed, ordinal: 0 },
        { t: 'page', route: `/${seed}` },
        { t: 'selector', literal: `[data-testid="${seed}"]` },
      ],
      summarySeed: `${seed} selector`,
      bodySeed: `${seed} was resolved and verified.`,
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: `${seed}-click`, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${seed}:0` },
          locator: { selector: `[data-testid="${seed}"]` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `evidence-${seed}`,
      attributingObservationId: `observation-${seed}`,
      emittedAt: '2026-07-30T00:00:00.000Z',
    }
  }

  function enqueue(seed: string, executionContext: ExecutionContext): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projectionInput(seed, executionContext),
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued projection')
    return outcome.candidateId
  }

  function scriptedAuthor(): CuratorAuthor {
    return async (job) => {
      const authorship: CurationAuthorship = {
        path: 'llm',
        model: { id: 'daemon-substrate-fixture' },
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
          ...(job.subtype === undefined ? {} : { subtype: job.subtype }),
          anchors: job.anchors,
          scope: job.scope,
          summary: job.summarySeed,
          body: job.bodySeed,
          distilledEvidenceRef: {
            id: `curation-candidate-${job.candidateId}`,
            sha: job.candidateId,
          },
          originStage: 'run-curation',
        },
      }
      return { kind: 'authored', deltas: [delta], authorship }
    }
  }

  function maintenanceFreeOperations(): Partial<DrainOperations> {
    return {
      readRebuildRequest: () => ({ present: false }),
      readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
    }
  }

  function statusesBySummary(): Record<string, string> {
    return Object.fromEntries(
      enumerateBundleDirs(knowledgeRoot).map(({ dir }) => {
        const loaded = loadBundle(dir)
        if (loaded.kind !== 'loaded') throw new Error(`expected loaded bundle at ${dir}`)
        return [loaded.bundle.summary, deriveBundleTrust(loaded.bundle).status]
      }),
    )
  }

  it('uses each claimed payload context inside one mixed-context drain', async () => {
    enqueue('ci-checkout', 'ci')
    enqueue('interactive-checkout', 'local-interactive')

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'local-headless',
      policy,
      operations: maintenanceFreeOperations(),
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 2,
      committed: 2,
      failures: 0,
    })
    expect(statusesBySummary()).toEqual({
      'ci-checkout selector': 'candidate',
      'interactive-checkout selector': 'active',
    })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])

    const beforeSecondDrain = statusesBySummary()
    const second = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'ci',
      policy,
      operations: maintenanceFreeOperations(),
    })

    expect(second).toMatchObject({ kind: 'drained', jobsProcessed: 0, committed: 0 })
    expect(statusesBySummary()).toEqual(beforeSecondDrain)
  })

  it('uses the drain-scoped fallback for a claimed legacy payload without context', async () => {
    const candidateId = enqueue('legacy-checkout', 'local-interactive')
    const author = vi.fn(scriptedAuthor())
    const claimWithoutContext: DrainOperations['claimNextJob'] = (options) => {
      const claimed = claimNextJob(options)
      if (claimed?.kind !== 'claimed') return claimed
      return {
        ...claimed,
        payload: {
          ...claimed.payload,
          executionContext: undefined,
        } as unknown as ClaimedCurationJob['payload'],
      }
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-headless',
      policy,
      operations: {
        ...maintenanceFreeOperations(),
        claimNextJob: claimWithoutContext,
      },
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 1,
      failures: 0,
    })
    expect(author).toHaveBeenCalledOnce()
    expect(author.mock.calls[0]?.[0].executionContext).toBe('local-headless')
    expect(statusesBySummary()).toEqual({ 'legacy-checkout selector': 'candidate' })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
    expect(readJobState(knowledgeRoot, candidateId).kind).toBe('absent')
  })
})
