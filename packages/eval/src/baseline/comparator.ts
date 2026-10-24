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
 *
 * 413-15 (2026-09-04, decision `refuse-mixed-identity`, taken by the orchestrator under the
 * owner's standing delegation): a report whose batch MIXED judge identities carries no judge
 * block, because `runReportVerb` never fabricates one (T-372-20) — so until now it reached this
 * predicate looking identical to honest abstention and was ADMITTED, and would have been
 * designated under the `judge=none|judgeVersion=none` profile key that 413-02 D-2 reserved for a
 * genuinely judge-less measurement. Such a report now stamps `judgeIdentity: 'mixed'` and its
 * sorted distinct `mixedJudgeModelIds` at `buildEvalReport` time, and is REFUSED here with the
 * second typed kind `mixed-judge-identity`. This closes 413-02 D-1's open assumption in the ONE
 * place; Phase 415's `eval gate` narrows on the widened union rather than inventing a refusal.
 */
import type { EvalBatchReport } from '../match/metrics'

/** Closed refusal-kind union so 415's gate narrows on it rather than string-matching. */
export type BaselineComparatorRefusalKind = 'same-family-override' | 'mixed-judge-identity'

/** The v50 refusal: every value is copied verbatim off the judge block that produced it. */
export interface SameFamilyOverrideRefusal {
  kind: 'same-family-override'
  judgeModelId: string
  judgeFamily: string
  batchKey: string
}

/**
 * The 413-15 refusal: the DISTINCT judge model ids the batch actually carried, sorted — a list,
 * never one synthesized identity (T-372-20).
 */
export interface MixedJudgeIdentityRefusal {
  kind: 'mixed-judge-identity'
  judgeModelIds: readonly string[]
  batchKey: string
}

/** The typed refusal: every value is copied verbatim off the report that produced it. */
export type BaselineComparatorRefusal = SameFamilyOverrideRefusal | MixedJudgeIdentityRefusal

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
  if (report.judgeIdentity === 'mixed') {
    return {
      ok: false,
      refusal: {
        kind: 'mixed-judge-identity',
        judgeModelIds: report.mixedJudgeModelIds ?? [],
        batchKey: report.batchKey,
      },
    }
  }
  return { ok: true }
}

/** One-line disclosure of a refusal, printed wherever the predicate is consulted (D-20). */
export function renderBaselineComparatorRefusal(refusal: BaselineComparatorRefusal): string {
  if (refusal.kind === 'mixed-judge-identity') {
    return (
      `baseline comparator refused: ${refusal.kind} — judges ${refusal.judgeModelIds.join(', ')} ` +
      `judged batch ${refusal.batchKey} under differing identities; a mixed-judge report is ` +
      'not a gate comparator (ROOT-11)'
    )
  }
  return (
    `baseline comparator refused: ${refusal.kind} — judge ${refusal.judgeModelId} ` +
    `(family ${refusal.judgeFamily}) judged batch ${refusal.batchKey} under ` +
    'eval.judgeAllowSameFamily; a same-family report is not a gate comparator (ROOT-11)'
  )
}
