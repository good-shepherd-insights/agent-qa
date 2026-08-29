// `runs.knowledge` — the Knowledge panel's one read (Phase 407 plan 01, LERN-01 / LERN-02).
//
// WHAT THESE CELLS ARE SHAPED TO CATCH. This op is a PROJECTION over a run's handoff plus three
// sibling-op compositions, and the failure mode of a projection test is a green suite that only
// ever compared shapes. So every fixture below carries values the op would be WRONG to pass
// through unchanged — a step whose trace is absent beside one whose trace is present, a
// notification row carrying exactly one of its two counts, a record change belonging to a
// NEIGHBOURING run — because a projection fed already-correct data cannot be distinguished from
// a coincidence.
//
// The three claims the phase rests on and that a shape comparison would not see:
//   1. A pruned handoff is a RESULT (`evidence-incomplete`), never a throw (D-06).
//   2. "No knowledge reader was bound" is derived from the DURABLE truncation marker, not from a
//      handoff version (D-16).
//   3. A learned change is kept only when it is ATTRIBUTABLE to this run (D-10) — attribution
//      unknown means the row is dropped, never guessed at.

import {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  NO_KNOWLEDGE_READER_TRUNCATION,
  asRunId,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  PerTestOutcome,
  RecordChange,
  RecordedRetrievalRung,
  RunNotification,
  ScopeKey,
  ServedBrief,
  StepEvidence,
  StepPlanSource,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { runsKnowledgeSpec } from '../ops/runs-knowledge.js'
import type {
  FunctionDeps,
  KnowledgeReaderPort,
  PostProcessingChainState,
} from '../spec.js'

const RUN_ID = 'RUN-407-01'
const OTHER_RUN_ID = 'RUN-407-99'
const SCOPE: ScopeKey = { tier: 'product', key: 'shop' }

const RUNG: RecordedRetrievalRung = {
  schemaVersion: 1,
  rung: 'static-floor',
  reason: 'native-runtime-unavailable',
}

/**
 * A served brief with whatever channels the cell cares about.
 *
 * `truncation` defaults to the ORDINARY empty string rather than to the D-16 marker, so a cell
 * that wants the unbound-store derivation has to ask for it by name — the marker is the whole
 * signal and a fixture that carried it by default would make cell (d) unfalsifiable.
 */
function brief(overrides: Partial<ServedBrief> = {}): ServedBrief {
  return {
    scope: SCOPE,
    asOfBuild: 12,
    budget: 400,
    truncation: '',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'digest-0',
    ...overrides,
  }
}

function step(stepIndex: number, overrides: Partial<StepEvidence> = {}): StepEvidence {
  return {
    stepIndex,
    stepText: `step ${String(stepIndex)}`,
    cacheStatus: 'miss',
    servedBrief: brief(),
    subActions: [],
    verifierVerdict: { pass: true, reasoning: 'ok' },
    ...overrides,
  }
}

function test(
  testIndex: number,
  steps: StepEvidence[],
  testId = `t_${String(testIndex)}`,
): PerTestOutcome {
  return {
    testId,
    testName: `test ${String(testIndex)}`,
    filePath: `tests/${testId}.yaml`,
    testIndex,
    outcome: 'passed',
    steps,
  }
}

function handoff(tests: PerTestOutcome[], overrides: Partial<CompletedRunHandoff> = {}) {
  return {
    schemaVersion: 6,
    runId: asRunId(RUN_ID),
    scope: SCOPE,
    buildOrdinal: 12,
    executionContext: 'local',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-a', testConfigDigest: 'test-a' },
    startedAt: 1,
    endedAt: 2,
    tests,
    ...overrides,
  } as CompletedRunHandoff
}

const REPLAY: StepPlanSource = {
  kind: 'procedure-replay',
  procedureId: 'rec-proc-1' as StepPlanSource extends { procedureId: infer P } ? P : never,
  guard: {
    checksPassed: 2,
    total: 3,
    miss: { procedureStepIndex: 2, reason: 'page-anchor-mismatch' },
  },
}

const HINT: StepPlanSource = {
  kind: 'procedure-hint',
  procedureId: 'rec-proc-2' as StepPlanSource extends { procedureId: infer P } ? P : never,
  demotion: 'body-empty',
}

/**
 * The default handoff every cell that does not need a special one reads: TWO member tests of TWO
 * steps each, deliberately asymmetric. Test 0 step 0 carries a trace and a replay; test 0 step 1
 * carries neither; test 1 step 0 serves a canary line; test 1 step 1 carries a hint. A symmetric
 * fixture would let a projection that dropped `testIndex` or reversed the flat-map still pass.
 */
function twoByTwo(): CompletedRunHandoff {
  return handoff([
    test(0, [
      step(0, {
        planSource: REPLAY,
        retrievalTrace: {
          schemaVersion: 1,
          servedLines: [{ recordId: 'rec-a', leg: 'anchor', rank: 1, score: 0.5 }],
          truncated: [{ recordId: 'rec-cut', leg: 'lexical', rank: 9, score: 0.1 }],
        },
        servedBrief: brief({
          channel1: [{
            id: 'rec-a' as never,
            kind: 'fact',
            summary: 'the cart badge counts items',
            trust: 0.8,
            status: 'active',
            servedAsCanary: false,
            tier: 'context',
          }],
          channel2: [{ id: 'rec-b' as never, detailLevel: 'summary', bodyDigest: 'body-1' }],
          channel3: [{
            id: 'rec-c' as never,
            anchors: [],
            summary: 'the checkout button moves on mobile',
          }],
        }),
      }),
      step(1),
    ]),
    test(1, [
      step(0, {
        servedBrief: brief({
          channel1: [{
            id: 'rec-canary' as never,
            kind: 'fact',
            summary: 'a canary line',
            trust: 0.4,
            status: 'active',
            servedAsCanary: true,
            tier: 'context',
          }],
        }),
      }),
      step(1, { planSource: HINT }),
    ]),
  ])
}

const EMPTY_KNOWLEDGE: KnowledgeReaderPort = {
  listBundles: () => Promise.resolve([]),
  inspectRecords: () => Promise.resolve([]),
  diffSince: () => Promise.resolve([]),
  showRecord: ({ recordId }) => Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId }),
}

interface DepsOptions {
  document?: CompletedRunHandoff | undefined
  knowledge?: Partial<KnowledgeReaderPort>
  chain?: PostProcessingChainState | undefined
  bindPostProcessing?: boolean
  bindProposalsInbox?: boolean
}

function deps(options: DepsOptions = {}): FunctionDeps {
  const document = 'document' in options ? options.document : twoByTwo()
  const base: FunctionDeps = {
    runs: {
      list: () => Promise.resolve(document === undefined ? [] : [document]),
      get: () => Promise.resolve(document),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: { ...EMPTY_KNOWLEDGE, ...options.knowledge },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
  }
  return {
    ...base,
    ...(options.bindPostProcessing === true
      ? {
          postProcessing: {
            idSource: { jobIdFor: (kind, key) => `${kind}:${key}` as never },
            readChain: () => Promise.resolve(options.chain),
          },
        }
      : {}),
    ...(options.bindProposalsInbox === true
      ? {
          proposalsInbox: {
            list: () => Promise.resolve([]),
            show: () => Promise.resolve({ kind: 'not-found' } as never),
            reject: () => Promise.resolve({ outcome: 'not-found' } as never),
            recordApplied: () => Promise.resolve({ outcome: 'not-found' } as never),
          },
        }
      : {}),
  }
}

function change(overrides: Partial<RecordChange> = {}): RecordChange {
  return {
    schemaVersion: 1,
    recordId: 'rec-1',
    change: 'confirmed',
    atOrdinal: 12,
    ...overrides,
  }
}

function notification(
  curation: RunNotification['stages']['curation'],
): RunNotification {
  return {
    schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
    runId: RUN_ID,
    outcome: 'done',
    verdictSummary: { total: 2, byClass: {} },
    stages: { analysis: { status: 'done' }, curation },
  }
}

async function ready(options: DepsOptions = {}) {
  const result = await runsKnowledgeSpec.invoke({ runId: asRunId(RUN_ID) }, deps(options))
  if (result.kind !== 'ready') {
    throw new Error(`expected a ready projection, got ${result.kind}`)
  }
  return result
}

describe('the spec declares a read-tier, everywhere-bound contract (D-05)', () => {
  it('names its id, scopes and risk the way its read siblings do', () => {
    expect(runsKnowledgeSpec.id).toBe('runs.knowledge')
    expect(runsKnowledgeSpec.requiredScopes).toEqual(['read'])
    expect(runsKnowledgeSpec.resultKind).toBe('unary')
    expect(runsKnowledgeSpec.risk).toEqual({
      name: 'fn:runs.knowledge',
      recognized: true,
      readOnly: true,
    })
  })

  it('declares NO optional-dep binding key — its substrate is the required runs port', () => {
    // The `knowledge.brief.why` footing. A `boundThrough` here would leave a host with no queue
    // database unable to see what its own runs used, which is most of this projection.
    expect(runsKnowledgeSpec.boundThrough).toBeUndefined()
  })
})

describe('the Used half projects every step of every member test (LERN-01, D-03)', () => {
  it('flat-maps both tests in order and keeps testIndex beside the per-test stepIndex', async () => {
    const result = await ready()

    // Four rows, and the pairs of duplicate `stepIndex` values are exactly why `testIndex` rides:
    // a run with two tests has two step 0s, and a row keyed on stepIndex alone addresses neither.
    expect(result.steps.map((row) => [row.testIndex, row.stepIndex])).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1],
    ])
    expect(result.steps.map((row) => row.testId)).toEqual(['t_0', 't_0', 't_1', 't_1'])
    expect(result.runId).toBe(RUN_ID)
    expect(result.buildOrdinal).toBe(12)
  })

  it('projects the three channels field by field, keeping the canary marker', async () => {
    const result = await ready()

    expect(result.steps[0]?.served.channel1).toEqual([{
      id: 'rec-a',
      kind: 'fact',
      summary: 'the cart badge counts items',
      trust: 0.8,
      status: 'active',
      servedAsCanary: false,
      tier: 'context',
    }])
    expect(result.steps[0]?.served.channel2).toEqual([
      { id: 'rec-b', detailLevel: 'summary', bodyDigest: 'body-1' },
    ])
    // Anchors are deliberately NOT projected: the panel renders a caution's sentence only.
    expect(result.steps[0]?.served.channel3).toEqual([
      { id: 'rec-c', summary: 'the checkout button moves on mobile' },
    ])
    expect(result.steps[2]?.served.channel1[0]?.servedAsCanary).toBe(true)
  })

  it('answers each step with the trace it recorded, or the named absence (D-04)', async () => {
    const result = await ready()

    expect(result.steps[0]?.trace).toEqual({
      kind: 'answered',
      trace: {
        schemaVersion: 1,
        servedLines: [{ recordId: 'rec-a', leg: 'anchor', rank: 1, score: 0.5 }],
        truncated: [{ recordId: 'rec-cut', leg: 'lexical', rank: 9, score: 0.1 }],
      },
    })
    // The honest absence — never a trace re-derived against today's index (LERN-01's prohibition).
    expect(result.steps[1]?.trace).toEqual({ kind: 'no-trace', reason: 'pre-trace-run' })
  })

  it('passes a replay and a hint plan source through verbatim (D-07)', async () => {
    const result = await ready()

    expect(result.steps[0]?.planSource).toEqual(REPLAY)
    expect(result.steps[3]?.planSource).toEqual(HINT)
    // A step that replayed nothing carries NO key — a different byte from an empty source.
    expect(result.steps[1] && 'planSource' in result.steps[1]).toBe(false)
  })
})

describe('a pruned handoff is a result, not a throw (D-06)', () => {
  it('answers evidence-incomplete for a run the runs port cannot load', async () => {
    const result = await runsKnowledgeSpec.invoke(
      { runId: asRunId(RUN_ID) },
      deps({ document: undefined }),
    )

    expect(result).toEqual({ kind: 'evidence-incomplete', runId: RUN_ID })
  })

  it('does not reject — the page renders the state, it does not catch it', async () => {
    await expect(
      runsKnowledgeSpec.invoke({ runId: asRunId(RUN_ID) }, deps({ document: undefined })),
    ).resolves.toBeDefined()
  })
})

describe('the store binding is derived from durable bytes (D-16)', () => {
  it('reads unbound when every step carries the no-reader truncation and no rung', async () => {
    const document = handoff([
      test(0, [
        step(0, { servedBrief: brief({ truncation: NO_KNOWLEDGE_READER_TRUNCATION }) }),
        step(1, { servedBrief: brief({ truncation: NO_KNOWLEDGE_READER_TRUNCATION }) }),
      ]),
    ])

    const result = await ready({ document })

    expect(result.knowledgeStore).toBe('unbound')
    // A project with no store did not degrade, so there is no rung to report (D-16).
    expect('retrievalRung' in result).toBe(false)
  })

  it('reads bound when even one step served an ordinary brief', async () => {
    const document = handoff([
      test(0, [
        step(0, { servedBrief: brief({ truncation: NO_KNOWLEDGE_READER_TRUNCATION }) }),
        step(1),
      ]),
    ])

    expect((await ready({ document })).knowledgeStore).toBe('bound')
  })
})

describe('the recorded rung is projected per step and at run level (TRST-01, D-13)', () => {
  it('lifts the first recorded rung to the run and keeps it on the step that carries it', async () => {
    // 407-03 adds `StepEvidence.retrievalRung`; this op reads it forward-compatibly, so the
    // fixture attaches it structurally exactly as the runner will write it.
    const document = handoff([
      test(0, [
        { ...step(0), retrievalRung: RUNG } as StepEvidence,
        step(1),
      ]),
    ])

    const result = await ready({ document })

    expect(result.retrievalRung).toEqual(RUNG)
    expect(result.steps[0]?.retrievalRung).toEqual(RUNG)
    expect(result.steps[1] && 'retrievalRung' in result.steps[1]).toBe(false)
  })

  it('projects no rung at all for a run recorded before rungs existed', async () => {
    const result = await ready()

    expect('retrievalRung' in result).toBe(false)
  })
})

describe('the curation word and its counts mirror the chip (LERN-02, D-09/D-12)', () => {
  it('reads pending with no counts when this host owns no queue database', async () => {
    const result = await ready()

    expect(result.curation.status).toBe('pending')
    expect('counts' in result.curation).toBe(false)
  })

  it('carries counts only when the frozen row recorded BOTH numbers', async () => {
    const result = await ready({
      bindPostProcessing: true,
      chain: {
        curateMemory: { status: 'done', claimed: false },
        notification: notification({ status: 'done', curated: 3, deprecated: 1 }),
      },
    })

    expect(result.curation.status).toBe('done')
    expect(result.curation.counts).toEqual({ curated: 3, deprecated: 1 })
  })

  it('omits counts when the row recorded only one of them — never a padded zero', async () => {
    const result = await ready({
      bindPostProcessing: true,
      chain: {
        curateMemory: { status: 'done', claimed: false },
        notification: notification({ status: 'done', curated: 3 }),
      },
    })

    expect(result.curation.status).toBe('done')
    expect('counts' in result.curation).toBe(false)
  })
})

describe('learned changes are attributed, never windowed (LERN-02, D-10)', () => {
  const MINE = change({ recordId: 'rec-mine', sourceRunId: RUN_ID })
  const BY_OBSERVATION = change({ recordId: 'rec-obs', observationId: 'canary-outcome:abc' })
  const NEIGHBOUR = change({ recordId: 'rec-theirs', sourceRunId: OTHER_RUN_ID })
  const UNATTRIBUTED = change({ recordId: 'rec-orphan' })

  it('keeps only rows this run produced and drops the neighbour and the orphan', async () => {
    const result = await ready({
      knowledge: {
        diffSince: () => Promise.resolve([MINE, BY_OBSERVATION, NEIGHBOUR, UNATTRIBUTED]),
        canaryAttributions: () => Promise.resolve([{
          candidateId: 'rec-canary',
          testIndex: 1,
          stepIndex: 0,
          observationId: 'canary-outcome:abc',
          outcome: 'confirmed' as const,
        }]),
      },
    })

    expect(result.learned.changes.map((row) => row.recordId)).toEqual(['rec-mine', 'rec-obs'])
  })

  it('projects only attributed canary rows, keyed by the step that served the line (D-08)', async () => {
    const result = await ready({
      knowledge: {
        canaryAttributions: () => Promise.resolve([
          {
            candidateId: 'rec-canary',
            testIndex: 1,
            stepIndex: 0,
            observationId: 'canary-outcome:abc',
            outcome: 'contradicted' as const,
          },
          // A served canary with no surviving attributed event: an ordinary state, and it must
          // NOT become a badge. The panel reads "attribution pending" from the curation word.
          {
            candidateId: 'rec-pending',
            testIndex: 1,
            stepIndex: 1,
            observationId: 'canary-outcome:def',
          },
        ]),
      },
    })

    expect(result.learned.canaryAttributions).toEqual([{
      testIndex: 1,
      stepIndex: 0,
      recordId: 'rec-canary',
      observationId: 'canary-outcome:abc',
      outcome: 'contradicted',
    }])
  })

  it('answers an empty attribution list when the reader binds no attribution method', async () => {
    const result = await ready()

    expect(result.learned.canaryAttributions).toEqual([])
    expect(result.learned.changes).toEqual([])
  })
})

describe('the proposals line rides only where an inbox is bound (D-11)', () => {
  it('carries no pendingProposalCount key on a host with no inbox', async () => {
    const result = await ready()

    expect('pendingProposalCount' in result).toBe(false)
  })

  it('carries the count from runs.digest when the inbox is bound', async () => {
    const result = await ready({ bindProposalsInbox: true })

    expect(result.pendingProposalCount).toBe(0)
  })
})

describe('the DTO never carries a null and always validates', () => {
  it('serialises with no null anywhere — absence is an absent key', async () => {
    const result = await ready({
      bindPostProcessing: true,
      chain: { notification: notification({ status: 'done', curated: 1 }) },
    })

    expect(JSON.stringify(result)).not.toContain('null')
  })

  it('parses against its own declared output contract', async () => {
    const result = await ready()

    expect(runsKnowledgeSpec.output.safeParse(result).success).toBe(true)
  })

  it('folds a receipt line of counts, never of served content', async () => {
    const verdict = runsKnowledgeSpec.classify(await ready())

    expect(verdict.status).toBe('executed')
    expect(verdict.outcome).toBe(
      `knowledge for ${RUN_ID} — 4 steps, 2 brief lines served, 0 learned change(s)`,
    )
    // The brief's own prose stays in `results[]`, where a reader asked for it.
    expect(verdict.outcome).not.toContain('the cart badge counts items')
  })

  it('names the incomplete arm on its receipt too', async () => {
    const result = await runsKnowledgeSpec.invoke(
      { runId: asRunId(RUN_ID) },
      deps({ document: undefined }),
    )

    expect(runsKnowledgeSpec.classify(result)).toEqual({
      status: 'executed',
      outcome: `knowledge for ${RUN_ID} — evidence incomplete`,
    })
  })
})
