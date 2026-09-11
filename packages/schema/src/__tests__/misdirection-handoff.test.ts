// The circularity evidence's DURABLE leg (Phase 422, plan 12 — D-17/D-18).
//
// Plan 11 made the evidence checkable in memory. This file is about the two places it has to
// survive a byte boundary: the completed-run handoff a later job re-loads, and the analyze-run
// payload that job is claimed with. A round trip that writes and reads through the same
// function proves almost nothing — every cell below serializes to JSON, loads the resulting
// bytes through `guardCompletedRunHandoff`, and compares against what the producer meant.
//
// THE TWO FACTS THAT MUST STAY DISTINGUISHABLE. A handoff with no `misdirectionEvidence` key
// is a run whose arbiter never ran — the overwhelming majority, and every handoff written
// before today. A handoff carrying `misdirectionEvidence: []` is a run whose arbiter ran and
// found nothing to check. 422-07 established that distinction as load-bearing for
// `stages.proposals`; the same line is held here, so the loader may neither synthesize the key
// nor drop it.
//
// NO VERSION BUMP. The sidecar is optional-additive and `CURRENT_HANDOFF_SCHEMA_VERSION` stays
// 7: a v7 document written yesterday carries no sidecar and loads unchanged, which is exactly
// what the absence rule above says it should do.

import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
} from '../handoff/completed-run-handoff'
import {
  guardCompletedRunHandoff,
  HANDOFF_MIGRATIONS,
} from '../handoff/load-completed-run-handoff'
import type { StepEvidence } from '../handoff/step-evidence'
import type { BriefLine, ServedBrief } from '../brief/served-brief'
import { asRecordId } from '../ids/record-id'
import { asRef } from '../primitives/ref'
import { asRunId } from '../run/run-id'
import { misdirectionSourceDigest } from '../verdict/misdirection-evidence'
import type { MisdirectionRecordResult } from '../verdict/misdirection-evidence'
import type { Verdict } from '../verdict/verdict'

const RUN_ID = 'run-misdirection-handoff'
const CANDIDATE_RECORD = asRecordId('rec_mem_candidate')
const CANARY_RECORD = asRecordId('rec_mem_canary')

function briefLine(overrides: Partial<BriefLine> = {}): BriefLine {
  return {
    id: CANDIDATE_RECORD,
    kind: 'fact',
    summary: 'the checkout form autosaves',
    trust: 0.4,
    status: 'candidate',
    servedAsCanary: false,
    tier: 'L2',
    ...overrides,
  }
}

function servedBrief(lines: BriefLine[], briefDigest: string): ServedBrief {
  return {
    scope: { tier: 'product', key: 'misdirection-handoff' },
    asOfBuild: 1,
    budget: 0,
    truncation: 'none',
    channel1: lines,
    channel2: [],
    channel3: [],
    briefDigest,
  }
}

function screenState() {
  return {
    platform: 'web' as const,
    tree: '',
    elements: [],
    refMap: {},
    url: '/checkout',
    timestamp: 1,
    metadata: {
      coordSpace: 'viewport' as const,
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
      captureMode: 'textOnly' as const,
    },
  }
}

function failingStep(stepIndex: number, brief: ServedBrief): StepEvidence {
  return {
    stepIndex,
    stepText: 'click the Submit button on the checkout screen',
    cacheStatus: 'miss',
    servedBrief: brief,
    subActions: [
      {
        plan: 'click the Submit button now that the cart is full',
        plannedAction: { type: 'click', ref: asRef('e1') },
        stateBefore: screenState(),
        result: { success: false, error: 'Error: element "Submit" not found' },
      },
    ],
    verifierVerdict: { pass: false, reasoning: 'the submit button never appeared' },
  }
}

/** A v7 handoff with one failed member that was served two low-trust records. */
function makeHandoff(): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(RUN_ID),
    scope: { tier: 'product', key: 'misdirection-handoff' },
    buildOrdinal: 3,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    tests: [
      {
        testId: 't_checkout',
        testName: 'checkout submits',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        steps: [
          failingStep(
            0,
            servedBrief(
              [
                briefLine(),
                briefLine({
                  id: CANARY_RECORD,
                  status: 'active',
                  servedAsCanary: true,
                  trust: 0.6,
                }),
              ],
              'brief-digest-1',
            ),
          ),
        ],
      },
    ],
  }
}

const BASE_DIGEST = misdirectionSourceDigest(makeHandoff())

function row(overrides: Partial<MisdirectionRecordResult> = {}): MisdirectionRecordResult {
  return {
    runId: RUN_ID,
    perTest: 0,
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

const SIDECAR: MisdirectionRecordResult[] = [
  row({ samples: { k: 3, seeds: [11, 12, 13], modelCalls: 3 } }),
  row({ recordId: CANARY_RECORD, crossCheck: 'inconclusive', reason: 'replay was unavailable' }),
]

function withSidecar(sidecar: unknown): unknown {
  return { ...makeHandoff(), misdirectionEvidence: sidecar }
}

/** Serialize exactly as the runner persists, then read the bytes back. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function load(value: unknown): CompletedRunHandoff {
  return guardCompletedRunHandoff(wire(value))
}

/** The FINAL handoff digest, spelled exactly as `curationTailHandoffDigest` spells it. */
function finalDigest(handoff: unknown): string {
  return sha256hex(canonicalJson(handoff))
}

function verdictWithEvidence(overrides: Partial<Verdict> = {}): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.8,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit endpoint returned 500',
    },
    memoryMisdirectionRuledOut: true,
    perTest: 0,
    memoryOnPath: [
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ],
    misdirectionRuledOut: { crossCheck: 'held', results: SIDECAR },
    ...overrides,
  } as Verdict
}

function withRootCause(rootCause: unknown): unknown {
  const handoff = makeHandoff()
  return {
    ...handoff,
    tests: [{ ...handoff.tests[0]!, rootCause }],
  }
}

describe('CompletedRunHandoff.misdirectionEvidence (422 D-17/D-18 durable sidecar)', () => {
  it('loads a sidecar through the wire with every row and digest intact', () => {
    const loaded = load(withSidecar(SIDECAR))

    expect(loaded.misdirectionEvidence).toEqual(SIDECAR)
    expect(loaded.misdirectionEvidence?.[0]?.samples).toEqual({
      k: 3,
      seeds: [11, 12, 13],
      modelCalls: 3,
    })
    expect(loaded.misdirectionEvidence?.[1]?.crossCheck).toBe('inconclusive')
    expect(loaded.misdirectionEvidence?.[1]?.reason).toBe('replay was unavailable')
  })

  it('keeps an ABSENT sidecar absent — a run whose arbiter never ran is not an empty result', () => {
    const loaded = load(makeHandoff())

    expect('misdirectionEvidence' in loaded).toBe(false)
    expect(loaded.misdirectionEvidence).toBeUndefined()
  })

  it('keeps an EMPTY sidecar empty — distinguishable from the absent case above', () => {
    const loaded = load(withSidecar([]))

    expect('misdirectionEvidence' in loaded).toBe(true)
    expect(loaded.misdirectionEvidence).toEqual([])
  })

  it('refuses a row minted against another run', () => {
    expect(() => load(withSidecar([row({ runId: 'run-somebody-else' })]))).toThrow()
  })

  it("refuses a row naming a source-digest identity that is not this run's", () => {
    expect(() => load(withSidecar([row({ handoffBaseDigest: 'f'.repeat(64) })]))).toThrow()
  })

  it('refuses a sidecar that is not an array', () => {
    expect(() => load(withSidecar({ 0: row() }))).toThrow()
    expect(() => load(withSidecar('held'))).toThrow()
  })

  it('refuses a nonfinite sample count', () => {
    // JSON has no Infinity/NaN literal, so these reach the loader as `null` through the wire —
    // which the row schema must refuse just as firmly as the in-memory nonfinite would be.
    expect(() =>
      load(withSidecar([row({ samples: { k: 1, seeds: [1], modelCalls: Number.POSITIVE_INFINITY } })])),
    ).toThrow()
    expect(() =>
      load(withSidecar([row({ samples: { k: Number.NaN, seeds: [1], modelCalls: 1 } })])),
    ).toThrow()
  })

  it('refuses two rows for one exposure — a second answer is not a second check', () => {
    expect(() => load(withSidecar([row(), row({ briefDigest: 'brief-digest-other' })]))).toThrow()
  })

  it('refuses an unrecognised member inside a row rather than dropping it', () => {
    expect(() =>
      load(withSidecar([{ ...row(), exonerates: true } as unknown as MisdirectionRecordResult])),
    ).toThrow()
  })

  it('refuses a row whose crossCheck is outside the closed vocabulary', () => {
    expect(() =>
      load(withSidecar([row({ crossCheck: 'cleared' as MisdirectionRecordResult['crossCheck'] })])),
    ).toThrow()
  })

  it('keeps CURRENT_HANDOFF_SCHEMA_VERSION at 7 with its migration ladder unchanged', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(7)
    expect(Object.keys(HANDOFF_MIGRATIONS)).toEqual(['2', '3', '4', '5', '6'])
  })

  it('moves the FINAL handoff digest when the evidence moves, and never the row base digest', () => {
    const without = makeHandoff()
    const withEvidence = withSidecar(SIDECAR)
    const flipped = withSidecar([row({ crossCheck: 'flipped' }), SIDECAR[1]!])

    expect(finalDigest(withEvidence)).not.toBe(finalDigest(without))
    expect(finalDigest(flipped)).not.toBe(finalDigest(withEvidence))
    // The row binds the run's IDENTITY, which cannot move when the sidecar it sits in does.
    expect(misdirectionSourceDigest(load(withEvidence))).toBe(BASE_DIGEST)
    expect(misdirectionSourceDigest(load(flipped))).toBe(BASE_DIGEST)
    expect(SIDECAR[0]!.handoffBaseDigest).not.toBe(finalDigest(withEvidence))
  })
})

describe('the two verdict evidence members on a persisted rootCause (422 D-17)', () => {
  it('round-trips a rootCause carrying both members without losing a row', () => {
    const loaded = load(withRootCause(verdictWithEvidence()))
    const rootCause = loaded.tests[0]?.rootCause

    expect(rootCause?.memoryOnPath).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
    expect(rootCause?.misdirectionRuledOut?.results).toEqual(SIDECAR)
    expect(rootCause?.misdirectionRuledOut?.crossCheck).toBe('held')
  })

  it('loads a historical rootCause carrying the boolean alone, with both members absent', () => {
    const { memoryOnPath: _a, misdirectionRuledOut: _b, ...historical } = verdictWithEvidence()
    const loaded = load(withRootCause(historical))
    const rootCause = loaded.tests[0]?.rootCause

    expect(rootCause?.memoryMisdirectionRuledOut).toBe(true)
    expect(rootCause === undefined ? true : 'memoryOnPath' in rootCause).toBe(false)
    expect(rootCause === undefined ? true : 'misdirectionRuledOut' in rootCause).toBe(false)
  })

  it('refuses a malformed misdirectionRuledOut rather than silently stripping it', () => {
    expect(() =>
      load(withRootCause(verdictWithEvidence({ misdirectionRuledOut: { crossCheck: 'held' } as never }))),
    ).toThrow()
    expect(() =>
      load(
        withRootCause(
          verdictWithEvidence({
            misdirectionRuledOut: { crossCheck: 'held', results: [], backing: 'measured' } as never,
          }),
        ),
      ),
    ).toThrow()
  })

  it('refuses a memoryOnPath entry outside the closed two-word trust vocabulary', () => {
    expect(() =>
      load(
        withRootCause(
          verdictWithEvidence({
            memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'canary' }] as never,
          }),
        ),
      ),
    ).toThrow()
    expect(() =>
      load(
        withRootCause(verdictWithEvidence({ memoryOnPath: { recordId: CANDIDATE_RECORD } as never })),
      ),
    ).toThrow()
  })
})
