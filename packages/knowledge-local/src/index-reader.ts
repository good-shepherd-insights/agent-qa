/**
 * D-06/D-07/D-08 degrading reader facade for IDX-02 and memory.md §8.2.
 *
 * Index health is resolved once at open. Every unhealthy state becomes an authoritative bundle
 * scan plus a durable rebuild request, while healthy readers stay read-only and query-only through
 * openIndexReaderConnection. This module never acquires the writer role or rebuilds inline.
 */
import { existsSync } from 'node:fs'

import type { Anchor } from '@vostride/agent-qa-schema'

import {
  isServable,
  scanBundleById,
  scanBundles,
} from './bundle-scan.js'
import type { KnowledgeHit } from './bundle-scan.js'
import {
  indexDbPath,
  openIndexReaderConnection,
  probeIndexHealth,
} from './index-open.js'
import type { IndexReaderConnection, VecCapability } from './index-open.js'
import { requestRebuild } from './rebuild-marker.js'
import type { RebuildReason } from './rebuild-marker.js'

export interface KnowledgeSearchOptions {
  product?: string
  k?: number
}

export interface DenseSearchOptions extends KnowledgeSearchOptions {
  k: number
}

export type DenseHit = KnowledgeHit & { distance: number }

export interface KnowledgeReader {
  readonly source: 'index' | 'scan'
  readonly vec: VecCapability | 'none'
  getById(bundleId: string): KnowledgeHit | undefined
  searchLexical(text: string, opts?: KnowledgeSearchOptions): KnowledgeHit[]
  lookupAnchor(anchor: Anchor, opts?: KnowledgeSearchOptions): KnowledgeHit[]
  searchDense(embedding: Float32Array, opts: DenseSearchOptions): DenseHit[]
  recheck(hits: readonly KnowledgeHit[]): KnowledgeHit[]
  close(): void
}

export interface OpenKnowledgeReaderOptions {
  /** D-12 test seam. Production callers resolve sqlite-vec's pinned prebuild. */
  vecLoadablePath?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lockedReason(detail: string): boolean {
  return /locked|busy/i.test(detail)
}

function requestRebuildBestEffort(
  knowledgeRoot: string,
  reason: RebuildReason,
  detail: string,
): void {
  try {
    requestRebuild({ knowledgeRoot, reason, detail })
  } catch {
    // D-07 is an operations signal, not a serving gate. Bundle truth remains available.
  }
}

function closeBestEffort(connection: IndexReaderConnection): void {
  try {
    connection.db.close()
  } catch {
    // Preserve the health failure that selected authoritative scan mode.
  }
}

function scanReader(knowledgeRoot: string): KnowledgeReader {
  return {
    source: 'scan',
    vec: 'none',
    getById(bundleId): KnowledgeHit | undefined {
      return scanBundleById({ knowledgeRoot, bundleId })
    },
    searchLexical(text, opts = {}): KnowledgeHit[] {
      return scanBundles({ knowledgeRoot, text, ...opts })
    },
    lookupAnchor(anchor, opts = {}): KnowledgeHit[] {
      return scanBundles({ knowledgeRoot, anchor, ...opts })
    },
    searchDense(): DenseHit[] {
      return []
    },
    recheck(hits): KnowledgeHit[] {
      return hits.flatMap((hit) => {
        const current = scanBundleById({ knowledgeRoot, bundleId: hit.bundleId })
        return current === undefined || !isServable({
          status: current.status,
          trust: current.trust,
          counters: { confirmed: 0, contradicted: 0, helpful: 0, harmful: 0 },
          validity: current.validity,
        })
          ? []
          : [current]
      })
    },
    close(): void {},
  }
}

function indexReader(
  knowledgeRoot: string,
  connection: IndexReaderConnection,
): KnowledgeReader {
  let closed = false
  return {
    source: 'index',
    vec: connection.vec,
    getById(): KnowledgeHit | undefined {
      return undefined
    },
    searchLexical(): KnowledgeHit[] {
      return []
    },
    lookupAnchor(): KnowledgeHit[] {
      return []
    },
    searchDense(): DenseHit[] {
      return []
    },
    recheck(hits): KnowledgeHit[] {
      return scanReader(knowledgeRoot).recheck(hits)
    },
    close(): void {
      if (closed) return
      closed = true
      connection.db.close()
    },
  }
}

function degrade(
  knowledgeRoot: string,
  reason: RebuildReason,
  detail: string,
): KnowledgeReader {
  requestRebuildBestEffort(knowledgeRoot, reason, detail)
  return scanReader(knowledgeRoot)
}

export function openKnowledgeReader(
  knowledgeRoot: string,
  opts: OpenKnowledgeReaderOptions = {},
): KnowledgeReader {
  if (!existsSync(indexDbPath(knowledgeRoot))) {
    return degrade(knowledgeRoot, 'absent', 'derived index file is absent')
  }

  let connection: IndexReaderConnection
  try {
    connection = openIndexReaderConnection(knowledgeRoot, opts)
  } catch (error) {
    const detail = errorMessage(error)
    return degrade(knowledgeRoot, lockedReason(detail) ? 'locked' : 'corrupt', detail)
  }

  const health = probeIndexHealth(connection.db)
  if (!health.ok) {
    closeBestEffort(connection)
    const reason: RebuildReason = health.probe === 'schema-version'
      ? 'schema-version'
      : lockedReason(health.reason)
        ? 'locked'
        : 'corrupt'
    return degrade(knowledgeRoot, reason, health.reason)
  }

  return indexReader(knowledgeRoot, connection)
}
