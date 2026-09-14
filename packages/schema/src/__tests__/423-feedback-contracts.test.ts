import { describe, expect, test } from 'vitest'

import {
  MARK_GOLD_CHANNELS,
  MARK_PREVIEW_DRAFT_KINDS,
  MARK_PREVIEW_LATEST_KINDS,
  MARK_PREVIEW_OUTCOMES,
  MARK_PREVIEW_REFUSALS,
  MARK_PROPOSAL_STATES,
  MARK_TARGET_REASONS,
  MARKS,
  MARKS_HISTORY_OUTCOMES,
  MarkPreviewDraftSchema,
  MarkPreviewLatestSchema,
  MarkProposalCurrentSchema,
  RunsMarkOutcomeSchema,
  RunsMarkPreviewResultSchema,
  RunsMarksHistoryResultSchema,
  asRunId,
} from '../index'

// Independent vocabularies, spelled by hand so no expected list is derived from production.
// Plan 423-23 owns the mutation script; C423-FEEDBACK-RESULTS-EXACT is its required RED cell.
const HISTORY_OUTCOMES = ['history', 'run-not-found', 'ledger-corrupt', 'ledger-unavailable'] as const
// The runtime list follows the envelope's status order; the schema arms pair the in-flight states first.
const PROPOSAL_STATES = ['pending', 'applied', 'rejected', 'expired', 'missing', 'corrupt'] as const
const PROPOSAL_STATE_ARMS = ['pending', 'expired', 'applied', 'rejected', 'missing', 'corrupt'] as const
const REFUSALS = ['run-not-found', 'member-not-found', 'step-not-found', 'ambiguous-address', 'ambiguous-correction'] as const
const PREVIEW_OUTCOMES = ['consequences', 'quarantined', 'already-marked', ...REFUSALS] as const
const MARK_OUTCOMES = ['marked', 'already-marked', ...REFUSALS] as const
const MARK_KINDS = ['false-fail', 'false-pass', 'confirmed-bug'] as const
const TARGET_REASONS = ['step-mark', 'failing-step', 'passing-verdict'] as const
const GOLD_CHANNELS = ['user-mark', 'overturned-verdict'] as const
const LATEST_KINDS = ['first', 'supersedes'] as const
const DRAFT_KINDS = ['confirmed-bug', 'knowledge', 'test-edit', 'no-draftable-fix'] as const

const runId = asRunId('run-feedback-contract')
type Options = { options: readonly { shape: Record<string, { value?: unknown }> }[] }
const armsOf = (union: unknown, key: string) => (union as Options).options.map(option => option.shape[key]!.value)

const HISTORY_CASES: Record<(typeof HISTORY_OUTCOMES)[number], unknown> = {
  history: { kind: 'history', runId, entries: [] },
  'run-not-found': { kind: 'run-not-found', runId },
  'ledger-corrupt': { kind: 'ledger-corrupt', runId, line: 3 },
  'ledger-unavailable': { kind: 'ledger-unavailable', runId },
}

const PROPOSAL_CASES: Record<(typeof PROPOSAL_STATES)[number], unknown> = {
  pending: { state: 'pending', applyInFlight: true },
  expired: { state: 'expired', applyInFlight: false },
  applied: { state: 'applied' },
  rejected: { state: 'rejected', decision: { decision: 'rejected', at: 9, reason: 'withdrawn' } },
  missing: { state: 'missing' },
  corrupt: { state: 'corrupt' },
}

const member = { testIndex: 0 }
const PREVIEW_CASES: Record<(typeof PREVIEW_OUTCOMES)[number], unknown> = {
  consequences: { kind: 'consequences', runId, prospective: true, markKind: 'false-fail', member,
    resolvedStep: { stepIndex: 0, reason: 'failing-step' }, markedDecisionCount: 1,
    groundTruth: [{ testIndex: 0, stepIndex: 0, verdict: 'pass', recordedVerdict: { pass: false, reasoning: 'r' }, correctedAction: false }],
    labels: [{ testIndex: 0, stepIndex: 0, decisionOrdinal: 0, sourceCassetteId: 'leaf', channel: 'user-mark', correction: { verdict: 'pass' } }],
    knowledge: { servedRecordIds: [], appendsEvidence: false },
    draft: { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: true } },
    latest: { kind: 'first' }, basis: { ledgerOrdinal: 0 } },
  quarantined: { kind: 'quarantined', runId, prospective: true, markKind: 'false-pass', member, class: 'timeout',
    resolvedStep: { stepIndex: 1, reason: 'step-mark' },
    latest: { kind: 'supersedes', markId: 'mark_000000000001', ordinal: 1 }, basis: { ledgerOrdinal: 1, priorMarkOrdinal: 1 } },
  'already-marked': { kind: 'already-marked', runId,
    prior: { markId: 'mark_000000000001', kind: 'confirmed-bug', ordinal: 1, testIndex: 0,
      disposition: { kind: 'confirmed-bug', confirmedRecords: 0 } },
    basis: { ledgerOrdinal: 1, priorMarkOrdinal: 1 } },
  'run-not-found': { kind: 'run-not-found', runId },
  'member-not-found': { kind: 'member-not-found', runId, testId: 'missing' },
  'step-not-found': { kind: 'step-not-found', runId, testIndex: 0, stepIndex: 4, stepCount: 2 },
  'ambiguous-address': { kind: 'ambiguous-address', runId, candidates: [{ testIndex: 0 }, { testIndex: 1 }] },
  'ambiguous-correction': { kind: 'ambiguous-correction', runId, testIndex: 0, decisionCount: 3 },
}

describe('C423-FEEDBACK-RESULTS-EXACT', () => {
  test('pins the marks-history outcome arms: runtime list, schema arms and parser', () => {
    expect([...MARKS_HISTORY_OUTCOMES]).toEqual([...HISTORY_OUTCOMES])
    expect(armsOf(RunsMarksHistoryResultSchema, 'kind')).toEqual([...HISTORY_OUTCOMES])
    for (const kind of HISTORY_OUTCOMES) {
      expect(RunsMarksHistoryResultSchema.safeParse(HISTORY_CASES[kind]).success, kind).toBe(true)
    }
    for (const unknown of ['history-partial', 'marked', 'ledger-locked']) {
      expect(RunsMarksHistoryResultSchema.safeParse({ kind: unknown, runId }).success, unknown).toBe(false)
    }
  })

  test('pins the current proposal states: runtime list, schema arms and parser', () => {
    expect([...MARK_PROPOSAL_STATES]).toEqual([...PROPOSAL_STATES])
    expect(armsOf(MarkProposalCurrentSchema, 'state')).toEqual([...PROPOSAL_STATE_ARMS])
    for (const state of PROPOSAL_STATES) {
      expect(MarkProposalCurrentSchema.safeParse(PROPOSAL_CASES[state]).success, state).toBe(true)
    }
    for (const unknown of ['accepted', 'withdrawn', 'draft']) {
      expect(MarkProposalCurrentSchema.safeParse({ state: unknown }).success, unknown).toBe(false)
    }
  })

  test('pins the preview outcome arms: runtime list, schema arms and parser', () => {
    expect([...MARK_PREVIEW_OUTCOMES]).toEqual([...PREVIEW_OUTCOMES])
    expect(armsOf(RunsMarkPreviewResultSchema, 'kind')).toEqual([...PREVIEW_OUTCOMES])
    for (const kind of PREVIEW_OUTCOMES) {
      expect(RunsMarkPreviewResultSchema.safeParse(PREVIEW_CASES[kind]).success, kind).toBe(true)
    }
    for (const unknown of ['marked', 'refused', 'effects', 'preview']) {
      expect(RunsMarkPreviewResultSchema.safeParse({ kind: unknown, runId }).success, unknown).toBe(false)
    }
  })

  test('pins the preview refusals as exactly runs.mark refusal arms, and keeps the runs.mark and MARKS sets', () => {
    expect([...MARK_PREVIEW_REFUSALS]).toEqual([...REFUSALS])
    expect([...MARKS]).toEqual([...MARK_KINDS])
    expect(armsOf(RunsMarkOutcomeSchema, 'kind')).toEqual([...MARK_OUTCOMES])
    const previewArms = (RunsMarkPreviewResultSchema as unknown as Options).options
    const markArms = (RunsMarkOutcomeSchema as unknown as Options).options
    for (const kind of REFUSALS) {
      const arm = previewArms.find(option => option.shape.kind!.value === kind)
      expect(arm, kind).toBe(markArms.find(option => option.shape.kind!.value === kind))
      expect(RunsMarkOutcomeSchema.safeParse(PREVIEW_CASES[kind]).success, kind).toBe(true)
    }
  })

  test('pins the preview sub-vocabularies: reasons, gold channels, latest and draft kinds', () => {
    expect([...MARK_TARGET_REASONS]).toEqual([...TARGET_REASONS])
    expect([...MARK_GOLD_CHANNELS]).toEqual([...GOLD_CHANNELS])
    expect([...MARK_PREVIEW_LATEST_KINDS]).toEqual([...LATEST_KINDS])
    expect(armsOf(MarkPreviewLatestSchema, 'kind')).toEqual([...LATEST_KINDS])
    expect([...MARK_PREVIEW_DRAFT_KINDS]).toEqual([...DRAFT_KINDS])
    expect(armsOf(MarkPreviewDraftSchema, 'kind')).toEqual([...DRAFT_KINDS])
    const base = PREVIEW_CASES.consequences as Record<string, unknown>
    expect(RunsMarkPreviewResultSchema.safeParse({ ...base, resolvedStep: { stepIndex: 0, reason: 'last-step' } }).success).toBe(false)
    expect(RunsMarkPreviewResultSchema.safeParse({ ...base, labels: [{ ...(base.labels as object[])[0], channel: 'silver' }] }).success).toBe(false)
    expect(RunsMarkPreviewResultSchema.safeParse({ ...base, latest: { kind: 'replaces', markId: 'mark_000000000001', ordinal: 1 } }).success).toBe(false)
    expect(MarkPreviewDraftSchema.safeParse({ kind: 'wording', text: 'x' }).success).toBe(false)
  })
})
