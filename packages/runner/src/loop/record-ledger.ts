import type { RecordId } from '@vostride/agent-qa-schema'

export type RecordAdmission =
  | { admitted: true }
  | { admitted: false; reason: 'volume-cap' }

export interface RecordLedger {
  admit(id: RecordId): RecordAdmission
  resetTurn(seedIds: readonly RecordId[]): void
  size(): number
}

function normalizeCap(cap: number): number {
  return Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0
}

/**
 * D-17 turn-time enforcement for the global distinct-record cap. The frozen Channel-1 brief
 * seeds the ledger because those records already ride every planning turn; Channel 2 search/read
 * and Channel 3 cautions share the remaining headroom. D-16 re-emphasis of an already-counted id
 * is free: repeated injections cost tokens, but never consume another distinct-record slot.
 */
export function createRecordLedger(input: {
  cap: number
  seedIds: readonly RecordId[]
}): RecordLedger {
  const cap = normalizeCap(input.cap)
  let admittedIds = new Set<RecordId>(input.seedIds)

  return {
    admit(id) {
      if (admittedIds.has(id)) return { admitted: true }
      if (admittedIds.size >= cap) return { admitted: false, reason: 'volume-cap' }
      admittedIds.add(id)
      return { admitted: true }
    },
    resetTurn(seedIds) {
      admittedIds = new Set(seedIds)
    },
    size() {
      return admittedIds.size
    },
  }
}
