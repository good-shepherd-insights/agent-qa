import {
  createServingAdmissionState,
  inspectServingRecord,
  tryAdmitServingRecord,
  type ServedAdmissionEvent,
  type ServedAdmissionSurface,
  type ServingAdmissionDecision,
  type ServingRecordMetadata,
} from '@vostride/agent-qa-schema'

export type RecordAdmission = ServingAdmissionDecision
export type ServingExposureSurface = ServedAdmissionSurface

export interface ServingExposure {
  readonly surface: ServingExposureSurface
  readonly turnOrdinal: number
}

export interface RecordLedger {
  /** Preview without mutation so channel-local and combined-turn checks can commit atomically. */
  inspect(record: ServingRecordMetadata): RecordAdmission
  admit(record: ServingRecordMetadata, exposure?: ServingExposure): RecordAdmission
  resetTurn(
    seedRecords: readonly ServingRecordMetadata[],
    exposure?: ServingExposure,
  ): void
  /** Optional-compatible evidence seam; production ledgers provide both methods. */
  beginStepEvidence?(): void
  drainEvidenceEvents?(): ServedAdmissionEvent[]
  size(): number
  spent(): number
}

export interface ProductionRecordLedger extends RecordLedger {
  beginStepEvidence(): void
  drainEvidenceEvents(): ServedAdmissionEvent[]
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
}): ProductionRecordLedger {
  const cap = normalizeLimit(input.cap)
  const budget = normalizeLimit(input.budget)
  let admission = createServingAdmissionState(input.seedRecords)
  let evidenceEvents: ServedAdmissionEvent[] = []
  let nextEvidenceOrdinal = 0

  const admissionInput = (record: ServingRecordMetadata) => ({
    record,
    budget,
    recordCap: cap,
    chargeRepeated: true,
  }) as const

  const recordEvidenceEvent = (
    record: ServingRecordMetadata,
    exposure: ServingExposure | undefined,
    chargeRepeated: boolean,
  ): void => {
    if (exposure === undefined) return
    evidenceEvents.push({
      ordinal: nextEvidenceOrdinal,
      turnOrdinal: exposure.turnOrdinal,
      surface: exposure.surface,
      id: record.id,
      sourceId: record.sourceId,
      clusterKey: record.clusterKey,
      renderedCost: record.renderedCost,
      chargeRepeated,
    })
    nextEvidenceOrdinal += 1
  }

  return {
    inspect(record) {
      return inspectServingRecord(admissionInput(record), admission)
    },
    admit(record, exposure) {
      const decision = tryAdmitServingRecord(admissionInput(record), admission)
      if (decision.admitted) recordEvidenceEvent(record, exposure, true)
      return decision
    },
    resetTurn(seedRecords, exposure) {
      admission = createServingAdmissionState(seedRecords)
      for (const seed of seedRecords) recordEvidenceEvent(seed, exposure, false)
    },
    beginStepEvidence() {
      evidenceEvents = []
      nextEvidenceOrdinal = 0
    },
    drainEvidenceEvents() {
      const drained = evidenceEvents.map(event => ({ ...event }))
      evidenceEvents = []
      return drained
    },
    size() {
      return admission.selectedCount
    },
    spent() {
      return admission.usedBudget
    },
  }
}
