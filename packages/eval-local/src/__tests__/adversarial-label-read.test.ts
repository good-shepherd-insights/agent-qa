/**
 * 422-02-T2 — derived labels and adversarial entries through the REAL committed read leg.
 *
 * The eval-core cells prove the pure factory and the pure guards. This file proves the thing
 * an operator actually depends on: that the bytes land on disk, that a FRESH reader — the
 * proposer's own door — resolves the derived cassette with the seed's gold and its
 * `derivedFrom` marker intact, that pre-422 bytes beside them are untouched, and that a
 * partial marker is REFUSED at the read rather than normalized into something executable.
 *
 * Nothing here mutates a committed byte: every assertion re-hashes the files it wrote.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  canonicalJson,
  deriveAdversarialCassetteId,
  deriveAdversarialLabel,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
} from '@vostride/agent-qa-eval'
import type {
  CorpusGenerator,
  LeafCassette,
  StandaloneLabelRecord,
} from '@vostride/agent-qa-eval'
import { asRunId, sha256hex } from '@vostride/agent-qa-schema'
import { readCommittedCorpus } from '../index.js'
import { openCorpusReader } from '../reader.js'
import {
  committedCassettePath,
  committedCorpusPath,
  committedLabelPath,
} from '../committed-root-store.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const PRODUCT = 'fixture'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(root: string, path: string, value: unknown): string {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(value))
  return target
}

function digestOf(path: string): string {
  return sha256hex(readFileSync(path, 'utf8'))
}

interface Fixture {
  root: string
  seed: LeafCassette
  seedLabel: StandaloneLabelRecord
  seedPaths: readonly string[]
  derived: LeafCassette
  derivedLabel: StandaloneLabelRecord
  derivedEntry: unknown
  generator: CorpusGenerator
}

/**
 * A committed root holding one natural seed and one adversarial derivation of it. The
 * derived documents come out of the shipped pure factories, so what is written here is what
 * `refreshAdversarialSplit` writes.
 */
function setup(overrides: { label?: unknown; entry?: unknown } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-adversarial-read-'))
  roots.push(root)
  const handoff = makeLocalV2Handoff()
  handoff.runId = asRunId('run / adversarial label read')
  const extracted = extractRunCassettes({
    handoff,
    artifacts: {
      getBlob: sha => (sha === LOCAL_FIXTURE_BLOB_SHA ? LOCAL_FIXTURE_BLOB_BYTES : undefined),
    },
  })
  const seed = extracted.cassettes
    .map(row => row.cassette)
    .find((row): row is LeafCassette => row.granularity === 'leaf')
  if (seed === undefined) throw new Error('fixture leaf cassette missing')

  const runId = String(handoff.runId)
  const seedEntry = projectCorpusEntry({
    cassette: seed,
    product: PRODUCT,
    runId,
    assignment: { split: 'natural' },
  })
  const seedLabel = projectSilverLabelRecord({ cassette: seed, runId })

  const generator: CorpusGenerator = {
    kind: 'fuzz-label',
    seedCassetteId: seed.id,
    generatorVersion: 2,
    mutator: 'confusable',
    tableVersion: ADVERSARIAL_TABLE_VERSION,
    tableHash: ADVERSARIAL_TABLE_HASH,
  }
  const derived: LeafCassette = {
    ...seed,
    id: deriveAdversarialCassetteId({
      seedCassetteId: seed.id,
      kind: generator.kind,
      mutator: 'confusable',
      tableVersion: ADVERSARIAL_TABLE_VERSION,
    }),
  }
  const derivedLabel = deriveAdversarialLabel({ cassette: derived, seedLabel, generator })
  const derivedEntry = projectCorpusEntry({
    cassette: derived,
    product: PRODUCT,
    runId,
    assignment: { split: 'adversarial', generator },
  })

  const seedPaths = [
    write(root, committedCassettePath(PRODUCT, seed.id), seed),
    write(root, committedCorpusPath(PRODUCT, seed.id), seedEntry),
    write(root, committedLabelPath(PRODUCT, seed.id), seedLabel),
  ]
  write(root, committedCassettePath(PRODUCT, derived.id), derived)
  write(root, committedCorpusPath(PRODUCT, derived.id), overrides.entry ?? derivedEntry)
  write(root, committedLabelPath(PRODUCT, derived.id), overrides.label ?? derivedLabel)

  return { root, seed, seedLabel, seedPaths, derived, derivedLabel, derivedEntry, generator }
}

function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value }
  delete copy[key]
  return copy
}

describe('422-02 committed reads of derived adversarial labels', () => {
  it('resolves the derived entry, its cloned gold and its derivedFrom marker through a fresh reader', () => {
    const f = setup()
    const reader = openCorpusReader(f.root)
    const entries = reader.listEntries(PRODUCT)
    expect(entries.map(entry => entry.split).sort()).toEqual(['adversarial', 'natural'])

    const label = reader.loadLabel(f.derived.id)
    expect(label.kind).toBe('loaded')
    if (label.kind !== 'loaded') throw new Error('derived label unreadable')
    expect(canonicalJson(label.record)).toBe(canonicalJson(f.derivedLabel))
    expect(label.record.derivedFrom).toEqual({
      seedCassetteId: f.seed.id,
      generator: f.generator,
    })
    // D-06: the seed's run travels with the clone, so ROOT-03 keeps excluding it.
    expect(label.record.provenance.runId).toBe(f.seedLabel.provenance.runId)
    expect(label.record.provenance.capturedAtOrdinal).toBe(
      f.seedLabel.provenance.capturedAtOrdinal,
    )
    expect(reader.loadCassette(f.derived.id).kind).toBe('loaded')
    expect(readCommittedCorpus(f.root).refusals).toEqual([])
  })

  it('leaves every pre-422 committed byte exactly as it was written', () => {
    const f = setup()
    const before = f.seedPaths.map(digestOf)
    const read = readCommittedCorpus(f.root)
    expect(read.refusals).toEqual([])
    expect(canonicalJson(read.snapshot.labelsById.get(f.seed.id))).toBe(
      canonicalJson(f.seedLabel),
    )
    expect(Object.hasOwn(read.snapshot.labelsById.get(f.seed.id)!, 'derivedFrom')).toBe(false)
    expect(f.seedPaths.map(digestOf)).toEqual(before)
  })

  it('refuses a derived label whose generator metadata is partial, and only that entry', () => {
    for (const dropped of ['mutator', 'tableVersion', 'tableHash'] as const) {
      const base = setup()
      const broken = {
        ...base.derivedLabel,
        derivedFrom: {
          seedCassetteId: base.seed.id,
          generator: omit({ ...base.generator }, dropped),
        },
      }
      const f = setup({ label: broken })
      const read = readCommittedCorpus(f.root)
      expect(read.refusals.length).toBeGreaterThan(0)
      expect(read.snapshot.labelsById.has(f.derived.id)).toBe(false)
      // The untouched natural seed beside it still reads.
      expect(read.snapshot.labelsById.has(f.seed.id)).toBe(true)
      expect(openCorpusReader(f.root).loadLabel(f.derived.id).kind).toBe('not-found')
    }
  })

  it('refuses an adversarial corpus entry whose generator metadata is partial', () => {
    for (const dropped of ['mutator', 'tableVersion', 'tableHash'] as const) {
      const base = setup()
      const entry = base.derivedEntry as Record<string, unknown>
      const broken = {
        ...entry,
        generator: omit(entry.generator as Record<string, unknown>, dropped),
      }
      const f = setup({ entry: broken })
      const read = readCommittedCorpus(f.root)
      expect(read.refusals.some(row => row.reason.includes('generator'))).toBe(true)
      expect(read.snapshot.entries.map(row => row.cassetteId)).toEqual([f.seed.id])
      expect(openCorpusReader(f.root).listEntries(PRODUCT).map(row => row.split)).toEqual([
        'natural',
      ])
    }
  })
})
