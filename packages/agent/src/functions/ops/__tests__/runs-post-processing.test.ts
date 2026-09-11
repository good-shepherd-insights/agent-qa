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

import {
  asJobId,
  FunctionScopeSchema,
  POST_PROCESSING_CHIP_STATUSES,
} from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  JobStatus,
  PostProcessingChipStatus,
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
  origin: 'agent',
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
  schemaVersion: 3,
  runId: RUN_ID,
  outcome: 'done',
  verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
  stages: {
    analysis: { status: 'done' },
    curation: { status: 'done', curated: 3, deprecated: 1 },
    proposals: { status: 'done', proposed: 2, skipped: 1 },
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

/**
 * The whole mapping, keyed by every status a job row can hold.
 *
 * A `Record<JobStatus, …>` rather than a list of cases, and the type is the exhaustiveness:
 * a status added to the job contract makes THIS table a compile error, which is the only form
 * of "we covered every member" that survives the vocabulary growing. A hand-written array with
 * a length assertion beside it would agree with the union today and drift on the first member
 * added, which is exactly when the table stops being a table of everything.
 */
const CHIP_BY_STATUS: Record<
  JobStatus,
  { readonly unclaimed: PostProcessingChipStatus; readonly claimed: PostProcessingChipStatus }
> = {
  queued: { unclaimed: 'pending', claimed: 'running' },
  authored: { unclaimed: 'pending', claimed: 'running' },
  bundling: { unclaimed: 'pending', claimed: 'running' },
  committing: { unclaimed: 'pending', claimed: 'running' },
  // Terminal: the claim was released by the transaction that ended the job, so the two columns
  // agree — and they are still both stated, because a projection that consulted the claim on a
  // terminal row would pass a table that only listed one of them.
  done: { unclaimed: 'done', claimed: 'done' },
  failed: { unclaimed: 'failed', claimed: 'failed' },
  cancelled: { unclaimed: 'failed', claimed: 'failed' },
}

// ------------------------------------------------------------------------------------------
// The CLOSED-UNION cells (Phase 404, D-04). Mutation-measured by
// `scripts/404-chip-teardown-mutation.sh`, which re-adds a third chip arm (M1) and a fifth
// status (M2) and requires each to red a cell named below.
//
// SET-EQUALITY, NEVER MEMBERSHIP. A cell that asserts the chips CONTAIN `analysis` and
// `curation`, or that the vocabulary CONTAINS four words, cannot fail on an ADDITION — and an
// addition is the direction that matters here: the whole point of the teardown is that a
// member which no producer can produce cannot quietly come back and make every consumer render
// a word about a slot that will never fill.
// ------------------------------------------------------------------------------------------

describe('the chip set and its vocabulary are closed (404 D-01/D-04)', () => {
  it('projects EXACTLY the two chips, by key set', () => {
    // Read off the projection's own output rather than off the type: a type is erased before
    // anything runs, and it is the runtime object every surface iterates.
    //
    // 2026-09-11 (422 D-13): this cell is now also the pin that the chain's THIRD stage did not
    // quietly become a third chip. The chips are a published vocabulary rendered by the
    // dashboard and by chat; D-13 authorised a third chain id, not a third thing every surface
    // has to learn to draw.
    expect(Object.keys(projectPostProcessingChips(undefined)).sort())
      .toEqual(['analysis', 'curation'])
    expect(Object.keys(projectPostProcessingChips({ analyzeRun: row('done') })).sort())
      .toEqual(['analysis', 'curation'])
  })

  it('declares EXACTLY the four status words, in the order a stage passes through them', () => {
    // Order asserted too, because the array is the enumeration surfaces walk — a reordering is a
    // change to what a caller iterating it renders first, and the constant's own doc claims the
    // order is the lifecycle.
    expect([...POST_PROCESSING_CHIP_STATUSES]).toEqual(['pending', 'running', 'done', 'failed'])
  })

  it('has no reserved-slot row left in the exhaustive status table', () => {
    // The table below is what pins `chipFor`. A structural placeholder returning from the dead
    // would arrive as a row here first, so the table's own key set is asserted against the job
    // statuses it claims to range over — not against a count somebody could bump.
    expect(Object.keys(CHIP_BY_STATUS).sort()).toEqual(
      ['authored', 'bundling', 'cancelled', 'committing', 'done', 'failed', 'queued'],
    )
    const produced = new Set(
      Object.values(CHIP_BY_STATUS).flatMap((cell) => [cell.claimed, cell.unclaimed]),
    )
    expect([...produced].sort()).toEqual(['done', 'failed', 'pending', 'running'])
  })
})

describe('projectPostProcessingChips is total over the durable chain state (D-14)', () => {
  it('maps EVERY job status, claimed and unclaimed, identically for both stages', () => {
    const produced = new Set<PostProcessingChipStatus>()

    for (const [status, expected] of Object.entries(CHIP_BY_STATUS)) {
      for (const claimed of [false, true]) {
        const cell = claimed ? expected.claimed : expected.unclaimed
        const label = `${status}${claimed ? ' (claimed)' : ''}`
        const only = row(status as JobStatus, claimed)

        // Asserted per STAGE and not once, because the stages differ only in what an ABSENCE
        // says: a present row must read the same everywhere, and a projection that special-cased
        // one chip would satisfy a single-stage table forever.
        expect(projectPostProcessingChips({ analyzeRun: only }).analysis, label).toBe(cell)
        expect(projectPostProcessingChips({ curateMemory: only }).curation, label).toBe(cell)
        produced.add(cell)
      }
    }
    // The absences, folded into the SAME collection rather than asserted beside it, so the
    // coverage claim below is about what the projection actually emits.
    const empty = projectPostProcessingChips(undefined)
    produced.add(empty.analysis).add(empty.curation)

    // Every member of the one vocabulary is reachable, derived on both sides: no member is
    // declared-but-unproducible, and no case below quietly stops exercising one.
    expect([...produced].sort()).toEqual([...POST_PROCESSING_CHIP_STATUSES].sort())
  })

  it('reports pending/pending when the project holds no queue database at all', () => {
    expect(projectPostProcessingChips(undefined)).toEqual({
      analysis: 'pending',
      curation: 'pending',
    } satisfies PostProcessingChips)
  })

  it('reports the same pair from a database that holds none of this chain\'s rows', () => {
    // The two absences answer identically ON PURPOSE and are asserted separately: a project
    // that never enqueued anything and a project whose queue serves other runs are the same
    // fact ABOUT THIS RUN, and a projection that distinguished them would be reporting on the
    // host rather than on the chain it was asked about.
    expect(projectPostProcessingChips({})).toEqual({
      analysis: 'pending',
      curation: 'pending',
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
    // Both sides of the line above DERIVE, so on its own it would agree with a chain of any
    // width. The literal is what makes the cell a pin rather than a tautology.
    //
    // 2026-09-11 (422 D-13): three ids, still TWO chips. The reader is handed the whole chain
    // it is reading — deriving a partial chain here would make this op a second, narrower
    // opinion about what a run's chain IS — and the projection below stays two-wide because
    // the chip vocabulary is a published surface this phase did not widen.
    expect(Object.keys(reader.asked[0]!.ids).sort())
      .toEqual(['analyzeRun', 'curateMemory', 'proposeImprovements'])
  })

  it('projects a finished chain and attaches the notification the terminal wrote', async () => {
    const status = await statusFor({
      analyzeRun: row('done'),
      curateMemory: row('done'),
      notification: NOTIFICATION,
    })

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'done', curation: 'done' },
      notification: NOTIFICATION,
    })
    // The third stage reaches a reader through the durable RECORD, not through a chip — so the
    // op must carry a `proposals` stage out untouched. A DTO that dropped it would leave the
    // one surface that can report the proposal stage reporting nothing at all.
    expect(status.notification?.stages.proposals).toEqual({
      status: 'done',
      proposed: 2,
      skipped: 1,
    })
  })

  it('OMITS the notification key entirely while the chain is still in flight', async () => {
    // Absence is spread away rather than padded with null: this DTO is rendered directly by
    // several surfaces, and a `notification: null` is a value each of them would have to
    // learn to mean "not yet" — which is the state an absent key already says by itself.
    const status = await statusFor({ analyzeRun: row('queued', true) })

    expect(status.chips).toEqual({ analysis: 'running', curation: 'pending' })
    expect('notification' in status).toBe(false)
  })

  it('answers the all-pending projection for a host whose queue database is absent', async () => {
    const status = await statusFor(undefined)

    expect(status).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'pending', curation: 'pending' },
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
