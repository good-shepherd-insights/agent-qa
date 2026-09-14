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
  RunKnowledgeProjectionSchema,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { CurationSnapshotSchema, KnowledgeRecordShowResultSchema, maskedMarker } from '@vostride/agent-qa-schema'
import { createFunctionRegistry } from '../registry.js'
import { invokeFunction } from '../invoke.js'

import { knowledgeRecordsDiffSpec } from '../ops/knowledge-records-diff.js'
import { runsDigestSpec } from '../ops/runs-digest.js'
import { runsPostProcessingSpec } from '../ops/runs-post-processing.js'
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
  // 407-12 (CR-01). `recordProcedureReplaySource` writes `flow` on EVERY replay it records, so a
  // fixture without it could not see the seam at all: the arm was `.strict()` and never declared
  // the member, and the wire refused every real replay run while this file stayed green.
  flow: { cursor: 0, length: 3 },
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

function currentRecord(recordId: string) {
  return KnowledgeRecordShowResultSchema.parse({
    kind: 'found', schemaVersion: 1, summary: `購入 é e\u0301 ${recordId}`,
    body: `Current body 🧪 ${recordId}`,
    provenance: { mode: 'standalone', sourceDescription: 'synthetic inspection' },
    record: { schemaVersion: 1, recordId, product: 'shop', scope: 'checkout', kind: 'fact',
      status: 'superseded', confirmations: 7, contradictions: 2, evidenceTokens: ['evidence-current'],
      openedAtOrdinal: 8, closedAtOrdinal: 90, lastEventOrdinal: 90,
      anchors: ['page:/checkout', 'el:購入'], trustNarrative: 'Current supporting evidence' },
  })
}

function fixedSnapshot() {
  const classified = (recordId: string, kind: RecordChange['change'], atOrdinal: number) =>
    change({ recordId, change: kind, atOrdinal, sourceRunId: RUN_ID,
      evidenceToken: `receipt-${recordId}`, observationId: `observation-${recordId}` })
  return CurationSnapshotSchema.parse({ schemaVersion: 1,
    rows: [
      { recordId: 'added', bucket: 'added', changes: [{ bucket: 'added', change: classified('added', 'added', 20) }] },
      { recordId: 'confirmed', bucket: 'confirmed', changes: [
        { bucket: 'confirmed', change: classified('confirmed', 'confirmed', 21) },
        { bucket: 'confirmed', change: { ...classified('confirmed', 'confirmed', 21), evidenceToken: 'second-confirm', observationId: 'second-observation' } },
      ] },
      { recordId: 'victim', bucket: 'superseded', byRecordId: 'replacement', changes: [
        { bucket: 'superseded', change: { ...classified('victim', 'superseded', 22), byRecordId: 'replacement' } },
        { bucket: 'added', change: classified('replacement', 'added', 22) },
      ] },
      { recordId: 'deprecated', bucket: 'deprecated', changes: [{ bucket: 'deprecated', change: classified('deprecated', 'deprecated', 23) }] },
      { recordId: 'proposed', bucket: 'proposed', changes: [{ bucket: 'proposed', change: classified('proposed', 'added', 24) }] },
    ], breakdown: { added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 } })
}

describe('423 current content and fixed historical sections', () => {
  beforeEach(() => setActiveMaskingContextResolver(() => masking))
  afterEach(() => setActiveMaskingContextResolver(() => undefined))
  const masking = createMaskingContext()

  it('USED-ALL-CHANNELS: one union batch enriches learned and every used channel', async () => {
    const showRecords = vi.fn(async ({ recordIds }: { recordIds: readonly string[] }) => recordIds.map(currentRecord))
    const unary = vi.fn(async () => { throw new Error('per-ID fallback forbidden') })
    const result = await ready({ knowledge: { showRecords, showRecord: unary,
      diffSince: async () => [change({ recordId: 'rec-a', sourceRunId: RUN_ID }), change({ recordId: 'learned-only', sourceRunId: RUN_ID })] } })
    expect(showRecords).toHaveBeenCalledTimes(1)
    expect(new Set(showRecords.mock.calls[0]?.[0].recordIds)).toEqual(new Set(['rec-a', 'rec-b', 'rec-c', 'rec-canary', 'learned-only']))
    expect(showRecords.mock.calls[0]?.[0].recordIds).toHaveLength(5)
    expect(unary).not.toHaveBeenCalled()
    for (const row of [...result.steps.flatMap(s => [...s.served.channel1, ...s.served.channel2, ...s.served.channel3]), ...result.learned.changes]) {
      expect(row).toHaveProperty('recordContent', expect.objectContaining({ kind: 'fact', currentStatus: 'superseded',
        applicability: { product: 'shop', scope: 'checkout', anchors: ['page:/checkout', 'el:購入'],
          openedAtOrdinal: 8, closedAtOrdinal: 90 },
        currentTrust: { confirmations: 7, contradictions: 2, evidenceTokens: ['evidence-current'],
          lastEventOrdinal: 90, trustNarrative: 'Current supporting evidence' } }))
    }
    expect(RunKnowledgeProjectionSchema.parse(result)).toEqual(result)
  })

  it('CURRENT-VS-HISTORICAL: joined present-day facts cannot rewrite served trust or change identity', async () => {
    const historical = change({ recordId: 'rec-a', sourceRunId: RUN_ID, observationId: 'old-observation', evidenceToken: 'old-token' })
    const result = await ready({ knowledge: { diffSince: async () => [historical],
      showRecords: async ({ recordIds }) => recordIds.map(currentRecord) } })
    expect(result.learned.changes[0]).toMatchObject(historical)
    expect(result.learned.changes[0]).toHaveProperty('recordContent.currentStatus', 'superseded')
    expect(result.steps[0]?.served.channel1[0]).toMatchObject({ trust: 0.8, status: 'active',
      recordContent: { content: 'Current body 🧪 rec-a', summary: '購入 é e\u0301 rec-a', currentTrust: { confirmations: 7 } } })
  })

  it('NOT-FOUND-RETAINED: missing exact Unicode identities remain learned and used rows', async () => {
    const ids = ['é', 'e\u0301', '__proto__']
    const showRecords = vi.fn(async ({ recordIds }: { recordIds: readonly string[] }) => recordIds.map(recordId => ({ kind: 'not-found' as const, schemaVersion: 1 as const, recordId })))
    const result = await ready({ knowledge: { showRecords,
      diffSince: async () => ids.map(recordId => change({ recordId, sourceRunId: RUN_ID })) } })
    expect(result.learned.changes.map(row => row.recordId)).toEqual(['__proto__', 'e\u0301', 'é'])
    for (const row of [...result.learned.changes, ...result.steps[0]!.served.channel2]) {
      expect(row).toHaveProperty('contentAbsence', { reason: 'not-found' })
      expect(row).not.toHaveProperty('recordContent')
    }
    expect(result.learned).not.toHaveProperty('scanIncomplete')
  })

  it('SCAN-INCOMPLETE: failed batch retains both halves and differs from an ordinary missing record', async () => {
    const result = await ready({ knowledge: { diffSince: async () => [change({ sourceRunId: RUN_ID })],
      showRecords: async () => { throw Object.assign(new Error('synthetic private path'), { name: 'KnowledgeMaintenanceScanError' }) } } })
    expect(result.learned.changes).toHaveLength(1)
    expect(result.steps).toHaveLength(4)
    expect(result.learned).toHaveProperty('scanIncomplete', true)
    expect(result.learned.changes[0]).toHaveProperty('contentAbsence', { reason: 'scan-incomplete' })
    expect(result.steps[0]?.served.channel2[0]).toHaveProperty('contentAbsence', { reason: 'scan-incomplete' })
    expect(JSON.stringify(result)).not.toContain('synthetic private path')
  })

  it('SNAPSHOT-STABLE: five fixed buckets preserve richer attribution and unchanged reads', async () => {
    const snapshot = fixedSnapshot()
    const before = JSON.stringify(snapshot)
    const recorded = snapshot.rows.flatMap(row => row.changes.map(entry => entry.change))
    const diff = recorded.map(row => row.change === 'added'
      ? change({ recordId: row.recordId, change: 'added', atOrdinal: row.atOrdinal, sourceRunId: RUN_ID }) : row)
    const options: DepsOptions = { bindPostProcessing: true, chain: { curationSnapshot: snapshot,
      curateMemory: { status: 'done', claimed: false } }, knowledge: { diffSince: async () => diff,
      showRecords: async ({ recordIds }) => recordIds.map(currentRecord) } }
    const first = await ready(options)
    expect(first.learned).toHaveProperty('curationSnapshot', snapshot)
    expect(first.learned).toHaveProperty('sinceThen', { changes: [], count: 0 })
    expect(first.learned.changes).toHaveLength(7)
    const served = first.learned.curationSnapshot!
    expect(served.rows.map(row => row.bucket).sort()).toEqual(['added', 'confirmed', 'deprecated', 'proposed', 'superseded'])
    expect(Object.values(served.breakdown).reduce((sum, count) => sum + count, 0)).toBe(served.rows.length)
    for (const bucket of ['added', 'confirmed', 'superseded', 'deprecated', 'proposed'] as const) {
      expect(served.breakdown[bucket]).toBe(served.rows.filter(row => row.bucket === bucket).length)
    }
    expect(await ready(options)).toEqual(first)
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(RunKnowledgeProjectionSchema.parse(first)).toEqual(first)
  })

  it('LATER-PROMOTION: the same record and a distinct same-ordinal confirmation remain since then', async () => {
    const snapshot = fixedSnapshot()
    const later = [change({ recordId: 'added', change: 'promoted', atOrdinal: 91, sourceRunId: RUN_ID }),
      change({ recordId: 'confirmed', atOrdinal: 21, sourceRunId: RUN_ID, evidenceToken: 'third-confirm', observationId: 'third-observation' })]
    const result = await ready({ bindPostProcessing: true, chain: { curationSnapshot: snapshot },
      knowledge: { diffSince: async () => [...snapshot.rows.flatMap(row => row.changes.map(entry => entry.change)), ...later],
        showRecords: async ({ recordIds }) => recordIds.map(currentRecord) } })
    expect(result.learned).toHaveProperty('curationSnapshot', snapshot)
    expect(result.learned).toHaveProperty('sinceThen', { changes: later.map(row => expect.objectContaining(row)), count: 2 })
  })

  it('FAILED-CHAIN-ROWS-RETAINED: incomplete curation keeps actual changes without invented snapshot/counts', async () => {
    const result = await ready({ bindPostProcessing: true, chain: { curateMemory: { status: 'failed', claimed: false } },
      knowledge: { diffSince: async () => [change({ sourceRunId: RUN_ID })],
        showRecords: async ({ recordIds }) => recordIds.map(currentRecord) } })
    expect(result.curation.status).toBe('failed')
    expect(result.learned.changes).toHaveLength(1)
    expect(result.learned.changes[0]).toMatchObject({ recordId: 'rec-1', change: 'confirmed', atOrdinal: 12 })
    expect(result.learned.changes[0]).toHaveProperty('recordContent')
    expect(result.learned).not.toHaveProperty('curationSnapshot')
    expect(result.learned).not.toHaveProperty('sinceThen')
    expect(result.curation).not.toHaveProperty('counts')
  })

  it('JOINED-STRINGS-MASKED: joined prose crosses the live mask while exact identities stay unmasked', async () => {
    const secret = 'synthetic-secret-9f2c'
    const local = createMaskingContext()
    local.register(secret)
    const secretRecord = (recordId: string) => KnowledgeRecordShowResultSchema.parse({
      kind: 'found', schemaVersion: 1, summary: `summary ${secret}`, body: `body ${secret}`,
      provenance: { mode: 'standalone', sourceDescription: 'synthetic inspection' },
      record: { schemaVersion: 1, recordId, product: `shop ${secret}`, scope: 'checkout', kind: 'fact',
        status: 'active', confirmations: 1, contradictions: 0, evidenceTokens: [`token ${secret}`],
        openedAtOrdinal: 3, lastEventOrdinal: 3, anchors: [`el:${secret}`], trustNarrative: `narrative ${secret}` },
    })
    const options: DepsOptions = { knowledge: { diffSince: async () => [change({ recordId: 'rec-a', sourceRunId: RUN_ID })],
      showRecords: async ({ recordIds }) => recordIds.map(secretRecord) } }
    setActiveMaskingContextResolver(() => local)
    const masked = await ready(options)
    expect(JSON.stringify(masked)).not.toContain(secret)
    expect(masked.steps[0]?.served.channel1[0]).toMatchObject({ id: 'rec-a', recordContent: {
      content: local.mask(`body ${secret}`), summary: local.mask(`summary ${secret}`),
      applicability: { product: local.mask(`shop ${secret}`), anchors: [local.mask(`el:${secret}`)] },
      currentTrust: { evidenceTokens: [local.mask(`token ${secret}`)], trustNarrative: local.mask(`narrative ${secret}`) } } })
    expect(masked.learned.changes[0]).toMatchObject({ recordId: 'rec-a', sourceRunId: RUN_ID })
    setActiveMaskingContextResolver(() => undefined)
    const closed = await ready(options)
    expect(JSON.stringify(closed)).not.toContain(secret)
    expect(closed.steps[0]?.served.channel1[0]).toHaveProperty('recordContent.content', maskedMarker('secret'))
    expect(closed.steps[0]?.served.channel1[0]?.id).toBe('rec-a')
  })

  it('JOIN-NOT-BOUND: actual registry retains the read with typed enrichment absence and no unary fallback', async () => {
    const unary = vi.fn(async () => { throw new Error('unary fallback forbidden') })
    const registry = createFunctionRegistry({ deps: deps({ knowledge: { showRecord: unary } }),
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => 'local-headless' })
    const result = await invokeFunction(registry, 'runs.knowledge', { runId: RUN_ID },
      { surface: 'cli', origin: 'human', grantedScopes: ['read'], safeMode: false })
    expect(result).toHaveProperty('steps.0.served.channel2.0.contentAbsence', { reason: 'not-bound' })
    expect(unary).not.toHaveBeenCalled()
  })
})

/**
 * The layer's no-null idiom, asserted STRUCTURALLY (407-19, IN-03).
 *
 * Serialising the DTO and searching those bytes for the four letters `n-u-l-l` — the form these
 * cells used before — reds on any record id, step text or CSS selector that merely CONTAINS them.
 * An unrelated fixture change breaks the cell and the failure says nothing about the idiom it was
 * guarding. This walks the parsed value instead and names the path of the offending member, so a
 * failure reads as an instruction.
 */
function assertNoNull(value: unknown, path = '$'): void {
  if (value === null) {
    expect.fail(`null at ${path} — absence in this DTO is an ABSENT KEY, never a null byte`)
  }
  if (Array.isArray(value)) {
    value.forEach((member, index) => assertNoNull(member, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [key, member] of Object.entries(value as object)) {
      assertNoNull(member, path === '$' ? key : `${path}.${key}`)
    }
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

  it('composes only siblings that declare the same read tier it does (407-12, WR-08)', () => {
    // The header's "composition inside the layer, not a dispatch path around the gate" argument
    // holds ONLY while every sibling this op calls directly needs no more scope than this call
    // was granted. Nothing else enforces that; a widened sibling would silently exercise a
    // capability a `read` caller never asked for, and emit no receipt for it. It reds HERE.
    for (const spec of [runsPostProcessingSpec, knowledgeRecordsDiffSpec, runsDigestSpec]) {
      expect(spec.requiredScopes).toEqual(runsKnowledgeSpec.requiredScopes)
    }
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
      contentAbsence: { reason: 'not-bound' },
    }])
    expect(result.steps[0]?.served.channel2).toEqual([
      { id: 'rec-b', detailLevel: 'summary', bodyDigest: 'body-1', contentAbsence: { reason: 'not-bound' } },
    ])
    // Anchors are deliberately NOT projected: the panel renders a caution's sentence only.
    // 423-34: a host binding no batch record read names that absence instead of omitting it.
    expect(result.steps[0]?.served.channel3).toEqual([
      { id: 'rec-c', summary: 'the checkout button moves on mobile', contentAbsence: { reason: 'not-bound' } },
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

describe('the plan source is PICKED onto the wire, never spread (CR-01)', () => {
  it('carries the runner-written flow cursor of a real replay onto the wire', async () => {
    // The exact input CR-01 reproduced a `ZodError` with: the arm is `.strict()`, the runner
    // writes `flow` unconditionally, and before 407-12 this refused rather than projected.
    const result = await ready()

    expect(result.steps[0]?.planSource).toEqual(REPLAY)
    expect(result.steps[0]?.planSource).toHaveProperty('flow', { cursor: 0, length: 3 })
  })

  it('keeps every declared member of both arms — the pick is not a narrowing', async () => {
    const result = await ready()

    expect(result.steps[0]?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: 'rec-proc-1',
      guard: {
        checksPassed: 2,
        total: 3,
        miss: { procedureStepIndex: 2, reason: 'page-anchor-mismatch' },
      },
      flow: { cursor: 0, length: 3 },
    })
    expect(result.steps[3]?.planSource).toEqual({
      kind: 'procedure-hint',
      procedureId: 'rec-proc-2',
      demotion: 'body-empty',
    })
  })

  it('drops a producer member this build does not declare, and still parses', async () => {
    // The channels are field-picked so a serving-contract addition cannot silently reach a page
    // (405's display posture). Before CR-01 the plan source alone was SPREAD, so the next
    // producer member would have reached the strict wire and refused the whole read — exactly
    // how `flow` shipped. A field-pick makes that class of break impossible rather than pending.
    const evidence = step(0, {
      planSource: { ...REPLAY, futureMember: 'x' } as unknown as StepPlanSource,
    })
    const result = await runsKnowledgeSpec.invoke(
      { runId: asRunId(RUN_ID) },
      deps({ document: handoff([test(0, [evidence])]) }),
    )

    expect(result.kind).toBe('ready')
    expect(RunKnowledgeProjectionSchema.safeParse(result).success).toBe(true)
    expect(JSON.stringify(result)).not.toContain('futureMember')
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
        canaryAttributions: () => Promise.resolve({
          rows: [{
            candidateId: 'rec-canary',
            testIndex: 1,
            stepIndex: 0,
            observationId: 'canary-outcome:abc',
            outcome: 'confirmed' as const,
          }],
          skippedBundles: 0,
        }),
      },
    })

    expect(result.learned.changes.map((row) => row.recordId)).toEqual(['rec-mine', 'rec-obs'])
  })

  it('projects only attributed canary rows, keyed by the step that served the line (D-08)', async () => {
    const result = await ready({
      knowledge: {
        canaryAttributions: () => Promise.resolve({
          rows: [
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
          ],
          skippedBundles: 0,
        }),
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

describe('an unrelated malformed bundle degrades the Learned enrichments, never the read (CR-03)', () => {
  // The knowledge store's own fail-closed error, built the way the op must recognise it: BY NAME.
  // `packages/agent` is storage-neutral and cannot import `KnowledgeMaintenanceScanError` from
  // `knowledge-local`, and neither may this file — so the cell constructs the exact wire the op
  // reads (403-03 D-4: read a foreign error structurally, never `instanceof` across a substrate
  // boundary).
  function scanError(path: string): Error {
    return Object.assign(
      new Error(`knowledge maintenance scan incomplete at ${path}: bundle-load: manifest-invalid`),
      { name: 'KnowledgeMaintenanceScanError' },
    )
  }

  const MALFORMED = 'memory/shop/bundles/aaa-malformed-0000000000000000'
  const MINE = change({ recordId: 'rec-mine', sourceRunId: RUN_ID })

  /** `twoByTwo` with a recorded rung on its first step, so the Used half can be SEEN to survive. */
  function withRecordedRung(): CompletedRunHandoff {
    const base = twoByTwo()
    return handoff(base.tests.map((member, testIndex) => (testIndex === 0
      ? {
          ...member,
          steps: member.steps.map((evidence, stepIndex) => (stepIndex === 0
            ? ({ ...evidence, retrievalRung: RUNG } as StepEvidence)
            : evidence)),
        }
      : member)) as PerTestOutcome[])
  }

  it('folds a scan error from the records diff to an empty list and says so on the wire', async () => {
    const result = await ready({
      document: withRecordedRung(),
      knowledge: { diffSince: () => Promise.reject(scanError(MALFORMED)) },
    })

    // The whole Used half is intact — every step, and the rung the run recorded. One malformed
    // bundle this run never touched used to make ALL of this a `read_failed` page.
    expect(result.steps).toHaveLength(4)
    expect(result.retrievalRung).toEqual(RUNG)
    expect(result.learned.changes).toEqual([])
    expect(result.learned.scanIncomplete).toBe(true)
    expect(RunKnowledgeProjectionSchema.safeParse(result).success).toBe(true)
  })

  it('degrades the two enrichments INDEPENDENTLY — a failed attribution keeps the diff rows', async () => {
    const result = await ready({
      knowledge: {
        diffSince: () => Promise.resolve([MINE]),
        canaryAttributions: () => Promise.reject(scanError(MALFORMED)),
      },
    })

    expect(result.learned.canaryAttributions).toEqual([])
    expect(result.learned.changes.map((row) => row.recordId)).toEqual(['rec-mine'])
    expect(result.learned.scanIncomplete).toBe(true)
  })

  it('still propagates an error that is NOT a knowledge-store scan error', async () => {
    // The posture this op has always held, and does not abandon here: a real failure inside a
    // BOUND path is not swallowed. Only the store's own named scan error folds.
    await expect(runsKnowledgeSpec.invoke(
      { runId: asRunId(RUN_ID) },
      deps({ knowledge: { diffSince: () => Promise.reject(new Error('disk on fire')) } }),
    )).rejects.toThrow('disk on fire')
  })

  it('carries NO scanIncomplete key at all on a clean read — never a false', async () => {
    const result = await ready({ knowledge: { diffSince: () => Promise.resolve([MINE]) } })

    expect('scanIncomplete' in result.learned).toBe(false)
    assertNoNull(JSON.parse(JSON.stringify(result)))
  })

  it('names the incomplete scan on the receipt, and leaves a clean receipt byte-identical', async () => {
    const CLEAN = `knowledge for ${RUN_ID} — 4 steps, 2 brief lines served, 0 learned change(s)`
    const degraded = runsKnowledgeSpec.classify(await ready({
      knowledge: { diffSince: () => Promise.reject(scanError(MALFORMED)) },
    }))

    expect(degraded.outcome).toBe(`${CLEAN}, knowledge store scan incomplete`)
    expect(runsKnowledgeSpec.classify(await ready()).outcome).toBe(CLEAN)
  })
})

describe('a partial attribution walk raises the flag by CONTRACT, and the op emits rows beside it (407-19, REVIEW WR-03)', () => {
  // Before 407-19 the ONLY reason a half-read store reached the wire as `scanIncomplete` was that
  // `diffSince` happened to throw on the same bundle. That coupling is not a contract: it does not
  // hold when the two reads see different stores, and it disappears the moment anyone applies
  // 407-14's per-bundle skip to `diffSince` too. The walk now COUNTS what it could not load, and
  // the op reads the flag off that count — so the degradation marker belongs to the read that
  // degraded.
  const MINE = change({ recordId: 'rec-mine', sourceRunId: RUN_ID })

  const ATTRIBUTED = {
    candidateId: 'rec-canary',
    testIndex: 1,
    stepIndex: 0,
    observationId: 'canary-outcome:abc',
    outcome: 'confirmed' as const,
  }

  it('raises scanIncomplete from the walk\'s OWN count, keeping BOTH lists (the CR-01 shape)', async () => {
    // The exact projection 407-18's rows-first view renders — now produced by the shipped op from
    // real inputs rather than hand-built in a view fixture: rows on both lists AND the flag.
    const result = await ready({
      knowledge: {
        diffSince: () => Promise.resolve([MINE]),
        canaryAttributions: () => Promise.resolve({ rows: [ATTRIBUTED], skippedBundles: 1 }),
      },
    })

    expect(result.learned.scanIncomplete).toBe(true)
    expect(result.learned.changes.map((row) => row.recordId)).toEqual(['rec-mine'])
    expect(result.learned.canaryAttributions).toEqual([{
      testIndex: 1,
      stepIndex: 0,
      recordId: 'rec-canary',
      observationId: 'canary-outcome:abc',
      outcome: 'confirmed',
    }])
    expect(RunKnowledgeProjectionSchema.safeParse(result).success).toBe(true)
  })

  it('leaves the key ABSENT when the walk read the whole store — a count of 0 is a clean read', async () => {
    const result = await ready({
      knowledge: {
        diffSince: () => Promise.resolve([MINE]),
        canaryAttributions: () => Promise.resolve({ rows: [ATTRIBUTED], skippedBundles: 0 }),
      },
    })

    expect('scanIncomplete' in result.learned).toBe(false)
    expect(result.learned.canaryAttributions).toHaveLength(1)
  })

  it('names the incomplete scan on the receipt for the counted skip, exactly as for the thrown one', async () => {
    const result = await ready({
      knowledge: {
        canaryAttributions: () => Promise.resolve({ rows: [ATTRIBUTED], skippedBundles: 1 }),
      },
    })

    expect(runsKnowledgeSpec.classify(result).outcome).toBe(
      `knowledge for ${RUN_ID} — 4 steps, 2 brief lines served, 0 learned change(s)`
      + ', knowledge store scan incomplete',
    )
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

    assertNoNull(JSON.parse(JSON.stringify(result)))
  })

  it('the no-null walk names the member it found — the idiom is structural, not textual', () => {
    // The control for the helper above (IN-03): a record id, a step text or a selector carrying
    // the four letters `null` must NOT red these cells, and a real null must red them by PATH.
    expect(() => assertNoNull({ a: [{ b: null }] })).toThrow(/a\[0\]\.b/)
    expect(() => assertNoNull({ recordId: 'rec-[data-null]', steps: ['nullable selector'] }))
      .not.toThrow()
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
