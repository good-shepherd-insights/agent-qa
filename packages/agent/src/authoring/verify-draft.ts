// The gate evaluator (Phase 393, D-03/D-04/D-18 · WTST-02).
//
// ONE call takes a parsed draft to a persisted, schema-valid receipt: four separately-named gate
// booleans, the per-step classification table, the per-run records, the adds-value finding, and a
// disposition that this module does not compute.
//
// ALL FOUR GATES, ALWAYS (D-04). There is no short-circuit anywhere below, and the omission is
// the point rather than an oversight. The frozen corpus proves gate INDEPENDENCE — the
// "page loaded"-only draft must report executes ✓ · stable ✓ · adds-value ✓ · falsifiable ✗ so
// that gate 4 is demonstrably the only catcher — and a vector with three of its four entries
// missing proves nothing at all. Early-stop inside gate 2 (D-17) skips redundant RUNS; it never
// skips a gate. The case that makes this concrete is a draft whose gate 1 fails: gates 2, 3 and 4
// are still computed and still reported, and gate 3 in particular reports what the evidence
// actually supports rather than a default.
//
// THE DISPOSITION IS NOT DERIVED HERE (D-18). `computeDraftDisposition` is imported and its
// return is assigned. No `switch`, no `if` chain, no "keep-eligible when all four are true"
// reading of the rule lives in this package — 394 consumes the disposition and must be
// structurally unable to re-derive its own, which is only true if this side cannot either.
//
// MAP, NOT TERRITORY (D-19, T-393-02). The receipt is built strictly against `DraftReceiptSchema`:
// run IDs as refs, pre-interpolation step text, findings. There is no field on it that could hold
// a run payload or a resolved secret, and `.strict()` makes an attempt to add one a typed refusal
// rather than a durable leak.

import {
  computeDraftDisposition,
  DRAFT_STABILITY_RUNS_N,
  DraftReceiptSchema,
  testFingerprintElements,
} from '@vostride/agent-qa-schema'
import type { DraftReceipt, PerTestOutcome } from '@vostride/agent-qa-schema'

import { addsValueGate } from './adds-value.js'
import { assertionStrengthGate } from './assertion-strength.js'
import type {
  DraftReceiptsStoreLike,
  DraftRunPortLike,
  ParsedDraftLike,
  SuiteFingerprintIndexLike,
  SuiteTextCorpusEntryLike,
} from './ports.js'
import { runStabilityGates } from './stability-gates.js'

/**
 * A capability the evaluation needs was not supplied by the composition.
 *
 * The named-refusal idiom `FunctionNotBoundError` establishes for the function layer, applied one
 * level down: a host missing a run port cannot evaluate gates 1-2 at all, and the honest answer is
 * to say which port by name rather than to report four booleans computed from nothing.
 */
export class DraftEvaluationPortNotBoundError extends Error {
  constructor(readonly port: string) {
    super(`the draft gate evaluator has no ${port} port bound in this composition`)
    this.name = 'DraftEvaluationPortNotBoundError'
  }
}

export interface EvaluateDraftInput {
  readonly draft: ParsedDraftLike
  /**
   * Draft mode: take ONE stability run instead of the pinned N.
   *
   * Consequential rather than a speed knob — `computeDraftDisposition` forces `unverified`
   * unconditionally for a one-run evaluation, so nothing evaluated this way can be auto-kept
   * however its four booleans read (D-18, SC3).
   */
  readonly draftMode?: boolean
}

export interface EvaluateDraftPorts {
  readonly runs: DraftRunPortLike
  readonly fingerprints: SuiteFingerprintIndexLike
  /** D-16's evidence-less population. An empty array is a legitimate answer, not an absent port. */
  readonly textCorpus: readonly SuiteTextCorpusEntryLike[]
  readonly receipts: DraftReceiptsStoreLike
  /** Injected so a receipt's `evaluatedAt` is pinnable in a test. Defaults to the wall clock. */
  readonly now?: () => number
}

/**
 * The draft's own fingerprint elements, from its own gate-run evidence.
 *
 * WHY EVIDENCE AND NOT STEP TEXT. A suite element is minted from what the run actually resolved —
 * `{kind, type, anchor: {t:'el', role, name, ordinal}}` after normalization — so its bytes encode
 * facts (the element's a11y role, its normalized accessible name, its ordinal among peers) that
 * exist only after a browser rendered the page. Deriving the draft's side from the NL step text
 * instead would have to invent those facts, and an invented anchor matches a resolved one only by
 * accident: every draft element would come out novel and gate 3 would return `true` for every
 * draft ever evaluated, including the corpus's own near-duplicate rejector. A gate that cannot
 * return false is not a gate. Gates 1-2 have already executed the draft by the time this runs, so
 * the evidence is in hand and no extra run is taken for it.
 *
 * WHICH RUN'S EVIDENCE. The newest run that yielded any elements, which is the suite fold's own
 * rule applied to the draft: newest evidence wins, and a run contributing zero elements never
 * erases what an earlier one observed. The alternative — unioning across runs — would make the
 * draft's element set grow with N while every suite identity's stays fixed at one run's worth,
 * which is an asymmetry that would quietly make longer evaluations look more novel.
 */
function draftFingerprintElements(members: readonly PerTestOutcome[]): string[] {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const elements = testFingerprintElements(members[index] as PerTestOutcome)
    if (elements.length > 0) return elements
  }
  return []
}

/**
 * Evaluate one parsed draft through all four keep-gates and persist the receipt (WTST-02).
 *
 * Returns the receipt AND writes it (D-19), so a caller never has to re-read the store to learn
 * what was just decided.
 */
export async function evaluateDraft(
  input: EvaluateDraftInput,
  ports: EvaluateDraftPorts,
): Promise<DraftReceipt> {
  if (ports.runs === undefined) throw new DraftEvaluationPortNotBoundError('runs')
  if (ports.fingerprints === undefined) throw new DraftEvaluationPortNotBoundError('fingerprints')
  if (ports.receipts === undefined) throw new DraftEvaluationPortNotBoundError('receipts')

  const stabilityRunsRequested = input.draftMode === true ? 1 : DRAFT_STABILITY_RUNS_N

  // Gates 1 and 2.
  const stability = await runStabilityGates({
    draft: input.draft,
    runPort: ports.runs,
    runsRequested: stabilityRunsRequested,
  })

  // Gate 3, over the draft's own execution evidence.
  const draftElements = draftFingerprintElements(stability.draftMembers)
  const addsValue = addsValueGate({
    draft: { testName: input.draft.testName, steps: input.draft.steps },
    draftElements,
    index: ports.fingerprints,
    textCorpus: ports.textCorpus,
  })

  // Gate 4 — the deterministic static check, whose table lands verbatim on the receipt (D-11).
  const falsifiable = assertionStrengthGate({ steps: input.draft.steps })

  const runRefs = stability.gateRuns.map((row) => row.runId)
  const receipt = DraftReceiptSchema.parse({
    schemaVersion: 1,
    draftRef: {
      filePath: input.draft.filePath,
      testId: input.draft.testId,
      testName: input.draft.testName,
      contentDigest: input.draft.contentDigest,
    },
    gates: {
      executesDefinitive: {
        pass: stability.executesDefinitive,
        runRefs,
        indefinitiveRunRefs: stability.gateRuns
          .filter((row) => !row.definitive)
          .map((row) => row.runId),
        reason: stabilityGateOneReason(stability.executesDefinitive, stability.gateRuns.length),
      },
      stableVerdict: {
        pass: stability.stableVerdict,
        runRefs,
        distinctOutcomes: stability.distinctOutcomes,
        earlyStopped: stability.earlyStopped,
        reason: stabilityGateTwoReason(stability.distinctOutcomes, stability.earlyStopped),
      },
      addsValue: {
        pass: addsValue.pass,
        novelElementCount: addsValue.finding.novelElements.length,
        comparedTestCount: addsValue.finding.comparedTests.length,
        reason: addsValue.reason,
      },
      falsifiableAssertion: {
        pass: falsifiable.pass,
        assertionStepCount: falsifiable.assertionStepCount,
        falsifiableAssertionCount: falsifiable.falsifiableAssertionCount,
        reason: falsifiable.reason,
      },
    },
    stepTable: falsifiable.table,
    gateRuns: stability.gateRuns,
    addsValueFinding: addsValue.finding,
    stabilityRunsRequested,
    stabilityRunsCompleted: stability.runsCompleted,
    disposition: computeDraftDisposition({
      gates: {
        executesDefinitive: stability.executesDefinitive,
        stableVerdict: stability.stableVerdict,
        addsValue: addsValue.pass,
        falsifiableAssertion: falsifiable.pass,
      },
      stabilityRunsRequested,
      stabilityRunsCompleted: stability.runsCompleted,
    }),
    evaluatedAt: (ports.now ?? Date.now)(),
  })

  await ports.receipts.put(receipt)
  return receipt
}

function stabilityGateOneReason(pass: boolean, runCount: number): string {
  return pass
    ? `all ${runCount} gate-run(s) reached a final verdict about the draft (D-17)`
    : `${runCount} gate-run(s) taken; at least one reached no final verdict — see gateRuns[].reason`
}

function stabilityGateTwoReason(distinctOutcomes: readonly string[], earlyStopped: boolean): string {
  if (distinctOutcomes.length <= 1) {
    return `one verdict across the completed runs: ${distinctOutcomes[0] ?? 'none observed'}`
  }
  return `the verdict flipped across runs (${distinctOutcomes.join(' -> ')})`
    + (earlyStopped ? ' — remaining runs skipped, the flip is already proven (D-17)' : '')
}
