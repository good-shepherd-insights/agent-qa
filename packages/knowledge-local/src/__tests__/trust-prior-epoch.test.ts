import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { type TrustPriorTable } from '@vostride/agent-qa-schema'
import { publishBundle, type PublishBundleInput } from '../bundle-publish.test-helper.js'
import { indexDbPath } from '../index-open.js'
import { rebuildIndex, projectBundleIndexRow } from '../index-rebuild.js'
import { acquireWriterLease } from '../lease/writer-lease.js'
import { openKnowledgeReader, withKnowledgeReadSnapshot } from '../index-reader.js'
import { readIndexRows, hydrateRows } from '../serving/reader.js'
import { readRebuildRequest } from '../rebuild-marker.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const input = JSON.parse(readFileSync(new URL('./fixtures/420-prior-baseline.json', import.meta.url), 'utf8')).cases.find((entry: { name: string }) => entry.name === 'agent-observed-clean').input as PublishBundleInput
const prior = (alpha = 1.8): TrustPriorTable => ({ 'agent-observed': { alpha, beta: 2 - alpha } })
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-epoch-'))
  roots.push(root)
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'fixture-storefront', auditBaseDir: join(root, 'audit'), commitArtifacts: 'none' as const }
  const result = publishBundle(config, input)
  if (result.kind !== 'published') throw new Error('fixture refused')
  const lease = acquireWriterLease(config.knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('fixture lease refused')
  const f = { ...config, ...result, writerAuthority: { knowledgeRoot: config.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch } }
  await rebuildIndex({ ...f, priors: prior() })
  return f
}

describe('420 host index epoch isolation', () => {
  it('uses one WAL epoch during a concurrent refresh and scans on the next snapshot', async () => {
    const f = await fixture()
    const mutable = prior()
    const a = openKnowledgeReader(f.knowledgeRoot, { priors: mutable })
    mutable['agent-observed']!.alpha = 0.1
    try {
      await withKnowledgeReadSnapshot(a, async context => {
        expect(context.source).toBe('index')
        expect(context.connection!.db.prepare('SELECT trust FROM records').get()?.trust).toBe(0.9)
        await rebuildIndex({ ...f, priors: prior(0.2) })
        expect(context.connection!.db.prepare('SELECT trust FROM records').get()?.trust).toBe(0.9)
        expect(context.reader.getById(f.id)!.trust).toBe(0.9)
      })
      const later = await withKnowledgeReadSnapshot(a, context => ({ source: context.source, hasConnection: context.connection !== undefined, trust: context.reader.getById(f.id)!.trust }))
      expect(later).toEqual({ source: 'scan', hasConnection: false, trust: 0.9 })
      const b = openKnowledgeReader(f.knowledgeRoot, { priors: prior(0.2) })
      try { expect(b.getById(f.id)!.trust).toBe(0.1); expect(b.source).toBe('index') }
      finally { b.close() }
      expect(readRebuildRequest(f.knowledgeRoot)).toEqual({ present: false })
    } finally { a.close() }
  })
  it('falls back before index selection can omit a canonical bundle', async () => {
    const f = await fixture()
    const a = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    await rebuildIndex({ ...f, priors: prior(0.2) })
    const db = new DatabaseSync(indexDbPath(f.knowledgeRoot))
    db.exec('DELETE FROM records')
    db.close()
    try {
      expect(a.getById(f.id)).toMatchObject({ bundleId: f.id, trust: 0.9 })
      expect(a.source).toBe('scan')
      expect(a.searchLexical('Sign in', { k: 1 })[0]!.bundleId).toBe(f.id)
    } finally { a.close() }
  })
  it('checks row identity even if a completed marker still matches the host', async () => {
    const f = await fixture()
    const a = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    const db = new DatabaseSync(indexDbPath(f.knowledgeRoot))
    db.prepare('UPDATE records SET trust_prior_digest = ?').run('mixed-row')
    db.close()
    try { expect(a.getById(f.id)!.trust).toBe(0.9); expect(a.source).toBe('scan') }
    finally { a.close() }
  })
  it('serving direct row selection scans with the old snapshot and scope fences', async () => {
    const f = await fixture()
    const config = { knowledgeRoot: f.knowledgeRoot, priors: prior(), product: f.productKey }
    await rebuildIndex({ ...f, priors: prior(0.2) })
    const db = new DatabaseSync(indexDbPath(f.knowledgeRoot))
    db.exec('DELETE FROM records')
    db.close()
    const rows = readIndexRows(config)
    expect(rows.map(row => row.bundle_id)).toEqual([f.id])
    expect(hydrateRows(config, rows, true)[0]!.entry.trust).toBe(0.9)
    expect(readIndexRows({ ...config, product: 'different-product' })).toEqual([])
  })
  it('a newly provisional host uses provisional trust after calibration removal', async () => {
    const f = await fixture()
    const old = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    await rebuildIndex(f)
    const fresh = openKnowledgeReader(f.knowledgeRoot)
    try {
      expect(fresh.getById(f.id)!.trust).toBe(0.5)
      expect(fresh.source).toBe('index')
      expect(old.getById(f.id)!.trust).toBe(0.9)
      expect(old.source).toBe('scan')
    } finally { fresh.close(); old.close() }
  })
  it('single-bundle mixed projection cannot supply an indexed snapshot', async () => {
    const f = await fixture()
    projectBundleIndexRow({ knowledgeRoot: f.knowledgeRoot, bundleId: f.id, priors: prior(0.2) })
    const b = openKnowledgeReader(f.knowledgeRoot, { priors: prior(0.2) })
    try { expect(await withKnowledgeReadSnapshot(b, context => context.source)).toBe('scan') }
    finally { b.close() }
  })
})
