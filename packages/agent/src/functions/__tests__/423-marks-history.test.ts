// 2026-09-15, 423 D-19: ordinal mark history over a read-only feedback port.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { MarkReceiptSchema, RunsMarksHistoryResultSchema, asRunId, maskedMarker } from '@vostride/agent-qa-schema'
import type { FunctionCaller, MarkProposalCurrent, MarkReceipt, RunId } from '@vostride/agent-qa-schema'
import { invokeFunction } from '../invoke.js'
import { runsMarksHistorySpec } from '../ops/runs-marks-history.js'
import { createRegistryFromSpecs } from '../registry.js'
import * as spec from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

const historySpec = () => runsMarksHistorySpec
const resultSchema = () => RunsMarksHistoryResultSchema

const runId = asRunId('run-423-marks-history')
type Address = { testIndex: number; stepIndex?: number; testId?: string }
type ProposalState = MarkProposalCurrent
type ReadEntry = { receipt: MarkReceipt; proposal?: ProposalState }

const markIdOf = (ordinal: number) => `mark_${ordinal.toString(16).padStart(12, '0')}`

function receipt(ordinal: number, address: Address, overrides: Partial<MarkReceipt> = {}): MarkReceipt {
  return MarkReceiptSchema.parse({
    schemaVersion: 1, markId: markIdOf(ordinal), runId, runSlug: 'run-423-marks-history',
    testIndex: address.testIndex,
    ...(address.testId === undefined ? {} : { testId: address.testId }),
    ...(address.stepIndex === undefined ? {} : { stepIndex: address.stepIndex }),
    kind: 'false-fail', origin: 'user', ordinal,
    // Deliberately descending: ordinal, never markedAt, governs latest-wins (419 D-11).
    markedAt: 10_000 - ordinal * 10,
    disposition: { kind: 'quarantined', class: 'flake' }, gold: [], evidence: { confirmed: 0, overturned: 0 },
    ...overrides,
  })
}

const WITHDRAWN: ProposalState = { state: 'rejected', decision: { decision: 'rejected', at: 42, reason: `superseded by ${markIdOf(3)}` } }
const PENDING: ProposalState = { state: 'pending', applyInFlight: false }
const MISSING: ProposalState = { state: 'missing' }

// Sequence A: run0, step 0:2, run0, run1, step 0:2, run0. Writer-shaped `supersedes` links.
function sequenceA(): ReadEntry[] {
  return [
    { receipt: receipt(1, { testIndex: 0 }, { note: 'first run-level mark',
      disposition: { kind: 'drafted', fix: 'fact', proposalId: 'proposal-a1', proposalKind: 'knowledge' } }), proposal: WITHDRAWN },
    { receipt: receipt(2, { testIndex: 0, stepIndex: 2 }, { kind: 'false-pass', correctedExpectation: 'the banner reads saved',
      disposition: { kind: 'no-draftable-fix', checked: { servedRecords: 1, procedureReads: 0, assertionDrift: true } } }) },
    { receipt: receipt(3, { testIndex: 0 }, { kind: 'confirmed-bug', supersedes: markIdOf(1),
      rootCause: { class: 'app_bug', producer: 'verifier' }, isRerun: true,
      disposition: { kind: 'confirmed-bug', confirmedRecords: 2 },
      gold: [{ cassetteId: 'cassette-3', sourceCassetteId: 'source-3', channel: 'user-mark' }],
      evidence: { confirmed: 2, overturned: 0 } }) },
    { receipt: receipt(4, { testIndex: 1, testId: 'checkout' }, { kind: 'false-fail',
      disposition: { kind: 'drafted', fix: 'test-edit', proposalId: 'proposal-a4', proposalKind: 'test-draft' } }), proposal: PENDING },
    { receipt: receipt(5, { testIndex: 0, stepIndex: 2 }, { supersedes: markIdOf(2),
      correctedAction: { type: 'navigate', to: 'url', url: 'https://example.test/cart' } as MarkReceipt['correctedAction'],
      evidence: { confirmed: 0, overturned: 1 } }) },
    { receipt: receipt(6, { testIndex: 0 }, { supersedes: markIdOf(3), note: 'latest run-level mark',
      disposition: { kind: 'drafted', fix: 'caution', proposalId: 'proposal-a6', proposalKind: 'knowledge' } }), proposal: MISSING },
  ]
}

// Sequence B: step 1:0, run1, run0, run1 under another testId, step 1:0. No `supersedes` links at all.
function sequenceB(): ReadEntry[] {
  return [
    { receipt: receipt(1, { testIndex: 1, stepIndex: 0 }) },
    { receipt: receipt(2, { testIndex: 1 }, { kind: 'false-pass' }) },
    { receipt: receipt(3, { testIndex: 0 }, { kind: 'confirmed-bug', disposition: { kind: 'confirmed-bug', confirmedRecords: 0 } }) },
    { receipt: receipt(4, { testIndex: 1, testId: 'renamed-member' }) },
    { receipt: receipt(5, { testIndex: 1, stepIndex: 0 }, { note: 'second step mark' }) },
  ]
}

// Hand-spelled oracles, independent of any implementation rule.
const EXPECTED = {
  A: { active: [4, 5, 6], supersededBy: { 1: 3, 2: 5, 3: 6 } as Record<number, number> },
  B: { active: [3, 4, 5], supersededBy: { 1: 5, 2: 4 } as Record<number, number> },
}
const SEQUENCES = { A: sequenceA, B: sequenceB } as const

function port(read: unknown) {
  return { history: vi.fn(async (_runId: RunId) => read) }
}

function deps(feedbackReads?: ReturnType<typeof port>) {
  const forbidden = vi.fn(() => { throw new Error('history must not touch runs, config or the mark writer') })
  return {
    forbidden,
    deps: {
      runs: { list: forbidden, get: forbidden, readEvents: forbidden, readStepEvidence: forbidden },
      knowledge: { listBundles: forbidden, inspectRecords: forbidden, diffSince: forbidden, showRecord: forbidden },
      entities: { resolve: forbidden, get: forbidden },
      config: { getMasked: forbidden },
      feedback: { mark: forbidden, marksFor: forbidden },
      ...(feedbackReads === undefined ? {} : { feedbackReads }),
    } as unknown as FunctionDeps,
  }
}

async function read(entries: readonly ReadEntry[]) {
  const reads = port({ kind: 'history', entries })
  const { deps: bound, forbidden } = deps(reads)
  const result = await historySpec().invoke({ runId }, bound)
  expect(forbidden).not.toHaveBeenCalled()
  expect(reads.history).toHaveBeenCalledWith(runId)
  return result as unknown as { kind: string; runId: RunId; entries: Record<string, unknown>[] }
}

function expectedFacts(value: MarkReceipt): Record<string, unknown> {
  const { schemaVersion: _version, runSlug: _slug, correctedExpectation, correctedAction, ...facts } = value
  return { ...facts, corrected: { expectation: correctedExpectation !== undefined, action: correctedAction !== undefined } }
}

beforeEach(() => setActiveMaskingContextResolver(() => createMaskingContext()))
afterEach(() => setActiveMaskingContextResolver(() => undefined))

describe('423-36 runs.marks.history contract (D-19)', () => {
  it.each(['A', 'B'] as const)('HISTORY-ORDINAL: sequence %s returns every receipt fact in ledger ordinal order', async name => {
    const entries = SEQUENCES[name]()
    const result = await read(entries)
    expect(resultSchema().parse(result)).toEqual(result)
    expect(result.kind).toBe('history')
    expect(result.runId).toBe(runId)
    expect(result.entries.map(entry => entry.ordinal)).toEqual(entries.map((_, index) => index + 1))
    result.entries.forEach((entry, index) => {
      const source = entries[index]!
      expect(entry).toMatchObject(expectedFacts(source.receipt))
      // Corrected fields are presence only, and absent optional facts stay absent keys, never null.
      expect(Object.keys(entry)).not.toContain('correctedExpectation')
      expect(Object.keys(entry)).not.toContain('correctedAction')
      expect(Object.values(entry)).not.toContain(null)
      expect(Object.values(entry)).not.toContain(undefined)
      if (source.receipt.note === undefined) expect(Object.keys(entry)).not.toContain('note')
      if (source.receipt.stepIndex === undefined) expect(Object.keys(entry)).not.toContain('stepIndex')
    })
  })

  it('HISTORY-ORDINAL: a port read out of ordinal order or for another run is a corrupt ledger, never re-sorted', async () => {
    const [first, second, third] = sequenceB()
    const swapped = await read([first!, third!, second!])
    expect(swapped).toEqual({ kind: 'ledger-corrupt', runId, line: 2 })
    const foreign = { receipt: { ...second!.receipt, runId: asRunId('run-423-other') } }
    expect(await read([first!, foreign])).toEqual({ kind: 'ledger-corrupt', runId, line: 2 })
  })

  it.each(['A', 'B'] as const)('ACTIVE-ADDRESS: sequence %s marks only the highest ordinal per member/step address active', async name => {
    const result = await read(SEQUENCES[name]())
    const active = result.entries.filter(entry => entry.active === true).map(entry => entry.ordinal)
    expect(active).toEqual(EXPECTED[name].active)
    expect(result.entries.every(entry => typeof entry.active === 'boolean')).toBe(true)
  })

  it.each(['A', 'B'] as const)('SUPERSEDED-BY: sequence %s links each superseded receipt to the next mark on its address', async name => {
    const result = await read(SEQUENCES[name]())
    const links = Object.fromEntries(result.entries
      .filter(entry => 'supersededBy' in entry)
      .map(entry => [entry.ordinal, entry.supersededBy]))
    expect(links).toEqual(Object.fromEntries(Object.entries(EXPECTED[name].supersededBy)
      .map(([ordinal, next]) => [ordinal, markIdOf(next)])))
    for (const entry of result.entries) expect(entry.active).toBe(!('supersededBy' in entry))
  })

  it('SUPERSEDED-BY: drafted receipts carry the current proposal state beside their historical disposition', async () => {
    const result = await read(sequenceA())
    const byOrdinal = new Map(result.entries.map(entry => [entry.ordinal, entry]))
    expect(byOrdinal.get(1)).toMatchObject({ disposition: { kind: 'drafted', proposalId: 'proposal-a1' }, proposal: WITHDRAWN })
    expect(byOrdinal.get(4)).toMatchObject({ disposition: { kind: 'drafted', proposalId: 'proposal-a4' }, proposal: PENDING })
    expect(byOrdinal.get(6)).toMatchObject({ disposition: { kind: 'drafted', proposalId: 'proposal-a6' }, proposal: MISSING })
    for (const ordinal of [2, 3, 5]) expect(Object.keys(byOrdinal.get(ordinal)!)).not.toContain('proposal')
    // A drafted receipt with no joined state, or a joined state on a non-drafted receipt, is refused.
    const [, second, third] = sequenceA()
    const unjoined = { receipt: receipt(1, { testIndex: 0 }, {
      disposition: { kind: 'drafted', fix: 'fact', proposalId: 'proposal-x', proposalKind: 'knowledge' } }) }
    await expect(read([unjoined])).rejects.toThrow()
    await expect(read([{ receipt: receipt(1, { testIndex: 0 }), proposal: PENDING }, second!, third!])).rejects.toThrow()
  })

  it('HISTORY-EMPTY: an unmarked run answers an empty history, distinct from a missing run', async () => {
    const result = await read([])
    expect(result).toEqual({ kind: 'history', runId, entries: [] })
    expect(resultSchema().parse(result)).toEqual(result)
    expect(historySpec().classify(RunsMarksHistoryResultSchema.parse(result))).toEqual({ status: 'executed', outcome: 'history: 0 marks' })
  })

  it('HISTORY-ERRORS: no-run, corrupt and unavailable ledgers are typed arms; an absent port is unbound', async () => {
    const cases = [
      [{ kind: 'run-not-found' }, { kind: 'run-not-found', runId }, 'refused'],
      [{ kind: 'ledger-corrupt', line: 3 }, { kind: 'ledger-corrupt', runId, line: 3 }, 'failed'],
      [{ kind: 'ledger-unavailable' }, { kind: 'ledger-unavailable', runId }, 'failed'],
    ] as const
    for (const [answer, expected, status] of cases) {
      const { deps: bound } = deps(port(answer))
      const result = await historySpec().invoke({ runId }, bound)
      expect(result).toEqual(expected)
      expect(resultSchema().parse(result)).toEqual(expected)
      expect(historySpec().classify(result).status).toBe(status)
    }
    const { deps: unbound } = deps()
    await expect(historySpec().invoke({ runId }, unbound)).rejects.toBeInstanceOf(spec.FunctionNotBoundError)
  })

  it('HISTORY-READ-TIER: read scope, read-only risk and a feedbackReads binding separate from the mark writer', async () => {
    const op = historySpec()
    expect(op.id).toBe('runs.marks.history')
    expect(op.requiredScopes).toEqual(['read'])
    expect(op.resultKind).toBe('unary')
    expect(op.risk).toEqual({ name: 'fn:runs.marks.history', recognized: true, readOnly: true })
    expect(op.requiresHumanOrigin).toBeUndefined()
    expect(op.boundThrough).toBe('feedbackReads')
    expect(spec.OPTIONAL_FUNCTION_DEP_KEYS).toContain('feedbackReads')
    expect(spec.OPTIONAL_FUNCTION_DEP_KEYS).toContain('feedback')

    const reads = port({ kind: 'history', entries: sequenceB() })
    const { deps: bound, forbidden } = deps(reads)
    const options = { deps: bound, resolveExecutionContext: () => 'local-headless' as const,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} } }
    const caller: FunctionCaller = { surface: 'mcp', grantedScopes: ['read'], safeMode: true, origin: 'agent' }
    const registry = createRegistryFromSpecs([{ ...op } as FunctionSpec], options)
    expect(registry.list(caller).find(entry => entry.id === 'runs.marks.history')?.bindingStatus).toBe('bound')
    const result = await invokeFunction(registry, 'runs.marks.history', { runId }, caller) as { entries: unknown[] }
    expect(result.entries).toHaveLength(5)
    expect(forbidden).not.toHaveBeenCalled()

    const unbound = createRegistryFromSpecs([{ ...op } as FunctionSpec], { ...options, deps: deps().deps })
    expect(unbound.list(caller).find(entry => entry.id === 'runs.marks.history')?.bindingStatus).toBe('unbound')
    await expect(invokeFunction(unbound, 'runs.marks.history', { runId }, caller)).rejects.toBeInstanceOf(spec.FunctionNotBoundError)
  })

  it('HISTORY-MASK: note, root-cause producer and proposal decision reason cross the live mask; identities do not', async () => {
    const masking = createMaskingContext()
    masking.register('synthetic-sensitive-token')
    setActiveMaskingContextResolver(() => masking)
    const secret = 'synthetic-sensitive-token'
    const entries: ReadEntry[] = [
      { receipt: receipt(1, { testIndex: 0, testId: 'member-a' }, { note: `note ${secret}`,
        rootCause: { class: 'app_bug', producer: `producer ${secret}` },
        disposition: { kind: 'drafted', fix: 'fact', proposalId: 'proposal-m1', proposalKind: 'knowledge' } }),
      proposal: { state: 'rejected', decision: { decision: 'rejected', at: 7, reason: `withdrawn ${secret}` } } },
    ]
    const result = await read(entries)
    const [entry] = result.entries
    expect(entry).toMatchObject({
      markId: markIdOf(1), testId: 'member-a', note: masking.mask(`note ${secret}`),
      rootCause: { class: 'app_bug', producer: masking.mask(`producer ${secret}`) },
      disposition: { proposalId: 'proposal-m1' },
      proposal: { state: 'rejected', decision: { reason: masking.mask(`withdrawn ${secret}`) } },
    })
    expect(JSON.stringify(result)).not.toContain(secret)

    setActiveMaskingContextResolver(() => undefined)
    const unmaskable = await read(entries)
    expect(unmaskable.entries[0]).toMatchObject({ markId: markIdOf(1), note: maskedMarker('secret'),
      rootCause: { producer: maskedMarker('secret') }, proposal: { decision: { reason: maskedMarker('secret') } } })
  })
})
