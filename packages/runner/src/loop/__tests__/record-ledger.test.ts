import { describe, expect, it } from 'vitest'
import { asRecordId, type ServingRecordMetadata } from '@vostride/agent-qa-schema'
import { createRecordLedger } from '../record-ledger.js'

function record(
  id: string,
  overrides: Partial<ServingRecordMetadata> = {},
): ServingRecordMetadata {
  return {
    id: asRecordId(id),
    sourceId: id,
    clusterKey: `cluster:${id}`,
    renderedCost: 1,
    ...overrides,
  }
}

describe('createRecordLedger — combined turn serving authority (D-16/D-17/D-18)', () => {
  it('admits at cap - 1, refuses a new id at cap, and keeps a counted id slot-free', () => {
    const first = record('record-first')
    const second = record('record-second')
    const third = record('record-third')
    const overflow = record('record-overflow')
    const ledger = createRecordLedger({
      cap: 3,
      budget: 100,
      seedRecords: [first, second],
    })

    expect(ledger.size()).toBe(2)
    expect(ledger.admit(third)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(3)
    expect(ledger.admit(overflow)).toEqual({ admitted: false, reason: 'volume-cap' })
    expect(ledger.admit(first)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(3)
  })

  it('resets each turn to the frozen brief metadata instead of prior-turn accumulation', () => {
    const brief = record('record-brief')
    const firstTurnOnly = record('record-first-turn-only')
    const secondTurnOnly = record('record-second-turn-only')
    const ledger = createRecordLedger({ cap: 2, budget: 100, seedRecords: [brief] })

    expect(ledger.admit(firstTurnOnly)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(2)

    ledger.resetTurn([brief])

    expect(ledger.size()).toBe(1)
    expect(ledger.admit(secondTurnOnly)).toEqual({ admitted: true })
    expect(ledger.admit(firstTurnOnly)).toEqual({ admitted: false, reason: 'volume-cap' })
  })

  it('starts empty when the brief has no learned record metadata', () => {
    const ledger = createRecordLedger({ cap: 2, budget: 100, seedRecords: [] })

    expect(ledger.size()).toBe(0)
    expect(ledger.admit(record('record-one'))).toEqual({ admitted: true })
    expect(ledger.admit(record('record-two'))).toEqual({ admitted: true })
    expect(ledger.admit(record('record-three'))).toEqual({
      admitted: false,
      reason: 'volume-cap',
    })
  })

  it('charges one cluster across Channel 1, Channel 3, and Channel 2 at exact half', () => {
    const sharedCluster = 'cluster:checkout-submit'
    const brief = record('brief-record', { clusterKey: sharedCluster, renderedCost: 20 })
    const caution = record('caution-record', { clusterKey: sharedCluster, renderedCost: 20 })
    const searchAtHalf = record('search-record', {
      clusterKey: sharedCluster,
      renderedCost: 20,
    })
    const searchOverHalf = record('search-overflow', {
      clusterKey: sharedCluster,
      renderedCost: 1,
    })
    const ledger = createRecordLedger({ cap: 8, budget: 120, seedRecords: [brief] })

    expect(ledger.admit(caution)).toEqual({ admitted: true })
    expect(ledger.admit(searchAtHalf)).toEqual({ admitted: true })
    expect(ledger.spent()).toBe(60)
    expect(ledger.inspect(searchOverHalf)).toEqual({
      admitted: false,
      reason: 'cluster-dominance',
    })
    expect(ledger.admit(searchOverHalf)).toEqual({
      admitted: false,
      reason: 'cluster-dominance',
    })
    expect(ledger.spent()).toBe(60)
  })

  it('charges repeated cross-channel bytes even when the distinct id is already counted', () => {
    const repeated = record('repeated-record', { renderedCost: 20 })
    const ledger = createRecordLedger({ cap: 1, budget: 80, seedRecords: [repeated] })

    expect(ledger.admit(repeated)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(1)
    expect(ledger.spent()).toBe(40)
    expect(ledger.admit(repeated)).toEqual({
      admitted: false,
      reason: 'source-dominance',
    })
  })
})
