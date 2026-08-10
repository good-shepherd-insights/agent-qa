// Gates 1 and 2 — the stability driver (Phase 393, D-02/D-17 · WTST-02).
//
// Gate 1 asks whether the draft reached a DEFINITIVE verdict; gate 2 asks whether that verdict
// HELD. Both are answered from execution evidence alone — never from `analyze-run`'s authoring
// output (the verdict/post-processing split, live-view.md §4) — and both read the DRAFT'S OWN
// member-test outcome rather than the run's aggregate, because the aggregate carries
// quarantine-aware rules that are noise for a draft nobody has ever run before.
//
// EVERY START INPUT CARRIES BOTH MARKERS (D-02, T-393-03). `gateRun: true` and
// `excludedFromOutcomes: true` are distinct axes and both are set on every run this module takes.
// A gate-run that entered the outcome fold would seed the very union gate 3 later compares the
// draft against, and the corruption accumulates in a derived index rather than announcing itself.
// The markers are not merely SENT — the acknowledgment is checked, because `runs.start` copies
// them off the durable record instead of echoing the request, so an acknowledgment without them
// is the host reporting that the run was not accepted as a gate-run.

import { DRAFT_STABILITY_RUNS_N } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  GateRunRecord,
  MemberTestOutcome,
  PerTestOutcome,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

import type { DraftRunPortLike, ParsedDraftLike } from './ports.js'

/**
 * The run was started but the host did not report it back as a gate-run.
 *
 * A refusal rather than a warning, and the reasoning is about blast radius. Every other failure
 * in this module degrades one draft's receipt; this one silently widens the suite union with the
 * draft's own evidence, in a derived index that accumulates across runs, so the next draft
 * evaluated against it reads its own surface as already covered. Nothing downstream can detect
 * that from a receipt. Stopping is the only response that keeps the corruption from compounding.
 */
export class GateRunNotFlaggedError extends Error {
  constructor(readonly runId: string, readonly acknowledged: {
    gateRun?: true
    excludedFromOutcomes?: true
  }) {
    super(
      `runs.start accepted ${runId} without both gate-run markers ` +
        `(gateRun=${String(acknowledged.gateRun)}, ` +
        `excludedFromOutcomes=${String(acknowledged.excludedFromOutcomes)}): ` +
        'an unflagged gate-run pollutes the outcome projection and the suite fingerprint union ' +
        'the draft is later compared against (WTST-06).',
    )
    this.name = 'GateRunNotFlaggedError'
  }
}

export interface RunStabilityGatesInput {
  readonly draft: ParsedDraftLike
  readonly runPort: DraftRunPortLike
  /** How many runs to take. `1` is draft mode; absent means the pinned N. */
  readonly runsRequested?: number
}

export interface StabilityGatesResult {
  /** Gate 1. */
  readonly executesDefinitive: boolean
  /** Gate 2. */
  readonly stableVerdict: boolean
  /** One row per run taken, in order — the receipt's `gateRuns`. */
  readonly gateRuns: GateRunRecord[]
  readonly runsCompleted: number
  /** True when D-17's early-stop fired: the reason a completed count may be below N. */
  readonly earlyStopped: boolean
  /**
   * The distinct COMPARISON verdicts observed; `length > 1` is the flip, exactly as
   * `DraftGateResultsSchema.stableVerdict.distinctOutcomes` promises. Raw member-outcome enum
   * values live per run on `gateRuns[].memberOutcome`.
   */
  readonly distinctOutcomes: string[]
  /**
   * The draft's own member outcome from each run that produced one, in order.
   *
   * Gate 3's draft-side elements are computed from these — see `verify-draft.ts`. Carried out of
   * this module rather than re-read because the run documents are already in hand here, and
   * fetching them twice would let the two gates disagree about which run they are describing.
   */
  readonly draftMembers: PerTestOutcome[]
}

/**
 * Member outcomes that represent a FINAL answer about the draft (D-17).
 *
 * `healed` is here and it is load-bearing rather than lenient: 393-01 measured the accept
 * control's definitive pass arriving as `healed`, not `passed` (F3), on the very draft the corpus
 * exists to accept. A gate 1 that treats a heal as indefinitive fails it.
 */
const DEFINITIVE_MEMBER_OUTCOMES: ReadonlySet<string> = new Set<MemberTestOutcome>([
  'passed',
  'failed',
  'healed',
])

/** The sentinel `memberOutcome` for a run whose document held no member for this draft. */
export const ABSENT_MEMBER_OUTCOME = 'absent'

/**
 * The verdict gate 2 COMPARES across runs — `healed` folded into `passed`.
 *
 * A heal is a recovery within one run, not a different answer about the app, and 393-01's F2
 * measured heals arriving on 5 of 8 corpus drafts from seeded procedure replay. Comparing the raw
 * enum would make nearly every draft read unstable for a reason that is about the knowledge store
 * rather than about the draft — a false gate-2 rejection, which is the direction that costs a user
 * a good test. The raw enum survives per run on the receipt, so nothing is hidden by the fold.
 */
function comparisonVerdict(memberOutcome: string): string {
  return memberOutcome === 'healed' ? 'passed' : memberOutcome
}

/** The draft's own member in a run document, by stable identity (never `testId`). */
export function findDraftMember(
  document: CompletedRunHandoff,
  draft: ParsedDraftLike,
): PerTestOutcome | undefined {
  return document.tests.find(
    (member) => member.filePath === draft.filePath && member.testName === draft.testName,
  )
}

/** Whether any step recorded a self-heal, beside the member outcome's own `healed` arm. */
function recordedHeal(member: PerTestOutcome): boolean {
  return member.outcome === 'healed'
    || member.steps.some((step) => step.selfHeal !== undefined)
}

/**
 * The `runs.start` input for one gate-run.
 *
 * `patterns` names the draft file and nothing else, so the run admits exactly the member the
 * gates then look for. The draft path is passed through as handed in — boundary validation (is
 * this path inside the workspace at all?) belongs at the op invoke where the resolved config
 * exists, and is plan 07's T-393-01 discharge.
 */
function gateRunStartInput(draft: ParsedDraftLike): RunsStartInput {
  return {
    patterns: [draft.filePath],
    gateRun: true,
    excludedFromOutcomes: true,
  }
}

/**
 * Take up to `runsRequested` gate-runs and answer gates 1 and 2 (D-17).
 *
 * The tracer depth: every run is taken, both markers are set and confirmed, and definitiveness is
 * read off the member-outcome enum. 393-01's F1 measured that the enum ALONE is not enough — a
 * draft referencing controls the target does not have reads `failed`, a definitive value, while
 * its step evidence records an infeasible termination — so the classifier grows a step-evidence
 * arm and an early-stop in this plan's Task 2. The shape it grows into is already here: `reason`
 * on every row says what was actually read.
 */
export async function runStabilityGates(
  input: RunStabilityGatesInput,
): Promise<StabilityGatesResult> {
  const runsRequested = input.runsRequested ?? DRAFT_STABILITY_RUNS_N
  const gateRuns: GateRunRecord[] = []
  const draftMembers: PerTestOutcome[] = []

  for (let taken = 0; taken < runsRequested; taken += 1) {
    const acknowledgement = await input.runPort.start(gateRunStartInput(input.draft))
    if (acknowledgement.gateRun !== true || acknowledgement.excludedFromOutcomes !== true) {
      throw new GateRunNotFlaggedError(acknowledgement.runId, acknowledgement)
    }

    const document = await input.runPort.get(acknowledgement.runId)
    const member = document === undefined ? undefined : findDraftMember(document, input.draft)

    if (member === undefined) {
      gateRuns.push({
        runId: acknowledgement.runId,
        memberOutcome: ABSENT_MEMBER_OUTCOME,
        definitive: false,
        healed: false,
        reason: document === undefined
          ? 'no completed-run record was readable for this run: nothing is known about it'
          : `the run document holds no member for (${input.draft.filePath}, ${input.draft.testName})`,
      })
      continue
    }

    draftMembers.push(member)
    const definitive = DEFINITIVE_MEMBER_OUTCOMES.has(member.outcome)
    gateRuns.push({
      runId: acknowledgement.runId,
      memberOutcome: member.outcome,
      definitive,
      healed: recordedHeal(member),
      reason: definitive
        ? `member outcome '${member.outcome}' is a final answer about the draft (D-17)`
        : `member outcome '${member.outcome}' is not a final pass or fail (D-17)`,
    })
  }

  const distinctOutcomes = [
    ...new Set(gateRuns.map((row) => comparisonVerdict(row.memberOutcome))),
  ]

  return {
    executesDefinitive: gateRuns.length > 0 && gateRuns.every((row) => row.definitive),
    stableVerdict: distinctOutcomes.length <= 1,
    gateRuns,
    runsCompleted: gateRuns.length,
    earlyStopped: false,
    distinctOutcomes,
    draftMembers,
  }
}
