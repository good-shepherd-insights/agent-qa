import { describe, expect, it } from 'vitest'

import { buildEvalReport } from '../../match/metrics'
import type { EvalBatchReport } from '../../match/metrics'
import type { JudgeIdentityBlock } from '../../match/score'
import { assertBaselineComparator, renderBaselineComparatorRefusal } from '../comparator'
import {
  BASELINE_POINTER_SCHEMA_VERSION,
  composeBaselineProfileKey,
  projectBaselinePointer,
} from '../profile-key'

/**
 * Byte-copied from the committed D-18 fixture's `judge` block:
 * demo/init/agent-qa-eval/reports/358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e/report.json
 *
 * This unit cell stands for that artefact; the in-place proof against the real file is the
 * census cross-check (Plan 05) and the hygiene leg (Plan 03), so the two can never drift apart
 * without one of the three reddening.
 */
const FIXTURE_JUDGE_BLOCK: JudgeIdentityBlock = {
  confidenceThreshold: 'high',
  familyOverride: 'same-family-allowed',
  judgeFamily: 'openai',
  judgeModelId: 'gpt-5.6-sol',
  judgeVersion: 1,
}

const FIXTURE_BATCH_KEY = '358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e'

function fixtureReport(judge?: JudgeIdentityBlock): EvalBatchReport {
  return { ...buildEvalReport([], judge), batchKey: FIXTURE_BATCH_KEY }
}

describe('assertBaselineComparator (D-20, ROOT-11)', () => {
  it('refuses the committed same-family fixture with its verbatim identity values', () => {
    expect(assertBaselineComparator(fixtureReport(FIXTURE_JUDGE_BLOCK))).toEqual({
      ok: false,
      refusal: {
        kind: 'same-family-override',
        judgeModelId: 'gpt-5.6-sol',
        judgeFamily: 'openai',
        batchKey: '358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e',
      },
    })
  })

  it('admits honest abstention — a batch with no judge at all', () => {
    expect(assertBaselineComparator(buildEvalReport([]))).toEqual({ ok: true })
  })

  it('admits a family-disjoint judge carrying no override', () => {
    const judge: JudgeIdentityBlock = {
      judgeModelId: 'claude-sonnet-4-6',
      judgeFamily: 'claude',
      judgeVersion: 1,
      confidenceThreshold: 'high',
    }

    expect(assertBaselineComparator(fixtureReport(judge))).toEqual({ ok: true })
  })

  it('prints the refusal on one line naming kind, judge, family and batch key', () => {
    const verdict = assertBaselineComparator(fixtureReport(FIXTURE_JUDGE_BLOCK))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return

    const line = renderBaselineComparatorRefusal(verdict.refusal)

    expect(line).toContain('same-family-override')
    expect(line).toContain('gpt-5.6-sol')
    expect(line).toContain('openai')
    expect(line).toContain('358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e')
    expect(line).toContain('not a gate comparator')
    expect(line).not.toContain('\n')
  })

  /**
   * 413-15 (2026-09-04): a batch whose persisted score records carried DIFFERING judge identity
   * blocks. `runReportVerb` never fabricates a single identity (T-372-20), so before this plan
   * such a report reached the predicate carrying no judge block at all — indistinguishable from
   * honest abstention, and admitted. The decision `refuse-mixed-identity` stamps the mixture on
   * the report from the batch's own blocks and refuses it here, in the ONE predicate.
   */
  it('refuses a report whose batch mixed judge identities with the verbatim ids (413-15 decision: refuse)', () => {
    const mixed = buildEvalReport([], undefined, {
      judgeIdentity: 'mixed',
      judgeModelIds: ['judge-fixture-b', 'judge-fixture-a', 'judge-fixture-a'],
    })

    // The ids are the distinct persisted judgeModelIds, sorted and deduped — never synthesized.
    expect(mixed.judgeIdentity).toBe('mixed')
    expect(mixed.mixedJudgeModelIds).toEqual(['judge-fixture-a', 'judge-fixture-b'])
    expect(Object.keys(mixed)).not.toContain('judge')

    expect(assertBaselineComparator({ ...mixed, batchKey: FIXTURE_BATCH_KEY })).toEqual({
      ok: false,
      refusal: {
        kind: 'mixed-judge-identity',
        judgeModelIds: ['judge-fixture-a', 'judge-fixture-b'],
        batchKey: FIXTURE_BATCH_KEY,
      },
    })
  })

  it('renders the mixed-identity refusal on one line naming both ids and the batch key (413-15)', () => {
    const mixed = buildEvalReport([], undefined, {
      judgeIdentity: 'mixed',
      judgeModelIds: ['judge-fixture-b', 'judge-fixture-a'],
    })
    const verdict = assertBaselineComparator({ ...mixed, batchKey: FIXTURE_BATCH_KEY })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return

    const line = renderBaselineComparatorRefusal(verdict.refusal)

    expect(line).toContain('mixed-judge-identity')
    expect(line).toContain('judge-fixture-a')
    expect(line).toContain('judge-fixture-b')
    expect(line).toContain(FIXTURE_BATCH_KEY)
    expect(line).toContain('not a gate comparator')
    expect(line).not.toContain('\n')
  })

  it('leaves a non-mixed report carrying neither judgeIdentity nor mixedJudgeModelIds (413-15)', () => {
    // Optional-spread, not undefined-valued keys: every already-committed report keeps its bytes.
    const keys = Object.keys(buildEvalReport([]))
    expect(keys).not.toContain('judgeIdentity')
    expect(keys).not.toContain('mixedJudgeModelIds')

    const judged = buildEvalReport([], FIXTURE_JUDGE_BLOCK)
    expect(Object.keys(judged)).not.toContain('judgeIdentity')
    expect(Object.keys(judged)).not.toContain('mixedJudgeModelIds')
  })

  it('never throws — an explicitly undefined judge and an unknown extra key both verdict', () => {
    const explicitlyUndefined = { ...buildEvalReport([]), judge: undefined }
    expect(assertBaselineComparator(explicitlyUndefined)).toEqual({ ok: true })

    const extraKey = {
      ...FIXTURE_JUDGE_BLOCK,
      unknownFutureField: 'ignored',
    } as unknown as JudgeIdentityBlock
    expect(assertBaselineComparator(fixtureReport(extraKey))).toEqual({
      ok: false,
      refusal: {
        kind: 'same-family-override',
        judgeModelId: 'gpt-5.6-sol',
        judgeFamily: 'openai',
        batchKey: FIXTURE_BATCH_KEY,
      },
    })
  })
})

describe('baseline profile key (D-19)', () => {
  it('composes the key from the fields the report already stamps', () => {
    expect(
      composeBaselineProfileKey({
        plannerModelId: 'gpt-5.6-terra',
        fingerprint: 'abc',
        matcherVersion: 1,
        judgeModelId: 'claude-sonnet-4-6',
        judgeVersion: 1,
      }),
    ).toBe(
      'planner=gpt-5.6-terra|fingerprint=abc|matcher=1|judge=claude-sonnet-4-6|judgeVersion=1',
    )

    // Honest abstention has its own key: a no-judge profile is a different profile.
    expect(
      composeBaselineProfileKey({
        plannerModelId: 'gpt-5.6-terra',
        fingerprint: 'abc',
        matcherVersion: 1,
      }),
    ).toBe('planner=gpt-5.6-terra|fingerprint=abc|matcher=1|judge=none|judgeVersion=none')
  })

  it('projects a byte-stable pointer carrying no undefined key and no wall-clock field', () => {
    const withJudge = projectBaselinePointer({
      plannerModelId: 'gpt-5.6-terra',
      fingerprint: 'abc',
      corpusDigest: 'digest-fixture',
      matcherVersion: 1,
      judgeModelId: 'claude-sonnet-4-6',
      judgeVersion: 1,
      batchKey: 'abc',
    })

    expect(withJudge).toEqual({
      schemaVersion: BASELINE_POINTER_SCHEMA_VERSION,
      profileKey: 'planner=gpt-5.6-terra|fingerprint=abc|matcher=1|judge=claude-sonnet-4-6|judgeVersion=1',
      fingerprint: 'abc',
      corpusDigest: 'digest-fixture',
      batchKey: 'abc',
      plannerModelId: 'gpt-5.6-terra',
      matcherVersion: 1,
      judgeModelId: 'claude-sonnet-4-6',
      judgeVersion: 1,
    })

    const abstained = projectBaselinePointer({
      plannerModelId: 'gpt-5.6-terra',
      fingerprint: 'abc',
      corpusDigest: 'digest-fixture',
      matcherVersion: 1,
      batchKey: 'abc',
    })

    // Optional-spread, not undefined-valued keys: committedFileText must stay byte-stable.
    expect(Object.keys(abstained).sort()).toEqual([
      'batchKey',
      'corpusDigest',
      'fingerprint',
      'matcherVersion',
      'plannerModelId',
      'profileKey',
      'schemaVersion',
    ])
    expect(JSON.stringify(abstained)).not.toContain('designatedAt')
  })
})
