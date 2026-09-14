import type { EvidenceDocument, MaskFn } from '@vostride/agent-qa-schema'
import type { NetworkLogEntry } from '../result.js'

/** Project the adapter's drained records into the persisted network document. */
export function projectNetworkEvidence(
  records: readonly NetworkLogEntry[],
  _mask: MaskFn,
): Extract<EvidenceDocument, { kind: 'network' }> {
  return { schemaVersion: 1, kind: 'network', records: records.map(record => ({ ...record })) }
}
