/**
 * D-14's one true-delete exemption for confirmed-sensitive material.
 *
 * This library function owns only local store surfaces. It performs no git operation and never
 * attempts to rewrite repository history; Phase 382's sovereign CLI binding leaves that
 * destructive, repository-wide decision with the human operator.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, isAbsolute, join, sep } from 'node:path'

import {
  recordGraphNode,
  supersessionKey,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  RecordId,
} from '@vostride/agent-qa-schema'

import { loadBundle } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import {
  indexDbPath,
  openIndexWriter,
  resolveActiveProfile,
  vecTableName,
} from './index-open.js'
import { jobStatePath, queueRoot } from './queue/queue-layout.js'
import { curationCandidatePayloadSchema } from './queue/queue-payload.js'

export interface PurgeRecordInput {
  knowledgeRoot: string
  recordId: RecordId
  /** Caller-owned sovereign identity; Phase 382 supplies the confirmed user identity. */
  initiator: string
}

export type PurgeRecordOutcome =
  | { kind: 'purged' }
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
    const activeProfile = resolveActiveProfile(writer.db)

    transaction(() => {
      if (row !== undefined) {
        const recordRowid = Number(row.record_rowid)
        writer.db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
        writer.db.prepare('DELETE FROM anchors WHERE record_rowid = ?').run(recordRowid)
        writer.db.prepare(`
          DELETE FROM graph_edges
          WHERE record_rowid = ? OR src_node_id = ? OR dst_node_id = ?
        `).run(recordRowid, recordNode.nodeId, recordNode.nodeId)
        if (writer.vec === 'vec0') {
          writer.db
            .prepare(`DELETE FROM ${vecTableName(activeProfile)} WHERE record_rowid = ?`)
            .run(BigInt(recordRowid))
        }
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

function intersectsAnchorKeys(anchors: readonly Anchor[], purgedKeys: ReadonlySet<string>): boolean {
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

/** Hard-remove one confirmed-sensitive record from every recoverable local-store surface. */
export function purgeRecord(input: PurgeRecordInput): PurgeRecordOutcome {
  assertInput(input)
  const matches = resolveBundles(input.knowledgeRoot, input.recordId)
  if (matches.length === 0) return { kind: 'not-found' }

  const anchors = matches.flatMap(({ bundle }) =>
    bundle.frontmatter.anchors.map(({ raw }) => raw),
  )
  const kind = matches[0]!.bundle.frontmatter.kind

  // Capture metadata above before the only true-delete operation removes the committed tree.
  for (const match of matches) {
    rmSync(match.dir, { recursive: true, force: true })
  }
  purgeIndexSurfaces(input.knowledgeRoot, input.recordId, kind)
  sweepQueuePayloads(input.knowledgeRoot, anchors)

  return { kind: 'purged' }
}
