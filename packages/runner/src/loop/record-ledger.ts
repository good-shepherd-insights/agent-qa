import {
  createServingAdmissionState,
  inspectServingRecord,
  tryAdmitServingRecord,
  type ServingAdmissionDecision,
  type ServingRecordMetadata,
} from '@vostride/agent-qa-schema'

export type RecordAdmission = ServingAdmissionDecision

export interface RecordLedger {
  /** Preview without mutation so channel-local and combined-turn checks can commit atomically. */
  inspect(record: ServingRecordMetadata): RecordAdmission
  admit(record: ServingRecordMetadata): RecordAdmission
  resetTurn(seedRecords: readonly ServingRecordMetadata[]): void
  size(): number
  spent(): number
}

function normalizeLimit(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/**
 * One turn-time authority for the global distinct-record and combined dominance walls. Channel 1
 * seeds exact rendered material; Channel 3 and Channel 2 then charge every exposure against the
 * same source/cluster maps. Re-emphasizing an id remains free only for the DISTINCT slot — its
 * repeated bytes still count toward budget and dominance.
 */
export function createRecordLedger(input: {
  cap: number
  budget: number
  seedRecords: readonly ServingRecordMetadata[]
}): RecordLedger {
  const cap = normalizeLimit(input.cap)
  const budget = normalizeLimit(input.budget)
  let admission = createServingAdmissionState(input.seedRecords)

  const admissionInput = (record: ServingRecordMetadata) => ({
    record,
    budget,
    recordCap: cap,
    chargeRepeated: true,
  }) as const

  return {
    inspect(record) {
      return inspectServingRecord(admissionInput(record), admission)
    },
    admit(record) {
      return tryAdmitServingRecord(admissionInput(record), admission)
    },
    resetTurn(seedRecords) {
      admission = createServingAdmissionState(seedRecords)
    },
    size() {
      return admission.selectedCount
    },
    spent() {
      return admission.usedBudget
    },
  }
}
