import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deriveEvidenceToken,
  normalizeAnchor,
  type CanaryOutcome,
  type CurationAuthorship,
  type RecordId,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  makeProcedureBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import { deriveBundleTrust, loadBundle } from '../../bundle-read.js'
import { publishBundle } from '../../bundle-publish.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { enqueueCanaryOutcome } from '../../queue/canary-queue.js'
import { listQueuedCandidates } from '../../queue/curation-queue.js'
import { PROCEDURE_REPLAY_CONFIRMATIONS } from '../../serving/get-procedure.js'
import { openKnowledgeReader } from '../../serving/reader.js'
import type { CuratorAuthor } from '../author-contract.js'
import { canaryOutcomeObservationId } from '../disposition.js'
import { drainQueue } from '../drain.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const PRODUCT = 'ladder-storefront'
const FULL_AUTHORSHIP: CurationAuthorship = {
  path: 'llm',
  model: { id: 'claude-sonnet-4' },
  executionContext: 'local-interactive',
}
const FLOW_ANCHOR = normalizeAnchor({ t: 'flow', name: 'Sign in flow' })

/**
 * D-05 ladder proof: a full-tier procedure earns replay eligibility exclusively through the
 * organic canary stream — queue -> drain -> Confirm evidence -> matcher confirmation fold —
 * with no hand-seeded outcome events. The compounding loop closes end-to-end inside M2.
 */
describe('procedure confirmation ladder (PROC-01/PROC-02 D-05)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'procedure-confirmation-ladder-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function seedProcedure(): { id: RecordId; dir: string } {
    const outcome = publishBundle({
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'confirmation-ladder-test',
      policy,
    }, {
      draft: makeProcedureBundleDraftFixture(),
      discriminant: {
        kind: 'procedure',
        flowName: 'Sign in flow',
        stepSignature: 'email>password>submit',
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 10,
      screenStates: [],
      // The ladder starts from ZERO confirmations: replay must be earned, never seeded.
      initialEvents: [],
      relations: [],
      provenance: {
        schemaVersion: 1,
        mode: 'run-linked',
        originClass: 'agent-verified',
        runId: 'run-ladder-seed',
        testId: 'test-ladder-seed',
        stepIndex: 0,
        authorship: FULL_AUTHORSHIP,
      },
      artifacts: [],
      evidenceMarkdown: 'Evidence for the sign-in procedure.\n',
    })
    if (outcome.kind !== 'published') {
      throw new Error(`expected published procedure bundle, got ${outcome.kind}`)
    }
    return { id: outcome.id, dir: outcome.dir }
  }

  function replayOutcome(
    procedureId: RecordId,
    stepIndex: number,
    runOutcome: CanaryOutcome['runOutcome'] = 'positive',
  ): CanaryOutcome {
    return {
      candidateId: procedureId,
      runOutcome,
      runId: 'run-ladder-replay',
      testId: 'sign-in::happy-path',
      testIndex: 0,
      buildOrdinal: 11,
      stepIndex,
      briefDigest: `brief-digest-ladder-${stepIndex}`,
      attribution:
        `Procedure ${procedureId} replayed on test 0 step ${stepIndex} with ${runOutcome} verdict`,
      exercisedAnchor: FLOW_ANCHOR,
    }
  }

  function throwingAuthor(): CuratorAuthor {
    return vi.fn<CuratorAuthor>(async () => {
      throw new Error('canary jobs must never reach the Curator author')
    })
  }

  async function drain() {
    return drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: throwingAuthor(),
      executionContext: 'local-interactive',
      policy,
    })
  }

  function getProcedure() {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    return reader.getProcedure('sign in', makeScreenStateFixture(), ['email', 'password'])
  }

  function loaded(bundleDir: string) {
    const result = loadBundle(bundleDir)
    if (result.kind !== 'loaded') throw new Error(`expected loaded bundle, got ${result.kind}`)
    return { bundle: result.bundle, trust: deriveBundleTrust(result.bundle) }
  }

  it('flips hint to replay after the full-tier bar of drained positive outcomes', async () => {
    const seeded = seedProcedure()
    await rebuildIndex({ knowledgeRoot })

    const before = getProcedure()
    expect(before?.id).toBe(seeded.id)
    expect(before?.replayRecommendation).toBe('hint')

    const bar = PROCEDURE_REPLAY_CONFIRMATIONS.full
    for (let stepIndex = 0; stepIndex < bar; stepIndex += 1) {
      const enqueued = enqueueCanaryOutcome(knowledgeRoot, replayOutcome(seeded.id, stepIndex))
      expect(enqueued.kind).toBe('enqueued')
    }
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(bar)

    const report = await drain()
    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: bar,
      committed: bar,
      failures: 0,
    })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])

    const result = loaded(seeded.dir)
    expect(result.trust.counters.confirmed).toBe(bar)
    // M2 posture: procedures never go active; Confirm evidence alone crosses the bar (D-05).
    expect(result.trust.status).toBe('candidate')

    const after = getProcedure()
    expect(after?.id).toBe(seeded.id)
    expect(after?.replayRecommendation).toBe('replay')
    expect(after?.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('admits procedure-kind targets through the queue -> Confirm disposition path', async () => {
    const seeded = seedProcedure()
    const attributed = replayOutcome(seeded.id, 0)
    enqueueCanaryOutcome(knowledgeRoot, attributed)

    const report = await drain()
    expect(report).toMatchObject({ kind: 'drained', committed: 1, failures: 0 })

    const expectedToken = deriveEvidenceToken({
      attributingObservationId: canaryOutcomeObservationId(attributed),
      anchor: attributed.exercisedAnchor,
      buildOrdinal: attributed.buildOrdinal,
    })
    const result = loaded(seeded.dir)
    expect(result.bundle.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'confirmed', evidenceToken: expectedToken }),
    ]))
  })

  it('disposes a negative outcome without deleting the bundle', async () => {
    const seeded = seedProcedure()
    await rebuildIndex({ knowledgeRoot })
    enqueueCanaryOutcome(knowledgeRoot, replayOutcome(seeded.id, 0, 'negative'))

    const report = await drain()
    expect(report).toMatchObject({ kind: 'drained', committed: 1, failures: 0 })

    // Procedures degrade through the confirmation fold and 379's decay machinery,
    // never through hard deletion: the bundle survives and still matches as a hint.
    const result = loaded(seeded.dir)
    expect(result.bundle.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'contradicted' }),
    ]))
    expect(result.trust.counters.contradicted).toBe(1)
    expect(result.trust.status).toBe('candidate')

    const match = getProcedure()
    expect(match?.id).toBe(seeded.id)
    expect(match?.replayRecommendation).toBe('hint')
  })
})
