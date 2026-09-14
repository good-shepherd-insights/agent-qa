import { describe, expectTypeOf, test } from 'vitest'

import type {
  MARK_GOLD_CHANNELS,
  MARK_PREVIEW_DRAFT_KINDS,
  MARK_PREVIEW_LATEST_KINDS,
  MARK_PREVIEW_OUTCOMES,
  MARK_PREVIEW_REFUSALS,
  MARK_PROPOSAL_STATES,
  MARK_TARGET_REASONS,
  MARKS,
  MARKS_HISTORY_OUTCOMES,
} from '../index'
import type {
  Mark,
  MarkPreviewDraft,
  MarkPreviewLabel,
  MarkPreviewLatest,
  MarkProposalCurrent,
  MarkProposalState,
  RunsMarkOutcome,
  RunsMarkPreviewResult,
  RunsMarksHistoryResult,
} from '../index'

// Independent literal unions: no expected vocabulary is derived from production.
// Plan 423-23 owns the mutation script; C423-FEEDBACK-RESULTS-EXACT is its required RED cell.
type HistoryOutcome = 'history' | 'run-not-found' | 'ledger-corrupt' | 'ledger-unavailable'
type ProposalState = 'pending' | 'expired' | 'applied' | 'rejected' | 'missing' | 'corrupt'
type Refusal = 'run-not-found' | 'member-not-found' | 'step-not-found' | 'ambiguous-address' | 'ambiguous-correction'
type PreviewOutcome = 'consequences' | 'quarantined' | 'already-marked' | Refusal
type MarkOutcome = 'marked' | 'already-marked' | Refusal
type MarkKind = 'false-fail' | 'false-pass' | 'confirmed-bug'

describe('C423-FEEDBACK-RESULTS-EXACT', () => {
  test('pins the four marks-history outcome arms in both directions', () => {
    expectTypeOf<RunsMarksHistoryResult['kind']>().toEqualTypeOf<HistoryOutcome>()
    expectTypeOf<(typeof MARKS_HISTORY_OUTCOMES)[number]>().toEqualTypeOf<HistoryOutcome>()
    expectTypeOf<
      Exclude<RunsMarksHistoryResult['kind'], (typeof MARKS_HISTORY_OUTCOMES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof MARKS_HISTORY_OUTCOMES)[number], RunsMarksHistoryResult['kind']>
    >().toEqualTypeOf<never>()
  })

  test('pins the six current proposal states in both directions', () => {
    expectTypeOf<MarkProposalCurrent['state']>().toEqualTypeOf<ProposalState>()
    expectTypeOf<MarkProposalState>().toEqualTypeOf<ProposalState>()
    expectTypeOf<Exclude<MarkProposalState, (typeof MARK_PROPOSAL_STATES)[number]>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<(typeof MARK_PROPOSAL_STATES)[number], MarkProposalCurrent['state']>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ProposalState, 'accepted' | 'withdrawn'>>().toEqualTypeOf<never>()
  })

  test('pins the eight preview outcome arms in both directions', () => {
    expectTypeOf<RunsMarkPreviewResult['kind']>().toEqualTypeOf<PreviewOutcome>()
    expectTypeOf<(typeof MARK_PREVIEW_OUTCOMES)[number]>().toEqualTypeOf<PreviewOutcome>()
    expectTypeOf<
      Exclude<RunsMarkPreviewResult['kind'], (typeof MARK_PREVIEW_OUTCOMES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof MARK_PREVIEW_OUTCOMES)[number], RunsMarkPreviewResult['kind']>
    >().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunsMarkPreviewResult['kind'], 'marked'>>().toEqualTypeOf<never>()
  })

  test('pins the preview refusals to runs.mark refusal objects and keeps the runs.mark and MARKS sets', () => {
    expectTypeOf<(typeof MARK_PREVIEW_REFUSALS)[number]>().toEqualTypeOf<Refusal>()
    expectTypeOf<Extract<RunsMarkPreviewResult, { kind: Refusal }>>().toEqualTypeOf<Extract<RunsMarkOutcome, { kind: Refusal }>>()
    expectTypeOf<RunsMarkOutcome['kind']>().toEqualTypeOf<MarkOutcome>()
    expectTypeOf<Mark>().toEqualTypeOf<MarkKind>()
    expectTypeOf<(typeof MARKS)[number]>().toEqualTypeOf<MarkKind>()
  })

  test('pins the preview sub-vocabularies in both directions', () => {
    type Reason = 'step-mark' | 'failing-step' | 'passing-verdict'
    type Channel = 'user-mark' | 'overturned-verdict'
    type Latest = 'first' | 'supersedes'
    type Draft = 'confirmed-bug' | 'knowledge' | 'test-edit' | 'no-draftable-fix'
    type Consequences = Extract<RunsMarkPreviewResult, { kind: 'consequences' }>
    expectTypeOf<Consequences['resolvedStep']['reason']>().toEqualTypeOf<Reason>()
    expectTypeOf<(typeof MARK_TARGET_REASONS)[number]>().toEqualTypeOf<Reason>()
    expectTypeOf<MarkPreviewLabel['channel']>().toEqualTypeOf<Channel>()
    expectTypeOf<(typeof MARK_GOLD_CHANNELS)[number]>().toEqualTypeOf<Channel>()
    expectTypeOf<MarkPreviewLatest['kind']>().toEqualTypeOf<Latest>()
    expectTypeOf<(typeof MARK_PREVIEW_LATEST_KINDS)[number]>().toEqualTypeOf<Latest>()
    expectTypeOf<MarkPreviewDraft['kind']>().toEqualTypeOf<Draft>()
    expectTypeOf<Exclude<(typeof MARK_PREVIEW_DRAFT_KINDS)[number], MarkPreviewDraft['kind']>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<MarkPreviewDraft['kind'], (typeof MARK_PREVIEW_DRAFT_KINDS)[number]>>().toEqualTypeOf<never>()
  })
})
