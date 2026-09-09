import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BundleOutcomeEventSchema, supersessionKey, type TrustPriorTable } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import { appendOutcomeEvent } from '../bundle-append.js'
import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import { publishBundle, type PublishBundleInput } from '../bundle-publish.test-helper.js'
import { candidateInjectionFor } from '../gates/candidate-injection.js'
import { openKnowledgeReader, withKnowledgeReadSnapshot } from '../index-reader.js'
import { indexDbPath } from '../index-open.js'
import { rebuildIndex } from '../index-rebuild.js'
import { retrieve } from '../retrieve.js'
import { makeBundleDraftFixture, makeDiscriminantFixture } from './fixtures/bundle-fixture.js'

const baseline = JSON.parse(readFileSync(new URL('./fixtures/420-prior-baseline.json', import.meta.url), 'utf8')) as {
  cases: { name: string; input: PublishBundleInput; appended: unknown[]; snapshots: { expectedBytes: string }[] }[]
}
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const prior = (): TrustPriorTable => ({ 'agent-observed': { alpha: 1.8, beta: 0.2 }, 'agent-verified': { alpha: 0.3, beta: 2.7 } })

function persist(name = 'agent-observed-clean', stage = 5) {
  const entry = baseline.cases.find(row => row.name === name)!
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-retrieve-'))
  roots.push(root)
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'fixture-storefront', auditBaseDir: join(root, 'audit'), commitArtifacts: 'none' as const }
  const published = publishBundle(config, entry.input)
  if (published.kind !== 'published') throw new Error('fixture publication refused')
  for (const event of entry.appended.slice(0, stage)) expect(appendOutcomeEvent(config, published.id, BundleOutcomeEventSchema.parse(event)).kind).toBe('appended')
  const loaded = loadBundle(published.dir)
  if (loaded.kind !== 'loaded') throw new Error('fixture read refused')
  return { ...config, ...published, bundle: loaded.bundle, expected: JSON.parse(entry.snapshots[stage]!.expectedBytes) }
}

describe('420 retrieval prior continuity', () => {
  it('refreshes indexed and scan hits using the same caller snapshot', async () => {
    const f = persist()
    const mutable = prior()
    const scan = openKnowledgeReader(f.knowledgeRoot, { priors: mutable })
    await rebuildIndex({ knowledgeRoot: f.knowledgeRoot })
    const indexed = openKnowledgeReader(f.knowledgeRoot, { priors: mutable })
    mutable['agent-observed']!.alpha = 0
    try {
      expect(scan.source).toBe('scan')
      expect(indexed.source).toBe('index')
      const expected = deriveBundleTrust(f.bundle, prior()).trust
      for (const reader of [indexed, scan]) {
        expect(reader.getById(f.id)!.trust).toBe(expected)
        expect(reader.searchLexical('Sign in')[0]!.trust).toBe(expected)
        expect(reader.lookupAnchor(f.bundle.frontmatter.anchors[0]!.normalized)[0]!.trust).toBe(expected)
        await withKnowledgeReadSnapshot(reader, context => {
          expect(context.priors).toEqual(prior())
          expect(Object.isFrozen(context.priors)).toBe(true)
          expect(context.recheck([reader.getById(f.id)!], true)[0]!.trust).toBe(expected)
        })
      }
    } finally { indexed.close(); scan.close() }
  })

  it('reranks numerical trust before limiting indexed and scan results', async () => {
    const f = persist()
    const published = publishBundle(f, { ...baseline.cases[2]!.input,
      draft: makeBundleDraftFixture({ summary: 'Sign in second control' }),
      discriminant: { kind: 'fact', subtype: 'selector', elementRef: { role: 'Button', name: 'Second' } },
      initialEvents: f.bundle.events,
    })
    if (published.kind !== 'published') throw new Error('second fixture refused')
    const scan = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    await rebuildIndex({ knowledgeRoot: f.knowledgeRoot })
    const indexed = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    const provisional = openKnowledgeReader(f.knowledgeRoot)
    const query = { intent: '', anchors: [f.bundle.frontmatter.anchors[0]!.normalized] }
    const options = { n: 1, product: f.productKey, asOfBuild: 15 }
    try {
      expect((await retrieve(provisional, query, options))[0]!.id).toBe(published.id)
      const expected = deriveBundleTrust(f.bundle, prior()).trust
      for (const reader of [indexed, scan]) {
        expect(await retrieve(reader, query, options)).toMatchObject([{ id: f.id, trust: expected }])
      }
    } finally { indexed.close(); scan.close(); provisional.close() }
  })

  it('retains the snapshot across the live index failure and async retry', async () => {
    const f = persist()
    await rebuildIndex({ knowledgeRoot: f.knowledgeRoot })
    const reader = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    const db = new DatabaseSync(indexDbPath(f.knowledgeRoot))
    db.exec('DROP TABLE fts_records')
    db.close()
    try {
      const hits = await retrieve(reader, { intent: 'Sign in', anchors: [f.bundle.frontmatter.anchors[0]!.normalized] }, { n: 5, product: f.productKey, asOfBuild: 15 })
      expect(reader.source).toBe('scan')
      expect(hits).toMatchObject([{ id: f.id, trust: deriveBundleTrust(f.bundle, prior()).trust }])
      expect(reader.getById(f.id)!.trust).toBe(hits[0]!.trust)
    } finally { reader.close() }
  })

  it('candidate injection carries numerical trust while preserving rendered wording', () => {
    const f = persist('agent-observed-clean', 0)
    const original = candidateInjectionFor({ knowledgeRoot: f.knowledgeRoot, candidateId: f.id })
    const result = candidateInjectionFor({ knowledgeRoot: f.knowledgeRoot, candidateId: f.id, priors: prior() })
    if (original.kind !== 'found' || result.kind !== 'found') throw new Error('candidate fixture not found')
    expect(result.injection.line.trust).toBe(0.9)
    expect(result.injection.renderedLine).toBe(original.injection.renderedLine)
    expect(result.injection.status).toBe(original.injection.status)
  })

  it('hydrates memory-off unknowns with the caller prior before public projection', async () => {
    const f = persist()
    const marker = `thrash:${supersessionKey(f.bundle.frontmatter.anchors.map(a => a.normalized))}:window:1`
    const unknown = publishBundle(f, { ...baseline.cases[4]!.input,
      draft: makeBundleDraftFixture({ kind: 'unknown', anchors: [{ t: 'flow', name: marker }] }),
      discriminant: makeDiscriminantFixture('unknown'), initialEvents: f.bundle.events,
    })
    if (unknown.kind !== 'published') throw new Error('unknown fixture refused')
    const reader = openKnowledgeReader(f.knowledgeRoot, { priors: prior() })
    try {
      const hits = await retrieve(reader, { intent: '', anchors: [f.bundle.frontmatter.anchors[0]!.normalized] }, { n: 5, product: f.productKey, asOfBuild: 15 })
      expect(hits).toMatchObject([{ id: unknown.id, trust: deriveBundleTrust(f.bundle, prior()).trust }])
    } finally { reader.close() }
  })

  it('absent and empty readers preserve original persisted trust and lifecycle', async () => {
    for (const entry of baseline.cases) {
      const f = persist(entry.name)
      await rebuildIndex({ knowledgeRoot: f.knowledgeRoot })
      const original = openKnowledgeReader(f.knowledgeRoot)
      const empty = openKnowledgeReader(f.knowledgeRoot, { priors: {} })
      try {
        expect(empty.getById(f.id)).toEqual(original.getById(f.id))
        expect(empty.getById(f.id)).toMatchObject({ trust: f.expected.trust, status: f.expected.status, validity: f.expected.validity })
      } finally { empty.close(); original.close() }
    }
  })
})
