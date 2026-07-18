import { describe, expect, it, vi } from 'vitest'
import { asRecordId } from '@vostride/agent-qa-schema'
import type {
  IndexEntry,
  ReadTrace,
  RecordBody,
  ScopeKey,
} from '@vostride/agent-qa-schema'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import { createRecordLedger } from '../record-ledger.js'
import { createMemoryTools } from '../memory-tools.js'
import { z } from 'zod'

const SCOPE: ScopeKey = { tier: 'test', key: 'checkout' }

function entry(
  id: string,
  overrides: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id: asRecordId(id),
    kind: 'fact',
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    trust: 0.8,
    anchors: [{ t: 'page', route: '/checkout' }],
    status: 'active',
    servedAsCanary: false,
    scope: SCOPE,
    validity: 'current',
    ...overrides,
  }
}

function body(id: string, text: string, evidenceDigest = `digest-${id}`): RecordBody {
  return {
    id: asRecordId(id),
    title: `Title ${id}`,
    body: text,
    anchors: [{ t: 'page', route: '/checkout' }],
    evidenceDigest,
    relations: [],
  }
}

function stubReader(overrides: Partial<KnowledgeHintReader> = {}): KnowledgeHintReader {
  return {
    getRunBrief: vi.fn(() => ({
      tiers: { L0: '', L1: '', L2: '' },
      lines: [],
      truncation: '',
    })),
    search: vi.fn(() => []),
    read: vi.fn(id => body(id, 'body')),
    getCautions: vi.fn(() => ({ cautions: [], budgetUsed: 0 })),
    getProcedure: vi.fn(() => undefined),
    emitCanaryOutcome: vi.fn(),
    ...overrides,
  }
}

function factory(
  reader: KnowledgeHintReader,
  options: {
    readBodyBudget?: number
    recordLedger?: ReturnType<typeof createRecordLedger>
    estimateTokens?: (text: string) => number
    onReadTrace?: (trace: ReadTrace) => void
  } = {},
) {
  return createMemoryTools({
    reader,
    scope: SCOPE,
    asOfBuild: 42,
    readBodyBudget: options.readBodyBudget ?? 100,
    recordLedger:
      options.recordLedger ?? createRecordLedger({ cap: 10, seedIds: [] }),
    estimateTokens: options.estimateTokens ?? (text => text.length),
    onReadTrace: options.onReadTrace,
  })
}

describe('createMemoryTools — Channel 2 retrieval (D-11/D-12/D-17)', () => {
  it('exposes exactly the restricted memory.search schema and rejects every privileged field', () => {
    const { tools } = factory(stubReader())
    const searchTool = tools['memory.search'].tool as {
      inputSchema?: z.ZodObject<z.ZodRawShape>
      parameters?: z.ZodObject<z.ZodRawShape>
    }
    const schema = searchTool.inputSchema ?? searchTool.parameters

    expect(schema).toBeDefined()
    expect(Object.keys(schema!.shape).sort()).toEqual([
      'anchors',
      'includeCandidates',
      'kind',
      'query',
    ])

    const base = { query: 'checkout button' }
    for (const injected of [
      { includeSuperseded: true },
      { asOfRange: { from: 1, to: 99 } },
      { scope: { tier: 'global', key: '*' } },
      { asOfBuild: 999 },
    ]) {
      expect(schema!.safeParse({ ...base, ...injected }).success).toBe(false)
    }
  })

  it('threads wrapper-fixed scope and build attribution into every search', async () => {
    const search = vi.fn(() => [entry('record-one')])
    const { tools } = factory(stubReader({ search }))

    await tools['memory.search'].execute({
      query: 'checkout button',
      kind: 'fact',
      anchors: [{ t: 'page', route: '/checkout' }],
      includeCandidates: true,
    })

    expect(search).toHaveBeenCalledWith('checkout button', {
      scope: SCOPE,
      asOfBuild: 42,
      kind: 'fact',
      anchors: [{ t: 'page', route: '/checkout' }],
      includeCandidates: true,
    })
  })

  it('rebinds searches to the active suite member at each turn boundary', async () => {
    const search = vi.fn(() => [entry('record-one')])
    const { tools, beginTurn } = factory(stubReader({ search }))
    const memberScope: ScopeKey = { tier: 'test', key: 'guest-checkout' }

    beginTurn(memberScope)
    await tools['memory.search'].execute({ query: 'guest checkout' })

    expect(search).toHaveBeenCalledWith('guest checkout', {
      scope: memberScope,
      asOfBuild: 42,
    })
  })

  it('accounts read bodies with the injected estimator and refuses calls after exhaustion', async () => {
    const first = body('record-first', 'sixty-token-body', 'digest-first')
    const second = body('record-second', 'forty-token-body', 'digest-second')
    const read = vi
      .fn<KnowledgeHintReader['read']>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const estimateTokens = vi.fn((text: string) =>
      text === first.body ? 60 : text === second.body ? 40 : 0,
    )
    const onReadTrace = vi.fn()
    const { tools, beginTurn, drainReadTraces } = factory(
      stubReader({ read }),
      { estimateTokens, onReadTrace },
    )
    beginTurn(SCOPE, [first.id, second.id])

    await tools['memory.read'].execute({ id: first.id, detailLevel: 'body' })
    await tools['memory.read'].execute({ id: second.id, detailLevel: 'summary' })
    const exhausted = await tools['memory.read'].execute({ id: 'record-third' })

    expect(read).toHaveBeenNthCalledWith(1, first.id, {
      detailLevel: 'body',
      budget: 100,
      scope: SCOPE,
      asOfBuild: 42,
    })
    expect(read).toHaveBeenNthCalledWith(2, second.id, {
      detailLevel: 'summary',
      budget: 40,
      scope: SCOPE,
      asOfBuild: 42,
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(estimateTokens).toHaveBeenNthCalledWith(1, first.body)
    expect(estimateTokens).toHaveBeenNthCalledWith(2, second.body)
    expect(exhausted).toEqual({
      kind: 'read-budget-exhausted',
      budget: 100,
      spent: 100,
    })
    expect(exhausted).not.toHaveProperty('body')
    expect(onReadTrace).toHaveBeenNthCalledWith(1, {
      id: first.id,
      detailLevel: 'body',
      bodyDigest: 'digest-first',
    })
    expect(onReadTrace).toHaveBeenNthCalledWith(2, {
      id: second.id,
      detailLevel: 'summary',
      bodyDigest: 'digest-second',
    })
    expect(drainReadTraces()).toEqual([
      { id: first.id, detailLevel: 'body', bodyDigest: 'digest-first' },
      { id: second.id, detailLevel: 'summary', bodyDigest: 'digest-second' },
    ])
    expect(drainReadTraces()).toEqual([])
  })

  it('restores the complete read-body budget at each planning-turn boundary', async () => {
    const record = body('record-reset', 'complete-turn-budget')
    const read = vi.fn<KnowledgeHintReader['read']>(() => record)
    const { tools, beginTurn, drainReadTraces } = factory(stubReader({ read }), {
      estimateTokens: () => 100,
    })
    beginTurn(SCOPE, [record.id])

    await tools['memory.read'].execute({ id: record.id })
    expect(await tools['memory.read'].execute({ id: record.id })).toMatchObject({
      kind: 'read-budget-exhausted',
    })

    beginTurn(SCOPE, [record.id])
    expect(drainReadTraces()).toEqual([])
    await tools['memory.read'].execute({ id: record.id })

    expect(read).toHaveBeenNthCalledWith(2, record.id, {
      budget: 100,
      scope: SCOPE,
      asOfBuild: 42,
    })
    expect(drainReadTraces()).toHaveLength(1)
  })

  it('refuses ids not exposed by this turn, including cap drops and relation targets', async () => {
    const exposed = entry('record-exposed')
    const dropped = entry('record-dropped')
    const relationTarget = asRecordId('record-related-hidden')
    const read = vi.fn<KnowledgeHintReader['read']>((id) => ({
      ...body(id, 'body'),
      relations: [{ kind: 'related', targetId: relationTarget }],
    }))
    const ledger = createRecordLedger({ cap: 1, seedIds: [] })
    const { tools, beginTurn } = factory(
      stubReader({ search: vi.fn(() => [exposed, dropped]), read }),
      { recordLedger: ledger },
    )
    beginTurn(SCOPE)

    await tools['memory.search'].execute({ query: 'checkout' })
    expect(await tools['memory.read'].execute({ id: dropped.id })).toEqual({
      kind: 'not-authorized',
      id: dropped.id,
    })
    expect(read).not.toHaveBeenCalled()

    const exposedResult = await tools['memory.read'].execute({ id: exposed.id })
    expect(exposedResult).toMatchObject({
      kind: 'record',
      record: { relations: [{ targetId: relationTarget }] },
    })
    expect(await tools['memory.read'].execute({ id: relationTarget })).toEqual({
      kind: 'not-authorized',
      id: relationTarget,
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('filters new ids at the record cap, preserves counted entries, and reports the drop', async () => {
    const counted = entry('record-counted', {
      servedAsCanary: true,
      unverified: true,
    })
    const dropped = entry('record-dropped')
    const ledger = createRecordLedger({ cap: 1, seedIds: [counted.id] })
    const { tools } = factory(
      stubReader({ search: vi.fn(() => [counted, dropped]) }),
      { recordLedger: ledger },
    )

    const result = await tools['memory.search'].execute({ query: 'checkout' })

    expect(result).toEqual({
      kind: 'search-results',
      entries: [counted],
      note: {
        kind: 'volume-cap-reached',
        droppedCount: 1,
        message: 'Volume cap reached; 1 result omitted.',
      },
    })
  })

  it('returns structured empty and not-found results instead of throwing', async () => {
    const missingId = asRecordId('record-missing')
    const read = vi.fn(() => undefined) as unknown as KnowledgeHintReader['read']
    const { tools, beginTurn } = factory(stubReader({ search: vi.fn(() => []), read }))
    beginTurn(SCOPE, [missingId])

    expect(tools['memory.search'].execute({ query: 'no match' })).toEqual({
      kind: 'empty-result',
      entries: [],
    })
    expect(tools['memory.read'].execute({ id: missingId })).toEqual({
      kind: 'not-found',
      id: missingId,
    })
  })
})
