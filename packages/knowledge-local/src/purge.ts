/**
 * D-14's one true-delete exemption for confirmed-sensitive material.
 *
 * This library function owns only local store surfaces. It performs no git operation and never
 * attempts to rewrite repository history; Phase 382's sovereign CLI binding leaves that
 * destructive, repository-wide decision with the human operator.
 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import {
  committedFileText,
  createVersionGuard,
  recordGraphNode,
  supersessionKey,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  RecordId,
} from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { checkpointCommittedParts } from './bundle-egress.js'
import { loadBundle } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import { fsyncDirectory, fsyncFile } from './durable-fs.js'
import {
  deleteRecordFromAllSchemaVecTables,
  indexDbPath,
  openIndexWriter,
} from './index-open.js'
import { jobStatePath, queueRoot } from './queue/queue-layout.js'
import { curationCandidatePayloadSchema } from './queue/queue-payload.js'

export const PURGE_RECEIPT_SCHEMA_VERSION = 1

const SAFE_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const receiptRelativePathSchema = z.string().refine((value) => {
  if (value === '' || value.startsWith('/') || value.includes('\\')) return false
  return value
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}, 'expected a knowledge-root-relative committed path')

/**
 * A7 ratification: the receipt is committed because a purge is exactly the event a PR reviewer
 * must see. Its closed strict shape carries only identity, ordinal, caller, and path metadata;
 * bundle prose, anchors, observations, and vectors have no representable field.
 */
export const PurgeReceiptSchema = z.object({
  schemaVersion: z.literal(PURGE_RECEIPT_SCHEMA_VERSION),
  purgedRecordId: z.string().regex(SAFE_RECORD_ID),
  purgedAtOrdinal: z.number().int().nonnegative(),
  initiator: z.string().min(1).refine((value) => value.trim() !== '', 'initiator is required'),
  affectedPaths: z.array(receiptRelativePathSchema).min(1),
  firstCommittedOrdinal: z.number().int().nonnegative(),
}).strict()

/** Lower-camel schema alias follows the existing knowledge-local committed-file convention. */
export const purgeReceiptSchema = PurgeReceiptSchema
export type PurgeReceipt = z.infer<typeof PurgeReceiptSchema>

const guardPurgeReceiptVersion = createVersionGuard<PurgeReceipt>({
  name: 'PurgeReceipt',
  current: PURGE_RECEIPT_SCHEMA_VERSION,
  migrations: {},
})

export function guardPurgeReceipt(value: unknown): PurgeReceipt {
  return PurgeReceiptSchema.parse(guardPurgeReceiptVersion(value))
}

export interface PurgeRecordInput {
  knowledgeRoot: string
  recordId: RecordId
  /** Caller-owned sovereign identity; Phase 382 supplies the confirmed user identity. */
  initiator: string
  /** Optional explicit runtime audit root; omission uses the knowledge root's stable sibling. */
  auditBaseDir?: string
}

export type PurgeRecordOutcome =
  | { kind: 'purged'; receipt: PurgeReceipt }
  | { kind: 'already-purged'; receipt: PurgeReceipt }
  | {
      kind: 'egress-blocked'
      detections: readonly { label: string; detector: string }[]
    }
  | { kind: 'not-found' }

interface ResolvedBundle {
  dir: string
  bundle: LoadedBundle
}

function assertInput(input: PurgeRecordInput): void {
  if (!isAbsolute(input.knowledgeRoot)) {
    throw new TypeError('knowledgeRoot must be absolute')
  }
  if (input.initiator.trim() === '') {
    throw new TypeError('initiator must be a non-empty caller-supplied identity')
  }
  if (!SAFE_RECORD_ID.test(input.recordId)) {
    throw new TypeError('recordId must be a safe path segment')
  }
  if (input.auditBaseDir !== undefined && !isAbsolute(input.auditBaseDir)) {
    throw new TypeError('auditBaseDir must be absolute when supplied')
  }
}

function resolveBundles(knowledgeRoot: string, recordId: RecordId): ResolvedBundle[] {
  const matches: ResolvedBundle[] = []
  for (const entry of enumerateBundleDirs(knowledgeRoot)) {
    const loaded = loadBundle(entry.dir)
    if (loaded.kind !== 'loaded' || loaded.bundle.manifest.id !== recordId) continue
    matches.push({ dir: entry.dir, bundle: loaded.bundle })
  }
  return matches
}

function transaction(operation: () => void, db: ReturnType<typeof openIndexWriter>['db']): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    operation()
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the deletion failure that caused the rollback.
    }
    throw error
  }
}

/** Reuse removeMissingBundles' total five-statement deletion set for one known record. */
function purgeIndexSurfaces(
  knowledgeRoot: string,
  recordId: RecordId,
  kind: LoadedBundle['frontmatter']['kind'],
): void {
  if (!existsSync(indexDbPath(knowledgeRoot))) return

  const writer = openIndexWriter(knowledgeRoot)
  try {
    const row = writer.db
      .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
      .get(recordId)
    const recordNode = recordGraphNode(kind, recordId)

    transaction(() => {
      if (row !== undefined) {
        const recordRowid = Number(row.record_rowid)
        deleteRecordFromAllSchemaVecTables(writer.db, recordRowid)
        writer.db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
        writer.db.prepare('DELETE FROM anchors WHERE record_rowid = ?').run(recordRowid)
        writer.db.prepare(`
          DELETE FROM graph_edges
          WHERE record_rowid = ? OR src_node_id = ? OR dst_node_id = ?
        `).run(recordRowid, recordNode.nodeId, recordNode.nodeId)
        writer.db.prepare('DELETE FROM records WHERE record_rowid = ?').run(recordRowid)
      } else {
        // A stale graph projection can outlive a missing records row; remove both directions.
        writer.db.prepare(`
          DELETE FROM graph_edges
          WHERE src_node_id = ? OR dst_node_id = ?
        `).run(recordNode.nodeId, recordNode.nodeId)
      }

      writer.db.exec(`
        DELETE FROM graph_nodes
        WHERE node_id NOT IN (
          SELECT src_node_id FROM graph_edges
          UNION
          SELECT dst_node_id FROM graph_edges
        )
      `)

      /**
       * RATIFICATION A4 / RESEARCH Pitfall 9: clear the entire cache rather than guessing every
       * historical rendering hash. The table is a pure auto-rebuilt cache; sovereignty over the
       * invertible-vector channel outranks cache warmth.
       */
      const cachePresent = writer.db
        .prepare(`
          SELECT 1
          FROM sqlite_master
          WHERE type = 'table' AND name = 'embed_cache'
        `)
        .get()
      if (cachePresent !== undefined) {
        writer.db.prepare('DELETE FROM embed_cache').run()
      }
    }, writer.db)
  } finally {
    writer.close()
  }
}

function payloadDirectories(root: string): string[] {
  const found: string[] = []

  function visit(dir: string): void {
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'payload.json')) {
      found.push(dir)
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(dir, entry.name))
    }
  }

  visit(root)
  return found.sort()
}

function anchorKeys(anchors: readonly Anchor[]): Set<string> {
  return new Set(
    anchors
      .filter((anchor) => anchor.t !== 'platform')
      .map((anchor) => supersessionKey([anchor])),
  )
}

function intersectsAnchorKeys(
  anchors: readonly Anchor[],
  purgedKeys: ReadonlySet<string>,
): boolean {
  return anchors.some(
    (anchor) => anchor.t !== 'platform' && purgedKeys.has(supersessionKey([anchor])),
  )
}

function removeEmptyQueueParents(candidateDir: string, root: string): void {
  let current = dirname(candidateDir)
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    try {
      rmdirSync(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        current = dirname(current)
        continue
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return
      throw error
    }
    current = dirname(current)
  }
}

function sweepQueuePayloads(knowledgeRoot: string, purgedAnchors: readonly Anchor[]): void {
  const root = queueRoot(knowledgeRoot)
  const purgedKeys = anchorKeys(purgedAnchors)
  for (const candidateDir of payloadDirectories(root)) {
    let payload: unknown
    try {
      payload = JSON.parse(readFileSync(join(candidateDir, 'payload.json'), 'utf8'))
    } catch {
      continue
    }
    const parsed = curationCandidatePayloadSchema.safeParse(payload)
    if (!parsed.success || !intersectsAnchorKeys(parsed.data.anchors, purgedKeys)) continue

    rmSync(candidateDir, { recursive: true, force: true })
    rmSync(jobStatePath(knowledgeRoot, parsed.data.candidateId), { force: true })
    removeEmptyQueueParents(candidateDir, root)
  }
}

function receiptRelativePath(recordId: RecordId): string {
  return `memory/receipts/purge-${recordId}.json`
}

function receiptPath(knowledgeRoot: string, recordId: RecordId): string {
  return join(knowledgeRoot, receiptRelativePath(recordId))
}

function readExistingReceipt(knowledgeRoot: string, recordId: RecordId): PurgeReceipt | undefined {
  const file = receiptPath(knowledgeRoot, recordId)
  if (!existsSync(file)) return undefined
  return guardPurgeReceipt(JSON.parse(readFileSync(file, 'utf8')))
}

function toReceiptPath(knowledgeRoot: string, absolutePath: string): string {
  return relative(knowledgeRoot, absolutePath).split(sep).join('/')
}

function affectedPaths(knowledgeRoot: string, matches: readonly ResolvedBundle[]): string[] {
  const paths = new Set<string>()
  for (const match of matches) {
    const bundleDir = toReceiptPath(knowledgeRoot, match.dir)
    paths.add(bundleDir)
    for (const relPath of Object.keys(match.bundle.manifest.contentHashes)) {
      paths.add(`${bundleDir}/${relPath}`)
    }
    paths.add(`${bundleDir}/manifest.json`)
  }
  return [...paths].sort()
}

function firstCommittedOrdinal(matches: readonly ResolvedBundle[]): number {
  return Math.min(...matches.map(({ bundle }) =>
    bundle.provenance.mode === 'run-linked'
      ? (bundle.provenance.sourceBuildOrdinal ?? bundle.manifest.createdAtOrdinal)
      : bundle.manifest.createdAtOrdinal,
  ))
}

/**
 * The function receives no ambient/runtime ordinal. Stamp the latest deterministic ordinal on the
 * purged record's own canonical lineage (creation/provenance, events, and relations), never time.
 */
function purgedAtOrdinal(matches: readonly ResolvedBundle[]): number {
  const ordinals = matches.flatMap(({ bundle }) => [
    bundle.manifest.createdAtOrdinal,
    ...(bundle.provenance.mode === 'run-linked'
      && bundle.provenance.sourceBuildOrdinal !== undefined
      ? [bundle.provenance.sourceBuildOrdinal]
      : []),
    ...bundle.events.map((event) => event.buildOrdinal),
    ...bundle.relations.relations.map((relation) => relation.addedAtOrdinal),
  ])
  return Math.max(...ordinals)
}

function buildReceipt(input: PurgeRecordInput, matches: readonly ResolvedBundle[]): PurgeReceipt {
  return PurgeReceiptSchema.parse({
    schemaVersion: PURGE_RECEIPT_SCHEMA_VERSION,
    purgedRecordId: input.recordId,
    purgedAtOrdinal: purgedAtOrdinal(matches),
    initiator: input.initiator,
    affectedPaths: affectedPaths(input.knowledgeRoot, matches),
    firstCommittedOrdinal: firstCommittedOrdinal(matches),
  })
}

function auditBaseDir(input: PurgeRecordInput): string {
  return input.auditBaseDir ?? join(dirname(input.knowledgeRoot), '.agent-qa')
}

/**
 * Publish a complete new receipt without exposing partial bytes and without ever overwriting an
 * existing audit fact. The hard link is the exclusive atomic visibility step; the temp file is
 * fsynced first and resides in the same directory.
 */
function writeReceiptExclusive(
  knowledgeRoot: string,
  recordId: RecordId,
  text: string,
): 'written' | 'already-exists' {
  const finalPath = receiptPath(knowledgeRoot, recordId)
  const directory = dirname(finalPath)
  mkdirSync(directory, { recursive: true })
  const temporary = `${finalPath}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' })
    fsyncFile(temporary)
    fsyncDirectory(directory)
    try {
      linkSync(temporary, finalPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'already-exists'
      throw error
    }
    fsyncDirectory(directory)
    return 'written'
  } finally {
    rmSync(temporary, { force: true })
    fsyncDirectory(directory)
  }
}

/** Hard-remove one confirmed-sensitive record from every recoverable local-store surface. */
export function purgeRecord(input: PurgeRecordInput): PurgeRecordOutcome {
  assertInput(input)
  const existingReceipt = readExistingReceipt(input.knowledgeRoot, input.recordId)
  if (existingReceipt !== undefined) {
    return { kind: 'already-purged', receipt: existingReceipt }
  }

  const matches = resolveBundles(input.knowledgeRoot, input.recordId)
  if (matches.length === 0) return { kind: 'not-found' }

  const receipt = buildReceipt(input, matches)
  const receiptText = committedFileText(receipt)
  const checkpoint = checkpointCommittedParts(
    [{ label: receiptRelativePath(input.recordId), text: receiptText }],
    { auditBaseDir: auditBaseDir(input) },
  )
  if (checkpoint.kind === 'egress-blocked') return checkpoint

  const anchors = matches.flatMap(({ bundle }) =>
    bundle.frontmatter.anchors.map(({ raw }) => raw),
  )
  const kind = matches[0]!.bundle.frontmatter.kind

  // Projection cleanup must prove every materialized vec table was writable before any
  // irreversible bundle, queue, or receipt mutation can attest success.
  purgeIndexSurfaces(input.knowledgeRoot, input.recordId, kind)

  // Capture metadata above before the only true-delete operation removes the committed tree.
  for (const match of matches) {
    rmSync(match.dir, { recursive: true, force: true })
  }
  sweepQueuePayloads(input.knowledgeRoot, anchors)

  const writeOutcome = writeReceiptExclusive(
    input.knowledgeRoot,
    input.recordId,
    receiptText,
  )
  if (writeOutcome === 'already-exists') {
    const racedReceipt = readExistingReceipt(input.knowledgeRoot, input.recordId)
    if (racedReceipt === undefined) {
      throw new Error('purge receipt disappeared during exclusive publication')
    }
    return { kind: 'already-purged', receipt: racedReceipt }
  }
  return { kind: 'purged', receipt }
}
