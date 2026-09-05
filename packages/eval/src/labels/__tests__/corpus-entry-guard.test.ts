import { readFileSync } from 'node:fs'
import { sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { canonicalJson } from '../../canonical-json'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import { projectCorpusEntry } from '../corpus-entry'
import { guardCorpusEntry, parseCorpusEntry } from '../corpus-entry-guard'

/**
 * The committed v1 bytes. Copied verbatim (byte-identical `cp`) from the
 * live google-maps `test-00-step-05-d03-leaf` entry BEFORE Plan 10 rewrites
 * the root, so this file is the last committed v1 corpus entry anywhere
 * once the migration lands (414 D-03).
 */
const V1_FIXTURE_TEXT = readFileSync(
  new URL('./fixtures/v1-corpus-entry.json', import.meta.url),
  'utf8',
)

function v1Fixture(): Record<string, unknown> {
  return JSON.parse(V1_FIXTURE_TEXT) as Record<string, unknown>
}

const RUN_ID = 'run / checkout suite 42'
const RUN_SLUG = 'run---checkout-suite-42'
const LEAF_ID = `${RUN_SLUG}/test-00-step-00-d00-leaf`

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function fixtureLeaf(): LeafCassette {
  const handoff: CompletedRunHandoff = makeArtifactRefV2Handoff()
  const found = extractRunCassettes({ handoff, artifacts: fullArtifacts() })
    .cassettes.map((entry) => entry.cassette)
    .find(
      (cassette): cassette is LeafCassette =>
        cassette.granularity === 'leaf' && cassette.id === LEAF_ID,
    )
  if (found === undefined) throw new Error(`missing leaf cassette ${LEAF_ID}`)
  return found
}

/** A minimal well-formed v2 natural document, as committed bytes would be. */
function v2Natural(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    cassetteId: LEAF_ID,
    product: 'demo-app',
    split: 'natural',
    captured_at_ordinal: 37,
    run_links: { runId: RUN_ID, runSlug: RUN_SLUG },
    receiptDigest: 'a'.repeat(64),
    ...overrides,
  }
}

describe('parseCorpusEntry — the v1 arm (414 D-03/D-13)', () => {
  it('admits the committed v1 fixture bytes and normalises them to a v2 natural entry', () => {
    const parsed = parseCorpusEntry(v1Fixture())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.schemaVersion).toBe(1)

    const fixture = v1Fixture()
    const links = fixture.run_links as Record<string, unknown>
    expect(parsed.entry).toEqual({
      schemaVersion: 2,
      cassetteId: fixture.cassetteId,
      product: 'google-maps',
      split: 'natural',
      captured_at_ordinal: 1,
      run_links: { runId: links.runId, runSlug: links.runSlug },
      receiptDigest: fixture.receiptDigest,
    })

    // The dropped path field, and every field that must not be fabricated.
    expect(Object.keys(parsed.entry.run_links)).toEqual(['runId', 'runSlug'])
    expect(Object.keys(parsed.entry)).not.toContain('captured_at')
    expect(Object.keys(parsed.entry)).not.toContain('targetEnvironment')
    expect(Object.keys(parsed.entry)).not.toContain('heldOutVisibility')
    expect(Object.keys(parsed.entry)).not.toContain('generator')
  })

  it('normalises a v1 entry to exactly what projectCorpusEntry emits for that cassette (adjacency, ROOT-06)', () => {
    const cassette = fixtureLeaf()
    const projected = projectCorpusEntry({
      cassette,
      product: 'demo-app',
      runId: RUN_ID,
      assignment: { split: 'natural' },
    })

    // The v1 bytes that the same cassette would have produced before 414:
    // identical fields plus the D-13 path that v2 no longer carries.
    const v1Bytes = {
      schemaVersion: 1,
      cassetteId: projected.cassetteId,
      product: projected.product,
      split: 'natural',
      captured_at_ordinal: projected.captured_at_ordinal,
      run_links: {
        runId: projected.run_links.runId,
        runSlug: projected.run_links.runSlug,
        handoffPath: `.agent-qa/runs/${RUN_SLUG}/handoff.json`,
      },
      receiptDigest: sha256hex(canonicalJson(cassette.receipt)),
    }

    const parsed = parseCorpusEntry(v1Bytes)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // One in-memory shape for one cassetteId: v1 and v2 merge, never collide.
    expect(parsed.entry).toEqual(projected)
  })
})

describe('parseCorpusEntry — the v2 run_links ban (ROOT-08 SC3, D-13)', () => {
  it('refuses a v2 entry whose run_links carries an absolute handoff path', () => {
    const parsed = parseCorpusEntry(
      v2Natural({
        run_links: { runId: RUN_ID, runSlug: RUN_SLUG, handoffPath: '/Users/x/handoff.json' },
      }),
    )

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContain('run_links')
  })

  it('refuses a v2 entry whose run_links carries a relative handoff path', () => {
    const parsed = parseCorpusEntry(
      v2Natural({
        run_links: {
          runId: RUN_ID,
          runSlug: RUN_SLUG,
          handoffPath: '.agent-qa/runs/x/handoff.json',
        },
      }),
    )

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContain('run_links')
  })
})

describe('parseCorpusEntry — D-21 presence rules hold in both directions', () => {
  it('requires heldOutVisibility on a held-out entry and forbids it on a natural one', () => {
    expect(parseCorpusEntry(v2Natural({ split: 'held-out' })).ok).toBe(false)
    expect(parseCorpusEntry(v2Natural({ heldOutVisibility: 'shared' })).ok).toBe(false)

    const admitted = parseCorpusEntry(
      v2Natural({ split: 'held-out', heldOutVisibility: 'private' }),
    )
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(admitted.entry.split).toBe('held-out')
  })

  it('requires generator on an adversarial entry, forbids it elsewhere, and closes generator.kind', () => {
    expect(parseCorpusEntry(v2Natural({ split: 'adversarial' })).ok).toBe(false)
    expect(
      parseCorpusEntry(
        v2Natural({
          split: 'held-out',
          heldOutVisibility: 'shared',
          generator: { kind: 'fuzz-selector', seedCassetteId: 'x/y', generatorVersion: 1 },
        }),
      ).ok,
    ).toBe(false)
    expect(
      parseCorpusEntry(
        v2Natural({
          split: 'adversarial',
          generator: { kind: 'fuzz-html', seedCassetteId: 'x/y', generatorVersion: 1 },
        }),
      ).ok,
    ).toBe(false)

    const admitted = parseCorpusEntry(
      v2Natural({
        split: 'adversarial',
        generator: { kind: 'fuzz-selector', seedCassetteId: 'x/y', generatorVersion: 1 },
      }),
    )
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(admitted.entry.split).toBe('adversarial')
  })
})

describe('parseCorpusEntry — encoding (ROOT-06)', () => {
  it('compares split and heldOutVisibility as exact ASCII literals', () => {
    for (const split of ['Held-Out', 'heldout', 'held_out']) {
      expect(parseCorpusEntry(v2Natural({ split, heldOutVisibility: 'shared' })).ok).toBe(false)
    }
    expect(
      parseCorpusEntry(v2Natural({ split: 'held-out', heldOutVisibility: 'Private' })).ok,
    ).toBe(false)

    expect(
      parseCorpusEntry(v2Natural({ split: 'held-out', heldOutVisibility: 'private' })).ok,
    ).toBe(true)
    expect(
      parseCorpusEntry(v2Natural({ split: 'held-out', heldOutVisibility: 'shared' })).ok,
    ).toBe(true)
  })
})

describe('parseCorpusEntry — empty inputs (ROOT-06)', () => {
  it('refuses empty and non-object inputs without throwing, and guardCorpusEntry throws a TypeError', () => {
    for (const value of [{}, null, [], undefined]) {
      const parsed = parseCorpusEntry(value)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) continue
      expect(parsed.issues.length).toBeGreaterThan(0)

      expect(() => guardCorpusEntry(value)).toThrow(TypeError)
      expect(() => guardCorpusEntry(value)).toThrow(/^corpus entry rejected:/)
    }
  })
})

describe('parseCorpusEntry — the optional D-04 fields', () => {
  it('admits captured_at and targetEnvironment only in their exact spellings', () => {
    const withBoth = parseCorpusEntry(
      v2Natural({ captured_at: '2026-09-04T16:25:54.000Z', targetEnvironment: 'local' }),
    )
    expect(withBoth.ok).toBe(true)
    if (!withBoth.ok) return
    expect(withBoth.entry.captured_at).toBe('2026-09-04T16:25:54.000Z')
    expect(withBoth.entry.targetEnvironment).toBe('local')

    expect(parseCorpusEntry(v2Natural({ targetEnvironment: 'staging' })).ok).toBe(false)
    expect(parseCorpusEntry(v2Natural({ captured_at: 'yesterday' })).ok).toBe(false)

    const withNeither = parseCorpusEntry(v2Natural())
    expect(withNeither.ok).toBe(true)
    if (!withNeither.ok) return
    expect(Object.keys(withNeither.entry)).not.toContain('captured_at')
    expect(Object.keys(withNeither.entry)).not.toContain('targetEnvironment')
  })
})
