import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  RECORD_CHANGE_SCHEMA_VERSION,
  RecordChangeSchema,
  survivingOutcomeEvents,
} from '@vostride/agent-qa-schema'
import type {
  BundleOutcomeEvent,
  RecordChange,
} from '@vostride/agent-qa-schema'

import { loadBundle, verifyBundleIntegrity } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import { guardPurgeReceipt } from './purge-receipt.js'

export interface DiffSinceOptions {
  knowledgeRoot: string
  sinceOrdinal: number
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function directChange(
  recordId: string,
  event: BundleOutcomeEvent,
): RecordChange | undefined {
  switch (event.type) {
    case 'confirmed':
    case 'deprecated':
    case 'promoted':
      return RecordChangeSchema.parse({
        schemaVersion: RECORD_CHANGE_SCHEMA_VERSION,
        recordId,
        change: event.type,
        atOrdinal: event.buildOrdinal,
        evidenceToken: event.evidenceToken,
      })
    case 'superseded':
      return RecordChangeSchema.parse({
        schemaVersion: RECORD_CHANGE_SCHEMA_VERSION,
        recordId,
        change: event.type,
        atOrdinal: event.buildOrdinal,
        evidenceToken: event.evidenceToken,
        byRecordId: event.byRecordId,
      })
    default:
      return undefined
  }
}

function purgeChanges(knowledgeRoot: string, sinceOrdinal: number): RecordChange[] {
  const receiptsDir = join(knowledgeRoot, 'memory', 'receipts')
  let files: string[]
  try {
    files = readdirSync(receiptsDir, { withFileTypes: true })
      .filter((entry) => (
        entry.isFile()
        && entry.name.startsWith('purge-')
        && entry.name.endsWith('.json')
        && !entry.name.endsWith('.intent.json')
      ))
      .map((entry) => entry.name)
      .sort(compareText)
  } catch {
    return []
  }

  const changes: RecordChange[] = []
  for (const file of files) {
    try {
      const receipt = guardPurgeReceipt(
        JSON.parse(readFileSync(join(receiptsDir, file), 'utf8')),
      )
      if (receipt.purgedAtOrdinal <= sinceOrdinal) continue
      changes.push(RecordChangeSchema.parse({
        schemaVersion: RECORD_CHANGE_SCHEMA_VERSION,
        recordId: receipt.purgedRecordId,
        change: 'purged',
        atOrdinal: receipt.purgedAtOrdinal,
      }))
    } catch {
      // A malformed or foreign purge-prefixed file is not canonical receipt truth.
    }
  }
  return changes
}

/** Pure build-ordinal fold over committed bundle outcomes and content-free purge receipts. */
export function diffSince(options: DiffSinceOptions): RecordChange[] {
  if (!Number.isInteger(options.sinceOrdinal) || options.sinceOrdinal < 0) {
    throw new TypeError('sinceOrdinal must be a non-negative integer')
  }

  const changes: RecordChange[] = []
  for (const entry of enumerateBundleDirs(options.knowledgeRoot)) {
    const loaded = loadBundle(entry.dir)
    if (loaded.kind !== 'loaded' || !verifyBundleIntegrity(entry.dir).ok) continue

    const { bundle } = loaded
    const survivingEvents = survivingOutcomeEvents(bundle.events)
    const earliestOrdinal = survivingEvents.reduce(
      (earliest, event) => Math.min(earliest, event.buildOrdinal),
      bundle.manifest.createdAtOrdinal,
    )
    if (earliestOrdinal > options.sinceOrdinal) {
      changes.push(RecordChangeSchema.parse({
        schemaVersion: RECORD_CHANGE_SCHEMA_VERSION,
        recordId: bundle.manifest.id,
        change: 'added',
        atOrdinal: earliestOrdinal,
      }))
      continue
    }

    for (const event of survivingEvents) {
      if (event.buildOrdinal <= options.sinceOrdinal) continue
      const change = directChange(bundle.manifest.id, event)
      if (change !== undefined) changes.push(change)
    }
  }

  changes.push(...purgeChanges(options.knowledgeRoot, options.sinceOrdinal))
  return changes.sort((left, right) => (
    compareText(left.recordId, right.recordId)
    || left.atOrdinal - right.atOrdinal
    || compareText(left.change, right.change)
    || compareText(left.evidenceToken ?? '', right.evidenceToken ?? '')
    || compareText(left.byRecordId ?? '', right.byRecordId ?? '')
  ))
}
