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
} from '@vostride/agent-qa-schema'
import type { RecordId } from '@vostride/agent-qa-schema'
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
/** Ordinary curation-job ids are 64-hex queue content addresses; prefixed maintenance receipt ids are not queue identities. */
const QUEUE_CANDIDATE_ID = /^[0-9a-f]{64}$/
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

export const PURGE_INTENT_SCHEMA_VERSION = 1

/**
 * D-14/CR-04: the durable, content-free purge intent published before the first irreversible
 * mutation. It embeds the complete receipt payload plus the exact resolved bundle dirs, queue
 * candidate ids, and queue payload dirs, so a retry after a crash replays destruction from
 * persisted identities and completes to byte-identical receipt publication instead of returning
 * not-found over half-destroyed state. Every list is deterministically sorted at construction;
 * purged prose, anchors, observations, and vectors have no representable field.
 */
export const PurgeIntentSchema = z.object({
  schemaVersion: z.literal(PURGE_INTENT_SCHEMA_VERSION),
  purgedRecordId: z.string().regex(SAFE_RECORD_ID),
  receipt: PurgeReceiptSchema,
  bundleDirs: z.array(receiptRelativePathSchema).min(1),
  queueCandidateIds: z.array(z.string().regex(QUEUE_CANDIDATE_ID)),
  queuePayloadDirs: z.array(receiptRelativePathSchema),
}).strict()

/** Lower-camel schema alias follows the existing knowledge-local committed-file convention. */
export const purgeIntentSchema = PurgeIntentSchema
export type PurgeIntent = z.infer<typeof PurgeIntentSchema>

const guardPurgeIntentVersion = createVersionGuard<PurgeIntent>({
  name: 'PurgeIntent',
  current: PURGE_INTENT_SCHEMA_VERSION,
  migrations: {},
})

export function guardPurgeIntent(value: unknown): PurgeIntent {
  return PurgeIntentSchema.parse(guardPurgeIntentVersion(value))
}

export interface PurgeRecordInput {
  knowledgeRoot: string
  recordId: RecordId
  /** Caller-owned sovereign identity; Phase 382 supplies the confirmed user identity. */
  initiator: string
  /** Optional explicit runtime audit root; omission uses the knowledge root's stable sibling. */
  auditBaseDir?: string
  /** Test/chaos seam between purge phases; production callers omit it (commit.ts precedent). */
  hooks?: {
    /** Immediately after the durable intent publication. */
    afterIntentWritten?: () => void
    /** After the transactional projection purge. */
    afterProjectionPurge?: () => void
    /** After every committed bundle tree removal. */
    afterBundleRemoval?: () => void
    /** After the queue payload sweep. */
    afterQueueSweep?: () => void
    /** Immediately before the completion receipt publication. */
    beforeReceiptPublish?: () => void
  }
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
  kind?: LoadedBundle['frontmatter']['kind'],
): void {
  if (!existsSync(indexDbPath(knowledgeRoot))) return

  const writer = openIndexWriter(knowledgeRoot)
  try {
    const row = writer.db
      .prepare('SELECT record_rowid, kind FROM records WHERE bundle_id = ?')
      .get(recordId)
    // A resume over destroyed bundles derives the graph identity from the projection row; when
    // both are gone the pre-removal projection purge already committed and only the idempotent
    // orphan-node and cache cleanup remains.
    const resolvedKind =
      kind
      ?? (row === undefined
        ? undefined
        : (String(row.kind) as LoadedBundle['frontmatter']['kind']))
    const recordNode =
      resolvedKind === undefined ? undefined : recordGraphNode(resolvedKind, recordId)

    transaction(() => {
      if (row !== undefined && recordNode !== undefined) {
        const recordRowid = Number(row.record_rowid)
        deleteRecordFromAllSchemaVecTables(writer.db, recordRowid)
        writer.db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
        writer.db.prepare('DELETE FROM anchors WHERE record_rowid = ?').run(recordRowid)
        writer.db.prepare(`
          DELETE FROM graph_edges
          WHERE record_rowid = ? OR src_node_id = ? OR dst_node_id = ?
        `).run(recordRowid, recordNode.nodeId, recordNode.nodeId)
        writer.db.prepare('DELETE FROM records WHERE record_rowid = ?').run(recordRowid)
      } else if (recordNode !== undefined) {
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

/** One exact queue deletion decided before any destruction (CR-03). */
export interface QueueSweepTarget {
  candidateDir: string
  candidateId: string
}

function lineageCandidateIds(matches: readonly ResolvedBundle[]): Set<string> {
  const ids = new Set<string>()
  for (const { bundle } of matches) {
    const jobIds = [
      ...(bundle.provenance.mode === 'run-linked'
        && bundle.provenance.curationJobId !== undefined
        ? [bundle.provenance.curationJobId]
        : []),
      ...bundle.events.map((event) => event.curationJobId),
      ...bundle.relations.relations.map((relation) => relation.curationJobId),
    ]
    for (const jobId of jobIds) {
      if (QUEUE_CANDIDATE_ID.test(jobId)) ids.add(jobId)
    }
  }
  return ids
}

function contentSeeds(matches: readonly ResolvedBundle[]): Set<string> {
  const seeds = new Set<string>()
  for (const { bundle } of matches) {
    if (bundle.summary !== '') seeds.add(bundle.summary)
    if (bundle.body !== '') seeds.add(bundle.body)
  }
  return seeds
}

function artifactDigests(matches: readonly ResolvedBundle[]): Set<string> {
  const digests = new Set<string>()
  for (const { bundle } of matches) {
    for (const digest of Object.values(bundle.manifest.contentHashes)) {
      digests.add(digest)
    }
  }
  return digests
}

/**
 * D-14/CR-03 deletion authority: a queue payload is destroyed iff it carries the purged content
 * or curation-job lineage — candidateId lineage, exact seed equality, or artifact digest
 * intersection. Anchor overlap never selects. The full set is resolved before any irreversible
 * mutation so the exact deletion intent exists ahead of destruction.
 */
export function resolveQueueSweepTargets(
  knowledgeRoot: string,
  matches: readonly ResolvedBundle[],
): QueueSweepTarget[] {
  const lineage = lineageCandidateIds(matches)
  const seeds = contentSeeds(matches)
  const digests = artifactDigests(matches)

  const targets: QueueSweepTarget[] = []
  for (const candidateDir of payloadDirectories(queueRoot(knowledgeRoot))) {
    let payload: unknown
    try {
      payload = JSON.parse(readFileSync(join(candidateDir, 'payload.json'), 'utf8'))
    } catch {
      continue
    }
    const parsed = curationCandidatePayloadSchema.safeParse(payload)
    if (!parsed.success) continue

    const { candidateId, summarySeed, bodySeed, artifactInventory } = parsed.data
    const carriesPurgedIdentity =
      lineage.has(candidateId)
      || seeds.has(summarySeed)
      || seeds.has(bodySeed)
      || artifactInventory.some((artifact) => digests.has(artifact.sha256))
    if (carriesPurgedIdentity) targets.push({ candidateDir, candidateId })
  }
  return targets.sort((left, right) =>
    left.candidateDir < right.candidateDir
      ? -1
      : left.candidateDir > right.candidateDir
        ? 1
        : 0,
  )
}

/** Pure destruction pass over the pre-resolved exact deletion set. */
function sweepQueuePayloads(
  knowledgeRoot: string,
  targets: readonly QueueSweepTarget[],
): void {
  const root = queueRoot(knowledgeRoot)
  for (const target of targets) {
    rmSync(target.candidateDir, { recursive: true, force: true })
    rmSync(jobStatePath(knowledgeRoot, target.candidateId), { force: true })
    removeEmptyQueueParents(target.candidateDir, root)
  }
}

function receiptRelativePath(recordId: RecordId): string {
  return `memory/receipts/purge-${recordId}.json`
}

function receiptPath(knowledgeRoot: string, recordId: RecordId): string {
  return join(knowledgeRoot, receiptRelativePath(recordId))
}

/** The intent lives beside the receipt it completes into. */
function intentPath(knowledgeRoot: string, recordId: RecordId): string {
  return join(knowledgeRoot, 'memory', 'receipts', `purge-${recordId}.intent.json`)
}

function readExistingReceipt(knowledgeRoot: string, recordId: RecordId): PurgeReceipt | undefined {
  const file = receiptPath(knowledgeRoot, recordId)
  if (!existsSync(file)) return undefined
  return guardPurgeReceipt(JSON.parse(readFileSync(file, 'utf8')))
}

function readExistingIntent(knowledgeRoot: string, recordId: RecordId): PurgeIntent | undefined {
  const file = intentPath(knowledgeRoot, recordId)
  if (!existsSync(file)) return undefined
  return guardPurgeIntent(JSON.parse(readFileSync(file, 'utf8')))
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
 * Publish one complete durable artifact without exposing partial bytes and without ever
 * overwriting an existing audit fact. The hard link is the exclusive atomic visibility step; the
 * temp file is fsynced first and resides in the same directory. Intent and receipt publication
 * share this one pattern.
 */
function writeDurableExclusive(finalPath: string, text: string): 'written' | 'already-exists' {
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

/** Persist the complete destruction authority as one deterministically sorted intent payload. */
function buildIntent(
  input: PurgeRecordInput,
  receipt: PurgeReceipt,
  matches: readonly ResolvedBundle[],
  targets: readonly QueueSweepTarget[],
): PurgeIntent {
  return PurgeIntentSchema.parse({
    schemaVersion: PURGE_INTENT_SCHEMA_VERSION,
    purgedRecordId: input.recordId,
    receipt,
    bundleDirs: matches
      .map((match) => toReceiptPath(input.knowledgeRoot, match.dir))
      .sort(),
    queueCandidateIds: targets.map((target) => target.candidateId).sort(),
    queuePayloadDirs: targets
      .map((target) => toReceiptPath(input.knowledgeRoot, target.candidateDir))
      .sort(),
  })
}

/** Remove the fulfilled intent; the durable receipt is now the sole audit fact. */
function retireIntent(knowledgeRoot: string, recordId: RecordId): void {
  const file = intentPath(knowledgeRoot, recordId)
  if (!existsSync(file)) return
  rmSync(file, { force: true })
  fsyncDirectory(dirname(file))
}

/** Publish the completion receipt exclusively, then retire the fulfilled intent. */
function publishReceiptAndRetire(
  input: PurgeRecordInput,
  receiptText: string,
  receipt: PurgeReceipt,
): PurgeRecordOutcome {
  const writeOutcome = writeDurableExclusive(
    receiptPath(input.knowledgeRoot, input.recordId),
    receiptText,
  )
  if (writeOutcome === 'already-exists') {
    const racedReceipt = readExistingReceipt(input.knowledgeRoot, input.recordId)
    if (racedReceipt === undefined) {
      throw new Error('purge receipt disappeared during exclusive publication')
    }
    retireIntent(input.knowledgeRoot, input.recordId)
    return { kind: 'already-purged', receipt: racedReceipt }
  }
  retireIntent(input.knowledgeRoot, input.recordId)
  return { kind: 'purged', receipt }
}

/**
 * A crash at or after the intent may leave any prefix of the bundle removals applied. Any
 * surviving intent bundle still carries the record kind for the projection purge; when none
 * survives, bundle removal started, which proves the preceding projection purge committed.
 */
function survivingBundleKind(
  knowledgeRoot: string,
  intent: PurgeIntent,
): LoadedBundle['frontmatter']['kind'] | undefined {
  for (const dir of intent.bundleDirs) {
    const loaded = loadBundle(join(knowledgeRoot, dir))
    if (loaded.kind === 'loaded') return loaded.bundle.frontmatter.kind
  }
  return undefined
}

/**
 * Replay the irreversible phase from the intent's persisted identities only — never a second
 * resolution over destroyed state. Every deletion is idempotent and the receipt publishes
 * byte-identically from the embedded payload.
 */
function resumeFromIntent(input: PurgeRecordInput, intent: PurgeIntent): PurgeRecordOutcome {
  purgeIndexSurfaces(
    input.knowledgeRoot,
    input.recordId,
    survivingBundleKind(input.knowledgeRoot, intent),
  )
  for (const dir of intent.bundleDirs) {
    rmSync(join(input.knowledgeRoot, dir), { recursive: true, force: true })
  }
  const root = queueRoot(input.knowledgeRoot)
  for (const dir of intent.queuePayloadDirs) {
    const candidateDir = join(input.knowledgeRoot, dir)
    rmSync(candidateDir, { recursive: true, force: true })
    removeEmptyQueueParents(candidateDir, root)
  }
  for (const candidateId of intent.queueCandidateIds) {
    rmSync(jobStatePath(input.knowledgeRoot, candidateId), { force: true })
  }
  return publishReceiptAndRetire(input, committedFileText(intent.receipt), intent.receipt)
}

/**
 * Hard-remove one confirmed-sensitive record from every recoverable local-store surface.
 *
 * Recovery invariant (CR-04): nothing irreversible ever precedes a durable intent, so a retry
 * either re-resolves intact state (crash before the intent) or replays the intent's persisted
 * identities to the identical completion receipt (crash at any later boundary).
 */
export function purgeRecord(input: PurgeRecordInput): PurgeRecordOutcome {
  assertInput(input)
  const existingReceipt = readExistingReceipt(input.knowledgeRoot, input.recordId)
  if (existingReceipt !== undefined) {
    // A crash between receipt publication and intent retirement leaves a fulfilled intent.
    retireIntent(input.knowledgeRoot, input.recordId)
    return { kind: 'already-purged', receipt: existingReceipt }
  }

  const persistedIntent = readExistingIntent(input.knowledgeRoot, input.recordId)
  if (persistedIntent !== undefined) return resumeFromIntent(input, persistedIntent)

  const matches = resolveBundles(input.knowledgeRoot, input.recordId)
  if (matches.length === 0) return { kind: 'not-found' }

  const receipt = buildReceipt(input, matches)
  const receiptText = committedFileText(receipt)
  const checkpoint = checkpointCommittedParts(
    [{ label: receiptRelativePath(input.recordId), text: receiptText }],
    { auditBaseDir: auditBaseDir(input) },
  )
  if (checkpoint.kind === 'egress-blocked') return checkpoint

  const kind = matches[0]!.bundle.frontmatter.kind

  // Resolve the exact queue deletion set before the first irreversible mutation so the durable
  // intent persists the complete destruction authority (CR-03).
  const queueSweepTargets = resolveQueueSweepTargets(input.knowledgeRoot, matches)

  // The intent publication is the LAST act before the first irreversible mutation (CR-04).
  const intent = buildIntent(input, receipt, matches, queueSweepTargets)
  const intentOutcome = writeDurableExclusive(
    intentPath(input.knowledgeRoot, input.recordId),
    committedFileText(intent),
  )
  if (intentOutcome === 'already-exists') {
    // A concurrent purge published its intent first; that durable authority wins.
    const publishedIntent = readExistingIntent(input.knowledgeRoot, input.recordId)
    if (publishedIntent === undefined) {
      throw new Error('purge intent disappeared during exclusive publication')
    }
    return resumeFromIntent(input, publishedIntent)
  }
  input.hooks?.afterIntentWritten?.()

  // Projection cleanup must prove every materialized vec table was writable before any
  // irreversible bundle, queue, or receipt mutation can attest success.
  purgeIndexSurfaces(input.knowledgeRoot, input.recordId, kind)
  input.hooks?.afterProjectionPurge?.()

  // Capture metadata above before the only true-delete operation removes the committed tree.
  for (const match of matches) {
    rmSync(match.dir, { recursive: true, force: true })
  }
  input.hooks?.afterBundleRemoval?.()

  sweepQueuePayloads(input.knowledgeRoot, queueSweepTargets)
  input.hooks?.afterQueueSweep?.()

  input.hooks?.beforeReceiptPublish?.()
  return publishReceiptAndRetire(input, receiptText, receipt)
}
