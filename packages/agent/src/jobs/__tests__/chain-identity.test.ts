// The post-run chain's identity, pinned where it is derived (JOBK-03, D-02/D-03; 422 D-13).
//
// Two claims about identity: the derivation hands back exactly three keys, and the terminal list is
// not a second opinion about membership — it IS the kind set the derivation asks the id source for,
// so a chain that grows an id without extending the list, or extends the list without deriving the
// id, reds here by name rather than reporting a terminal one job early.
//
// 2026-09-11 (Phase 422, D-13): the chain grew a THIRD stage. `propose-improvements` is a kind this
// build has declared since 385; what 422 adds is the successor edge from `curate-memory` and the
// derived id that addresses the row that edge mints. The widening is authorised, and it is pinned
// here by literal so a FOURTH id cannot arrive unannounced.
//
// A second family of claims lives here too, and it is the one the widening most endangers: the
// chain terminal is now usually reported by a job that did NOT do the analysis and did NOT do the
// curation. Everything the record says about the first two stages therefore has to travel forward
// on the third job's payload. A builder that read only what the finishing job published would
// report a completed curation as a failure and lose its counts — the exact trap 422-PATTERNS names.

import { asJobId } from '@vostride/agent-qa-schema'
import type { CurationSnapshot, Job, JobKind } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  buildChainTerminalNotification,
  chainJobIdsForRun,
  POST_RUN_CHAIN_TERMINAL_KINDS,
  UNKNOWN_VERDICTS_MARKER,
} from '../chain-identity.js'
import type { JobIdSource } from '../engine.js'
import { createRealJobKindRegistry, readProposeImprovementsPayload } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'

const RUN_ID = 'run-1'

/**
 * An id source that records what it was asked for.
 *
 * The derivation calls `jobIdFor` exactly once per id, so the recorded kinds ARE the kind set
 * the chain addresses — read off the CALL rather than off the returned object's keys, because
 * the equivalence below has to compare the derivation against a hand-authored list and a key
 * set could agree with itself.
 */
function recordingIdSource(): {
  asked: { kind: JobKind; key: string }[]
  idSource: JobIdSource
} {
  const asked: { kind: JobKind; key: string }[] = []
  return {
    asked,
    idSource: {
      jobIdFor: (kind, key) => {
        asked.push({ kind, key })
        return asJobId(`${kind}:${key}`)
      },
    },
  }
}

describe('the post-run chain ids (JOBK-03, D-02/D-03; 422 D-13)', () => {
  it('derives exactly three chain ids, keyed analyzeRun, curateMemory and proposeImprovements', () => {
    const { idSource } = recordingIdSource()

    // Sorted against a literal rather than counted, so a fourth key names itself in the diff.
    expect(Object.keys(chainJobIdsForRun(RUN_ID, idSource)).sort()).toEqual([
      'analyzeRun',
      'curateMemory',
      'proposeImprovements',
    ])
  })

  it('lets every derived chain kind land the terminal — the terminal list equals the derived kind set', () => {
    const { asked, idSource } = recordingIdSource()
    chainJobIdsForRun(RUN_ID, idSource)

    // Declaration order: the terminal list is an authored array, so its order is part of what
    // this pins, exactly as the literal-list rule asks (D-01).
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS]).toEqual([
      'analyze-run',
      'curate-memory',
      'propose-improvements',
    ])
    // …and the coupling, which is the point of the cell. Either half moving without the other
    // reds this line, and the diff says which kind arrived or went missing.
    expect(asked.map((call) => call.kind).sort()).toEqual([...POST_RUN_CHAIN_TERMINAL_KINDS].sort())
  })

  it('derives three distinct ids, each successor key built from its own predecessor id', () => {
    const { asked, idSource } = recordingIdSource()
    const ids = chainJobIdsForRun(RUN_ID, idSource)

    // Adjacency, now over a chain of three: each id after the head is not an independent hash of
    // the run, it is addressed FROM the id before it. Two ids that collided would collapse two
    // stages onto one row; a successor key that forgot its predecessor would address a row the
    // engine's own `successorsOf` never mints.
    expect(new Set([ids.analyzeRun, ids.curateMemory, ids.proposeImprovements]).size).toBe(3)
    expect(asked.map((call) => call.key)).toEqual([
      RUN_ID,
      `${String(ids.analyzeRun)}->curate-memory`,
      `${String(ids.curateMemory)}->propose-improvements`,
    ])
  })
})

/** The upstream truth a real curate-memory success hands its proposal successor (422 D-13). */
function upstreamPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from: 'curate-memory',
    predecessor: 'job_curate',
    runId: RUN_ID,
    executionContext: 'local-headless',
    candidateIds: ['cand-1', 'cand-2'],
    upstream: {
      verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
      analysisStatus: 'done',
      curation: { curated: 4, deprecated: 2, complete: true },
    },
    ...overrides,
  }
}

describe('the chain terminal notification carries upstream truth forward (422 D-13, D-15)', () => {
  it('reports every earlier stage from the proposal job payload, not from what IT published', () => {
    const record = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'propose-improvements',
      finished: 'done',
      payload: upstreamPayload(),
      // The terminal trap in one line: the finishing job published only ITS own checkpoint. A
      // builder reading `bundle-committed` off this map finds nothing, and a builder that then
      // inferred curation from the finishing kind would call a completed fold a failure.
      publishedValues: new Map([['proposals-authored', { runId: RUN_ID, proposed: 3, skipped: 1 }]]),
    })

    expect(record.schemaVersion).toBe(4)
    expect(record.outcome).toBe('done')
    expect(record.verdictSummary).toEqual({ total: 2, byClass: { timeout: 1, unknown: 1 } })
    // Whole-record equality on the stages rather than field spot-checks: a builder that kept the
    // status and dropped the counts would satisfy any per-field check written afterwards.
    expect(record.stages).toEqual({
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 4, deprecated: 2 },
      proposals: { status: 'done', proposed: 3, skipped: 1 },
    })
  })

  it('records the proposal stage as failed without disowning the curation it cannot undo', () => {
    const record = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'propose-improvements',
      finished: 'failed',
      payload: upstreamPayload(),
      publishedValues: new Map(),
    })

    // The bundle is committed and on disk. A terminal that reported `curation: failed` because the
    // stage AFTER it died would be the record retracting durable work that really happened.
    expect(record.stages.curation).toEqual({ status: 'done', curated: 4, deprecated: 2 })
    expect(record.stages.proposals).toEqual({ status: 'failed' })
    expect(record.outcome).toBe('failed')
  })

  it('reports a dead analysis honestly from the third job, two payload generations apart', () => {
    const viaUpstream = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'propose-improvements',
      finished: 'done',
      payload: upstreamPayload({
        upstream: {
          analysisStatus: 'failed',
          curation: { curated: 0, deprecated: 0, complete: true },
        },
      }),
      publishedValues: new Map([['proposals-authored', { runId: RUN_ID, proposed: 0, skipped: 0 }]]),
    })

    // The chain proceeded with no verdicts and the record says so, even though the job that
    // reported the terminal is two stages downstream of the one that died.
    expect(viaUpstream.stages.analysis).toEqual({ status: 'failed' })
    expect(viaUpstream.verdictSummary).toEqual({ total: 0, byClass: {} })
    expect(viaUpstream.outcome).toBe('failed')

    // The 388 marker still travels on the payload root for a chain whose curate-memory stage was
    // reached by the FALLBACK; a build that read only the new nested field would lose it.
    const viaMarker = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'propose-improvements',
      finished: 'done',
      payload: upstreamPayload({ verdicts: UNKNOWN_VERDICTS_MARKER }),
      publishedValues: new Map([['proposals-authored', { runId: RUN_ID }]]),
    })
    expect(viaMarker.stages.analysis).toEqual({ status: 'failed' })
  })

  it('omits the proposal stage entirely when the chain never reached it', () => {
    // curate-memory's permanent failure halts the chain, so the proposal job is never enqueued.
    // ABSENT is the honest report: a `failed` proposal stage would claim a stage that never ran,
    // and a `done` one would be a straight fabrication.
    const halted = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'curate-memory',
      finished: 'failed',
      payload: { runId: RUN_ID, verdictSummary: { total: 1, byClass: { flake: 1 } } },
      publishedValues: new Map([['candidates-authored', { runId: RUN_ID }]]),
    })

    expect(Object.keys(halted.stages).sort()).toEqual(['analysis', 'curation'])
    expect(halted.stages.proposals).toBeUndefined()
    expect(halted.stages.curation).toEqual({ status: 'failed' })
    expect(halted.outcome).toBe('failed')
  })

  it('still reads counts off the finishing job when curate-memory itself is the terminal', () => {
    // The 388 path, unchanged: a scripted chain whose curate-memory completes without chaining
    // reports its own published counts. The widening must not cost the shorter chain its record.
    const record = buildChainTerminalNotification({
      runId: RUN_ID,
      finishingKind: 'curate-memory',
      finished: 'done',
      payload: { runId: RUN_ID, verdictSummary: { total: 0, byClass: {} } },
      publishedValues: new Map([
        ['bundle-committed', { runId: RUN_ID, curated: 1, deprecated: 0 }],
      ]),
    })

    expect(record.stages).toEqual({
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 1, deprecated: 0 },
    })
    expect(record.outcome).toBe('done')
  })
})

// Historical identities and deliberately unrelated legacy/proposal counts are authored
// independently of the fold. Two events for one row must remain two events and one unit.
function committedSnapshot(): CurationSnapshot {
  return { schemaVersion: 1, rows: [{ recordId: 'record-fixed', bucket: 'confirmed', changes: [
    { bucket: 'confirmed', change: { schemaVersion: 1, recordId: 'record-fixed', change: 'confirmed',
      atOrdinal: 7, evidenceToken: 'synthetic-first' } },
    { bucket: 'confirmed', change: { schemaVersion: 1, recordId: 'record-fixed', change: 'confirmed',
      atOrdinal: 8, evidenceToken: 'synthetic-second' } },
  ] }], breakdown: { added: 0, confirmed: 1, superseded: 0, deprecated: 0, proposed: 0 } }
}

async function completedFold(snapshot: CurationSnapshot | undefined) {
  const published = new Map<string, unknown>()
  const counts = { curated: 17, deprecated: 9, complete: true,
    ...(snapshot === undefined ? {} : { snapshot }) }
  const context: JobHandlerContext = {
    job: { id: asJobId('synthetic-curation-job') } as Job,
    payload: { runId: RUN_ID, verdictSummary: { total: 0, byClass: {} } },
    publishCheckpoint: async (id, value) => { published.set(id, structuredClone(value)) },
    recordLlmAuthorship: async () => { throw new Error('curation must not invoke a model') },
  }
  const result = await createRealJobKindRegistry({
    loadCompletedRunHandoff: () => { throw new Error('must not re-read run') },
    curateRun: async () => counts,
    persistAnalysis: () => { throw new Error('must not re-analyze') },
  }).require('curate-memory').handler(context)
  expect(result.status).toBe('complete')
  if (result.status !== 'complete') throw new Error('fixture fold did not complete')
  expect(result.next.map(next => next.kind)).toEqual(['propose-improvements'])
  expect([...published.keys()]).toEqual(['candidates-authored', 'bundle-committed'])
  return { payload: structuredClone(result.next[0]!.payload), published }
}

describe('423 fixed notification snapshot', () => {
  it.each(['done', 'failed'] as const)('NOTIFICATION-COPY: actual handler successor preserves exact checkpoint for proposals %s', async finished => {
    const source = committedSnapshot()
    const before = JSON.stringify(source)
    const { payload, published } = await completedFold(source)
    const checkpoint = published.get('bundle-committed')
    expect(checkpoint).toHaveProperty('curationSnapshot', source)
    expect(payload).toHaveProperty('upstream.curation.curationSnapshot', source)
    const parsed = readProposeImprovementsPayload(payload)
    expect(parsed).toHaveProperty('upstream.curation.curationSnapshot', source)
    // Simulate later knowledge changes. Neither the queued bytes nor the notification
    // may reconstruct membership or counts from this current object.
    source.rows[0]!.changes[0]!.change.atOrdinal = 999
    source.breakdown.confirmed = 99
    for (const carrier of [payload, parsed]) {
      const record = buildChainTerminalNotification({ runId: RUN_ID,
        finishingKind: 'propose-improvements', finished, payload: carrier,
        publishedValues: new Map([['proposals-authored', { proposed: 23, skipped: 4 }]]) })
      expect(record.stages.curation).toHaveProperty('curationSnapshot', JSON.parse(before))
      expect(JSON.stringify(Reflect.get(record.stages.curation, 'curationSnapshot'))).toBe(before)
      expect(record.stages.curation.curated).toBe(17)
      expect(record.stages.curation.deprecated).toBe(9)
      expect(record.stages.proposals).toEqual(finished === 'done'
        ? { status: 'done', proposed: 23, skipped: 4 } : { status: 'failed' })
      expect(record.outcome).toBe(finished)
    }
  })

  it('NOTIFICATION-COPY: direct completed curation detaches the authoritative snapshot', () => {
    const snapshot = committedSnapshot()
    const before = JSON.stringify(snapshot)
    const record = buildChainTerminalNotification({ runId: RUN_ID,
      finishingKind: 'curate-memory', finished: 'done', payload: {},
      publishedValues: new Map([['bundle-committed', { runId: RUN_ID, curationSnapshot: snapshot }]]) })
    expect(record.stages.curation).toHaveProperty('curationSnapshot', snapshot)
    snapshot.rows[0]!.changes[0]!.change.atOrdinal = 999
    expect(JSON.stringify(Reflect.get(record.stages.curation, 'curationSnapshot'))).toBe(before)
    expect(record.stages).not.toHaveProperty('proposals')
  })

  it('NOTIFICATION-COPY: historical complete and failed partial curation never invent a snapshot', async () => {
    const { payload, published } = await completedFold(undefined)
    expect(published.get('bundle-committed')).not.toHaveProperty('curationSnapshot')
    const record = buildChainTerminalNotification({ runId: RUN_ID,
      finishingKind: 'propose-improvements', finished: 'done', payload, publishedValues: new Map() })
    expect(record.stages.curation).toEqual({ status: 'done', curated: 17, deprecated: 9 })
    const failed = buildChainTerminalNotification({ runId: RUN_ID,
      finishingKind: 'curate-memory', finished: 'failed', payload: {}, publishedValues: new Map() })
    expect(failed.stages.curation).toEqual({ status: 'failed' })
  })

  it('NOTIFICATION-COPY: a present invalid snapshot fails generically rather than disappearing', () => {
    const bad = { ...committedSnapshot(), syntheticSecretKey: true }
    expect(() => readProposeImprovementsPayload({ runId: RUN_ID,
      upstream: { curation: { curationSnapshot: bad } } })).toThrow(/curation snapshot/)
    try { readProposeImprovementsPayload({ runId: RUN_ID,
      upstream: { curation: { curationSnapshot: bad } } }) } catch (error) {
      expect(String(error)).not.toContain('syntheticSecretKey')
    }
    expect(() => buildChainTerminalNotification({ runId: RUN_ID,
      finishingKind: 'curate-memory', finished: 'done', payload: {},
      publishedValues: new Map([['bundle-committed', { curationSnapshot: bad }]]) }))
      .toThrow(/curation snapshot/)
  })
})
