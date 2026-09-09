import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ORIGIN_PRIORS, type TrustPriorTable } from '@vostride/agent-qa-schema'
import { publishBundle, type PublishBundleInput } from '../bundle-publish.test-helper.js'
import { indexDbPath, INDEX_SCHEMA_VERSION, MIN_READABLE_INDEX_SCHEMA_VERSION, INDEX_RENDERING_SCHEMA_VERSION } from '../index-open.js'
import { rebuildIndex, projectBundleIndexRow } from '../index-rebuild.js'
import { acquireWriterLease } from '../lease/writer-lease.js'
import { effectivePriorDigest } from '../trust-prior-context.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const input = JSON.parse(readFileSync(new URL('./fixtures/420-prior-baseline.json', import.meta.url), 'utf8')).cases.find((entry: { name: string }) => entry.name === 'agent-observed-clean').input as PublishBundleInput
const prior = (alpha = 1.8): TrustPriorTable => ({ 'agent-observed': { alpha, beta: 2 - alpha } })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-index-'))
  roots.push(root)
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'fixture-storefront', auditBaseDir: join(root, 'audit'), commitArtifacts: 'none' as const }
  const result = publishBundle(config, input)
  if (result.kind !== 'published') throw new Error('fixture refused')
  const lease = acquireWriterLease(config.knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('fixture lease refused')
  return { ...config, ...result, writerAuthority: { knowledgeRoot: config.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch } }
}
function inspect(root: string) {
  const db = new DatabaseSync(indexDbPath(root))
  try { return { rows: db.prepare('SELECT * FROM records ORDER BY bundle_id').all(), epoch: db.prepare("SELECT v FROM meta WHERE k = 'trust_prior_digest'").get()?.v } }
  finally { db.close() }
}

describe('420 prior-aware index refresh', () => {
  it('canonicalizes effective defaults and rejects invalid host data', () => {
    expect(effectivePriorDigest()).toBe(effectivePriorDigest({}))
    expect(effectivePriorDigest()).toBe(effectivePriorDigest(ORIGIN_PRIORS))
    expect(effectivePriorDigest(prior())).toBe(effectivePriorDigest({ ...ORIGIN_PRIORS, ...prior() }))
    expect(() => effectivePriorDigest({ user: { alpha: NaN, beta: 1 } })).toThrow()
  })
  it('invalidates old trust schema without changing rendering schema', () => {
    expect(INDEX_SCHEMA_VERSION).toBe(5)
    expect(MIN_READABLE_INDEX_SCHEMA_VERSION).toBe(5)
    expect(INDEX_RENDERING_SCHEMA_VERSION).toBe(2)
  })
  it('replaces and removes priors with unchanged bundle and rendering bytes', async () => {
    const f = fixture()
    const bytes = () => readdirSync(f.dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort().map(name => [name, readFileSync(name, 'utf8')])
    const original = bytes()
    await rebuildIndex(f)
    const baseline = inspect(f.knowledgeRoot)
    for (const priors of [prior(), prior(0.2), undefined, {}]) {
      await rebuildIndex({ ...f, priors })
      const next = inspect(f.knowledgeRoot)
      expect(next.rows[0]!.trust).toBe(priors?.['agent-observed']?.alpha === 1.8 ? 0.9 : priors?.['agent-observed']?.alpha === 0.2 ? 0.1 : baseline.rows[0]!.trust)
      const { trust: _trust, trust_prior_digest: _digest, ...rest } = next.rows[0]!
      const { trust: _oldTrust, trust_prior_digest: _oldDigest, ...oldRest } = baseline.rows[0]!
      expect(rest).toEqual(oldRest)
      expect(next.epoch).toBe(next.rows[0]!.trust_prior_digest)
      expect(bytes()).toEqual(original)
    }
    expect(inspect(f.knowledgeRoot).epoch).toBe(baseline.epoch)
  })
  it('does not publish an interrupted refresh and heals on retry', async () => {
    const f = fixture()
    await rebuildIndex(f)
    await expect(rebuildIndex({ ...f, priors: prior(), hooks: { beforeMutationAuthority(family) { if (family === 'complete-rendering-epoch') throw new Error('injected interruption') } } })).rejects.toThrow('injected interruption')
    const interrupted = inspect(f.knowledgeRoot)
    expect(interrupted.epoch).toBeUndefined()
    await rebuildIndex({ ...f, priors: prior() })
    const healed = inspect(f.knowledgeRoot)
    expect(healed.epoch).toBe(healed.rows[0]!.trust_prior_digest)
    expect(healed.epoch).toEqual(expect.any(String))
  })
  it('single-bundle updates never claim a completed new epoch', async () => {
    const f = fixture()
    await rebuildIndex(f)
    projectBundleIndexRow({ knowledgeRoot: f.knowledgeRoot, bundleId: f.id, priors: prior() })
    const state = inspect(f.knowledgeRoot)
    expect(state.epoch).not.toBe(state.rows[0]!.trust_prior_digest)
  })
  it('refuses completed epoch publication without writer authority', async () => {
    const f = fixture()
    await rebuildIndex({ knowledgeRoot: f.knowledgeRoot, priors: prior() })
    expect(inspect(f.knowledgeRoot).epoch).toBeUndefined()
    await rebuildIndex({ ...f, priors: prior() })
    expect(inspect(f.knowledgeRoot).epoch).toEqual(expect.any(String))
  })
  it('refuses mixed rows at publication and repairs them on retry', async () => {
    const f = fixture()
    await rebuildIndex(f)
    await rebuildIndex({ ...f, priors: prior(), hooks: { beforeMutationAuthority(family) {
      if (family !== 'complete-trust-epoch') return
      const db = new DatabaseSync(indexDbPath(f.knowledgeRoot))
      db.prepare('UPDATE records SET trust_prior_digest = ?').run('interrupted-other-host')
      db.close()
    } } })
    expect(inspect(f.knowledgeRoot).epoch).toBeUndefined()
    await rebuildIndex({ ...f, priors: prior() })
    expect(inspect(f.knowledgeRoot).epoch).toBe(effectivePriorDigest(prior()))
  })
  it('publishes only after removed bundles are removed and refuses stale authority', async () => {
    const f = fixture()
    await rebuildIndex(f)
    await expect(rebuildIndex({ ...f, priors: prior(), writerAuthority: { ...f.writerAuthority, epoch: f.writerAuthority.epoch + 1 } })).rejects.toThrow()
    expect(inspect(f.knowledgeRoot).epoch).toBe(effectivePriorDigest())
    rmSync(f.dir, { recursive: true })
    await expect(rebuildIndex({ ...f, priors: prior(), hooks: { beforeMutationAuthority(family) { if (family === 'remove-missing-bundles') throw new Error('removal interrupted') } } })).rejects.toThrow('removal interrupted')
    expect(inspect(f.knowledgeRoot).epoch).toBeUndefined()
    const report = await rebuildIndex({ ...f, priors: prior() })
    expect(report.removed).toBe(1)
    expect(inspect(f.knowledgeRoot)).toEqual({ rows: [], epoch: effectivePriorDigest(prior()) })
  })
})
