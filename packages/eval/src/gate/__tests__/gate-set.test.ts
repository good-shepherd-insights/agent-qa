// 414 Task 1 — the gate-time core (ROOT-08 SC3, ROOT-09 SC4's eval half).
//
// `selectGateSet` takes a product partition and ONE candidate's provenance and
// returns the entries that candidate may be gated on, minus every entry the
// candidate itself bred. Each removal carries a typed reason, so an exclusion
// is never a silent drop (the `silver-sampling.ts` doctrine).
//
// The three cells that carry the requirement: Test 3 (a candidate with no
// provenance is REFUSED rather than handed a gate set it cannot have earned —
// D-11), Test 4 (a below-minimum gate set is a named verdict, never an `ok`),
// and Test 6 (exclusion keys on the three provenance fields and never on a
// path — the same entry with and without a `handoffPath` excludes identically).
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import type {
  CorpusEntry,
  CorpusEntryBase,
  NaturalCorpusEntry,
  PrivateHeldOutCorpusEntry,
  SharedHeldOutCorpusEntry,
} from '../../labels/corpus-entry'
import { parseCorpusEntry } from '../../labels/corpus-entry-guard'
import {
  EXCLUSION_REASONS,
  countGateSet,
  emptyGateSetCounts,
  selectGateSet,
  type CandidateProvenance,
  type GateSetVerdict,
} from '../gate-set'

const PRODUCT = 'example-web'

/** 64 lower-hex, distinct per tag — the tag itself is hex-safe. */
function digestOf(tag: string): string {
  return tag.padEnd(64, '0')
}

/** Distinct per cassette and never small — the small ordinals are candidate keys. */
function ordinalOf(cassetteId: string): number {
  return 100 + cassetteId.charCodeAt(cassetteId.length - 1)
}

function base(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): CorpusEntryBase {
  return {
    schemaVersion: 2,
    cassetteId,
    product: PRODUCT,
    captured_at_ordinal: ordinalOf(cassetteId),
    run_links: { runId: `run-${cassetteId}`, runSlug: `run-${cassetteId}` },
    receiptDigest: digestOf(cassetteId),
    ...overrides,
  }
}

function natural(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): NaturalCorpusEntry {
  return { ...base(cassetteId, overrides), split: 'natural' }
}

function heldOutShared(
  cassetteId: string,
  overrides: Partial<CorpusEntryBase> = {},
): SharedHeldOutCorpusEntry {
  return { ...base(cassetteId, overrides), split: 'held-out', heldOutVisibility: 'shared' }
}

function heldOutPrivate(
  cassetteId: string,
  overrides: Partial<CorpusEntryBase> = {},
): PrivateHeldOutCorpusEntry {
  return { ...base(cassetteId, overrides), split: 'held-out', heldOutVisibility: 'private' }
}

function adversarial(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): CorpusEntry {
  return {
    ...base(cassetteId, overrides),
    split: 'adversarial',
    generator: { kind: 'fuzz-selector', seedCassetteId: 'c0', generatorVersion: 1 },
  }
}

function candidate(overrides: Partial<CandidateProvenance> = {}): CandidateProvenance {
  return { runIds: [], receiptDigests: [], capturedAtOrdinals: [], ...overrides }
}

function expectOk(verdict: GateSetVerdict): Extract<GateSetVerdict, { verdict: 'ok' }> {
  if (verdict.verdict !== 'ok') {
    throw new Error(`expected an ok gate set, got ${verdict.verdict}`)
  }
  return verdict
}

function expectEmptyGateSet(
  verdict: GateSetVerdict,
): Extract<GateSetVerdict, { verdict: 'empty-gate-set' }> {
  if (verdict.verdict !== 'empty-gate-set') {
    throw new Error(`expected an empty-gate-set verdict, got ${verdict.verdict}`)
  }
  return verdict
}

describe('selectGateSet', () => {
  it('excludes on run, receipt and ordinal, each with its own reason, and counts before and after', () => {
    const runA = 'run-alpha'
    const entries: CorpusEntry[] = [
      natural('c1', { run_links: { runId: runA, runSlug: runA } }),
      natural('c2'),
      heldOutShared('c3'),
      heldOutShared('c4'),
      heldOutPrivate('c5', { captured_at_ordinal: 7 }),
      adversarial('c6'),
    ]

    const result = expectOk(
      selectGateSet({
        entries,
        product: PRODUCT,
        candidate: candidate({
          runIds: [runA],
          receiptDigests: [digestOf('c3')],
          capturedAtOrdinals: [7],
        }),
        minimumGateSet: 1,
      }),
    )

    expect(result.excluded).toEqual([
      { cassetteId: 'c1', reason: 'run-contributed' },
      { cassetteId: 'c3', reason: 'receipt-contributed' },
      { cassetteId: 'c5', reason: 'ordinal-contributed' },
    ])
    expect(result.gateEntries.map(entry => entry.cassetteId)).toEqual(['c2', 'c4', 'c6'])
    expect(result.counts.before).toEqual({
      natural: 2,
      heldOutShared: 2,
      heldOutPrivate: 1,
      adversarial: 1,
    })
    expect(result.counts.after).toEqual({
      natural: 1,
      heldOutShared: 1,
      heldOutPrivate: 0,
      adversarial: 1,
    })
  })

  it('merges adjacent matches into ONE exclusion at the highest-precedence reason', () => {
    const runB = 'run-bravo'
    const tripleDigest = digestOf('cbb')
    const doubleDigest = digestOf('cdd')
    const entries: CorpusEntry[] = [
      // matches all three keys at once
      natural('c1', {
        run_links: { runId: runB, runSlug: runB },
        receiptDigest: tripleDigest,
        captured_at_ordinal: 9,
      }),
      // matches receipt AND ordinal
      natural('c2', { receiptDigest: doubleDigest, captured_at_ordinal: 11 }),
      natural('c3'),
    ]

    const result = expectOk(
      selectGateSet({
        entries,
        product: PRODUCT,
        candidate: candidate({
          runIds: [runB],
          receiptDigests: [tripleDigest, doubleDigest],
          capturedAtOrdinals: [9, 11],
        }),
        minimumGateSet: 1,
      }),
    )

    expect(result.excluded).toEqual([
      { cassetteId: 'c1', reason: 'run-contributed' },
      { cassetteId: 'c2', reason: 'receipt-contributed' },
    ])
    expect(result.gateEntries.map(entry => entry.cassetteId)).toEqual(['c3'])
  })

  it('refuses an unprovenanced candidate, and reports an empty partition as empty', () => {
    // D-11: no keys at all is a REFUSAL, never "nothing to exclude".
    const refused = selectGateSet({
      entries: [natural('c1')],
      product: PRODUCT,
      candidate: candidate(),
      minimumGateSet: 1,
    })
    expect(refused).toEqual({ verdict: 'unprovenanced-candidate' })
    expect(Object.keys(refused)).toEqual(['verdict'])

    // A real candidate over a partition with nothing in it is a DIFFERENT answer.
    const empty = expectEmptyGateSet(
      selectGateSet({
        entries: [natural('c1', { product: 'some-other-product' })],
        product: PRODUCT,
        candidate: candidate({ runIds: ['run-nothing-matches'] }),
        minimumGateSet: 1,
      }),
    )
    expect(empty.reason).toBe('empty')
    expect(empty.excluded).toEqual([])
    expect(empty.counts.before).toEqual(emptyGateSetCounts())
    expect(empty.counts.after).toEqual(emptyGateSetCounts())
  })

  it('treats the minimum as an integer floor: at it is ok, one below it is below-minimum', () => {
    const entries: CorpusEntry[] = [natural('c1'), natural('c2'), natural('c3')]
    const noMatch = candidate({ runIds: ['run-nothing-matches'] })

    // Exactly at the minimum.
    const atFloor = expectOk(
      selectGateSet({ entries, product: PRODUCT, candidate: noMatch, minimumGateSet: 3 }),
    )
    expect(atFloor.gateEntries).toHaveLength(3)

    // One below it.
    const below = expectEmptyGateSet(
      selectGateSet({
        entries,
        product: PRODUCT,
        candidate: candidate({ runIds: ['run-c1'] }),
        minimumGateSet: 3,
      }),
    )
    expect(below.reason).toBe('below-minimum')
    expect(below.minimumGateSet).toBe(3)
    expect(below.excluded).toEqual([{ cassetteId: 'c1', reason: 'run-contributed' }])
    expect(below.counts.before).toEqual({
      natural: 3,
      heldOutShared: 0,
      heldOutPrivate: 0,
      adversarial: 0,
    })
    expect(below.counts.after).toEqual({
      natural: 2,
      heldOutShared: 0,
      heldOutPrivate: 0,
      adversarial: 0,
    })

    // A minimum that is not a positive integer can only be a caller bug.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        selectGateSet({ entries, product: PRODUCT, candidate: noMatch, minimumGateSet: bad }),
      ).toThrow(TypeError)
    }
  })

  it('gates on private held-out entries and never reaches another product', () => {
    const entries: CorpusEntry[] = [
      heldOutPrivate('c1'),
      natural('c2', { product: 'some-other-product' }),
    ]

    const result = expectOk(
      selectGateSet({
        entries,
        product: PRODUCT,
        candidate: candidate({ runIds: ['run-c2'], capturedAtOrdinals: [ordinalOf('c2')] }),
        minimumGateSet: 1,
      }),
    )

    // D-09: private entries GATE — `isProposerVisibleEntry` has no say here.
    expect(result.gateEntries.map(entry => entry.cassetteId)).toEqual(['c1'])
    expect(result.counts.before.heldOutPrivate).toBe(1)
    // The foreign entry matched the candidate on two keys and STILL never appears:
    // it is not in the partition, so it is neither gated on nor excluded.
    expect(result.excluded).toEqual([])
  })

  it('never keys on a path: the same entry with and without a handoffPath excludes identically', () => {
    const fixtureUrl = new URL(
      '../../labels/__tests__/fixtures/v1-corpus-entry.json',
      import.meta.url,
    )
    const bytes = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as {
      run_links: { handoffPath: string }
    }
    const handoffPath = bytes.run_links.handoffPath
    expect(handoffPath).toContain('/')

    const parsed = parseCorpusEntry(bytes)
    if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.issues}`)

    // The normalised v2 entry (no path anywhere) and a hand-built copy that
    // smuggles the original path string back onto `run_links`.
    const without = parsed.entry
    const withPath = {
      ...without,
      run_links: { ...without.run_links, handoffPath },
    } as unknown as CorpusEntry

    // The candidate offers the PATH as a provenance key. Nothing may match it.
    const pathCandidate = candidate({ runIds: [handoffPath] })

    const a = expectOk(
      selectGateSet({
        entries: [without],
        product: without.product,
        candidate: pathCandidate,
        minimumGateSet: 1,
      }),
    )
    const b = expectOk(
      selectGateSet({
        entries: [withPath],
        product: without.product,
        candidate: pathCandidate,
        minimumGateSet: 1,
      }),
    )

    expect(a.excluded).toEqual([])
    expect(b.excluded).toEqual(a.excluded)
    expect(b.gateEntries.map(entry => entry.cassetteId)).toEqual(
      a.gateEntries.map(entry => entry.cassetteId),
    )
  })

  it('is order-independent: a shuffled partition serialises identically', () => {
    const entries: CorpusEntry[] = [
      natural('c3'),
      heldOutShared('c1'),
      adversarial('c5'),
      heldOutPrivate('c2'),
      natural('c4'),
    ]
    const shuffled: CorpusEntry[] = [entries[4], entries[0], entries[3], entries[2], entries[1]]
    const provenance = candidate({
      runIds: ['run-c1'],
      receiptDigests: [digestOf('c4')],
      capturedAtOrdinals: [ordinalOf('c5')],
    })

    const inOrder = expectOk(
      selectGateSet({ entries, product: PRODUCT, candidate: provenance, minimumGateSet: 1 }),
    )
    const outOfOrder = expectOk(
      selectGateSet({
        entries: shuffled,
        product: PRODUCT,
        candidate: provenance,
        minimumGateSet: 1,
      }),
    )

    expect(canonicalJson(outOfOrder)).toBe(canonicalJson(inOrder))
    expect(inOrder.excluded.map(exclusion => exclusion.cassetteId)).toEqual(['c1', 'c4', 'c5'])
    expect(inOrder.gateEntries.map(entry => entry.cassetteId)).toEqual(['c2', 'c3'])
  })
})

describe('countGateSet', () => {
  it('declares exactly the three exclusion reasons, in declaration order, and counts all four splits', () => {
    expect(EXCLUSION_REASONS).toEqual([
      'run-contributed',
      'receipt-contributed',
      'ordinal-contributed',
    ])
    expect(emptyGateSetCounts()).toEqual({
      natural: 0,
      heldOutShared: 0,
      heldOutPrivate: 0,
      adversarial: 0,
    })
    expect(
      countGateSet([
        natural('c1'),
        heldOutShared('c2'),
        heldOutPrivate('c3'),
        heldOutPrivate('c4'),
        adversarial('c5'),
      ]),
    ).toEqual({ natural: 1, heldOutShared: 1, heldOutPrivate: 2, adversarial: 1 })
  })
})
