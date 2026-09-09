// Phase 372-07 Task 2 — the deterministic markdown projection of EvalBatchReport (D-13's
// rendered half, discharging 369 D-16's deferred rendering per D-04). The renderer is a pure
// template over the DTO: two renders of the same DTO are byte-identical, every number lands
// verbatim, and no timestamp or locale formatting can enter the committed bytes (RESEARCH Open
// Q3: byte-deterministic so the write-once re-commit byte-compare holds clean).
import { describe, expect, it } from 'vitest'
import { buildEvalReport } from '@vostride/agent-qa-eval'
import type { EvalBatchReport, JudgeIdentityBlock } from '@vostride/agent-qa-eval'
import { renderEvalReportMarkdown } from '../eval-report-render.js'

const JUDGE: JudgeIdentityBlock = {
  judgeModelId: 'judge-fixture-model',
  judgeFamily: 'fixture-family',
  judgeVersion: 1,
  confidenceThreshold: 'high',
}

/** A fully-shaped zero report minted by the ONE aggregator, then selectively inflated. */
function fixtureReport(): EvalBatchReport {
  const report = buildEvalReport([], JUDGE)
  report.headline.firstAttemptDecisionAccuracy = { numerator: 3, denominator: 4, rate: 0.75 }
  report.headline.perDecisionCost = {
    decisionCount: 4,
    promptTokens: 125.5,
    completionTokens: 12.25,
    totalTokens: 137.75,
    durationMs: 321.5,
  }
  report.honesty.tieCounts['partial-identity'] = 2
  report.honesty.judge.settled['partial-identity'] = 1
  report.honesty.judge.notInvoked['no-eligible-judge'] = 1
  report.honesty.judge.cost = {
    calls: 1,
    inputTokens: 200,
    outputTokens: 40,
    outcomesMissingUsage: 0,
  }
  report.axisDistributions.elementIdentity.full = 3
  report.recovery = {
    selfHealPairCount: 1,
    recoveredPositiveCount: 1,
    eligiblePositiveCount: 1,
    recoveryAccuracy: 1,
    weightSum: 2 / 3,
    weightedAccuracy: 1,
    pairsWithoutWeight: 1,
    negativeDecisionCount: 1,
    negativeFullMatchCount: 1,
  }
  return report
}

describe('renderEvalReportMarkdown — deterministic projection (D-13/Open Q3)', () => {
  it('renders the same DTO to byte-identical strings', () => {
    const report = fixtureReport()
    const first = renderEvalReportMarkdown(report)
    const second = renderEvalReportMarkdown(report)
    expect(second).toBe(first)
    expect(Buffer.from(second, 'utf8').equals(Buffer.from(first, 'utf8'))).toBe(true)
  })

  it('projects the headline with its denominator, per-decision cost, every honesty group, and provenance', () => {
    const report = fixtureReport()
    const markdown = renderEvalReportMarkdown(report)

    // Locked structure: H1 + provenance + headline + honesty + axes + recovery.
    expect(markdown).toContain('# Eval Baseline Report')
    expect(markdown).toContain('## Provenance')
    expect(markdown).toContain('## Headline')
    expect(markdown).toContain('## Honesty Counters')
    expect(markdown).toContain('## Axis Distributions')
    expect(markdown).toContain('## Recovery')

    // Provenance block: batchKey, matcherVersion, and the full judge identity fields.
    expect(markdown).toContain(report.batchKey)
    expect(markdown).toContain(`matcherVersion: ${report.matcherVersion}`)
    expect(markdown).toContain('judge-fixture-model')
    expect(markdown).toContain('fixture-family')

    // Headline accuracy WITH its denominator — never a bare rate (D-14 honesty).
    expect(markdown).toContain('3/4')
    expect(markdown).toContain('0.75')
    // Per-decision cost fields, verbatim floats.
    expect(markdown).toContain('decisionCount: 4')
    expect(markdown).toContain('promptTokens: 125.5')
    expect(markdown).toContain('durationMs: 321.5')

    // Every honesty counter group present, including the judge disposition table with
    // notInvoked reasons and the distinct judge cost (D-04).
    expect(markdown).toContain('tieCounts')
    expect(markdown).toContain('unscorableIdentityCounts')
    expect(markdown).toContain('refusalCounts')
    expect(markdown).toContain('missByFailureCounts')
    expect(markdown).toContain('harnessErrorCount')
    expect(markdown).toContain('neverScoredCounts')
    expect(markdown).toContain('skippedCounts')
    expect(markdown).toContain('notInvoked')
    expect(markdown).toContain('no-eligible-judge: 1')
    expect(markdown).toContain('inputTokens: 200')

    // Recovery counters land verbatim, including the D-08 negative buckets.
    expect(markdown).toContain('negativeDecisionCount: 1')
    expect(markdown).toContain('negativeFullMatchCount: 1')
  })

  it('states judge absence honestly and never renders a timestamp (Open Q3)', () => {
    const absent = buildEvalReport([])
    const markdown = renderEvalReportMarkdown(absent)

    expect(markdown).toContain('no judge invoked')
    // No ISO timestamp pattern, no Date-derived bytes anywhere in the projection.
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })
})

describe('renderEvalReportMarkdown — judge family override honesty line (owner override of D-10, 2026-07-12)', () => {
  it('renders exactly ONE honesty line when the judge block carries familyOverride, byte-identical on re-render', () => {
    const report = buildEvalReport([], { ...JUDGE, familyOverride: 'same-family-allowed' })
    const markdown = renderEvalReportMarkdown(report)

    const occurrences = markdown.split('judge family override: same-family-allowed').length - 1
    expect(occurrences).toBe(1)
    // The disclosure is derived ONLY from the DTO — double-render stays byte-identical.
    expect(renderEvalReportMarkdown(report)).toBe(markdown)
  })

  it('renders NO override line when the judge block carries no marker', () => {
    const markdown = renderEvalReportMarkdown(fixtureReport())
    expect(markdown).not.toContain('judge family override')
  })

  it('renders NO override line when the report has no judge block at all', () => {
    const markdown = renderEvalReportMarkdown(buildEvalReport([]))
    expect(markdown).not.toContain('judge family override')
  })
})
