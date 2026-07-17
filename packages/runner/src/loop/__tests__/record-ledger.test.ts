import { describe, expect, it } from 'vitest'
import { asRecordId } from '@vostride/agent-qa-schema'
import { createRecordLedger } from '../record-ledger.js'

describe('createRecordLedger — per-turn distinct-record cap (D-16/D-17)', () => {
  it('admits at cap - 1, refuses a new id at cap, and re-admits a counted id for free', () => {
    const first = asRecordId('record-first')
    const second = asRecordId('record-second')
    const third = asRecordId('record-third')
    const overflow = asRecordId('record-overflow')
    const ledger = createRecordLedger({ cap: 3, seedIds: [first, second] })

    expect(ledger.size()).toBe(2)
    expect(ledger.admit(third)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(3)
    expect(ledger.admit(overflow)).toEqual({ admitted: false, reason: 'volume-cap' })
    expect(ledger.admit(first)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(3)
  })

  it('resets each turn to the frozen brief seed instead of prior-turn accumulation', () => {
    const briefId = asRecordId('record-brief')
    const firstTurnOnly = asRecordId('record-first-turn-only')
    const secondTurnOnly = asRecordId('record-second-turn-only')
    const ledger = createRecordLedger({ cap: 2, seedIds: [briefId] })

    expect(ledger.admit(firstTurnOnly)).toEqual({ admitted: true })
    expect(ledger.size()).toBe(2)

    ledger.resetTurn([briefId])

    expect(ledger.size()).toBe(1)
    expect(ledger.admit(secondTurnOnly)).toEqual({ admitted: true })
    expect(ledger.admit(firstTurnOnly)).toEqual({ admitted: false, reason: 'volume-cap' })
  })

  it('starts empty when the brief has no learned record ids', () => {
    const ledger = createRecordLedger({ cap: 2, seedIds: [] })

    expect(ledger.size()).toBe(0)
    expect(ledger.admit(asRecordId('record-one'))).toEqual({ admitted: true })
    expect(ledger.admit(asRecordId('record-two'))).toEqual({ admitted: true })
    expect(ledger.admit(asRecordId('record-three'))).toEqual({
      admitted: false,
      reason: 'volume-cap',
    })
  })
})
