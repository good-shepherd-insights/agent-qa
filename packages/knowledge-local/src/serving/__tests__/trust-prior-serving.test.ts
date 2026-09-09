import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BundleOutcomeEventSchema, canonicalJson, type TrustPriorTable } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import { appendOutcomeEvent } from '../../bundle-append.js'
import { deriveBundleTrust, loadBundle } from '../../bundle-read.js'
import { publishBundle, type PublishBundleInput } from '../../bundle-publish.test-helper.js'
import { scanBundleById, scanBundles, scanBundlesForRetrieval } from '../../bundle-scan.js'
import { listBundles } from '../../list-bundles.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { createAuthoringReader } from '../authoring-reader.js'
import { hydrateRows, openKnowledgeReader, readIndexRows } from '../reader.js'

const baseline = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/420-prior-baseline.json', import.meta.url), 'utf8')) as {
  cases: { name: string; input: PublishBundleInput; appended: unknown[]; snapshots: { expectedBytes: string }[] }[]
}
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const prior = (): TrustPriorTable => ({ 'agent-observed': { alpha: 1.8, beta: 0.2 } })

async function persist(name = 'agent-observed-clean', stage = 5) {
  const entry = baseline.cases.find(row => row.name === name)!
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-serving-'))
  roots.push(root)
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'baseline', auditBaseDir: join(root, 'audit'), commitArtifacts: 'none' as const }
  const published = publishBundle(config, entry.input)
  if (published.kind !== 'published') throw new Error('fixture publication refused')
  for (const event of entry.appended.slice(0, stage)) expect(appendOutcomeEvent(config, published.id, BundleOutcomeEventSchema.parse(event)).kind).toBe('appended')
  const loaded = loadBundle(published.dir)
  if (loaded.kind !== 'loaded') throw new Error('fixture read refused')
  await rebuildIndex({ knowledgeRoot: config.knowledgeRoot })
  return { ...config, ...published, bundle: loaded.bundle, expected: JSON.parse(entry.snapshots[stage]!.expectedBytes), expectedBytes: entry.snapshots[stage]!.expectedBytes }
}

describe('420 serving prior continuity', () => {
  it('serving hydration uses supplied numerical priors', async () => {
    const f = await persist()
    const config = { knowledgeRoot: f.knowledgeRoot, priors: prior() }
    const expected = (1.8 + 1.25) / (2 + 2.5)
    expect(hydrateRows(config, readIndexRows(config), true)[0]!.entry.trust).toBe(expected)
    expect((await openKnowledgeReader(config).search('Sign in', { scope: f.bundle.frontmatter.scope }))[0]!.trust).toBe(expected)
  })

  it('scan list and direct fallback agree with serving', async () => {
    const f = await persist()
    const opts = { knowledgeRoot: f.knowledgeRoot, priors: prior() }
    const expected = deriveBundleTrust(f.bundle, prior())
    for (const hit of [...scanBundles(opts), ...scanBundlesForRetrieval(opts), scanBundleById({ ...opts, bundleId: f.id })!]) {
      expect(hit.trust).toBe(expected.trust)
      expect(hit.status).toBe(expected.status)
      expect(hit.validity).toEqual(expected.validity)
    }
    expect(listBundles(f.knowledgeRoot, prior())[0]).toMatchObject({ trust: expected.trust, counters: expected.counters })
  })

  it('serving and authoring retain construction priors and exact served wording', async () => {
    const f = await persist()
    const mutable = prior()
    const config = { knowledgeRoot: f.knowledgeRoot, priors: mutable }
    const serving = openKnowledgeReader(config)
    const authoring = createAuthoringReader(config)
    const before = await openKnowledgeReader({ knowledgeRoot: f.knowledgeRoot }).getRunBrief(f.bundle.frontmatter.scope, 2000)
    const authoredBefore = await createAuthoringReader({ knowledgeRoot: f.knowledgeRoot }).getAuthoringBrief('Sign in', f.bundle.frontmatter.scope)
    mutable['agent-observed']!.alpha = 0
    expect((await serving.search('Sign in', { scope: f.bundle.frontmatter.scope }))[0]!.trust).toBe(deriveBundleTrust(f.bundle, prior()).trust)
    const after = await serving.getRunBrief(f.bundle.frontmatter.scope, 2000)
    expect(after.brief.tiers).toEqual(before.brief.tiers)
    expect(after.brief.lines.map(({ trust, ...line }) => line)).toEqual(before.brief.lines.map(({ trust, ...line }) => line))
    expect(after.brief.lines[0]!.trust).toBe(deriveBundleTrust(f.bundle, prior()).trust)
    const authored = await authoring.getAuthoringBrief('Sign in', f.bundle.frontmatter.scope)
    expect(authored.facts[0]!.trust).toBe(deriveBundleTrust(f.bundle, prior()).trust)
    expect({ ...authored, facts: authored.facts.map(({ trust, ...line }) => line) }).toEqual({ ...authoredBefore, facts: authoredBefore.facts.map(({ trust, ...line }) => line) })
    expect(await serving.read(f.id)).toEqual(await openKnowledgeReader({ knowledgeRoot: f.knowledgeRoot }).read(f.id))
  })

  it('absent and empty priors preserve independent old bytes for every origin', async () => {
    for (const entry of baseline.cases) {
      const f = await persist(entry.name)
      expect(canonicalJson(deriveBundleTrust(f.bundle))).toBe(f.expectedBytes)
      const original = openKnowledgeReader({ knowledgeRoot: f.knowledgeRoot })
      const empty = openKnowledgeReader({ knowledgeRoot: f.knowledgeRoot, priors: {} })
      expect(await empty.search('Sign in', { scope: f.bundle.frontmatter.scope })).toEqual(await original.search('Sign in', { scope: f.bundle.frontmatter.scope }))
      expect((await empty.search('Sign in', { scope: f.bundle.frontmatter.scope }))[0]!.trust).toBe(f.expected.trust)
      expect(listBundles(f.knowledgeRoot, {})[0]!.trust).toBe(f.expected.trust)
      expect(scanBundles({ knowledgeRoot: f.knowledgeRoot, priors: {} })[0]!.trust).toBe(f.expected.trust)
    }
  })

  it('keeps product scope candidate history and integrity admission', async () => {
    const f = await persist('agent-observed-clean', 0)
    const config = { knowledgeRoot: f.knowledgeRoot, priors: prior() }
    expect(await openKnowledgeReader(config).search('Sign in', { scope: f.bundle.frontmatter.scope, includeCandidates: true })).toEqual([])
    expect(await openKnowledgeReader({ ...config, product: 'foreign' }).search('Sign in', { scope: f.bundle.frontmatter.scope })).toEqual([])
    expect(listBundles(f.knowledgeRoot, prior())).toHaveLength(1)
    writeFileSync(join(f.dir, 'record.md'), 'corrupt fixture')
    expect(hydrateRows(config, readIndexRows(config), false)).toEqual([])
    expect(scanBundles(config)).toEqual([])
  })
})
