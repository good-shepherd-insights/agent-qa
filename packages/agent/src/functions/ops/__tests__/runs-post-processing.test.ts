// `runs.postProcessing` — chip truth projected from durable job state (Phase 388, D-14/D-15).
//
// Two claims, and they are deliberately measured apart:
//
//   1. The PROJECTION is a closed, total function of the durable chain state. Driven here
//      with hand-built row values rather than a store, because what is under test is a
//      mapping and a store would only make the same table slower to state.
//   2. The OP is that projection wired to a port, and the port is asked for exactly the ids
//      `chainJobIdsForRun` derives. A projection that addressed other rows would answer
//      confidently about a chain that is not this run's, which no assertion on the returned
//      shape could ever catch.
//
// The durable half — a real sqlite store, real rows, and the pin that a status read leaves no
// database behind — lives in `agent-local`, because this package cannot reach a store at all.

import { asJobId, FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  JobStatus,
  PostProcessingChips,
  PostProcessingStatus,
  RunNotification,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { chainJobIdsForRun } from '../../../jobs/chain-identity.js'
import type { ChainJobIds } from '../../../jobs/chain-identity.js'
import type { JobIdSource } from '../../../jobs/engine.js'
import { FunctionNotBoundError, invokeFunction } from '../../invoke.js'
import { createFunctionRegistry } from '../../registry.js'
import type {
  FunctionDeps,
  PostProcessingChainState,
  PostProcessingJobRow,
  PostProcessingReaderPort,
} from '../../spec.js'
import {
  RUNS_POST_PROCESSING_FUNCTION_ID,
  projectPostProcessingChips,
} from '../runs-post-processing.js'

const RUN_ID = 'run-388-chips'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
}

/**
 * A second id source, differing from the production digest one in every byte.
 *
 * Deliberate: the ids the port is asked for are asserted against what `chainJobIdsForRun`
 * predicts THROUGH THIS SOURCE, so a projection that hard-coded the production derivation —
 * or derived its own — reads as a mismatch rather than as an accidental agreement.
 */
const TEST_ID_SOURCE: JobIdSource = {
  jobIdFor: (kind, key) => asJobId(`test_${kind}_${key}`),
}

function row(status: JobStatus, claimed = false): PostProcessingJobRow {
  return { status, claimed }
}

const NOTIFICATION: RunNotification = {
  schemaVersion: 1,
  runId: RUN_ID,
  outcome: 'done',
  verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
  stages: {
    analysis: { status: 'done' },
    curation: { status: 'done', curated: 3, deprecated: 1 },
    issues: { status: 'reserved' },
  },
}

interface RecordingReader {
  readonly port: PostProcessingReaderPort
  readonly asked: { runId: string; ids: ChainJobIds }[]
}

function recordingReader(state: PostProcessingChainState | undefined): RecordingReader {
  const asked: { runId: string; ids: ChainJobIds }[] = []
  return {
    port: {
      idSource: TEST_ID_SOURCE,
      readChain(ids, runId) {
        asked.push({ runId, ids })
        return Promise.resolve(state)
      },
    },
    asked,
  }
}

function deps(overrides: Partial<FunctionDeps> = {}): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...overrides,
  }
}

function registryWith(postProcessing: PostProcessingReaderPort | undefined) {
  return createFunctionRegistry({
    deps: deps(postProcessing === undefined ? {} : { postProcessing }),
    resolveExecutionContext: () => 'local-headless',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
  })
}

async function statusFor(
  state: PostProcessingChainState | undefined,
): Promise<PostProcessingStatus> {
  const reader = recordingReader(state)
  return await invokeFunction(
    registryWith(reader.port),
    RUNS_POST_PROCESSING_FUNCTION_ID,
    { runId: RUN_ID },
    CALLER,
  ) as PostProcessingStatus
}

describe('projectPostProcessingChips is total over the durable chain state (D-14)', () => {
  it('reports pending/pending/reserved when the project holds no queue database at all', () => {
    expect(projectPostProcessingChips(undefined)).toEqual({
      analysis: 'pending',
      curation: 'pending',
      issues: 'reserved',
    } satisfies PostProcessingChips)
  })

  it('reports the same triple from a database that holds none of this chain\'s rows', () => {
    // The two absences answer identically ON PURPOSE and are asserted separately: a project
    // that never enqueued anything and a project whose queue serves other runs are the same
    // fact ABOUT THIS RUN, and a projection that distinguished them would be reporting on the
    // host rather than on the chain it was asked about.
    expect(projectPostProcessingChips({})).toEqual({
      analysis: 'pending',
      curation: 'pending',
      issues: 'reserved',
    })
  })

  it('reads a queued row as pending and a CLAIMED non-terminal row as running', () => {
    expect(projectPostProcessingChips({ analyzeRun: row('queued') }).analysis).toBe('pending')
    expect(projectPostProcessingChips({ analyzeRun: row('queued', true) }).analysis).toBe('running')
  })

  it('reads done as done and both terminal failure statuses as failed', () => {
    expect(projectPostProcessingChips({ curateMemory: row('done') }).curation).toBe('done')
    expect(projectPostProcessingChips({ curateMemory: row('failed') }).curation).toBe('failed')
    expect(projectPostProcessingChips({ curateMemory: row('cancelled') }).curation).toBe('failed')
  })

  it('maps a triage row LIKE THE OTHERS once one exists — reserved is an absence, not a kind', () => {
    // D-04's rule has to survive the slot being filled. If `issues` were pinned to `reserved`
    // by the KIND rather than by the absence of a row, the issue engine would land and the
    // chip would keep reporting that nothing will run while a triage job ran.
    expect(projectPostProcessingChips({ triageIssues: row('done') }).issues).toBe('done')
    expect(projectPostProcessingChips({ triageIssues: row('queued', true) }).issues).toBe('running')
    expect(projectPostProcessingChips({ triageIssues: row('failed') }).issues).toBe('failed')
  })
})

describe('the runs.postProcessing op (D-14/D-15)', () => {
  it('asks the port for exactly the three ids chainJobIdsForRun derives', async () => {
    const reader = recordingReader({})
    await invokeFunction(
      registryWith(reader.port),
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId: RUN_ID },
      CALLER,
    )

    expect(reader.asked).toHaveLength(1)
    expect(reader.asked[0]?.runId).toBe(RUN_ID)
    expect(reader.asked[0]?.ids).toEqual(chainJobIdsForRun(RUN_ID, TEST_ID_SOURCE))
  })

  it('projects a finished chain and attaches the notification the terminal wrote', async () => {
    const status = await statusFor({
      analyzeRun: row('done'),
      curateMemory: row('done'),
      notification: NOTIFICATION,
    })

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'done', curation: 'done', issues: 'reserved' },
      notification: NOTIFICATION,
    })
  })

  it('OMITS the notification key entirely while the chain is still in flight', async () => {
    // Absence is spread away rather than padded with null: this DTO is rendered directly by
    // several surfaces, and a `notification: null` is a value each of them would have to
    // learn to mean "not yet" — which is the state an absent key already says by itself.
    const status = await statusFor({ analyzeRun: row('queued', true) })

    expect(status.chips).toEqual({ analysis: 'running', curation: 'pending', issues: 'reserved' })
    expect('notification' in status).toBe(false)
  })

  it('answers the all-pending projection for a host whose queue database is absent', async () => {
    const status = await statusFor(undefined)

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'pending', curation: 'pending', issues: 'reserved' },
    })
  })

  it('lists and refuses BY NAME in a composition that supplies no post-processing reader', async () => {
    const registry = registryWith(undefined)

    expect(registry.list(CALLER).find((entry) => entry.id === RUNS_POST_PROCESSING_FUNCTION_ID))
      .toMatchObject({ requiredScopes: ['read'], bindingStatus: 'unbound' })
    await expect(
      invokeFunction(registry, RUNS_POST_PROCESSING_FUNCTION_ID, { runId: RUN_ID }, CALLER),
    ).rejects.toBeInstanceOf(FunctionNotBoundError)
  })
})
