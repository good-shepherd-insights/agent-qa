// D-14's LIVE arm: the gate-2 flip consults the suite's recorded stability (394-17 · WTST-05).
//
// WHAT WAS DEAD. `gatherSuiteStability` shipped in 394-07 exported, barrel-listed and unit-tested,
// with ZERO production callers and an unbound `outcomes` port — so the "your app is unstable here"
// message could not be produced on any host, and a mixed verdict discarded the draft in silence
// (394-VERIFICATION SC-3; WINDOWS 95/97). 394-09-SUMMARY recorded the four steps and declined
// them; this file is step (d).
//
// THE MESSAGE REACHES THE RECEIPT, which is the only place a person later reads it: gate 2's
// `reason` string, composed by the ONE composer (`stabilityGateTwoReason`). A consultation whose
// answer went anywhere else would be a second surface for one gate's verdict.
//
// TWO-SIDED ON EVERY DISCRIMINATOR, because a consultation that fired on everything and one that
// fired on nothing would both pass a one-sided file: there is a flip cell AND a clean-pass cell
// that proves the port is never touched; a flaky cell AND a no-history cell; a product-observed
// cell AND a product-absent cell that proves nothing is guessed.
//
// AND IT STARTS ZERO RUNS, measured against an instrument that counts them. D-14 is read-side
// because WTST-08's fan-out preview promises a bound before dispatch; a stability check that took
// its own runs would make that promise one nobody could honour. The assertion is a DIFFERENTIAL —
// the same evaluation with and without the consultation starts the same runs — rather than a
// restated integer, so it stays true if the gate's own run count ever moves.

import { describe, expect, it } from 'vitest'

import type { DraftReceipt, MemberTestOutcome } from '@vostride/agent-qa-schema'

import {
  ACCEPT_CONTROL_DRAFT,
  acceptControlMember,
  fakeFingerprintIndex,
  fakeRunPort,
} from './evidence-fixtures.js'
import type { MemberFixture } from './evidence-fixtures.js'
import { evaluateDraft } from '../verify-draft.js'
import type { AuthoringFunnelPortLike, SuiteOutcomeHistoryPortLike } from '../funnel.js'

const PRODUCT = 'local-form'
const TARGET = ACCEPT_CONTROL_DRAFT.filePath

/** What the port was ASKED — every argument, so a guessed product is visible rather than implied. */
interface OutcomeCalls {
  readonly testsIn: { product: string; filePath: string }[]
  readonly outcomesFor: { product: string; filePath: string; testName: string }[]
}

function recordingOutcomes(
  rows: Readonly<Record<string, readonly string[]>>,
): { port: SuiteOutcomeHistoryPortLike; calls: OutcomeCalls } {
  const calls: OutcomeCalls = { testsIn: [], outcomesFor: [] }
  return {
    calls,
    port: {
      async testsIn(product: string, filePath: string) {
        calls.testsIn.push({ product, filePath })
        return Object.keys(rows).map((testName) => ({ filePath, testName }))
      },
      async outcomesFor(product: string, filePath: string, testName: string) {
        calls.outcomesFor.push({ product, filePath, testName })
        return rows[testName] ?? []
      },
    },
  }
}

function funnelPort(outcomes?: SuiteOutcomeHistoryPortLike): AuthoringFunnelPortLike {
  return {
    receipts: { async list() { return [] } },
    async proposals() { return [] },
    ...(outcomes === undefined ? {} : { outcomes }),
  }
}

function member(outcome: MemberTestOutcome): MemberFixture {
  return acceptControlMember(outcome)
}

/** The gate-2 flip: run 1 passed, run 2 failed. Early-stops at two of the pinned three. */
const FLIPPING_RUNS = [[member('passed')], [member('failed')], [member('passed')]]

/** One verdict across every run — the arm that must NOT consult anything. */
const STABLE_RUNS = [[member('passed')], [member('passed')], [member('passed')]]

interface EvaluationFixture {
  readonly runs: readonly (readonly MemberFixture[])[]
  /** Absent means the consultation half is UNBOUND — the pre-394-17 posture. */
  readonly stability?: {
    readonly outcomes?: SuiteOutcomeHistoryPortLike
    /** Absent means nothing was observed — a standalone verify with no product in hand. */
    readonly product?: string
  }
}

async function evaluate(
  fixture: EvaluationFixture,
): Promise<{ receipt: DraftReceipt; startCount: number }> {
  const runs = fakeRunPort({ runs: [...fixture.runs] })
  const receipt = await evaluateDraft(
    { draft: ACCEPT_CONTROL_DRAFT },
    {
      runs,
      fingerprints: fakeFingerprintIndex([]),
      textCorpus: [],
      receipts: { put: async () => {} },
      now: () => 1_700_000_000_000,
      ...(fixture.stability === undefined
        ? {}
        : {
          suiteStability: {
            port: funnelPort(fixture.stability.outcomes),
            product: () => fixture.stability?.product,
          },
        }),
    },
  )
  return { receipt, startCount: runs.startInputs.length }
}

describe('the gate-2 flip consults the suite\'s recorded stability', () => {
  it('NAMES the flaky neighbours in the gate-2 reason a person reads', async () => {
    const { port } = recordingOutcomes({
      'submits the form': ['passed', 'passed'],
      'shows the banner': ['passed', 'failed'],
    })
    const { receipt } = await evaluate({
      runs: FLIPPING_RUNS,
      stability: { outcomes: port, product: PRODUCT },
    })

    expect(receipt.gates.stableVerdict.pass).toBe(false)
    // The draft's own flip is still stated — the consultation EXPLAINS the rejection, it does not
    // replace it. An author told only "your app is unstable" would not know their draft flipped.
    expect(receipt.gates.stableVerdict.reason).toContain('the verdict flipped across runs')
    expect(receipt.gates.stableVerdict.reason).toContain('Your app is unstable')
    // On the CONCRETE name, which is the whole value of the branch: an author told "some
    // neighbours are flaky" cannot go and look.
    expect(receipt.gates.stableVerdict.reason).toContain(`${TARGET}::shows the banner`)
    // And not the neighbour that is stable — a message naming everything names nothing.
    expect(receipt.gates.stableVerdict.reason).not.toContain('submits the form')
  })

  it('asks the projection with the OBSERVED product, never a guessed one (T-394-68)', async () => {
    const { port, calls } = recordingOutcomes({ 'shows the banner': ['passed', 'failed'] })
    await evaluate({ runs: FLIPPING_RUNS, stability: { outcomes: port, product: PRODUCT } })

    // Both verbs, because history served under one file path across products would report another
    // product's flakiness as this target's.
    expect(calls.testsIn).toEqual([{ product: PRODUCT, filePath: TARGET }])
    expect(calls.outcomesFor)
      .toEqual([{ product: PRODUCT, filePath: TARGET, testName: 'shows the banner' }])
  })

  it('answers the honest no-history line when the projection has nothing on the target', async () => {
    const { port } = recordingOutcomes({})
    const { receipt } = await evaluate({
      runs: FLIPPING_RUNS,
      stability: { outcomes: port, product: PRODUCT },
    })

    expect(receipt.gates.stableVerdict.reason).toContain('No stability history')
    expect(receipt.gates.stableVerdict.reason).toContain('not a clean bill of health')
    // NEVER `stable` for a target nothing has observed — a wrong answer wearing a correct one's
    // clothes is the one shape this vocabulary exists to make unrepresentable.
    expect(receipt.gates.stableVerdict.reason).not.toContain('have stable recorded outcomes')
  })

  it('SKIPS the consultation when no product was observed — no fabricated key', async () => {
    const { port, calls } = recordingOutcomes({ 'shows the banner': ['passed', 'failed'] })
    const { receipt } = await evaluate({ runs: FLIPPING_RUNS, stability: { outcomes: port } })

    // The degraded posture here is the ABSENCE of the consultation, stated by nothing. A gather
    // that ran with an invented product would read another partition's history.
    expect(calls.testsIn).toEqual([])
    expect(receipt.gates.stableVerdict.reason).toContain('the verdict flipped across runs')
    expect(receipt.gates.stableVerdict.reason).not.toContain('Your app is unstable')
    expect(receipt.gates.stableVerdict.reason).not.toContain('No stability history')
  })

  it('does not consult AT ALL on a clean single-verdict pass', async () => {
    const { port, calls } = recordingOutcomes({ 'shows the banner': ['passed', 'failed'] })
    const { receipt } = await evaluate({
      runs: STABLE_RUNS,
      stability: { outcomes: port, product: PRODUCT },
    })

    expect(receipt.gates.stableVerdict.pass).toBe(true)
    // The blast radius, measured: a consultation on every evaluation would pass the flip cells
    // above and red this one — and would charge every clean draft a projection read.
    expect(calls.testsIn).toEqual([])
    expect(receipt.gates.stableVerdict.reason).toContain('one verdict across the completed runs')
    expect(receipt.gates.stableVerdict.reason).not.toContain('Your app is unstable')
  })

  it('starts ZERO extra runs — the same count with the consultation and without', async () => {
    const { port } = recordingOutcomes({ 'shows the banner': ['passed', 'failed'] })
    const consulted = await evaluate({
      runs: FLIPPING_RUNS,
      stability: { outcomes: port, product: PRODUCT },
    })
    const unconsulted = await evaluate({ runs: FLIPPING_RUNS })

    // A DIFFERENTIAL, not a restated integer: the gate's own run count is free to move, and what
    // this pins is that the consultation adds nothing to it.
    expect(consulted.startCount).toBe(unconsulted.startCount)
    expect(consulted.receipt.gates.stableVerdict.reason).toContain('Your app is unstable')
  })
})
