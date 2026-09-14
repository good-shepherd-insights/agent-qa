import {
  canonicalJson, CURATION_BUCKET_PRECEDENCE, CurationSnapshotSchema,
  CurationSnapshotChangeSchema, survivingOutcomeEvents,
  type CurationSnapshot, type CurationSnapshotChange, type CurationSnapshotRow,
} from '@vostride/agent-qa-schema'
import { enumerateMaintenanceBundleDirs, loadMaintenanceBundle } from '../maintenance-scan.js'
import { listCurationEffectReceipts } from '../journal/curation-effect-receipt.js'
import { diffSince } from '../diff-since.js'

export interface ReadCurationEffectsOptions {
  knowledgeRoot: string
  sourceRunId: string
  observationIds?: readonly string[]
}

/** Read only successful, surviving effects; current status is never classification authority. */
export function readCurationEffects(options: ReadCurationEffectsOptions): CurationSnapshotChange[] {
  const receipts = listCurationEffectReceipts(options.knowledgeRoot)
    .filter(row => row.sourceRunId === options.sourceRunId)
  const bundles = enumerateMaintenanceBundleDirs(options.knowledgeRoot).map(entry => ({
    product: entry.product, bundle: loadMaintenanceBundle(entry),
  }))
  const effects: CurationSnapshotChange[] = []
  for (const receipt of receipts) {
    const found = bundles.find(({ product, bundle }) => product === receipt.product
      && bundle.manifest.id === receipt.recordId)
    if (found === undefined) continue
    const surviving = survivingOutcomeEvents(found.bundle.events).some(event =>
      event.curationJobId === receipt.candidateId
      && event.evidenceToken === receipt.evidenceToken
      && event.buildOrdinal === receipt.atOrdinal
      && event.type === (receipt.change === 'added' ? 'confirmed' : receipt.change)
      && (receipt.byRecordId === undefined || (event.type === 'superseded'
        && event.byRecordId === receipt.byRecordId)),
    )
    if (!surviving) continue
    const bucket = receipt.disposition === 'downgraded' ? 'proposed' : receipt.change
    effects.push(CurationSnapshotChangeSchema.parse({ bucket, change: {
      schemaVersion: 1, recordId: receipt.recordId, change: receipt.change,
      atOrdinal: receipt.atOrdinal, evidenceToken: receipt.evidenceToken,
      sourceRunId: receipt.sourceRunId, observationId: receipt.observationId,
      ...(receipt.byRecordId === undefined ? {} : { byRecordId: receipt.byRecordId }),
    } }))
  }
  // The maintenance fold already applies canonical replay/retraction identities and
  // promotion receipt attribution. Never infer a curation Add/Confirm from bundle shape.
  const observations = new Set(options.observationIds ?? [])
  for (const change of diffSince({ knowledgeRoot: options.knowledgeRoot, sinceOrdinal: 0 })) {
    const canary = change.observationId !== undefined && observations.has(change.observationId)
    if ((change.change === 'confirmed' && canary)
      || (change.change === 'promoted' && (canary || change.sourceRunId === options.sourceRunId))) {
      // The caller's emitted observation identities attribute this event to the run,
      // even when the affected bundle originated in an older run.
      effects.push(CurationSnapshotChangeSchema.parse({ bucket: 'confirmed', change: {
        ...change, ...(canary ? { sourceRunId: options.sourceRunId } : {}),
      } }))
    }
  }
  return effects
}

/** One affected record, strongest classification, with all historical identities retained. */
export function foldCurationSnapshot(effects: readonly CurationSnapshotChange[]): CurationSnapshot {
  const identities = new Map<string, CurationSnapshotChange>()
  for (const value of effects) {
    const entry = CurationSnapshotChangeSchema.parse(value)
    const key = canonicalJson(entry.change)
    const previous = identities.get(key)
    if (previous !== undefined && previous.bucket !== entry.bucket) {
      throw new TypeError('conflicting curation classification')
    }
    identities.set(key, entry)
  }
  const groups = new Map<string, CurationSnapshotChange[]>()
  for (const [, entry] of [...identities].sort(([a], [b]) => a.localeCompare(b))) {
    const group = groups.get(entry.change.recordId) ?? []
    group.push(entry)
    groups.set(entry.change.recordId, group)
  }
  const rows: CurationSnapshotRow[] = [...groups].map(([recordId, changes]) => {
    const bucket = CURATION_BUCKET_PRECEDENCE.find(value => changes.some(e => e.bucket === value))!
    const latest = changes.filter(e => e.bucket === 'superseded')
      .sort((a, b) => b.change.atOrdinal - a.change.atOrdinal)[0]
    return { recordId, bucket, changes,
      ...(latest === undefined ? {} : { byRecordId: latest.change.byRecordId }) }
  })
  for (const row of rows) {
    for (const entry of [...row.changes]) {
      if (entry.bucket !== 'superseded') continue
      const replacement = rows.find(r => r.recordId === entry.change.byRecordId)
      if (replacement === undefined) continue
      // Suppress only Add membership. A separately recorded confirmation remains
      // its own affected unit; never invent it from replay or a diagnostic counter.
      const adds = replacement.changes.filter(e => e.bucket === 'added' && e.change.recordId === replacement.recordId)
      for (const added of adds) {
        if (!row.changes.some(e => canonicalJson(e.change) === canonicalJson(added.change))) row.changes.push(added)
      }
      replacement.changes = replacement.changes.filter(e => !adds.includes(e))
    }
  }
  const retained = rows.filter(row => row.changes.length > 0)
  for (const row of retained) {
    row.bucket = CURATION_BUCKET_PRECEDENCE.find(bucket => row.changes.some(entry =>
      entry.change.recordId === row.recordId && entry.bucket === bucket))!
  }
  const breakdown = { added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 }
  for (const row of retained) breakdown[row.bucket]++
  return CurationSnapshotSchema.parse({ schemaVersion: 1, rows: retained, breakdown })
}
