import {
  KnowledgeRecordShowResultSchema,
  type KnowledgeRecordShowResult,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust } from './bundle-read.js'
import { toInspectRecordView } from './inspect.js'
import { enumerateMaintenanceBundleDirs, loadMaintenanceBundle } from './maintenance-scan.js'

export interface ShowRecordsOptions {
  knowledgeRoot: string
  recordIds: readonly string[]
}

/**
 * Resolve exact identities in first-request order with one maintenance enumeration.
 * Missing records are data; incomplete scans retain KnowledgeMaintenanceScanError so
 * callers can report scanIncomplete instead of presenting a partial set as clean misses.
 * Like the single-record read, this bypasses serving filters and never opens an index.
 */
export function showRecords(options: ShowRecordsOptions): readonly KnowledgeRecordShowResult[] {
  const recordIds = [...new Set(options.recordIds)]
  if (recordIds.length === 0) return []
  const pending = new Set(recordIds)
  const found = new Map<string, KnowledgeRecordShowResult>()

  for (const entry of enumerateMaintenanceBundleDirs(options.knowledgeRoot)) {
    const bundle = loadMaintenanceBundle(entry)
    if (!pending.has(bundle.manifest.id)) continue
    found.set(bundle.manifest.id, KnowledgeRecordShowResultSchema.parse({
      kind: 'found',
      schemaVersion: 1,
      record: toInspectRecordView(entry, bundle, deriveBundleTrust(bundle)),
      provenance: bundle.provenance,
      summary: bundle.summary,
      body: bundle.body,
    }))
    pending.delete(bundle.manifest.id)
    // Preserve the single-record read's first matching bundle and error boundary.
    if (pending.size === 0) break
  }

  return recordIds.map(recordId => found.get(recordId) ?? KnowledgeRecordShowResultSchema.parse({
    kind: 'not-found',
    schemaVersion: 1,
    recordId,
  }))
}
