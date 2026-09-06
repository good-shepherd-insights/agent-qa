import type { GateReceipt, RecordId } from '@vostride/agent-qa-schema'

/**
 * 2026-09-06, 416 D-10: replayGateAvailable is true iff a host composition bound this port.
 * Phase 416 binds nothing; Phase 417 binds runReplayGate.
 */
export interface ReplayGatePort {
  runReplayGate(candidateId: RecordId): Promise<GateReceipt>
}
