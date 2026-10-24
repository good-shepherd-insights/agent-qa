import type { GateReceipt, RecordId } from '@vostride/agent-qa-schema'

/**
 * 2026-09-06, 416 D-10: replayGateAvailable is true iff a host composition bound this port.
 * Phase 416 binds nothing; Phase 417 binds runReplayGate.
 *
 * 2026-09-11, 422 D-14 — THE ACKNOWLEDGEMENT CONTRACT, stated on the port rather than in the
 * adapter that happens to implement it today.
 *
 * A resolved `runReplayGate` means the returned receipt is DURABLE: the writer capability
 * acknowledged persisting it. It does not mean "a receipt was generated". The distinction is
 * the whole point — a Gate-1 run costs replay work no later run can recover, and a caller that
 * read a generated-but-unwritten receipt as a screening result would report a candidate as
 * screened whose evidence nothing can find afterwards, then refuse to screen it again because
 * its own memory says it already did.
 *
 * So the contract is one-sided on purpose: persistence refusal, a stale writer fence, a lease
 * held by somebody else and a dry run are all REFUSALS, surfaced through this port's existing
 * error path as {@link Gate1ReceiptNotPersistedError}. There is no acknowledgement member on
 * the returned receipt, because a receipt that reached this caller at all is already the
 * acknowledged one and a flag saying so would be a second answer to the same question.
 */
export interface ReplayGatePort {
  runReplayGate(candidateId: RecordId): Promise<GateReceipt>
}

/**
 * The Gate-1 call produced a receipt that the writer did not acknowledge persisting (422 D-14).
 *
 * PROVIDER-NEUTRAL, and it lives here rather than in the CLI adapter for the reason every other
 * port refusal does: the caller that has to tell "screened" from "spent but unrecorded" is the
 * job handler, two packages away from whichever host bound the port, and an adapter-private
 * class would make that distinction reachable only by matching on message text.
 *
 * `recorded` carries the writer's own word for what happened — `dry-run`, `lease-held`,
 * `lease-refused`, or whatever a future writer adds — because a caller deciding whether to
 * retry wants to know WHICH refusal it met, and a boolean would flatten a transient lease
 * contention into the same fact as a deliberate dry run.
 *
 * What this error does NOT carry is the receipt. Handing back the bytes of a receipt nothing
 * stored is exactly the affordance that lets a caller record a screening result the store will
 * never agree with.
 */
export class Gate1ReceiptNotPersistedError extends Error {
  override readonly name = 'Gate1ReceiptNotPersistedError'

  constructor(
    readonly candidateId: string,
    readonly recorded: string,
  ) {
    super(
      `Gate 1 for candidate ${candidateId} produced a receipt the writer did not acknowledge ` +
        `(${recorded}). The replay work was spent and nothing was persisted, so this call ` +
        'establishes no screening result for that candidate.',
    )
  }
}
