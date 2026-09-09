import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BundleOutcomeEventSchema, canonicalJson, foldBundleTrust, type TrustPriorTable } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { appendOutcomeEvent } from '../bundle-append.js'
import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import { publishBundle, type PublishBundleInput } from '../bundle-publish.test-helper.js'
import { applyIndexDeltaForBundle, applyIndexDeltaForBundleWithinCurrentAuthority, deriveIndexRowFromBundle } from '../curator/commit.js'
import { indexDbPath } from '../index-open.js'
import { projectBundleIndexRow, projectBundleIndexRowWithinCurrentAuthority, rebuildIndex } from '../index-rebuild.js'
import { acquireWriterLease, releaseLease, withCurrentWriterAuthority } from '../lease/writer-lease.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/420-prior-baseline.json', import.meta.url), 'utf8')) as {
  cases: { name: string; input: PublishBundleInput; appended: unknown[]; snapshots: { expectedBytes: string }[] }[]
}
const calibrated: TrustPriorTable = { 'agent-verified': { alpha: 2.7, beta: 0.3 } }
const derive = deriveBundleTrust

function persist(root: string, entry: typeof fixture.cases[number]) {
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'baseline', auditBaseDir: join(root, 'audit'), commitArtifacts: 'none' as const }
  const published = publishBundle(config, entry.input)
  if (published.kind !== 'published') throw new Error('prior projection fixture publication refused')
  for (const event of entry.appended) expect(appendOutcomeEvent(config, published.id, BundleOutcomeEventSchema.parse(event)).kind).toBe('appended')
  const loaded = loadBundle(published.dir)
  if (loaded.kind !== 'loaded') throw new Error('prior projection fixture load refused')
  return { ...config, bundleId: published.id, bundle: loaded.bundle }
}

function row(knowledgeRoot: string) {
  const db = new DatabaseSync(indexDbPath(knowledgeRoot), { readOnly: true })
  try { return { ...db.prepare('SELECT * FROM records').get()! } }
  finally { db.close() }
}

function assertProjection(value: ReturnType<typeof persist>, expectedBytes: string, priors?: TrustPriorTable) {
  const original = JSON.parse(expectedBytes)
  const expected = foldBundleTrust(value.bundle.events, {
    originClass: value.bundle.provenance.originClass,
    evidenceIncomplete: value.bundle.manifest.evidenceIncomplete,
    createdAtOrdinal: value.bundle.manifest.createdAtOrdinal,
  }, priors)
  expect(derive(value.bundle, priors)).toEqual(expected)
  if (priors === undefined || Object.keys(priors).length === 0) expect(canonicalJson(expected)).toBe(expectedBytes)
  const actual = row(value.knowledgeRoot)
  expect(actual).toMatchObject({
    trust: expected.trust, confirmed: original.counters.confirmed,
    contradicted: original.counters.contradicted, helpful: original.counters.helpful,
    harmful: original.counters.harmful, status: original.status,
    opened_at_ordinal: original.validity.openedAtOrdinal,
    closed_at_ordinal: original.validity.closedAtOrdinal ?? null,
    last_confirmed_ordinal: original.lastConfirmedOrdinal,
  })
  return actual
}

describe('420 neutral prior bundle and SQLite projections', () => {
  it('derives supplied priors from a real persisted bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-read-'))
    try {
      const value = persist(root, fixture.cases[2]!)
      const expected = foldBundleTrust(value.bundle.events, { originClass: 'agent-verified', evidenceIncomplete: false, createdAtOrdinal: 10 }, calibrated)
      expect(derive(value.bundle, calibrated).trust).toBe(expected.trust)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  for (const entry of fixture.cases) {
    it(`full rebuild preserves ${entry.name} with absent empty and partial priors`, async () => {
      let original: Record<string, unknown> | undefined
      for (const priors of [undefined, {}, calibrated]) {
        const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-rebuild-'))
        try {
          const value = persist(root, entry)
          const options = { knowledgeRoot: value.knowledgeRoot, priors }
          expect((await rebuildIndex(options)).projected).toBe(1)
          const { trust: numerical, ...rest } = assertProjection(value, entry.snapshots.at(-1)!.expectedBytes, priors)
          if (original === undefined) original = rest
          else expect(rest).toEqual(original)
          expect((await rebuildIndex(options)).projected).toBe(0)
          expect(row(value.knowledgeRoot).trust).toBe(numerical)
        } finally { rmSync(root, { recursive: true, force: true }) }
      }
    })
  }

  for (const project of [projectBundleIndexRow, projectBundleIndexRowWithinCurrentAuthority,
    applyIndexDeltaForBundle, applyIndexDeltaForBundleWithinCurrentAuthority, deriveIndexRowFromBundle]) {
    it(`${project.name} forwards every prior mode through the authoritative upsert`, () => {
      const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-delta-'))
      const entry = fixture.cases[3]!
      try {
        const value = persist(root, entry)
        const lease = acquireWriterLease(value.knowledgeRoot)
        if (lease.kind !== 'acquired') throw new Error('prior projection lease refused')
        const authority = { knowledgeRoot: value.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch }
        try {
          let original: Record<string, unknown> | undefined
          for (const priors of [undefined, {}, calibrated, undefined]) {
            const input = { knowledgeRoot: value.knowledgeRoot, bundleId: value.bundleId, product: 'baseline', priors }
            withCurrentWriterAuthority(value.knowledgeRoot, authority, () => project(input))
            const { trust: numerical, ...rest } = assertProjection(value, entry.snapshots.at(-1)!.expectedBytes, priors)
            expect(Number.isFinite(numerical)).toBe(true)
            if (original === undefined) original = rest
            else expect(rest).toEqual(original)
          }
        } finally { releaseLease(authority) }
      } finally { rmSync(root, { recursive: true, force: true }) }
    })
  }
})
