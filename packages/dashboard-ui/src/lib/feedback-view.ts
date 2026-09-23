// THE FEEDBACK COMPOSER'S COPY AND RULES (426 D-01, D-11, D-16, D-19, D-21).
//
// Pure and total: no I/O, no clock, no React. Every sentence a person reads in the composer is an
// exported constant or a pure function here, so cells assert against the constant and copy moves in
// one place.

import { markAddressKey } from '@vostride/agent-qa-schema'
import type {
  Mark,
  MarkDisposition,
  MarkFixKind,
  RunDetailMember,
  RunsMarkInput,
  RunsMarkPreviewResult,
} from '@vostride/agent-qa-schema'

/** A UI pointer to a mark address, never a new identity (419 D-11). */
export interface FeedbackTarget {
  testIndex: number
  stepIndex?: number
}

/** Raw text, so an invalid corrected action survives re-targeting and closing. */
export interface FeedbackDraft {
  kind?: Mark
  note: string
  expectation: string
  actionText: string
}

export const EMPTY_DRAFT: FeedbackDraft = { note: '', expectation: '', actionText: '' }

export function feedbackAddress(target: FeedbackTarget): string {
  return markAddressKey(target)
}

export const CHOICE_LABELS = {
  'false-fail': 'This should have passed',
  'false-pass': 'This should have failed',
  'confirmed-bug': 'This is a real product bug',
} satisfies Record<Mark, string>

export type FeedbackOutcomeClass = 'passed' | 'failed'

// prettier-ignore
export const FEEDBACK_OUTCOME_CLASSES = [
  'passed',
  'failed',
] as const satisfies readonly FeedbackOutcomeClass[]

// prettier-ignore
export const FEEDBACK_CHOICE_ORDER = {
  failed: [
    'false-fail',
    'confirmed-bug',
    'false-pass',
  ],
  passed: [
    'false-pass',
    'confirmed-bug',
    'false-fail',
  ],
} as const satisfies Record<FeedbackOutcomeClass, readonly [Mark, Mark, Mark]>

export type FeedbackComposerState =
  | 'composing'
  | 'submitting'
  | 'awaiting-approval'
  | 'recorded'
  | 'retained'

// prettier-ignore
export const FEEDBACK_COMPOSER_STATES = [
  'composing',
  'submitting',
  'awaiting-approval',
  'recorded',
  'retained',
] as const satisfies readonly FeedbackComposerState[]

export const PREVIEW_DEBOUNCE_MS = 300

export const FEEDBACK_PANEL_IDS = {
  tree: 'run-tree',
  evidence: 'run-evidence',
  feedback: 'run-feedback',
} as const

/**
 * The open three-panel layout, in percent (RESEARCH Pattern 3). Numeric panel sizes are pixels in
 * react-resizable-panels 4, so the composer's 384px target is converted against the measured group
 * width; tree and evidence split the rest in the shipped 35:65 ratio.
 */
export function feedbackPanelLayout(groupWidth: number): Record<string, number> {
  const feedback = groupWidth > 0 ? Math.min(Math.max((384 / groupWidth) * 100, (320 / groupWidth) * 100), 50) : 30
  const tree = (100 - feedback) * 0.35
  return {
    [FEEDBACK_PANEL_IDS.tree]: tree,
    [FEEDBACK_PANEL_IDS.evidence]: 100 - feedback - tree,
    [FEEDBACK_PANEL_IDS.feedback]: feedback,
  }
}

export type FeedbackCorrection = Pick<RunsMarkInput, 'correctedExpectation' | 'correctedAction'>

/** The preview input, composed exactly as the page's onMark composes its markRun body (D-16). */
export function previewInputFor(
  member: Pick<RunDetailMember, 'testId'>,
  target: FeedbackTarget,
  kind: Mark,
  correction?: FeedbackCorrection,
): Omit<RunsMarkInput, 'runId' | 'note'> {
  return {
    kind,
    ...(member.testId ? { testId: member.testId } : {}),
    ...(target.stepIndex === undefined ? {} : { stepIndex: target.stepIndex }),
    ...correction,
  }
}

export interface PreviewRequest extends FeedbackTarget, FeedbackCorrection {
  kind: Mark
}

/** Excludes the note: a note alone never changes what a mark does (isIdenticalRepeat). */
export function previewRequestKey(input: PreviewRequest): string {
  return JSON.stringify([
    input.kind,
    input.testIndex,
    input.stepIndex ?? 'run',
    input.correctedExpectation ?? null,
    input.correctedAction ?? null,
  ])
}

export const SUBMIT_REASON_NO_CHOICE = 'Choose one of the three options.'
export const SUBMIT_REASON_CHECKING = 'Checking what this will do…'
export const SUBMIT_REASON_SENDING = 'Sending…'

export interface SubmitBlockInput {
  kind: Mark | undefined
  currentKey: string
  landedKey: string | undefined
  landedOutcome: RunsMarkPreviewResult['kind'] | 'failed' | undefined
  inFlight: boolean
}

/** First match wins; '' means Send feedback is available (D-19). */
export function submitBlockedReason(input: SubmitBlockInput): string {
  if (input.kind === undefined) return SUBMIT_REASON_NO_CHOICE
  if (
    input.landedKey !== input.currentKey ||
    (input.landedOutcome !== 'consequences' && input.landedOutcome !== 'quarantined')
  ) {
    return SUBMIT_REASON_CHECKING
  }
  if (input.inFlight) return SUBMIT_REASON_SENDING
  return ''
}

export const SEND_FEEDBACK_LABEL = 'Send feedback'
export const PREVIEW_TITLE = 'What this will do'
export const SENDING_STATUS = 'Sending feedback…'
export const FEEDBACK_ENTRY_TEST_LABEL = 'Give feedback on this test'
export const CLOSE_FEEDBACK_LABEL = 'Close feedback'

export const DISPOSITION_TEXT = {
  drafted: {
    fact: 'Recorded — a knowledge fact was drafted for review',
    caution: 'Recorded — a caution was drafted for review',
    'procedure-hint': 'Recorded — a procedure hint was drafted for review',
    'test-edit': 'Recorded — a test edit was drafted for review',
  } satisfies Record<MarkFixKind, string>,
  'no-draftable-fix': 'Recorded — no fix could be drafted',
  'confirmed-bug': 'Recorded — kept as a real product bug; no fix drafted',
} as const

export function dispositionText(disposition: MarkDisposition): string {
  switch (disposition.kind) {
    case 'quarantined':
      return `Recorded — quarantined (${disposition.class})`
    case 'drafted':
      return DISPOSITION_TEXT.drafted[disposition.fix]
    case 'no-draftable-fix':
      return DISPOSITION_TEXT['no-draftable-fix']
    case 'confirmed-bug':
      return DISPOSITION_TEXT['confirmed-bug']
    default:
      return disposition satisfies never
  }
}

export function feedbackRecordedText(disposition: MarkDisposition): string {
  return `Feedback recorded — ${dispositionText(disposition).replace(/^Recorded — /, '')}.`
}
