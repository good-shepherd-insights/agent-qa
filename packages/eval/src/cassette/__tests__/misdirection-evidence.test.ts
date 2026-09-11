// The circularity evidence's CASSETTE leg (Phase 422, plan 12 — D-17).
//
// A cassette is the only artifact in this system that leaves the run directory: it is committed
// to the eval corpus, replayed by the gate, and read by builds that are not the one that wrote
// it. Its `label.rootCause` slot has carried a `Verdict` shape since 373 and has never been
// populated — so the two members 422-11 added to `Verdict` reach this boundary as keys the
// cassette parser has literally never seen.
//
// TWO THINGS ARE PROVEN HERE, AND THEY ARE NOT THE SAME THING.
//
//   1. THE ROUND TRIP IS REAL. Every cell below runs the actual extractor over an actual
//      handoff, serializes the emitted cassette to JSON, and parses those bytes back through
//      `guardCassette`. Writing a label and reading it with the function that wrote it would
//      prove only that the projection is a bijection with itself.
//
//   2. THE PARSER NOW HAS AN OPINION. `verdictBaseShape` is `.passthrough()`, so before this
//      plan a forged `misdirectionRuledOut` — half a block, a row with no run identity, a trust
//      word outside the closed pair — sailed through unexamined and unrefused. Passthrough is
//      not validation: it means "I did not look". The refusal cells below are the ones that
//      would silently pass on a parser that merely carries the keys along.
//
// CASSETTE_SCHEMA_VERSION does NOT move. The members are optional-additive inside an optional
// block that no committed cassette carries, which is exactly the 373 precedent for admitting a
// required field inside `label.rootCause` at an unchanged envelope version.

import type { CompletedRunHandoff, MisdirectionRecordResult, Verdict } from '@vostride/agent-qa-schema'
import { asRecordId, misdirectionSourceDigest } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import { CASSETTE_SCHEMA_VERSION, guardCassette } from '../../index'
import type { ArtifactSource, LeafCassette } from '../../index'
import { extractRunCassettes } from '../../extract/extract-run'
import { projectLabelLeg } from '../../extract/label-leg'

const CANDIDATE_RECORD = asRecordId('rec_checkout_button')
const CANARY_RECORD = asRecordId('rec_checkout_flow')

const EMPTY_SOURCE: ArtifactSource = { getBlob: () => undefined }

const BASE_DIGEST = misdirectionSourceDigest(makeV2Handoff())

function row(overrides: Partial<MisdirectionRecordResult> = {}): MisdirectionRecordResult {
  return {
    runId: makeV2Handoff().runId,
    perTest: 1,
    stepIndex: 0,
    decisionOrdinal: 0,
    recordId: CANDIDATE_RECORD,
    handoffBaseDigest: BASE_DIGEST,
    briefDigest: 'brief-digest-1',
    corpusDigest: 'corpus-digest-1',
    profileDigest: 'profile-digest-1',
    crossCheck: 'held',
    seedHonored: true,
    ...overrides,
  }
}

const ROWS: MisdirectionRecordResult[] = [
  row({ samples: { k: 2, seeds: [9, 10], modelCalls: 2 } }),
  row({ recordId: CANARY_RECORD, stepIndex: 2, crossCheck: 'inconclusive', reason: 'replay unavailable' }),
]

function verdictWith(overrides: Partial<Verdict> = {}): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.7,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'Continue stayed blocked because the cart total never settled',
    },
    memoryMisdirectionRuledOut: true,
    perTest: 1,
    memoryOnPath: [
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ],
    misdirectionRuledOut: { crossCheck: 'held', results: ROWS },
    ...overrides,
  } as Verdict
}

/** The fixture handoff with a root cause stamped on member test 1 (the failure path). */
function handoffWithRootCause(rootCause?: unknown): CompletedRunHandoff {
  const base = makeV2Handoff()
  return {
    ...base,
    tests: base.tests.map((test) =>
      test.testIndex === 1 && rootCause !== undefined
        ? ({ ...test, rootCause } as (typeof base.tests)[number])
        : test,
    ),
  }
}

function leavesOf(handoff: CompletedRunHandoff): LeafCassette[] {
  return extractRunCassettes({ handoff, artifacts: EMPTY_SOURCE })
    .cassettes.map((entry) => entry.cassette)
    .filter((cassette): cassette is LeafCassette => cassette.granularity === 'leaf')
}

/** Extract → serialize → parse: the only round trip that crosses a real byte boundary. */
function reparsedLeaves(handoff: CompletedRunHandoff): LeafCassette[] {
  return leavesOf(handoff).map((cassette) => {
    const parsed = guardCassette(JSON.parse(JSON.stringify(cassette)) as unknown)
    if (parsed.granularity !== 'leaf') throw new Error('expected a leaf cassette')
    return parsed
  })
}

function failureLeaf(handoff: CompletedRunHandoff): LeafCassette {
  const leaf = reparsedLeaves(handoff).find((cassette) => cassette.testIndex === 1)
  if (leaf === undefined) throw new Error('fixture emitted no leaf for member test 1')
  return leaf
}

describe('cassette label evidence survives a real extraction (422 D-17)', () => {
  it('round-trips both members and every per-record row through extract, serialize and parse', () => {
    const leaf = failureLeaf(handoffWithRootCause(verdictWith()))

    expect(leaf.label.rootCause?.misdirectionRuledOut?.results).toEqual(ROWS)
    expect(leaf.label.rootCause?.misdirectionRuledOut?.results[0]?.samples).toEqual({
      k: 2,
      seeds: [9, 10],
      modelCalls: 2,
    })
    expect(leaf.label.rootCause?.misdirectionRuledOut?.results[1]?.reason).toBe('replay unavailable')
    expect(leaf.label.rootCause?.memoryOnPath).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
  })

  it('carries each cross-check outcome through unchanged, flips included', () => {
    for (const crossCheck of ['held', 'flipped', 'inconclusive', 'not-run'] as const) {
      const leaf = failureLeaf(
        handoffWithRootCause(
          verdictWith({ misdirectionRuledOut: { crossCheck, results: [row({ crossCheck })] } }),
        ),
      )
      expect(leaf.label.rootCause?.misdirectionRuledOut?.crossCheck).toBe(crossCheck)
      expect(leaf.label.rootCause?.misdirectionRuledOut?.results[0]?.crossCheck).toBe(crossCheck)
    }
  })

  it('preserves the declared-only backing marker with an empty ledger beside it', () => {
    const leaf = failureLeaf(
      handoffWithRootCause(
        verdictWith({
          misdirectionRuledOut: { crossCheck: 'not-run', results: [], backing: 'declared-only' },
        }),
      ),
    )

    expect(leaf.label.rootCause?.misdirectionRuledOut?.backing).toBe('declared-only')
    expect(leaf.label.rootCause?.misdirectionRuledOut?.results).toEqual([])
  })

  it('emits no rootCause at all for a member that recorded none — as-extracted truth', () => {
    const leaf = failureLeaf(handoffWithRootCause())

    expect('rootCause' in leaf.label).toBe(false)
    expect(leaf.label.sourceChannel).toBe('recorded-verdict')
    expect(leaf.label.tier).toBe('silver')
  })

  it('keeps the as-extracted label equal to the projection over the same evidence', () => {
    const handoff = handoffWithRootCause(verdictWith())
    const member = handoff.tests.find((test) => test.testIndex === 1)!
    const step = member.steps[0]!
    const subAction = step.subActions[0]!

    expect(failureLeaf(handoff).label).toEqual(
      JSON.parse(
        JSON.stringify(projectLabelLeg({ step, subAction, rootCause: member.rootCause })),
      ) as unknown,
    )
  })

  it('leaves the cassette envelope version where it was', () => {
    expect(CASSETTE_SCHEMA_VERSION).toBe(2)
    expect(failureLeaf(handoffWithRootCause(verdictWith())).schemaVersion).toBe(
      CASSETTE_SCHEMA_VERSION,
    )
  })
})

describe('the strict cassette parser refuses forged evidence rather than carrying it (422 D-17)', () => {
  /** Emit a real cassette, then tamper with the serialized bytes exactly as a forger would. */
  function reparseWithRootCause(rootCause: unknown): LeafCassette {
    const leaf = leavesOf(handoffWithRootCause(verdictWith())).find(
      (cassette) => cassette.testIndex === 1,
    )!
    const document = JSON.parse(JSON.stringify(leaf)) as Record<string, unknown>
    const label = document.label as Record<string, unknown>
    const parsed = guardCassette({ ...document, label: { ...label, rootCause } })
    if (parsed.granularity !== 'leaf') throw new Error('expected a leaf cassette')
    return parsed
  }

  it('refuses a misdirectionRuledOut block with no per-record ledger', () => {
    expect(() => reparseWithRootCause(verdictWith({ misdirectionRuledOut: { crossCheck: 'held' } as never }))).toThrow()
  })

  it('refuses a row that has lost an identity', () => {
    const { handoffBaseDigest: _dropped, ...withoutBase } = row()
    expect(() =>
      reparseWithRootCause(
        verdictWith({
          misdirectionRuledOut: { crossCheck: 'held', results: [withoutBase] } as never,
        }),
      ),
    ).toThrow()
  })

  it('refuses an unrecognised member smuggled into a row', () => {
    expect(() =>
      reparseWithRootCause(
        verdictWith({
          misdirectionRuledOut: {
            crossCheck: 'held',
            results: [{ ...row(), exonerates: true }],
          } as never,
        }),
      ),
    ).toThrow()
  })

  it('refuses a cross-check word outside the closed four', () => {
    expect(() =>
      reparseWithRootCause(
        verdictWith({
          misdirectionRuledOut: {
            crossCheck: 'held',
            results: [{ ...row(), crossCheck: 'cleared' }],
          } as never,
        }),
      ),
    ).toThrow()
  })

  it('refuses a backing word outside the closed one', () => {
    expect(() =>
      reparseWithRootCause(
        verdictWith({
          misdirectionRuledOut: { crossCheck: 'held', results: [], backing: 'measured' } as never,
        }),
      ),
    ).toThrow()
  })

  it('refuses a memoryOnPath trust word outside the closed pair', () => {
    expect(() =>
      reparseWithRootCause(
        verdictWith({ memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'canary' }] as never }),
      ),
    ).toThrow()
  })

  it('refuses a memoryOnPath that is not an array of entries', () => {
    expect(() =>
      reparseWithRootCause(verdictWith({ memoryOnPath: { recordId: CANDIDATE_RECORD } as never })),
    ).toThrow()
  })

  it('still parses a historical label leg whose rootCause carries the boolean alone', () => {
    const { memoryOnPath: _a, misdirectionRuledOut: _b, ...historical } = verdictWith()
    const leaf = reparseWithRootCause(historical)

    expect(leaf.label.rootCause?.memoryMisdirectionRuledOut).toBe(true)
    expect('memoryOnPath' in (leaf.label.rootCause ?? {})).toBe(false)
    expect('misdirectionRuledOut' in (leaf.label.rootCause ?? {})).toBe(false)
  })
})
