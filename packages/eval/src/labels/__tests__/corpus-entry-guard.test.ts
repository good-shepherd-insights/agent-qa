import { describe, expect, it } from 'vitest'
import { guardCorpusEntry, parseCorpusEntry } from '../corpus-entry-guard'

const RUN_ID = 'run / checkout suite 42'
const RUN_SLUG = 'run---checkout-suite-42'
const LEAF_ID = `${RUN_SLUG}/test-00-step-00-d00-leaf`

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

describe('parseCorpusEntry — the stamp', () => {
  it.each([1, 3])('refuses a corpus entry stamped %i', (stamp) => {
    const parsed = parseCorpusEntry(v2Natural({ schemaVersion: stamp }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toBe('<root>: not a corpus entry (schemaVersion must be 2)')
    expect(() => guardCorpusEntry(v2Natural({ schemaVersion: stamp }))).toThrow(TypeError)
  })

  it('admits a corpus entry stamped 2', () => {
    const parsed = parseCorpusEntry(v2Natural())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.schemaVersion).toBe(2)
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
  it('round trips optional feedback on every shape and refuses invalid provenance words', () => {
    const feedback = { source: 'canary-feedback', attributedObservationId: 'observation-fixture', benefit: 'rode-along' }
    for (const split of [{ split: 'natural' }, { split: 'held-out', heldOutVisibility: 'private' }]) {
      const entry = v2Natural({ ...split, ...feedback })
      expect(guardCorpusEntry(entry)).toEqual(entry)
    }
    for (const invalid of [{ source: 'bogus' }, { benefit: 'bogus' }, { attributedObservationId: '' }]) {
      expect(parseCorpusEntry(v2Natural({ ...feedback, ...invalid })).ok).toBe(false)
    }
  })
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
