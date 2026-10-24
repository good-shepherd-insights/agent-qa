import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  enumerateBundleDirs,
  loadBundle,
  openIndexReaderConnection,
} from '@vostride/agent-qa-knowledge-local'
import { canonicalJson } from '@vostride/agent-qa-schema'

export const LOGICAL_DUMP_EXCLUDED_COLUMNS = ['embedding'] as const

type SqlValue = null | number | string | bigint | Uint8Array

export interface LogicalTableDump {
  readonly table: string
  readonly columns: readonly string[]
  readonly orderByColumns: readonly string[]
  readonly rows: readonly Record<string, unknown>[]
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizedSqlValue(value: SqlValue): unknown {
  if (typeof value === 'bigint') return { bigint: value.toString() }
  if (value instanceof Uint8Array) return { blobHex: Buffer.from(value).toString('hex') }
  return value
}

/**
 * Canonical row dump: every non-SQLite-owned table, every visible column except the explicitly
 * nondeterministic dense embedding, and ORDER BY over that exact full selected column list.
 */
export function orderedLogicalDump(knowledgeRoot: string): string {
  const { db } = openIndexReaderConnection(knowledgeRoot)
  try {
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => String(row.name))

    const dump: LogicalTableDump[] = tables.map((table) => {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
        .map((row) => String(row.name))
        .filter((column) =>
          !(LOGICAL_DUMP_EXCLUDED_COLUMNS as readonly string[]).includes(column))
      if (columns.length === 0) {
        return { table, columns, orderByColumns: [], rows: [] }
      }
      const selection = columns.map(quoteIdentifier).join(', ')
      const rows = db.prepare(
        `SELECT ${selection} FROM ${quoteIdentifier(table)} ORDER BY ${selection}`,
      ).all().map((row) => Object.fromEntries(
        columns.map((column) => [column, normalizedSqlValue(row[column] as SqlValue)]),
      ))
      return { table, columns, orderByColumns: [...columns], rows }
    })
    return canonicalJson(dump)
  } finally {
    db.close()
  }
}

function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = join(dir, entry.name)
      return entry.isDirectory() ? filesBelow(file) : entry.isFile() ? [file] : []
    })
}

export function canonicalBundleTree(knowledgeRoot: string): string {
  const rows = enumerateBundleDirs(knowledgeRoot)
    .flatMap(({ dir }) => filesBelow(dir).map((file) => ({
      path: relative(knowledgeRoot, file),
      bytes: readFileSync(file).toString('base64'),
    })))
    .sort((left, right) => left.path.localeCompare(right.path))
  return canonicalJson(rows)
}

export interface StoreSequence {
  readonly bundleCount: number
  readonly commitOrder: readonly string[]
  readonly dispositions: readonly {
    candidateId: string
    status: string
    relationTypes: readonly string[]
  }[]
  readonly embedStatuses: readonly string[]
}

export function readStoreSequence(knowledgeRoot: string): StoreSequence {
  const candidateByBundleId = new Map<string, string>()
  const relationTypesByBundleId = new Map<string, string[]>()
  for (const { dir } of enumerateBundleDirs(knowledgeRoot)) {
    const loaded = loadBundle(dir)
    if (loaded.kind !== 'loaded') throw new Error(`bundle ${dir} did not load: ${loaded.kind}`)
    const provenance = loaded.bundle.provenance
    if (provenance.mode !== 'run-linked' || provenance.curationJobId === undefined) {
      throw new Error(`bundle ${dir} omitted run-linked curation provenance`)
    }
    const bundleId = basename(dir)
    candidateByBundleId.set(bundleId, provenance.curationJobId)
    relationTypesByBundleId.set(
      bundleId,
      loaded.bundle.relations.relations.map(({ type }) => type).sort(),
    )
  }

  const { db } = openIndexReaderConnection(knowledgeRoot)
  try {
    const rows = db.prepare(`
      SELECT record_rowid, bundle_id, status, embed_status
      FROM records
      ORDER BY record_rowid
    `).all()
    const resolved = rows.map((row) => {
      const bundleId = String(row.bundle_id)
      const candidateId = candidateByBundleId.get(bundleId)
      if (candidateId === undefined) throw new Error(`no candidate provenance for ${bundleId}`)
      return {
        candidateId,
        status: String(row.status),
        embedStatus: String(row.embed_status),
        relationTypes: relationTypesByBundleId.get(bundleId) ?? [],
      }
    })
    return {
      bundleCount: candidateByBundleId.size,
      commitOrder: resolved.map(({ candidateId }) => candidateId),
      dispositions: resolved.map(({ candidateId, status, relationTypes }) => ({
        candidateId,
        status,
        relationTypes,
      })),
      embedStatuses: resolved.map(({ embedStatus }) => embedStatus),
    }
  } finally {
    db.close()
  }
}
