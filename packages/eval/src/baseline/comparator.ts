/**
 * 413 D-18/D-20 baseline comparator eligibility — ROOT-11's refusal as ONE pure predicate.
 *
 * A report judged under the `eval.judgeAllowSameFamily` override discloses a self-preference
 * bias condition (`JudgeIdentityBlock.familyOverride`, minted by D-10's owner override): the
 * number it carries is honest history, but it is NOT a comparator a later gate may measure
 * against. Pitfall 8's shape applies — the v50 39/45 report stays committed untouched as the
 * fixture this predicate is proven against, so the refusal can never drift from the artefact.
 *
 * Composition law: pure, total, and reused UNCHANGED by every caller — the baseline pointer
 * writer today, the census cross-check line, and Phase 415's `eval gate`. There is no second
 * refusal path; a caller that wants to disclose the reason renders the same typed refusal
 * through `renderBaselineComparatorRefusal`. Absent judge is honest abstention and PASSES:
 * ROOT-11 admits a family-disjoint judge and no judge alike, and only the override is refused.
 * Returns a discriminated union and never raises (the `SeedingRefusal` posture).
 */
import type { EvalBatchReport } from '../match/metrics'

/** Closed refusal-kind union so 415's gate narrows on it rather than string-matching. */
export type BaselineComparatorRefusalKind = 'same-family-override'

/** The typed refusal: every value is copied verbatim off the report that produced it. */
export interface BaselineComparatorRefusal {
  kind: BaselineComparatorRefusalKind
  judgeModelId: string
  judgeFamily: string
  batchKey: string
}

/** Eligibility verdict for using a report as a gate comparator. */
export type BaselineComparatorVerdict =
  { ok: true } | { ok: false; refusal: BaselineComparatorRefusal }

/**
 * D-20's single predicate: refuse exactly the reports whose judge block discloses the
 * same-family override; admit everything else, including a report with no judge at all.
 */
export function assertBaselineComparator(report: EvalBatchReport): BaselineComparatorVerdict {
  const judge = report.judge
  if (judge?.familyOverride === 'same-family-allowed') {
    return {
      ok: false,
      refusal: {
        kind: 'same-family-override',
        judgeModelId: judge.judgeModelId,
        judgeFamily: judge.judgeFamily,
        batchKey: report.batchKey,
      },
    }
  }
  return { ok: true }
}

/** One-line disclosure of a refusal, printed wherever the predicate is consulted (D-20). */
export function renderBaselineComparatorRefusal(refusal: BaselineComparatorRefusal): string {
  return (
    `baseline comparator refused: ${refusal.kind} — judge ${refusal.judgeModelId} ` +
    `(family ${refusal.judgeFamily}) judged batch ${refusal.batchKey} under ` +
    'eval.judgeAllowSameFamily; a same-family report is not a gate comparator (ROOT-11)'
  )
}
