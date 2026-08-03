// The D-04 pin: `triage-issues` is DECLARED and never ENQUEUED (Phase 388).
//
// Two halves of one decision, and they have to be asserted separately because they live in
// different places and can drift apart silently. The TOPOLOGY keeps triage-issues among
// analyze-run's allowed successors, so the issue engine fills the slot later without a
// topology change and without reopening the engine's successor validation. The INSTANCES the
// handler returns carry only curate-memory, so nothing ever claims a triage job and the
// issues chip's `reserved` status is structurally true rather than a promise.
//
// The failure this file exists to catch is the asymmetric one: a success path narrowed to
// curate-memory while the PERMANENT-FAILURE fallback still maps over the whole declared list.
// That build enqueues a triage job precisely on the runs whose analysis died — the chip lies,
// and the chain-terminal arithmetic waits on a job D-04 says was never enqueued.
//
// Unit-level on purpose: these are claims about what the registry RETURNS, and proving them
// through a store and a pump would make the assertion depend on everything between.

import { canonicalJson, sha256hex } from '@vostride/agent-qa-schema'
import type {
  ChainedJobRequest,
  CompletedRunHandoff,
  Job,
  JobHandlerOutcome,
} from '@vostride/agent-qa-schema'
import { asRunId } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { createRealJobKindRegistry, REAL_JOB_KIND_DECLARATIONS } from '../kinds.js'
import type { PostRunJobCapabilities } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'

const RUN_ID = 'run-388-real-kinds'
const ANALYZE_JOB_ID = 'job_analyze_fixture'

const HANDOFF: CompletedRunHandoff = {
  schemaVersion: 5,
  runId: asRunId(RUN_ID),
  scope: { tier: 'product', key: 'real-kinds' },
  buildOrdinal: 1,
  executionContext: 'local-headless',
  aggregateVerdict: 'failed',
  configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
  startedAt: 1,
  endedAt: 2,
  tests: [
    {
      testId: 't_failed',
      testName: 'a member that failed',
      filePath: 'tests/failed.yaml',
      testIndex: 0,
      outcome: 'failed',
      steps: [],
    },
  ],
}

const CAPABILITIES: PostRunJobCapabilities = {
  loadCompletedRunHandoff: () => HANDOFF,
  // Never invoked by the analyze-run cases below; `complete: true` is the shape the widened
  // contract requires (WR-03), not a claim any assertion here turns on.
  curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
}

/** A scripted context: the handler's two capabilities, recorded rather than performed. */
function contextFor(payload: unknown): {
  readonly context: JobHandlerContext
  readonly published: { checkpointId: string; value: unknown }[]
} {
  const published: { checkpointId: string; value: unknown }[] = []
  const job = {
    id: ANALYZE_JOB_ID,
    kind: 'analyze-run',
    status: 'queued',
    summary: 'fixture',
    attempts: 1,
    createdAt: '2026-02-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  } as unknown as Job
  return {
    published,
    context: {
      job,
      payload,
      publishCheckpoint: async (checkpointId: string, value: unknown) => {
        published.push({ checkpointId, value })
      },
      recordLlmAuthorship: (async () => {
        throw new Error('the post-run chain never authors in 388')
      }) as unknown as JobHandlerContext['recordLlmAuthorship'],
    },
  }
}

function analyzeRunDeclaration(): (typeof REAL_JOB_KIND_DECLARATIONS)[number] {
  const declaration = REAL_JOB_KIND_DECLARATIONS.find((entry) => entry.kind === 'analyze-run')
  if (declaration === undefined) throw new Error('analyze-run is not declared')
  return declaration
}

function successorKinds(requests: readonly ChainedJobRequest[]): string[] {
  return requests.map((request) => request.kind)
}

describe('the real post-run kinds (388 D-04)', () => {
  it('declares triage-issues as an allowed successor of analyze-run', () => {
    // The half that must NOT change. A topology narrowed to match today's instances would
    // make filling the slot a contract edit, and the engine's successor validation would
    // refuse the first triage instance the issue engine ever produced.
    expect([...analyzeRunDeclaration().allowedSuccessors].sort()).toEqual([
      'curate-memory',
      'triage-issues',
    ])
  })

  it('returns exactly one curate-memory instance from a successful analysis', async () => {
    const { context, published } = contextFor({
      runId: RUN_ID,
      handoffDigest: sha256hex(canonicalJson(HANDOFF)),
      handoffSchemaVersion: HANDOFF.schemaVersion,
      executionContext: 'local-headless',
    })

    const outcome: JobHandlerOutcome = await createRealJobKindRegistry(CAPABILITIES)
      .require('analyze-run')
      .handler(context)

    expect(published.map((entry) => entry.checkpointId)).toEqual(['verdicts-authored'])
    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    expect(successorKinds(outcome.next)).toEqual(['curate-memory'])
    expect(outcome.next[0]).toMatchObject({
      idempotencyKey: `${ANALYZE_JOB_ID}->curate-memory`,
      payload: {
        runId: RUN_ID,
        executionContext: 'local-headless',
        verdictSummary: { total: 1, byClass: { unknown: 1 } },
      },
    })
  })

  it('returns exactly one curate-memory continuation from a permanently failed analysis', () => {
    const declaration = analyzeRunDeclaration()
    if (declaration.onPermanentFailure === 'halt-chain') {
      throw new Error('analyze-run must not halt its chain (D-20)')
    }

    const continuations = declaration.onPermanentFailure({
      job: contextFor({}).context.job,
      payload: { runId: RUN_ID, handoffDigest: 'x', handoffSchemaVersion: 5, executionContext: 'ci' },
      reason: 'the handoff could not be read',
    })

    // THE asymmetry this file exists for. Success and failure must produce the same instance
    // set, or a dead analysis is exactly the case that enqueues the job D-04 forbids.
    expect(successorKinds(continuations)).toEqual(['curate-memory'])
    expect(continuations[0]).toMatchObject({
      idempotencyKey: `${ANALYZE_JOB_ID}->curate-memory`,
      payload: {
        // Pitfall 6 / 386 D-09: without these two the daemon-claimed successor resolves a
        // drain-scoped posture and curation cannot find the run it is meant to fold.
        runId: RUN_ID,
        executionContext: 'ci',
        verdicts: 'unknown',
        failureReason: 'the handoff could not be read',
      },
    })
  })

  it('keeps the scripted stand-ins when no capabilities are bound', async () => {
    // NEGATIVE CONTROL for the two cases above: the assertions there would be satisfied just
    // as well by a build that had replaced the stand-ins outright, which would break every
    // registry-driven suite that scripts these kinds by payload. This is the case that must
    // still behave the OLD way.
    const { context } = contextFor({ chain: true })
    const outcome = await createRealJobKindRegistry().require('analyze-run').handler(context)

    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    expect(successorKinds(outcome.next)).toEqual(['curate-memory', 'triage-issues'])
  })
})
