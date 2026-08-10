// The draft disposition: ONE derivation site (Phase 393, D-18).
//
// A draft receipt reports four independent gate booleans (WTST-02). The disposition is what
// those booleans plus the stability-run counts MEAN for keeping the draft, and it is computed
// here — once — so that 394's accept flow consumes a value it is structurally unable to
// re-derive. The never-auto-keep rule therefore lives in the vocabulary itself rather than in
// whichever caller happens to remember it, which is the whole point of putting it in `schema`.
//
// THE TABLE (contract, not implementation detail), evaluated in this order:
//   1. `stabilityRunsRequested === 1` (draft mode) → 'unverified', UNCONDITIONALLY — including
//      when all four gates passed. One run cannot observe stability, so a one-run evaluation
//      never earns a keep-shaped answer. 'unverified' rather than 'rejected' because the gates
//      did not say no; they were not given enough runs to say anything about gate 2 at all.
//   2. any gate boolean false → 'rejected'. Early-stopped stability runs (D-17 stops on the
//      first verdict flip) arrive here with `stabilityRunsCompleted` below N and must still
//      read 'rejected': the flip already proved instability, and the unrun runs would only
//      re-prove it. Letting the short count win would turn a proven-unstable draft into a
//      proposal.
//   3. all four true AND `stabilityRunsCompleted >= DRAFT_STABILITY_RUNS_N` → 'keep-eligible'.
//   4. all four true with fewer completed runs → 'proposal-only'. A short evaluation is never
//      auto-kept; it becomes a proposal carrying its receipt (394).

/**
 * The closed disposition vocabulary. 394's accept flow and the proposal envelope branch on
 * these exact names; renaming one after 394 ships is a cross-phase migration, not a rename.
 */
export const DRAFT_DISPOSITIONS = [
  'keep-eligible',
  'proposal-only',
  'rejected',
  'unverified',
] as const

export type DraftDisposition = (typeof DRAFT_DISPOSITIONS)[number]

/**
 * Stability runs a draft must complete before it can be keep-eligible. PINNED, never config.
 *
 * RETUNE: changing this number changes what the stability gate MEANS, so a retune is a
 * measurement, not a preference. Before moving it, re-measure on the frozen corpus: (a) the
 * gate-2 rejector's flip rate at the new N — the corpus rejector alternates on a pinned
 * per-request schedule, so a wrong N can make a proven-unstable draft read stable; (b) the
 * accept control's pass rate at the new N, since a higher N multiplies the chance that an
 * unrelated flake denies a good draft; (c) the wall-clock cost per draft (local-form runs are
 * ~22s each, so N is a direct multiplier on the authoring loop's latency budget). Record the
 * new numbers beside the frozen expectations table; a retune that only argues from intuition
 * is the failure this comment exists to prevent.
 */
export const DRAFT_STABILITY_RUNS_N = 3

/**
 * The four keep-gates, reported separately and never collapsed (WTST-02, D-04).
 *
 * All four are always present: D-04 forbids short-circuiting, because the corpus proves gate
 * INDEPENDENCE — a draft whose only failing gate is 4 demonstrates that gate 4 is the sole
 * catcher, which is unprovable if evaluation stops at the first `false`.
 */
export interface DraftGateBooleans {
  /** Gate 1: the draft reached a definitive verdict (a final pass or fail) on every run. */
  readonly executesDefinitive: boolean
  /** Gate 2: the verdict did not flip across the stability runs. */
  readonly stableVerdict: boolean
  /** Gate 3: the draft exercises at least one element absent from the suite union (D-14). */
  readonly addsValue: boolean
  /** Gate 4: at least one assertion step references concrete, falsifiable content (D-09). */
  readonly falsifiableAssertion: boolean
}

export interface DraftDispositionInput {
  readonly gates: DraftGateBooleans
  /**
   * Stability runs the evaluation ASKED for. `1` is draft mode and is the only value with a
   * special meaning — it forces 'unverified' by rule 1 above.
   */
  readonly stabilityRunsRequested: number
  /**
   * Stability runs that actually completed. Below the requested count either because the
   * evaluation early-stopped on a verdict flip (D-17) or because a run could not be taken.
   */
  readonly stabilityRunsCompleted: number
}

/**
 * The ONE disposition derivation (D-18). Pure, total, and order-sensitive exactly as the
 * table above states; every branch is pinned by `__tests__/disposition.test.ts`.
 */
export function computeDraftDisposition(input: DraftDispositionInput): DraftDisposition {
  if (input.stabilityRunsRequested === 1) return 'unverified'

  const { executesDefinitive, stableVerdict, addsValue, falsifiableAssertion } = input.gates
  if (!(executesDefinitive && stableVerdict && addsValue && falsifiableAssertion)) {
    return 'rejected'
  }

  return input.stabilityRunsCompleted >= DRAFT_STABILITY_RUNS_N ? 'keep-eligible' : 'proposal-only'
}
