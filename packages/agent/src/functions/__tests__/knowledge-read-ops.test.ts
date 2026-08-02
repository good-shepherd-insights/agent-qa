// The three new knowledge READ verbs (Phase 387 plan 06, KREV-01 / FUNC-04).
//
// `knowledge.records.inspect`, `knowledge.records.diff` and `knowledge.record.show` are WIRING
// over functions the read-only reader entry already exports. That claim is what this file
// checks, and the check is deliberately shaped as "the op projects what the port handed it and
// derives nothing", not as "the op returns something plausible": a verb that recomputed trust,
// a status, or an ordinal would look identical in a green suite that only ever compared shapes.
//
// Every stub port here returns rows the ops would be WRONG to pass through unchanged — reversed
// order, equal sort keys, values no derivation could produce — because a projection test fed
// already-correct data cannot distinguish a projection from a coincidence.

import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  BundleProvenance,
  InspectRecordView,
  RecordChange,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { knowledgeRecordShowSpec } from '../ops/knowledge-record-show.js'
import { knowledgeRecordsDiffSpec } from '../ops/knowledge-records-diff.js'
import { knowledgeRecordsInspectSpec } from '../ops/knowledge-records-inspect.js'
import type { FunctionDeps, KnowledgeReaderPort } from '../spec.js'

function view(overrides: Partial<InspectRecordView> = {}): InspectRecordView {
  return {
    schemaVersion: 1,
    recordId: 'rec-1',
    product: 'shop',
    scope: 'product:shop',
    kind: 'fact',
    status: 'active',
    confirmations: 3,
    contradictions: 0,
    evidenceTokens: ['tok-a'],
    lastEventOrdinal: 12,
    openedAtOrdinal: 4,
    anchors: ['{"route":"/cart","t":"page"}'],
    ...overrides,
  }
}

function change(overrides: Partial<RecordChange> = {}): RecordChange {
  return {
    schemaVersion: 1,
    recordId: 'rec-1',
    change: 'confirmed',
    atOrdinal: 7,
    ...overrides,
  }
}

const PROVENANCE: BundleProvenance = {
  schemaVersion: 1,
  mode: 'run-linked',
  originClass: 'agent-verified',
  runId: 'run-alpha',
  testId: 't_checkout',
  stepIndex: 2,
}

/** The empty store: every verb answers, none of them throws. */
const EMPTY_KNOWLEDGE: KnowledgeReaderPort = {
  listBundles: () => Promise.resolve([]),
  inspectRecords: () => Promise.resolve([]),
  diffSince: () => Promise.resolve([]),
  showRecord: ({ recordId }) => Promise.resolve({
    kind: 'not-found',
    schemaVersion: 1,
    recordId,
  }),
}

function deps(knowledge: Partial<KnowledgeReaderPort> = {}): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: { ...EMPTY_KNOWLEDGE, ...knowledge },
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
}

describe('the three read verbs declare read-only unary contracts', () => {
  it('names its id, scope and risk the way the exemplar does', () => {
    const specs = [
      knowledgeRecordsInspectSpec,
      knowledgeRecordsDiffSpec,
      knowledgeRecordShowSpec,
    ]

    expect(specs.map((spec) => spec.id)).toEqual([
      'knowledge.records.inspect',
      'knowledge.records.diff',
      'knowledge.record.show',
    ])
    for (const spec of specs) {
      expect(spec.requiredScopes, spec.id).toEqual(['read'])
      expect(spec.resultKind, spec.id).toBe('unary')
      // Bound wherever registered: `knowledge` is a REQUIRED dep, so unlike the mutating half
      // there is no host that lists these and then refuses them.
      expect(spec.boundThrough, spec.id).toBeUndefined()
      expect(spec.risk, spec.id).toEqual({
        name: `fn:${spec.id}`,
        recognized: true,
        readOnly: true,
      })
    }
  })
})

describe('Test 1 — wiring parity: the ops project, they never recompute', () => {
  it('inspect hands back the reader\'s own view rows, field for field', async () => {
    // Values chosen so no derivation could produce them: a record with more contradictions
    // than confirmations that is still `active`, and an ordinal pair the other way round from
    // what a recomputation would infer. An op that recomputed anything would disagree here.
    const rows = [
      view({ recordId: 'rec-9', confirmations: 0, contradictions: 5, status: 'active' }),
      view({ recordId: 'rec-2', product: 'atlas', lastEventOrdinal: 1, openedAtOrdinal: 99 }),
    ]

    const result = await knowledgeRecordsInspectSpec.invoke(
      { filter: {} },
      deps({ inspectRecords: () => Promise.resolve(rows) }),
    )

    expect(result.schemaVersion).toBe(1)
    expect([...result.records].sort((a, b) => a.recordId.localeCompare(b.recordId)))
      .toEqual([...rows].sort((a, b) => a.recordId.localeCompare(b.recordId)))
  })

  it('inspect passes the caller\'s filter through unchanged', async () => {
    const seen: unknown[] = []

    await knowledgeRecordsInspectSpec.invoke(
      { filter: { product: 'shop', status: 'deprecated', unresolvedOnly: true } },
      deps({
        inspectRecords: (input) => {
          seen.push(input.filter)
          return Promise.resolve([])
        },
      }),
    )

    // A filter the op narrowed, widened or defaulted would be a second query planner living
    // above the one that already exists.
    expect(seen).toEqual([{ product: 'shop', status: 'deprecated', unresolvedOnly: true }])
  })

  it('diff hands back the reader\'s change rows and ECHOES the baseline it was asked for',
    async () => {
      const rows = [change({ recordId: 'rec-3', change: 'purged', atOrdinal: 41 })]

      const result = await knowledgeRecordsDiffSpec.invoke(
        { sinceOrdinal: 12 },
        deps({ diffSince: () => Promise.resolve(rows) }),
      )

      expect(result.schemaVersion).toBe(1)
      expect(result.changes).toEqual(rows)
      // The echo is not decoration: a change list with no baseline is a list whose meaning
      // depends on remembering the question, and these answers get pasted into issues.
      expect(result.sinceOrdinal).toBe(12)
    })

  it('diff passes the caller\'s ordinal through unchanged', async () => {
    const seen: number[] = []

    await knowledgeRecordsDiffSpec.invoke(
      { sinceOrdinal: 0 },
      deps({
        diffSince: ({ sinceOrdinal }) => {
          seen.push(sinceOrdinal)
          return Promise.resolve([])
        },
      }),
    )

    // Zero specifically: an op that treated a falsy ordinal as "unset" would silently answer a
    // different question, and 0 is the ordinal a first-ever diff asks from.
    expect(seen).toEqual([0])
  })
})

describe('Test 2 — show returns the record with its provenance, and types its miss', () => {
  it('carries the record, its provenance, and the prose that goes with them', async () => {
    const record = view({ recordId: 'rec-7' })

    const result = await knowledgeRecordShowSpec.invoke(
      { recordId: 'rec-7' },
      deps({
        showRecord: () => Promise.resolve({
          kind: 'found',
          schemaVersion: 1,
          record,
          provenance: PROVENANCE,
          summary: 'the cart badge lags one tick behind',
          body: 'full prose',
        }),
      }),
    )

    expect(result.kind).toBe('found')
    if (result.kind !== 'found') throw new Error('unreachable')
    expect(result.record).toEqual(record)
    // A record shown without its provenance is an assertion; shown with it, it is evidence.
    expect(result.provenance).toEqual(PROVENANCE)
    expect(result.summary).toBe('the cart badge lags one tick behind')
    expect(result.body).toBe('full prose')
  })

  it('returns a typed not-found for an unknown record id rather than throwing', async () => {
    const result = await knowledgeRecordShowSpec.invoke(
      { recordId: 'rec-nobody-committed' },
      deps(),
    )

    expect(result).toEqual({
      kind: 'not-found',
      schemaVersion: 1,
      recordId: 'rec-nobody-committed',
    })
  })

  it('passes the caller\'s record id through unchanged', async () => {
    const seen: string[] = []

    await knowledgeRecordShowSpec.invoke(
      { recordId: '../../etc/passwd' },
      deps({
        showRecord: ({ recordId }) => {
          seen.push(recordId)
          return Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId })
        },
      }),
    )

    // Verbatim, and the traversal-shaped id is the point: the op neither sanitises nor rejects,
    // because the reader resolves an id against the records it ENUMERATES and never by joining
    // it onto a path (the T-384-08 discipline `runs.get` already carries).
    expect(seen).toEqual(['../../etc/passwd'])
  })
})

describe('Test 3 — the empty store answers, it never throws (FUNC-04 empty edge)', () => {
  it('inspect returns an empty record list', async () => {
    expect(await knowledgeRecordsInspectSpec.invoke({ filter: {} }, deps()))
      .toEqual({ schemaVersion: 1, records: [] })
  })

  it('diff returns an empty change list that still echoes its baseline', async () => {
    expect(await knowledgeRecordsDiffSpec.invoke({ sinceOrdinal: 5 }, deps()))
      .toEqual({ schemaVersion: 1, sinceOrdinal: 5, changes: [] })
  })

  it('show returns the typed miss', async () => {
    expect((await knowledgeRecordShowSpec.invoke({ recordId: 'rec-1' }, deps())).kind)
      .toBe('not-found')
  })
})

describe('Test 4 — each op owns a deterministic TOTAL order (the 384 convention)', () => {
  it('inspect sorts by record id then product, whatever order the port answered in',
    async () => {
      // Deliberately reversed, and with one record id shared across two products so the second
      // key is load-bearing rather than decorative. A port that happened to answer in order
      // would leave the op's sort unpinned by this case.
      const rows = [
        view({ recordId: 'rec-9', product: 'shop' }),
        view({ recordId: 'rec-2', product: 'shop' }),
        view({ recordId: 'rec-2', product: 'atlas' }),
      ]

      const result = await knowledgeRecordsInspectSpec.invoke(
        { filter: {} },
        deps({ inspectRecords: () => Promise.resolve(rows) }),
      )

      expect(result.records.map((row) => `${row.recordId}/${row.product}`)).toEqual([
        'rec-2/atlas',
        'rec-2/shop',
        'rec-9/shop',
      ])
    })

  it('diff breaks equal keys deterministically all the way down', async () => {
    // Every pair below is equal on every key before the one that separates it, so each leg of
    // the comparator is the only thing that can order that pair. A comparator missing any leg
    // leaves two of these rows in the order the port supplied them.
    const rows = [
      change({ recordId: 'rec-2', atOrdinal: 9, change: 'confirmed', evidenceToken: 'tok-b' }),
      change({ recordId: 'rec-2', atOrdinal: 9, change: 'confirmed', evidenceToken: 'tok-a' }),
      change({ recordId: 'rec-2', atOrdinal: 9, change: 'confirmed' }),
      change({ recordId: 'rec-2', atOrdinal: 9, change: 'added' }),
      change({ recordId: 'rec-2', atOrdinal: 3, change: 'promoted' }),
      change({ recordId: 'rec-1', atOrdinal: 88, change: 'purged' }),
    ]

    const first = await knowledgeRecordsDiffSpec.invoke(
      { sinceOrdinal: 0 },
      deps({ diffSince: () => Promise.resolve(rows) }),
    )
    const second = await knowledgeRecordsDiffSpec.invoke(
      { sinceOrdinal: 0 },
      // The same rows in a DIFFERENT order: two invocations agreeing is only evidence of a
      // total order if the inputs they agreed from were not already in it.
      deps({ diffSince: () => Promise.resolve([...rows].reverse()) }),
    )

    expect(first.changes.map((row) => (
      `${row.recordId}/${String(row.atOrdinal)}/${row.change}/${row.evidenceToken ?? '-'}`
    ))).toEqual([
      'rec-1/88/purged/-',
      'rec-2/3/promoted/-',
      'rec-2/9/added/-',
      'rec-2/9/confirmed/-',
      'rec-2/9/confirmed/tok-a',
      'rec-2/9/confirmed/tok-b',
    ])
    expect(second.changes).toEqual(first.changes)
  })

  it('inspect produces the identical order from two differently-ordered answers', async () => {
    const rows = [
      view({ recordId: 'rec-4' }),
      view({ recordId: 'rec-1', product: 'atlas' }),
      view({ recordId: 'rec-4', product: 'atlas' }),
    ]

    const forward = await knowledgeRecordsInspectSpec.invoke(
      { filter: {} },
      deps({ inspectRecords: () => Promise.resolve(rows) }),
    )
    const reversed = await knowledgeRecordsInspectSpec.invoke(
      { filter: {} },
      deps({ inspectRecords: () => Promise.resolve([...rows].reverse()) }),
    )

    expect(reversed.records).toEqual(forward.records)
  })
})
