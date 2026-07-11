import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  COMMITTED_CASSETTES_DIR,
  COMMITTED_CONTRACTS_DIR,
  COMMITTED_CORPUS_DIR,
  COMMITTED_GITIGNORE_TEXT,
  COMMITTED_LABELS_DIR,
  COMMITTED_ROOT_MARKER_FILE,
  COMMITTED_ROOT_SCHEMA_VERSION,
  FsCommittedRootStore,
  buildRootMarkerValue,
  committedBlobPath,
  committedCassettePath,
  committedContractPath,
  committedCorpusPath,
  committedLabelPath,
} from '../committed-root-store.js'

function shaOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function markerText(): string {
  return `${JSON.stringify(buildRootMarkerValue(), null, 2)}\n`
}

describe('FsCommittedRootStore (ROOT-01, D-15/D-17)', () => {
  let root: string
  let store: FsCommittedRootStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-committed-root-'))
    store = new FsCommittedRootStore({ committedRoot: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('scaffolds the gitignore and schemaVersion root marker idempotently (D-15)', async () => {
    const first = store.scaffold(COMMITTED_GITIGNORE_TEXT, markerText())

    expect(first).toEqual({
      gitignore: { kind: 'written' },
      rootMarker: { kind: 'written' },
    })
    const gitignoreBytes = await readFile(join(root, '.gitignore'), 'utf8')
    expect(gitignoreBytes).toContain('**/blobs/')
    expect(COMMITTED_ROOT_SCHEMA_VERSION).toBe(1)
    expect(
      JSON.parse(await readFile(join(root, COMMITTED_ROOT_MARKER_FILE), 'utf8')),
    ).toEqual({ schemaVersion: 1 })

    const second = store.scaffold(COMMITTED_GITIGNORE_TEXT, markerText())
    expect(second).toEqual({
      gitignore: { kind: 'unchanged' },
      rootMarker: { kind: 'unchanged' },
    })
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(gitignoreBytes)
    expect(
      JSON.parse(await readFile(join(root, COMMITTED_ROOT_MARKER_FILE), 'utf8')),
    ).toEqual(buildRootMarkerValue())
  })

  it('treats a byte-identical re-write as a silent unchanged no-op (D-17)', async () => {
    const relPath = committedLabelPath('demo-app', 'run-01/test-01-step-02-d00-leaf')
    const text = '{\n  "schemaVersion": 1\n}\n'

    expect(store.writeText(relPath, text)).toEqual({ kind: 'written' })
    expect(store.writeText(relPath, text)).toEqual({ kind: 'unchanged' })
    expect(await readFile(join(root, relPath), 'utf8')).toBe(text)
  })

  it('refuses differing bytes on an existing path with a typed write-conflict (D-17)', async () => {
    const relPath = committedCorpusPath('demo-app', 'run-01/test-01-step-02-d00-leaf')
    const original = '{"split":"natural"}\n'

    expect(store.writeText(relPath, original)).toEqual({ kind: 'written' })
    expect(store.writeText(relPath, '{"split":"adversarial"}\n')).toEqual({
      kind: 'write-conflict',
      path: relPath,
    })
    expect(await readFile(join(root, relPath), 'utf8')).toBe(original)
  })

  it('keeps crafted traversal ids inside the committed root (T-371-09)', () => {
    const hostileId = '../../hostile/run\\escape/../cassette'
    const relPaths = [
      committedCassettePath('demo-app', hostileId),
      committedBlobPath('demo-app', hostileId, 'f'.repeat(64)),
      committedLabelPath('demo-app', hostileId),
      committedCorpusPath('demo-app', hostileId),
      committedContractPath('../escape.json'),
    ]
    for (const relPath of relPaths) {
      expect(resolve(root, relPath).startsWith(`${root}${sep}`)).toBe(true)
    }

    const cassetteRel = committedCassettePath('demo-app', hostileId)
    expect(store.writeText(cassetteRel, '{}\n')).toEqual({ kind: 'written' })
    const landed = resolve(root, cassetteRel)
    expect(landed.startsWith(`${root}${sep}`)).toBe(true)
    expect(existsSync(landed)).toBe(true)
  })

  it('verifies blob sha format and byte hash before landing bytes under blobs/ (T-371-11)', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const sha = shaOf(bytes)
    const relBlobPath = committedBlobPath('demo-app', 'run-01/leaf', sha)
    expect(relBlobPath).toBe(`cassettes/demo-app/run-01/leaf/blobs/${sha}`)

    const malformed = store.writeBlob(
      committedBlobPath('demo-app', 'run-01/leaf', '../not-a-content-sha'),
      { sha: '../not-a-content-sha', bytes },
    )
    expect(malformed.kind).toBe('write-conflict')

    const mismatched = store.writeBlob(
      committedBlobPath('demo-app', 'run-01/leaf', 'f'.repeat(64)),
      { sha: 'f'.repeat(64), bytes },
    )
    expect(mismatched.kind).toBe('write-conflict')
    expect(existsSync(join(root, COMMITTED_CASSETTES_DIR))).toBe(false)

    expect(store.writeBlob(relBlobPath, { sha, bytes })).toEqual({ kind: 'written' })
    expect(await readFile(join(root, relBlobPath))).toEqual(Buffer.from(bytes))
    expect(store.writeBlob(relBlobPath, { sha, bytes })).toEqual({ kind: 'unchanged' })
  })

  it('previews text writes without creating or modifying any file', async () => {
    const relPath = committedLabelPath('demo-app', 'run-01/leaf')
    const text = '{"tier":"silver"}\n'

    expect(store.previewText(relPath, text)).toBe('absent')
    expect(existsSync(join(root, COMMITTED_LABELS_DIR))).toBe(false)

    expect(store.writeText(relPath, text)).toEqual({ kind: 'written' })
    expect(store.previewText(relPath, text)).toBe('identical')
    expect(store.previewText(relPath, '{"tier":"near-gold"}\n')).toBe('conflict')
    expect(await readFile(join(root, relPath), 'utf8')).toBe(text)
  })

  it('builds the committed path anatomy with every segment slugged', () => {
    expect(COMMITTED_CASSETTES_DIR).toBe('cassettes')
    expect(COMMITTED_CORPUS_DIR).toBe('corpus')
    expect(COMMITTED_LABELS_DIR).toBe('labels')
    expect(COMMITTED_CONTRACTS_DIR).toBe('contracts')

    expect(committedCassettePath('demo-app', 'run 01/test-01-step-02-d00-leaf')).toBe(
      'cassettes/demo-app/run-01/test-01-step-02-d00-leaf/cassette.json',
    )
    expect(committedLabelPath('demo-app', 'run 01/test-01-step-02-d00-leaf')).toBe(
      'labels/demo-app/run-01/test-01-step-02-d00-leaf.json',
    )
    expect(committedCorpusPath('demo-app', 'run 01/test-01-step-02-d00-leaf')).toBe(
      'corpus/demo-app/run-01/test-01-step-02-d00-leaf.json',
    )
    expect(committedContractPath('matcher-config.v1.json')).toBe(
      'contracts/matcher-config.v1.json',
    )
  })
})
