// THE RUN-DETAIL PROJECTION, AS THE PAGE READS IT (405-06 · DETL-01, D-06/D-10/D-15/D-16..D-18).
//
// Every cell here drives a PURE function over the op's own `RunDetailProjection`. There is no DOM,
// no fetch and no clock, which is the whole reason this module exists separately from the page:
// 405-08's tree and 405-11's overview assert their copy BY CONSTANT rather than by string, so a
// sentence moves in one place and its cells move with it (the `post-processing-view.ts` idiom).
//
// THE TWO CELLS WITH TEETH are the token line and the screen-state label. Both are about the
// difference between "we measured nothing" and "we measured zero" — D-06's absent-is-not-zero law
// restated on the read side. A `?? 0` anywhere on that path would turn "nobody measured this" into
// "this was free", and the projection deliberately omits its three sums to make that impossible to
// say by accident; the cells below pin that the view layer does not put it back.

import { describe, expect, it } from 'vitest'
import type {
  RunDetailMember,
  RunDetailProjection,
  RunDetailStep,
  RunDetailSubAction,
} from '@vostride/agent-qa-schema'

import { formatTokens } from '@/lib/format'
import { DID_NOT_RUN_NOTE } from '@/lib/run-stream-reducer'
import * as view from '@/lib/run-detail-view'
import {
  DID_NOT_RUN_LABEL,
  MEMBER_FILTER_ALL,
  SCREEN_STATE_CHANGED_LABEL,
  SCREEN_STATE_UNCHANGED_LABEL,
  TOKENS_NOT_MEASURED_LABEL,
  filterGroups,
  groupRunDetail,
  memberNote,
  parseMemberFilter,
  reranLabel,
  screenStateChangeLabel,
  screenStateChip,
  showMemberChrome,
  tokenSummaryLine,
} from '@/lib/run-detail-view'

function member(testIndex: number, extra: Partial<RunDetailMember> = {}): RunDetailMember {
  return { testIndex, attempts: 1, ...extra }
}

function step(testIndex: number, stepIndex: number): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    cacheStatus: 'miss',
    verifierVerdict: 'pass',
    selfHealOccurred: false,
    briefDigest: `d${String(testIndex)}${String(stepIndex)}`,
  } as RunDetailStep
}

function subAction(
  testIndex: number,
  stepIndex: number,
  subActionIndex: number,
  extra: Partial<RunDetailSubAction> = {},
): RunDetailSubAction {
  return {
    testIndex,
    stepIndex,
    subActionIndex,
    plan: 'click it',
    plannedAction: { type: 'click' },
    result: { status: 'ok' },
    screenStateHash: 'abcdef0123456789'.repeat(4),
    ...extra,
  } as unknown as RunDetailSubAction
}

function projection(over: Partial<RunDetailProjection> = {}): RunDetailProjection {
  return {
    runId: 'run_1',
    members: [],
    steps: [],
    subActions: [],
    tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
    ...over,
  }
}

describe('groupRunDetail', () => {
  it('orders members, their steps and their sub-actions, and keeps a stepless member', () => {
    const grouped = groupRunDetail(
      projection({
        // Deliberately out of order on all three axes.
        members: [member(1, { name: 'second' }), member(0, { name: 'first' }), member(2, { name: 'thin' })],
        steps: [step(1, 1), step(0, 1), step(1, 0), step(0, 0)],
        subActions: [subAction(0, 0, 1), subAction(0, 0, 0), subAction(1, 0, 0)],
      }),
    )

    expect(grouped.map((g) => g.member.testIndex)).toEqual([0, 1, 2])
    expect(grouped[0]?.steps.map((s) => s.step.stepIndex)).toEqual([0, 1])
    expect(grouped[1]?.steps.map((s) => s.step.stepIndex)).toEqual([0, 1])
    expect(grouped[0]?.steps[0]?.subActions.map((s) => s.subActionIndex)).toEqual([0, 1])
    expect(grouped[1]?.steps[0]?.subActions.map((s) => s.subActionIndex)).toEqual([0])

    // D-18: a member whose stream began with a terminal event is STILL a group.
    expect(grouped[2]?.member.name).toBe('thin')
    expect(grouped[2]?.steps).toEqual([])
  })

  it("never hands one member's sub-actions to another member's step of the same index", () => {
    const grouped = groupRunDetail(
      projection({
        members: [member(0), member(1)],
        steps: [step(0, 0), step(1, 0)],
        subActions: [subAction(0, 0, 0, { plan: 'zero' }), subAction(1, 0, 0, { plan: 'one' })],
      }),
    )

    expect(grouped[0]?.steps[0]?.subActions.map((s) => s.plan)).toEqual(['zero'])
    expect(grouped[1]?.steps[0]?.subActions.map((s) => s.plan)).toEqual(['one'])
  })
})

describe('the member filter', () => {
  const groups = groupRunDetail(
    projection({ members: [member(0), member(1)], steps: [step(0, 0), step(1, 0)] }),
  )

  it('passes everything through for the default', () => {
    expect(filterGroups(groups, MEMBER_FILTER_ALL)).toHaveLength(2)
    expect(MEMBER_FILTER_ALL).toBe('all')
  })

  it('narrows to exactly one member', () => {
    const narrowed = filterGroups(groups, 1)
    expect(narrowed).toHaveLength(1)
    expect(narrowed[0]?.member.testIndex).toBe(1)
  })

  it('reads the URL param, and answers "all" for anything that is not an index', () => {
    expect(parseMemberFilter('7')).toBe(7)
    expect(parseMemberFilter('0')).toBe(0)
    expect(parseMemberFilter(null)).toBe(MEMBER_FILTER_ALL)
    expect(parseMemberFilter('x')).toBe(MEMBER_FILTER_ALL)
    expect(parseMemberFilter('')).toBe(MEMBER_FILTER_ALL)
    expect(parseMemberFilter('-1')).toBe(MEMBER_FILTER_ALL)
    expect(parseMemberFilter('1.5')).toBe(MEMBER_FILTER_ALL)
  })
})

describe('member copy', () => {
  it('says "did not run" for a stepless member and nothing for one that ran', () => {
    const [ran, thin] = groupRunDetail(
      projection({ members: [member(0), member(1)], steps: [step(0, 0)] }),
    )

    expect(memberNote(thin!.member, thin!)).toBe(DID_NOT_RUN_LABEL)
    expect(memberNote(ran!.member, ran!)).toBeUndefined()
    // The live surface and the durable surface must agree word for word (D-16).
    expect(DID_NOT_RUN_LABEL).toBe(DID_NOT_RUN_NOTE)
  })

  it('counts RE-RUNS, not attempts, and stays silent on the first attempt', () => {
    expect(reranLabel(3)).toBe('re-ran after failure ×2')
    expect(reranLabel(2)).toBe('re-ran after failure ×1')
    expect(reranLabel(1)).toBeUndefined()
    expect(reranLabel(0)).toBeUndefined()
  })
})

describe('tokenSummaryLine', () => {
  it('reports the sum and how much of the run it covers', () => {
    expect(
      tokenSummaryLine({
        measuredSteps: 2,
        unmeasuredSteps: 1,
        totalTokens: 1500,
        promptTokens: 1000,
        completionTokens: 500,
      }),
    ).toBe(`${formatTokens(1500)} tokens across 2 of 3 steps`)
  })

  it('never says "0 tokens" for a run nobody measured (D-06)', () => {
    const line = tokenSummaryLine({ measuredSteps: 0, unmeasuredSteps: 3 })
    expect(line).toBe(TOKENS_NOT_MEASURED_LABEL)
    expect(line).not.toContain('0')
  })

  it('refuses to invent a sum that the projection omitted', () => {
    // measuredSteps > 0 with no sums cannot happen on the shipped op — and if it ever did,
    // the honest answer is still "not measured", never a fabricated zero.
    expect(tokenSummaryLine({ measuredSteps: 2, unmeasuredSteps: 0 })).toBe(TOKENS_NOT_MEASURED_LABEL)
  })

  it('reports a genuinely measured zero as a measurement', () => {
    expect(tokenSummaryLine({ measuredSteps: 1, unmeasuredSteps: 0, totalTokens: 0 })).toBe(
      `${formatTokens(0)} tokens across 1 of 1 steps`,
    )
  })
})

describe('screen context (RESEARCH D2)', () => {
  const HASH = 'abcdef0123456789'.repeat(4)

  it('shows the first 12 hex characters of the hash', () => {
    expect(screenStateChip(HASH)).toBe('abcdef012345')
    expect(screenStateChip(HASH)).toHaveLength(12)
  })

  it('reads the pair, not the presence of the field', () => {
    expect(screenStateChangeLabel(subAction(0, 0, 0))).toBe(SCREEN_STATE_UNCHANGED_LABEL)
    expect(
      screenStateChangeLabel(subAction(0, 0, 0, { screenStateHashAfter: HASH })),
    ).toBe(SCREEN_STATE_UNCHANGED_LABEL)
    expect(
      screenStateChangeLabel(subAction(0, 0, 0, { screenStateHashAfter: 'f'.repeat(64) })),
    ).toBe(SCREEN_STATE_CHANGED_LABEL)
  })
})

describe('showMemberChrome', () => {
  it('is silent for a single-member run and grouped for a suite (D-16)', () => {
    expect(showMemberChrome(projection({ members: [member(0)] }))).toBe(false)
    expect(showMemberChrome(projection({ members: [] }))).toBe(false)
    expect(showMemberChrome(projection({ members: [member(0), member(1)] }))).toBe(true)
  })
})

describe('the copy inventory', () => {
  it('publishes only non-empty text-node sentences', () => {
    const labels = Object.entries(view).filter(([name]) => name.endsWith('_LABEL'))

    expect(labels.length).toBeGreaterThanOrEqual(6)
    for (const [name, value] of labels) {
      expect(typeof value, name).toBe('string')
      expect((value as string).length, name).toBeGreaterThan(0)
      // Text nodes only — nothing here is ever handed to a markup parser (T-405-21).
      expect((value as string).includes('<'), name).toBe(false)
    }
  })
})
