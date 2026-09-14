import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { EvidenceDocument } from '@vostride/agent-qa-schema'
import { FsEvidenceArtifactStore } from '../evidence-artifact-store.js'

const io = vi.hoisted(() => ({ beforeWrite: undefined as undefined | ((path: unknown) => void) }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: vi.fn((...args: Parameters<typeof fs.writeFileSync>) => {
      io.beforeWrite?.(args[0])
      return fs.writeFileSync(...args)
    }),
  }
})

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), '423-json-evidence-'))
  roots.push(root)
  return { root, dir: join(root, 'runs', 'run-423', 'blobs'),
    store: new FsEvidenceArtifactStore({ root, runId: 'run-423' }) }
}
afterEach(() => {
  io.beforeWrite = undefined
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const syntheticSecret = 'synthetic-console-secret-423'
const masked = '[secret]'
const document: Exclude<EvidenceDocument, { kind: 'variables' }> = {
  schemaVersion: 1, kind: 'console', records: [
    { level: 'warn', text: syntheticSecret.replace(syntheticSecret, masked), timestamp: 20 },
    { level: 'error', text: 'second', timestamp: 10 },
  ],
}
const bytes = Buffer.from(JSON.stringify(document))
const sha = createHash('sha256').update(bytes).digest('hex')

test('MASK-BEFORE-HASH: exact masked serialized bytes retain capture order and typed identity', () => {
  const { store } = fixture()
  const ref = store.persistEvidenceDocument(document)
  expect(ref).toEqual({ id: `console-evidence:${sha}`, sha })
  expect(Buffer.from(store.getBlob(ref.sha)!)).toEqual(bytes)
  expect(Buffer.from(store.getBlob(ref.sha)!).toString()).not.toContain(syntheticSecret)
  expect(JSON.parse(Buffer.from(store.getBlob(ref.sha)!).toString()).records.map(
    (record: { timestamp: number }) => record.timestamp,
  )).toEqual([20, 10])
})

test('DEDUP: identical complete bytes do not rewrite an existing blob', () => {
  const { store, dir } = fixture()
  const first = store.persistEvidenceDocument(document)
  vi.mocked(writeFileSync).mockClear()
  expect(store.persistEvidenceDocument(document)).toEqual(first)
  expect(writeFileSync).not.toHaveBeenCalled()
  expect(readdirSync(dir)).toEqual([sha])
})

test('CONCURRENT-BLOB: another store sees no partial target during publication', async () => {
  const { store, root, dir } = fixture()
  const other = new FsEvidenceArtifactStore({ root, runId: 'run-423' })
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  let visibleDuringWrite: Uint8Array | undefined
  io.beforeWrite = path => {
    io.beforeWrite = undefined
    if (typeof path === 'number') fs.writeSync(path, bytes, 0, 12, 0)
    else fs.writeFileSync(path as string, bytes.subarray(0, 12))
    visibleDuringWrite = other.getBlob(sha)
    other.persistEvidenceDocument(document)
  }
  store.persistEvidenceDocument(document)
  expect(visibleDuringWrite).toBeUndefined()
  expect(Buffer.from(other.getBlob(sha)!)).toEqual(bytes)
  expect(readdirSync(dir)).toEqual([sha])
})

test('INTERRUPTED-BLOB: partial write failure never publishes a successful ref or target', async () => {
  const { store, dir } = fixture()
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  io.beforeWrite = path => {
    io.beforeWrite = undefined
    if (typeof path === 'number') fs.writeSync(path, bytes, 0, 12, 0)
    else fs.writeFileSync(path as string, bytes.subarray(0, 12))
    throw new Error('synthetic interrupted write')
  }
  expect(() => store.persistEvidenceDocument(document)).toThrow('synthetic interrupted write')
  expect(store.hasBlob(sha)).toBe(false)
  expect(store.getBlob(sha)).toBeUndefined()
  expect(readdirSync(dir)).toEqual([])
  expect(store.persistEvidenceDocument(document).sha).toBe(sha)
})

test('JSON-KINDS: schema-owned prefixes and validation reject unsupported documents before writing', () => {
  const { store, dir } = fixture()
  for (const [value, prefix] of [
    [{ schemaVersion: 1, kind: 'network', records: [] }, 'network-evidence:'],
    [{ schemaVersion: 1, kind: 'a11y', records: [] }, 'a11y-evidence:'],
    [{ schemaVersion: 1, kind: 'aria', tree: masked }, 'aria-state:'],
  ] as const) {
    const ref = store.persistEvidenceDocument(value as Exclude<EvidenceDocument, { kind: 'variables' }>)
    expect(ref.id).toBe(`${prefix}${ref.sha}`)
    expect(createHash('sha256').update(store.getBlob(ref.sha)!).digest('hex')).toBe(ref.sha)
  }
  const before = readdirSync(dir)
  for (const invalid of [
    { ...document, schemaVersion: 2 }, { ...document, extra: true },
    { ...document, records: [{ level: 'warn', text: masked }] },
    { schemaVersion: 1, kind: 'variables', records: {} },
  ]) {
    expect(() => store.persistEvidenceDocument(invalid as typeof document)).toThrow()
  }
  expect(readdirSync(dir)).toEqual(before)
})
