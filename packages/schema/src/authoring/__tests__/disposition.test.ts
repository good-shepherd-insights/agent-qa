// The draft-disposition contract, written BEFORE the vocabulary exists (Phase 393, D-08).
//
// D-18 in one sentence: `keep-eligible` requires all four gate booleans true AND the full
// pinned N stability runs, and N=1 draft mode forces `unverified` UNCONDITIONALLY. That rule
// lives structurally in the vocabulary — 394's accept flow consumes `computeDraftDisposition`
// and is meant to be unable to re-derive its own answer — so the table below is the contract
// this module is judged against, not a description of whatever it happens to compute.
//
// The first commit of this file is RED by construction: `../disposition`,
// `../draft-receipt` and `../../functions/authoring` do not exist yet.

import { describe, expect, it } from 'vitest'

import {
  computeDraftDisposition,
  DRAFT_DISPOSITIONS,
  DRAFT_STABILITY_RUNS_N,
  type DraftDispositionInput,
} from '../disposition'
import {
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DraftReceiptSchema,
  type DraftReceipt,
} from '../draft-receipt'
import { AuthoringVerifyDraftInputSchema } from '../../functions/authoring'

const ALL_TRUE = {
  executesDefinitive: true,
  stableVerdict: true,
  addsValue: true,
  falsifiableAssertion: true,
} as const

function input(overrides: Partial<DraftDispositionInput> = {}): DraftDispositionInput {
  return {
    gates: ALL_TRUE,
    stabilityRunsRequested: DRAFT_STABILITY_RUNS_N,
    stabilityRunsCompleted: DRAFT_STABILITY_RUNS_N,
    ...overrides,
  }
}

/** A fully-populated receipt: every optional field present, so `.strict()` is exercised deeply. */
const FULL_RECEIPT: DraftReceipt = {
  schemaVersion: CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  draftRef: {
    filePath: 'fixtures/corpus/accept-control.yaml',
    testId: 't_accept_control',
    testName: 'accept-control',
    contentDigest: 'sha256:0f1e2d3c',
  },
  gates: {
    executesDefinitive: {
      pass: true,
      runRefs: ['r_one', 'r_two', 'r_three'],
      indefinitiveRunRefs: [],
      reason: 'every run reached a final pass or fail',
    },
    stableVerdict: {
      pass: true,
      runRefs: ['r_one', 'r_two', 'r_three'],
      distinctOutcomes: ['healed'],
      earlyStopped: false,
      reason: 'one distinct outcome across the full N',
    },
    addsValue: {
      pass: true,
      novelElementCount: 1,
      comparedTestCount: 3,
      reason: 'one anchor element absent from the suite union',
    },
    falsifiableAssertion: {
      pass: true,
      assertionStepCount: 1,
      falsifiableAssertionCount: 1,
      reason: 'one assertion naming concrete expected content',
    },
  },
  stepTable: [
    {
      stepText: 'Click the "Back to the form" link',
      role: 'action',
      falsifiable: false,
      captureSignatureHits: [],
    },
    {
      stepText: 'Verify the page shows the text "Received!"',
      role: 'assertion',
      falsifiable: true,
      vacuityHit: undefined,
      captureSignatureHits: [],
      tautologyHit: false,
    },
  ],
  gateRuns: [
    { runId: 'r_one', memberOutcome: 'healed', definitive: true, healed: true },
    { runId: 'r_two', memberOutcome: 'healed', definitive: true, healed: true },
    { runId: 'r_three', memberOutcome: 'passed', definitive: true, healed: false },
  ],
  addsValueFinding: {
    novelElements: ['{"anchor":{"name":"back to the form","role":"link","t":"el"}}'],
    comparedTests: [
      {
        filePath: 'tests/uat-381-local-form.yaml',
        testName: 'uat-381-local-form',
        lane: 'fingerprint',
        covered: false,
      },
      {
        filePath: 'tests/uat-381-ladder.yaml',
        testName: 'uat-381-ladder',
        lane: 'text',
        covered: true,
      },
    ],
  },
  stabilityRunsRequested: 3,
  stabilityRunsCompleted: 3,
  disposition: 'keep-eligible',
  evaluatedAt: 1_754_800_000_000,
}

describe('computeDraftDisposition (393 D-18) — the behavior table', () => {
  it('returns keep-eligible when all four gates pass across the full pinned N', () => {
    expect(
      computeDraftDisposition(
        input({ stabilityRunsRequested: 3, stabilityRunsCompleted: 3 }),
      ),
    ).toBe('keep-eligible')
  })

  it('forces unverified in draft mode (N=1) even with all four gates true', () => {
    expect(
      computeDraftDisposition(
        input({ stabilityRunsRequested: 1, stabilityRunsCompleted: 1 }),
      ),
    ).toBe('unverified')
  })

  it('forces unverified in draft mode regardless of every other input', () => {
    // The unconditional half of D-18: a failing gate, a zero run count and an over-full run
    // count all still read `unverified`, because one requested run can never observe stability.
    for (const overrides of [
      { gates: { ...ALL_TRUE, addsValue: false } },
      { stabilityRunsCompleted: 0 },
      { stabilityRunsCompleted: 9 },
      { gates: { ...ALL_TRUE, executesDefinitive: false }, stabilityRunsCompleted: 0 },
    ] satisfies readonly Partial<DraftDispositionInput>[]) {
      expect(
        computeDraftDisposition(input({ ...overrides, stabilityRunsRequested: 1 })),
      ).toBe('unverified')
    }
  })

  it('returns rejected when any single gate boolean is false', () => {
    for (const gate of [
      'executesDefinitive',
      'stableVerdict',
      'addsValue',
      'falsifiableAssertion',
    ] as const) {
      expect(
        computeDraftDisposition(input({ gates: { ...ALL_TRUE, [gate]: false } })),
      ).toBe('rejected')
    }
  })

  it('returns rejected on a false gate even when runs stopped early (D-17)', () => {
    // Early-stop on the first verdict flip leaves completed < N. The flip already proved
    // instability, so the short count must NOT downgrade the answer to proposal-only.
    expect(
      computeDraftDisposition(
        input({
          gates: { ...ALL_TRUE, stableVerdict: false },
          stabilityRunsRequested: 3,
          stabilityRunsCompleted: 2,
        }),
      ),
    ).toBe('rejected')
  })

  it('returns proposal-only when all four pass but fewer than N runs completed', () => {
    expect(
      computeDraftDisposition(
        input({ stabilityRunsRequested: 3, stabilityRunsCompleted: 2 }),
      ),
    ).toBe('proposal-only')
  })

  it('never auto-keeps below the pinned N for any completed count under it', () => {
    for (let completed = 0; completed < DRAFT_STABILITY_RUNS_N; completed += 1) {
      expect(
        computeDraftDisposition(
          input({ stabilityRunsRequested: 3, stabilityRunsCompleted: completed }),
        ),
      ).toBe('proposal-only')
    }
  })

  it('only ever returns a member of DRAFT_DISPOSITIONS', () => {
    expect(DRAFT_DISPOSITIONS).toEqual([
      'keep-eligible',
      'proposal-only',
      'rejected',
      'unverified',
    ])
    expect(DRAFT_DISPOSITIONS).toContain(computeDraftDisposition(input()))
  })

  it('pins the stability constant at 3', () => {
    expect(DRAFT_STABILITY_RUNS_N).toBe(3)
  })
})

describe('DraftReceiptSchema (393 D-19, WTST-02)', () => {
  it('round-trips a fully-populated receipt', () => {
    expect(DraftReceiptSchema.parse(FULL_RECEIPT)).toEqual(FULL_RECEIPT)
  })

  it('refuses an unknown top-level key (.strict())', () => {
    expect(() =>
      DraftReceiptSchema.parse({ ...FULL_RECEIPT, runPayload: { steps: [] } }),
    ).toThrow()
  })

  it('refuses an unknown key nested inside a gate run record', () => {
    // Map-not-territory (D-19 / 391 D-18): a gate run is a REF plus its judgment. Strictness
    // here is what structurally prevents a run payload from being smuggled into the receipt.
    expect(() =>
      DraftReceiptSchema.parse({
        ...FULL_RECEIPT,
        gateRuns: [{ ...FULL_RECEIPT.gateRuns[0], handoff: { tests: [] } }],
      }),
    ).toThrow()
  })

  it('reports the four gate booleans separately, never as one collapsed verdict', () => {
    const parsed = DraftReceiptSchema.parse(FULL_RECEIPT)
    expect(Object.keys(parsed.gates).sort()).toEqual([
      'addsValue',
      'executesDefinitive',
      'falsifiableAssertion',
      'stableVerdict',
    ])
  })

  it('records the heal on a gate run beside its definitiveness (F3, Pitfall 7)', () => {
    const parsed = DraftReceiptSchema.parse(FULL_RECEIPT)
    const healed = parsed.gateRuns.find((record) => record.healed)
    expect(healed).toBeDefined()
    expect(healed?.definitive).toBe(true)
  })

  it('refuses a disposition outside the vocabulary', () => {
    expect(() => DraftReceiptSchema.parse({ ...FULL_RECEIPT, disposition: 'keep' })).toThrow()
  })
})

describe('AuthoringVerifyDraftInputSchema (393 D-01, 392 D-07)', () => {
  it('refuses an empty call — draftPath is required', () => {
    expect(() => AuthoringVerifyDraftInputSchema.parse({})).toThrow()
  })

  it('refuses an empty draftPath', () => {
    expect(() => AuthoringVerifyDraftInputSchema.parse({ draftPath: '' })).toThrow()
  })

  it('accepts a draft path with the draft-mode marker', () => {
    expect(
      AuthoringVerifyDraftInputSchema.parse({ draftPath: 'x.yaml', draftMode: true }),
    ).toEqual({ draftPath: 'x.yaml', draftMode: true })
  })

  it('accepts only the literal true marker, matching the handoff carrier idiom', () => {
    expect(() =>
      AuthoringVerifyDraftInputSchema.parse({ draftPath: 'x.yaml', draftMode: false }),
    ).toThrow()
  })

  it('refuses an unknown key (.strict())', () => {
    expect(() =>
      AuthoringVerifyDraftInputSchema.parse({ draftPath: 'x.yaml', stabilityRuns: 1 }),
    ).toThrow()
  })
})
