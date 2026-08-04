// The tracer's end-to-end proof: artifact-before-checkpoint, one path only (Phase 389, plan 01).
//
// Four contracts on one committed slice, each pinned where it can fail loudest:
//
//   D-09  the analysis artifact is durable BEFORE the verdicts-authored value is recorded —
//         order-captured on the stubs, so moving the write after the author returns is a RED.
//   D-02  the recorded checkpoint value is byte-shape `{runId, verdicts}` exactly as 388 froze
//         it — asserted with an exact-keys check, never a subset match.
//   JOBQ-03  a resume with a recorded value never re-enters the author and never rewrites the
//         artifact — spy count 0 on both.
//   D-10  `resolveRunVerdicts` is the one verdict read path: artifact verdicts when present,
//         the handoff's deterministic floor when absent, and the minted `unknown` is
//         byte-identical to the runner's own `deterministicVerdict` fill.

import {
  canonicalJson,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  guardRunAnalysisArtifact,
  resolveRunVerdicts,
  sha256hex,
  VerdictSentencePartsSchema,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  Job,
  RunAnalysisArtifact,
  Verdict,
} from '@vostride/agent-qa-schema'
import { deterministicVerdict, UNKNOWN_SIGNAL_RATIONALE } from '@vostride/agent-qa-runner'
import { describe, expect, it } from 'vitest'

import { createRealJobKindRegistry } from '../kinds.js'
import type { PostRunJobCapabilities } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'
import { buildSyntheticHandoff } from './fixtures/synthetic-handoff.js'

const EVIDENCE_TEXT = 'Error: element "Submit" not found'
const ANALYZE_JOB_ID = 'job_analyze_389_tracer'

/**
 * The jobs harness for one analyze-run invocation: stub capabilities recording call ORDER,
 * and a faithful in-memory `recordLlmAuthorship` — read the recorded value, on a miss invoke
 * the author exactly once and record what it returned before handing it back. The same
 * control flow the engine's primitive ships, over a Map instead of a store.
 */
function harness(
  handoff: CompletedRunHandoff,
  options: { readonly recorded?: Map<string, unknown> } = {},
) {
  const recorded = options.recorded ?? new Map<string, unknown>()
  const calls: string[] = []
  const published: { checkpointId: string; value: unknown }[] = []
  const artifacts: RunAnalysisArtifact[] = []
  let authorInvocations = 0

  const capabilities: PostRunJobCapabilities = {
    loadCompletedRunHandoff: () => handoff,
    curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
    persistAnalysis: (artifact) => {
      calls.push('persistAnalysis')
      artifacts.push(artifact)
    },
  }

  const record = async (checkpointId: string, value: unknown): Promise<void> => {
    calls.push(`record:${checkpointId}`)
    published.push({ checkpointId, value })
    recorded.set(checkpointId, value)
  }

  const job = {
    id: ANALYZE_JOB_ID,
    kind: 'analyze-run',
    status: 'queued',
    summary: 'fixture',
    attempts: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  } as unknown as Job

  const context: JobHandlerContext = {
    job,
    payload: {
      runId: String(handoff.runId),
      handoffDigest: sha256hex(canonicalJson(handoff)),
      handoffSchemaVersion: handoff.schemaVersion,
      executionContext: handoff.executionContext,
    },
    publishCheckpoint: record,
    recordLlmAuthorship: (async <T>(
      checkpointId: string,
      author: (model: { modelId: string; generate: () => Promise<{ text: string }> }) => Promise<T>,
    ): Promise<T> => {
      if (recorded.has(checkpointId)) return recorded.get(checkpointId) as T
      authorInvocations += 1
      const value = await author({ modelId: 'stub', generate: async () => ({ text: '' }) })
      await record(checkpointId, value)
      return value
    }) as unknown as JobHandlerContext['recordLlmAuthorship'],
  }

  return {
    calls,
    published,
    artifacts,
    authorInvocationCount: () => authorInvocations,
    run: () => createRealJobKindRegistry(capabilities).require('analyze-run').handler(context),
  }
}

/** The floor the handler projects: rootCause where persisted, the minted unknown elsewhere. */
function expectedFloor(handoff: CompletedRunHandoff): Verdict[] {
  return handoff.tests
    .filter((test) => test.outcome === 'failed')
    .map(
      (test) =>
        test.rootCause ??
        deterministicVerdict('unknown', UNKNOWN_SIGNAL_RATIONALE, [], test.testIndex),
    )
}

describe('the analyze-run tracer: artifact before checkpoint (389 D-09/D-10)', () => {
  const persistedFlake = deterministicVerdict('flake', 'retryCount 2 > 0', [0], 0)
  const handoff = buildSyntheticHandoff({
    failureCount: 2,
    steplessFailureCount: 1,
    passedCount: 1,
    rootCauseFor: (index) => (index === 0 ? persistedFlake : undefined),
  })

  it('persists the artifact strictly before the verdicts-authored value is recorded', async () => {
    const { calls, run } = harness(handoff)
    const outcome = await run()

    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    // Strict order AND exactly once each: the artifact write is inside the author, the record
    // happens after the author returns, and neither runs twice.
    expect(calls).toEqual(['persistAnalysis', 'record:verdicts-authored'])
  })

  it('records exactly {runId, verdicts} — the frozen 388 D-02 byte-shape', async () => {
    const { published, run } = harness(handoff)
    await run()

    expect(published).toHaveLength(1)
    const entry = published[0] as (typeof published)[number]
    expect(entry.checkpointId).toBe('verdicts-authored')
    const value = entry.value as Record<string, unknown>
    // Exact key-set, not a subset match: sentence parts must never ride the checkpoint.
    expect(Object.keys(value).sort()).toEqual(['runId', 'verdicts'])
    expect(value).toEqual({ runId: String(handoff.runId), verdicts: expectedFloor(handoff) })
  })

  it('writes an artifact the guard admits, with parts joined by perTest quoting real evidence', async () => {
    const { artifacts, run } = harness(handoff)
    await run()

    expect(artifacts).toHaveLength(1)
    const artifact = artifacts[0] as RunAnalysisArtifact
    expect(artifact.schemaVersion).toBe(CURRENT_ANALYSIS_SCHEMA_VERSION)
    expect(artifact.runId).toBe(String(handoff.runId))
    expect(artifact.verdicts).toEqual(expectedFloor(handoff))
    // The guard round-trip: what the author persists is what every reader admits.
    expect(guardRunAnalysisArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact)

    // One parts record per verdict, joined by perTest — never by array position.
    expect(artifact.parts.map((part) => part.perTest)).toEqual(
      artifact.verdicts.map((verdict) => verdict.perTest),
    )

    // The stepped failures quote the sub-action's captured error VERBATIM.
    const flakePart = artifact.parts.find((part) => part.perTest === 0)
    expect(flakePart?.groundingQuote).toEqual({ stepIndex: 0, quote: EVIDENCE_TEXT })
    expect(flakePart?.discriminator).toBe('flake: retryCount 2 > 0')

    // The floor's unknown gets the honest undetermined discriminator (D-06).
    const unknownPart = artifact.parts.find((part) => part.perTest === 1)
    expect(unknownPart?.discriminator).toBe('root cause undetermined')
    expect(unknownPart?.nextAction).toContain('inspect the run manually')

    // The step-less failure quotes its test-level outcome through the typed no-step arm —
    // never a fabricated stepIndex.
    const steplessPart = artifact.parts.find((part) => part.perTest === 2)
    expect(steplessPart?.groundingQuote).toEqual({ source: 'test-outcome', quote: 'failed' })
  })

  it('never re-enters the author and never rewrites the artifact on resume (JOBQ-03)', async () => {
    const floor = expectedFloor(handoff)
    const recorded = new Map<string, unknown>([
      ['verdicts-authored', { runId: String(handoff.runId), verdicts: floor }],
    ])
    const { artifacts, authorInvocationCount, calls, run } = harness(handoff, { recorded })
    const outcome = await run()

    // The author callback body is never entered, and the artifact is never touched.
    expect(authorInvocationCount()).toBe(0)
    expect(artifacts).toHaveLength(0)
    expect(calls).toEqual([])

    // The resumed job still completes its chain work from the recorded value alone.
    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    expect(outcome.next.map((request) => request.kind)).toEqual(['curate-memory'])
    expect(outcome.next[0]).toMatchObject({
      payload: { verdictSummary: { total: 3, byClass: { flake: 1, unknown: 2 } } },
    })
  })

  it('resolveRunVerdicts answers the artifact when present and the floor when absent (D-10)', async () => {
    const { artifacts, run } = harness(handoff)
    await run()
    const artifact = artifacts[0] as RunAnalysisArtifact

    expect(resolveRunVerdicts(artifact, handoff)).toEqual(artifact.verdicts)
    expect(resolveRunVerdicts(undefined, handoff)).toEqual(expectedFloor(handoff))

    // A failed member without rootCause resolves to the minted unknown, byte-identical to
    // the runner's own fill — class, producer, confidence 0 and the fixed rationale.
    const minted = resolveRunVerdicts(undefined, handoff).find((verdict) => verdict.perTest === 1)
    expect(minted).toEqual(deterministicVerdict('unknown', UNKNOWN_SIGNAL_RATIONALE, [], 1))
    expect(minted?.class).toBe('unknown')
    expect(minted?.producer).toBe('deterministic-classifier')
  })

  it('validates agentqa:// links through EntityUriSchema and refuses a malformed ref', () => {
    const part = {
      perTest: 0,
      groundingQuote: { stepIndex: 0, quote: EVIDENCE_TEXT },
      discriminator: 'flake: retryCount 2 > 0',
      nextAction: 'watch for recurrence',
      links: ['agentqa://memory/MEM-001'],
    }
    expect(VerdictSentencePartsSchema.safeParse(part).success).toBe(true)
    // Case-mangled and free-form refs both fail the parse — never a bare string check.
    expect(
      VerdictSentencePartsSchema.safeParse({ ...part, links: ['agentqa://MEMORY/mem-001'] })
        .success,
    ).toBe(false)
    expect(
      VerdictSentencePartsSchema.safeParse({ ...part, links: ['not-a-uri'] }).success,
    ).toBe(false)
  })
})
