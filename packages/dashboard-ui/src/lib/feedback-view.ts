// THE FEEDBACK COMPOSER'S COPY AND RULES (426 D-01, D-11, D-12, D-14, D-16, D-19, D-21).
//
// Pure and total: no I/O, no clock, no React. Every sentence a person reads in the composer is an
// exported constant or a pure function here, so cells assert against the constant and copy moves in
// one place.

import { MARK_PREVIEW_REFUSALS, markAddressKey } from '@vostride/agent-qa-schema'
import type {
  Mark,
  MarkDisposition,
  MarkFixKind,
  MarkPreviewDraft,
  MarkPreviewEvidenceEffect,
  MarkPreviewGroundTruth,
  MarkPreviewKnowledge,
  MarkPreviewKnowledgeRecord,
  MarkQuarantineClass,
  MemberTestOutcome,
  RunDetailMember,
  RunDetailProjection,
  RunDetailStep,
  RunKnowledgeContentAbsence,
  RunsMarkInput,
  RunsMarkPreviewResult,
} from '@vostride/agent-qa-schema'

import type { FeedbackReadFailure } from './api'
import { UNNAMED_STEP_LABEL } from './display-step'
import { memberDisplayName, memberHandleLabel } from './run-detail-view'

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

export function isDraftEmpty(draft: FeedbackDraft): boolean {
  return draft.kind === undefined && draft.note === '' && draft.expectation === '' && draft.actionText === ''
}

/**
 * A place the composer can name (D-08, D-09): a step by number, a test by name and handle. `member`
 * is given only in a suite; without it a test is "this test".
 */
export interface FeedbackPlace {
  stepIndex?: number
  member?: Pick<RunDetailMember, 'testIndex' | 'name'>
}

function placeText({ stepIndex, member }: FeedbackPlace): string {
  const test = member === undefined ? undefined : `${memberDisplayName(member)} ${memberHandleLabel(member.testIndex)}`
  if (stepIndex === undefined) return test ?? 'this test'
  return test === undefined ? `step ${String(stepIndex + 1)}` : `step ${String(stepIndex + 1)} of ${test}`
}

/** Tests are named only when the viewed and the targeted test differ. */
export function pinnedTargetText(viewing: FeedbackPlace, target: FeedbackPlace): string {
  const differ =
    viewing.member !== undefined && target.member !== undefined && viewing.member.testIndex !== target.member.testIndex
  const viewed = differ ? viewing : { stepIndex: viewing.stepIndex }
  const about = target.stepIndex === undefined || differ ? target : { stepIndex: target.stepIndex }
  return `You're viewing ${placeText(viewed)} — this feedback is about ${placeText(about)}.`
}

export function switchTargetLabel(to: FeedbackPlace): string {
  return `Switch to ${placeText(to)}`
}

export function unsentDraftLabel(place: FeedbackPlace): string {
  return `Unsent draft: ${placeText(place)}`
}

export const NOTE_LABEL = 'Note (optional)'

export const ADD_CORRECTION_LABEL = 'Add a correction'

/** Why the corrected-action field is hidden (UI-SPEC S4; quarantined and unavailable are U7's rows). */
export type CorrectedActionGateState = 'no-choice' | 'loading' | 'count' | 'quarantined' | 'unavailable'

export function correctedActionUnavailableText(state: CorrectedActionGateState, count = 0): string {
  switch (state) {
    case 'no-choice':
      return 'Pick a choice first — a corrected action is only possible when the mark covers exactly one recorded decision.'
    case 'loading':
      return 'Checking whether a corrected action is possible…'
    case 'count':
      return count === 0
        ? "A corrected action isn't possible here — this mark covers no recorded decision."
        : `A corrected action isn't possible here — this mark covers ${String(count)} recorded decisions, and a correction needs exactly one.`
    case 'quarantined':
      return "A corrected action isn't used — this mark is quarantined."
    case 'unavailable':
      return "A corrected action can't be checked until the preview above answers."
    default:
      return state satisfies never
  }
}

export type CorrectedActionGate =
  | { shown: true }
  | { shown: false; state: Exclude<CorrectedActionGateState, 'count'> }
  | { shown: false; state: 'count'; count: number }

export interface CorrectedActionGateInput {
  kind: Mark | undefined
  /**
   * The last read that landed for this target and kind, current or not: a re-fetch in flight keeps
   * the landed decision, so the field never disappears mid-typing.
   */
  landedForTargetAndKind:
    | { kind: 'read'; result: RunsMarkPreviewResult }
    | { kind: 'failed'; reason: string }
    | undefined
}

/**
 * D-15: a corrected action is scored against exactly one recorded decision, so the field shows only
 * for a consequences read whose markedDecisionCount is 1 — runs.mark never receives
 * ambiguous-correction from the dashboard.
 */
export function correctedActionGate({ kind, landedForTargetAndKind: landed }: CorrectedActionGateInput): CorrectedActionGate {
  if (kind === undefined) return { shown: false, state: 'no-choice' }
  if (landed === undefined) return { shown: false, state: 'loading' }
  if (landed.kind === 'failed') return { shown: false, state: 'unavailable' }
  const read = landed.result
  if (read.kind === 'quarantined') return { shown: false, state: 'quarantined' }
  if (read.kind !== 'consequences') return { shown: false, state: 'unavailable' }
  return read.markedDecisionCount === 1 ? { shown: true } : { shown: false, state: 'count', count: read.markedDecisionCount }
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

export const CHOICE_LEGEND = 'Which is true?'

export const CHOICE_MEANINGS = {
  failed: {
    'false-fail': 'The app behaved correctly; the test was wrong to fail.',
    'confirmed-bug': 'The failure is real — the app is broken here.',
    'false-pass': 'The test missed a problem it should have caught.',
  },
  passed: {
    'false-fail': 'The pass is right; this confirms the test.',
    'confirmed-bug': 'The app has a real bug here, even though the test passed.',
    'false-pass': 'The app was broken here, but the test passed anyway.',
  },
} satisfies Record<FeedbackOutcomeClass, Record<Mark, string>>

function statusClass(status: string | undefined): FeedbackOutcomeClass {
  return status === 'passed' || status === 'healed' ? 'passed' : 'failed'
}

/**
 * Healed counts as passed; anything that did not pass orders as failed. A member with no recorded
 * outcome takes the run row's status the same way, and failed when that is not a verdict either.
 */
export function memberOutcomeClass(
  outcome: MemberTestOutcome | undefined,
  runStatus?: string,
): FeedbackOutcomeClass {
  return statusClass(outcome ?? runStatus)
}

export interface FeedbackOutcomeInput {
  member: Pick<RunDetailMember, 'outcome'> | undefined
  step?: Partial<Pick<RunDetailStep, 'verifierVerdict'>>
  runStatus: string | undefined
}

/** The target's own recorded result: a step reads its verifier verdict, a test its outcome (D-11). */
export function feedbackOutcomeClass({ member, step, runStatus }: FeedbackOutcomeInput): FeedbackOutcomeClass {
  // verifierVerdict is required by the schema, but fetchRunDetail does not parse (UI-SPEC U9).
  const verdict = step?.verifierVerdict
  if (verdict != null) return verdict.pass ? 'passed' : 'failed'
  return memberOutcomeClass(member?.outcome, runStatus)
}

/**
 * A sentence with one producer string in it. The product words stay constants and `name` is painted
 * through MaskedText as a text node, so a step or test name can never become markup.
 */
export interface FeedbackTextParts {
  prefix: string
  name?: string
  suffix?: string
}

export function feedbackPartsText(parts: FeedbackTextParts): string {
  return `${parts.prefix}${parts.name ?? ''}${parts.suffix ?? ''}`
}

export const WHOLE_TEST_SCOPE_TEXT = 'Whole test'
export const ONE_STEP_SCOPE_TEXT = 'One step'

export const RECORDED_RESULT_TEXT = {
  passed: 'recorded: passed',
  healed: 'recorded: healed — counts as passed',
  failed: 'recorded: failed',
  timeout: 'recorded: timed out — counts as failed',
  cancelled: 'recorded: cancelled — counts as failed',
  skipped: 'recorded: skipped — counts as failed',
} satisfies Record<MemberTestOutcome, string>

export function NO_STEP_VERDICT_TEXT(testRecordedText: string): string {
  return `no step verdict recorded — using the test's result (${testRecordedText})`
}

function recordedKey(status: string | undefined): MemberTestOutcome | undefined {
  return status !== undefined && Object.hasOwn(RECORDED_RESULT_TEXT, status) ? (status as MemberTestOutcome) : undefined
}

export type FeedbackScopeMember = Pick<RunDetailMember, 'testIndex' | 'name' | 'outcome'>
export type FeedbackScopeStep = Pick<RunDetailStep, 'stepIndex'> &
  Partial<Pick<RunDetailStep, 'stepText' | 'verifierVerdict' | 'status'>>

export interface ComposerHeadingInput {
  member: Pick<RunDetailMember, 'testIndex' | 'name'>
  step?: Pick<FeedbackScopeStep, 'stepIndex' | 'stepText'>
  stepCount: number
  suite: boolean
}

/** D-14: the exact step or test the composer is about; step numbers are stepIndex + 1. */
export function composerHeading({ member, step, stepCount, suite }: ComposerHeadingInput): FeedbackTextParts {
  if (step !== undefined) {
    return {
      prefix: `Feedback on step ${String(step.stepIndex + 1)} of ${String(stepCount)} · `,
      name: step.stepText ?? UNNAMED_STEP_LABEL,
    }
  }
  return suite
    ? { prefix: 'Feedback on ', name: memberDisplayName(member), suffix: ` ${memberHandleLabel(member.testIndex)}` }
    : { prefix: 'Feedback on ', name: memberDisplayName(member) }
}

export interface ScopeLineInput {
  member: FeedbackScopeMember
  step?: FeedbackScopeStep
  suite: boolean
  runStatus: string | undefined
}

function memberRecordedText(member: Pick<RunDetailMember, 'outcome'>, runStatus: string | undefined): string {
  return RECORDED_RESULT_TEXT[recordedKey(member.outcome ?? runStatus) ?? memberOutcomeClass(member.outcome, runStatus)]
}

/** The step's own word when it agrees with its verdict, else the verdict's class — never a contradiction. */
function stepRecordedText(step: FeedbackScopeStep, member: FeedbackScopeMember, runStatus: string | undefined): string {
  const verdict = step.verifierVerdict
  if (verdict == null) return NO_STEP_VERDICT_TEXT(memberRecordedText(member, runStatus))
  const cls: FeedbackOutcomeClass = verdict.pass ? 'passed' : 'failed'
  const own = recordedKey(step.status)
  return RECORDED_RESULT_TEXT[own !== undefined && memberOutcomeClass(own) === cls ? own : cls]
}

export function scopeLine({ member, step, suite, runStatus }: ScopeLineInput): FeedbackTextParts {
  if (step === undefined) {
    return { prefix: `${WHOLE_TEST_SCOPE_TEXT} · ${memberRecordedText(member, runStatus)}` }
  }
  const recorded = stepRecordedText(step, member, runStatus)
  return suite
    ? {
        prefix: `${ONE_STEP_SCOPE_TEXT} in `,
        name: memberDisplayName(member),
        suffix: ` ${memberHandleLabel(member.testIndex)} · ${recorded}`,
      }
    : { prefix: `${ONE_STEP_SCOPE_TEXT} · ${recorded}` }
}

export interface FeedbackTargetViewInput {
  detail: Pick<RunDetailProjection, 'members' | 'steps'> | null | undefined
  target: FeedbackTarget
  runStatus: string | undefined
}

export interface FeedbackTargetView {
  outcomeClass: FeedbackOutcomeClass
  heading: FeedbackTextParts
  scopeLine: FeedbackTextParts
  /** The target member's step count from runs.detail. */
  stepCount: number
}

/** Everything the composer states about its target, read from the projection the page already holds. */
export function feedbackTargetView({ detail, target, runStatus }: FeedbackTargetViewInput): FeedbackTargetView {
  const found = detail?.members.find((entry) => entry.testIndex === target.testIndex)
  const member: FeedbackScopeMember = found ?? { testIndex: target.testIndex }
  const memberSteps = detail?.steps.filter((entry) => entry.testIndex === target.testIndex) ?? []
  const step: FeedbackScopeStep | undefined =
    target.stepIndex === undefined
      ? undefined
      : (memberSteps.find((entry) => entry.stepIndex === target.stepIndex) ?? { stepIndex: target.stepIndex })
  const suite = (detail?.members.length ?? 0) > 1
  const stepCount = Math.max(found?.totalSteps ?? memberSteps.length, step === undefined ? 0 : step.stepIndex + 1)
  return {
    outcomeClass: feedbackOutcomeClass({ member, step, runStatus }),
    heading: composerHeading({ member, step, stepCount, suite }),
    scopeLine: scopeLine({ member, step, suite, runStatus }),
    stepCount,
  }
}

export interface HeaderFeedbackTargetInput {
  detail: Pick<RunDetailProjection, 'members'> | null | undefined
  selectedStep: { testIndex: number; stepIndex: number } | null
  memberFilter: number | undefined
  runStatus: string | undefined
}

/**
 * D-03: the test the header entry means. A suite resolves, in order, to the selected step's test, the
 * member filter's test, the first failed member, then the first member — "first" in handle order.
 * The page auto-selects the first visible step, so on load rung 1 wins (RESEARCH Pitfall 5).
 */
export function resolveHeaderFeedbackTarget({
  detail,
  selectedStep,
  memberFilter,
  runStatus,
}: HeaderFeedbackTargetInput): FeedbackTarget | undefined {
  const members = detail?.members ?? []
  const named = (testIndex: number | undefined) =>
    testIndex === undefined ? undefined : members.find((entry) => entry.testIndex === testIndex)
  const chosen =
    members.length === 1
      ? members[0]
      : (named(selectedStep?.testIndex) ??
        named(memberFilter) ??
        members.find((entry) => memberOutcomeClass(entry.outcome, runStatus) === 'failed') ??
        members[0])
  return chosen === undefined ? undefined : { testIndex: chosen.testIndex }
}

export const TEST_SWITCHER_LABEL = 'Test'
export const NO_UNIQUE_ADDRESS_TEXT = "This test has no unique address in this run, so feedback can't be recorded for it."

/**
 * D-01, inherited from onMark's refusal: the wire addresses a suite member by testId, so a member
 * needs a truthy testId no other member holds. A single-test run needs none.
 */
export function hasUniqueAddress(detail: Pick<RunDetailProjection, 'members'> | null | undefined, testIndex: number): boolean {
  const members = detail?.members ?? []
  const member = members.find((entry) => entry.testIndex === testIndex)
  if (member === undefined) return false
  if (members.length <= 1) return true
  return Boolean(member.testId) && members.filter((entry) => entry.testId === member.testId).length === 1
}

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

const PREVIEW_REFUSAL_KINDS: ReadonlySet<string> = new Set(MARK_PREVIEW_REFUSALS)

export const SUBMIT_REASON_NO_UNIQUE_ADDRESS = "This test can't be marked from the dashboard."
export const SUBMIT_REASON_NO_CHOICE = 'Choose one of the three options.'
export const SUBMIT_REASON_CHECKING = 'Checking what this will do…'
export const SUBMIT_REASON_PREVIEW_FAILED = "Consequences couldn't be checked — retry above."
export const SUBMIT_REASON_REFUSED = "This mark can't be recorded — see above."
export const SUBMIT_REASON_ALREADY_MARKED = "You already said this — there's nothing new to record."
export const SUBMIT_REASON_INVALID_CORRECTION = 'Fix the corrected action JSON first.'
export const SUBMIT_REASON_SENDING = 'Sending…'

export interface SubmitBlockInput {
  kind: Mark | undefined
  currentKey: string
  landedKey: string | undefined
  landedOutcome: RunsMarkPreviewResult['kind'] | 'failed' | undefined
  inFlight: boolean
  noUniqueAddress?: boolean
  invalidCorrection?: boolean
}

/**
 * First match wins; '' means Send feedback is available (D-19, UI-SPEC S6). Only a current
 * consequences or quarantined read gets past the preview rows: there is no blind submit.
 */
export function submitBlockedReason(input: SubmitBlockInput): string {
  if (input.noUniqueAddress === true) return SUBMIT_REASON_NO_UNIQUE_ADDRESS
  if (input.kind === undefined) return SUBMIT_REASON_NO_CHOICE
  const outcome = input.landedOutcome
  if (outcome === undefined || input.landedKey !== input.currentKey) return SUBMIT_REASON_CHECKING
  if (outcome === 'failed') return SUBMIT_REASON_PREVIEW_FAILED
  if (PREVIEW_REFUSAL_KINDS.has(outcome)) return SUBMIT_REASON_REFUSED
  if (outcome !== 'consequences' && outcome !== 'quarantined') return SUBMIT_REASON_ALREADY_MARKED
  if (input.invalidCorrection === true) return SUBMIT_REASON_INVALID_CORRECTION
  if (input.inFlight) return SUBMIT_REASON_SENDING
  return ''
}

export const SEND_FEEDBACK_LABEL = 'Send feedback'
export const PREVIEW_TITLE = 'What this will do'
export const SENDING_STATUS = 'Sending feedback…'
export const FEEDBACK_ENTRY_TEST_LABEL = 'Give feedback on this test'
export const CLOSE_FEEDBACK_LABEL = 'Close feedback'
export const CLOSE_FEEDBACK_TOOLTIP = 'Close (Esc)'
export const DRAFT_KEPT_STATUS = 'Draft kept. Check the message above before sending again.'

export type FeedbackEntryScope = 'test' | 'step'

// prettier-ignore
export const FEEDBACK_ENTRY_SCOPES = [
  'test',
  'step',
] as const satisfies readonly FeedbackEntryScope[]

export const FEEDBACK_ENTRY_TOOLTIP = 'Give feedback'
export const FEEDBACK_ENTRY_MARKED_TOOLTIP = 'Already marked — review or change'

export interface FeedbackEntryLabelInput {
  scope: FeedbackEntryScope
  stepNumber?: number
  memberName?: string
  handle?: string
  markedChoice?: Mark
}

/** A step is named by number, a suite test by name and handle; a marked target says how, in plain words. */
export function feedbackEntryLabel({ scope, stepNumber, memberName, handle, markedChoice }: FeedbackEntryLabelInput): string {
  const base =
    scope === 'step'
      ? `Give feedback on step ${String(stepNumber)}`
      : handle === undefined
        ? FEEDBACK_ENTRY_TEST_LABEL
        : `Give feedback on ${memberName ?? ''} ${handle}`
  return markedChoice === undefined ? base : `${base} — already marked: ${CHOICE_LABELS[markedChoice]}`
}

export function stepTriggerTooltip(stepNumber: number, marked: boolean): string {
  return marked
    ? `Step ${String(stepNumber)} is already marked — review or change`
    : `Give feedback on step ${String(stepNumber)}`
}

/** D-06: a passive trace names the plain choice, never the internal word. */
export function markGlyphLabel(kind: Mark): string {
  return `Marked: ${CHOICE_LABELS[kind]}`
}

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

// 426 D-16..D-19: the consequence preview. Every line is one runs.mark.preview field in plain words.

export type FeedbackPreviewState =
  | 'idle'
  | 'loading'
  | 'consequences'
  | 'quarantined'
  | 'already-marked'
  | 'refused'
  | 'failed'

// prettier-ignore
export const FEEDBACK_PREVIEW_STATES = [
  'idle',
  'loading',
  'consequences',
  'quarantined',
  'already-marked',
  'refused',
  'failed',
] as const satisfies readonly FeedbackPreviewState[]

export interface FeedbackPreviewStateInput {
  kind: Mark | undefined
  /** The read on screen; its currency is the caller's (previewRequestKey). */
  landed: { kind: 'read'; result: RunsMarkPreviewResult } | { kind: 'failed'; reason: string } | undefined
}

/** Nothing landed is loading whether the request is still debounced or already in flight. */
export function feedbackPreviewState({ kind, landed }: FeedbackPreviewStateInput): FeedbackPreviewState {
  if (kind === undefined) return 'idle'
  if (landed === undefined) return 'loading'
  if (landed.kind === 'failed') return 'failed'
  const arm = landed.result.kind
  if (PREVIEW_REFUSAL_KINDS.has(arm)) return 'refused'
  return arm === 'consequences' || arm === 'quarantined' ? arm : 'already-marked'
}

export const PREVIEW_UPDATING_TEXT = 'Updating…'
export const PREVIEW_IDLE_TEXT = 'Choose an option above to see what this will do.'

export const PREVIEW_LINE_LABELS = {
  result: 'Result',
  labels: 'Eval labels',
  knowledge: 'Knowledge',
  proposals: 'Proposals',
} as const

const VERDICT_WORD = { pass: 'passed', fail: 'failed' } as const

/** D-17: n is stepIndex + 1; the reasoning is the producer part and is dropped with its quote when empty. */
export function groundTruthLine(entry: MarkPreviewGroundTruth): FeedbackTextParts {
  const head = `Step ${String(entry.stepIndex + 1)} will count as ${VERDICT_WORD[entry.verdict]} (recorded: ${
    VERDICT_WORD[entry.recordedVerdict.pass ? 'pass' : 'fail']
  }`
  const { reasoning } = entry.recordedVerdict
  return reasoning === '' ? { prefix: `${head})` } : { prefix: `${head} — "`, name: reasoning, suffix: '")' }
}

export function correctedGroundTruthText(entry: MarkPreviewGroundTruth): string | undefined {
  const expectation = entry.correctedExpectation !== undefined
  if (expectation && entry.correctedAction) return 'with your corrected expectation and action'
  if (expectation) return 'with your corrected expectation'
  if (entry.correctedAction) return 'with your corrected action'
  return undefined
}

export const NO_GROUND_TRUTH_TEXT = 'No step verdict changes.'

export function labelsLine(count: number): string {
  if (count === 0) return 'No eval labels change'
  return count === 1 ? '1 decision becomes a held-out eval label' : `${String(count)} decisions become held-out eval labels`
}

/**
 * Zero-count clauses are omitted. Records reached with no effect at all are all unreadable (a record
 * with effects carries at least one), so that line says so instead of printing nothing.
 */
export function knowledgeLine(evidence: MarkPreviewKnowledge['evidence'], recordCount: number): string {
  if (recordCount === 0) return 'No knowledge records are reached'
  const clauses = [
    evidence.confirmed === 0 ? undefined : `${String(evidence.confirmed)} ${evidence.confirmed === 1 ? 'record' : 'records'} confirmed`,
    evidence.overturned === 0 ? undefined : `${String(evidence.overturned)} counted against`,
  ].filter((clause) => clause !== undefined)
  if (clauses.length > 0) return clauses.join(' · ')
  return recordCount === 1 ? "1 record reached — it can't be read" : `${String(recordCount)} records reached — none can be read`
}

export function showRecordsLabel(count: number): string {
  return `Show records (${String(count)})`
}

export const RECORD_EFFECT_TEXT = {
  confirm: 'confirms',
  overturn: 'counts against',
} satisfies Record<MarkPreviewEvidenceEffect['direction'], string>

export const UNREADABLE_RECORD_TEXT = "This record can't be read — it keeps its place, and nothing is applied to it."

/** The muted line under a reached record: its planned effects, or why none can apply. */
export function recordEffectLine(record: MarkPreviewKnowledgeRecord): string {
  if (record.evidence.kind === 'unreadable') return UNREADABLE_RECORD_TEXT
  const { effects } = record.evidence
  const overturns = effects.filter((effect) => effect.direction === 'overturn').length
  return [
    effects.some((effect) => effect.direction === 'confirm') ? RECORD_EFFECT_TEXT.confirm : undefined,
    overturns === 0 ? undefined : overturns === 1 ? RECORD_EFFECT_TEXT.overturn : `${RECORD_EFFECT_TEXT.overturn} × ${String(overturns)}`,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}

export const CONTENT_ABSENCE_TEXT = {
  'not-found': 'Record content not found',
  'scan-incomplete': 'Record content could not be fully read',
  'not-bound': "Record content isn't available on this host",
} satisfies Record<RunKnowledgeContentAbsence['reason'], string>

export const PROPOSAL_DRAFT_TEXT = {
  knowledge: {
    fact: 'A knowledge fact will be drafted for your review',
    caution: 'A caution will be drafted for your review',
    'procedure-hint': 'A procedure hint will be drafted for your review',
  } satisfies Record<Extract<MarkPreviewDraft, { kind: 'knowledge' }>['fix'], string>,
  'test-edit': 'A test edit will be drafted for your review',
  'no-draftable-fix': 'No fix can be drafted from this run',
  'confirmed-bug': 'Nothing is drafted — a real product bug needs a product fix, not a test or knowledge change',
} as const

export function proposalDraftText(draft: MarkPreviewDraft): string {
  switch (draft.kind) {
    case 'knowledge':
      return PROPOSAL_DRAFT_TEXT.knowledge[draft.fix]
    case 'test-edit':
      return PROPOSAL_DRAFT_TEXT['test-edit']
    case 'no-draftable-fix':
      return PROPOSAL_DRAFT_TEXT['no-draftable-fix']
    case 'confirmed-bug':
      return PROPOSAL_DRAFT_TEXT['confirmed-bug']
    default:
      return draft satisfies never
  }
}

/** The preview never calls the model, so a drafted fix is named but its wording is not shown. */
export const DRAFT_WORDING_NOT_SHOWN_TEXT = "The drafted wording isn't shown here — it's written after you send."

export function draftHasWording(draft: MarkPreviewDraft): boolean {
  return draft.kind === 'knowledge' || draft.kind === 'test-edit'
}

/** The time is the history entry's own; without history the clause drops rather than guessing. */
export function replacesLine(ordinal: number, time: string | undefined, withdraws: boolean): string {
  const at = time === undefined ? `#${String(ordinal)}` : `#${String(ordinal)}, ${time}`
  return `Replaces your earlier mark (${at})${withdraws ? ' and withdraws its proposal' : ''}`
}

export type MarkTargetReason = Extract<RunsMarkPreviewResult, { kind: 'consequences' }>['resolvedStep']['reason']

/** D-14: keyed on the read's reason and the kind, never re-derived; a step mark needs no line. */
export function resolvedStepText(reason: MarkTargetReason, kind: Mark, stepNumber: number, total: number): string | undefined {
  const lead = `This marks step ${String(stepNumber)} of ${String(total)} — `
  switch (reason) {
    case 'failing-step':
      return `${lead}the first step that failed.`
    case 'passing-verdict':
      return kind === 'false-pass' ? `${lead}the last step, where the test finished.` : `${lead}the last step, because no step failed.`
    case 'step-mark':
      return undefined
    default:
      return reason satisfies never
  }
}

export function showStepLabel(stepNumber: number): string {
  return `Show step ${String(stepNumber)}`
}

// D-18: the two arms that are not consequences. A quarantined mark still records; an identical repeat
// does not, because a note alone never changes what a mark does (isIdenticalRepeat).

export const QUARANTINE_CAUSE_TEXT = {
  timeout: 'a timeout',
  flake: 'a flaky run',
  environment: 'an environment problem',
} satisfies Record<MarkQuarantineClass, string>

export function quarantinedText(cls: MarkQuarantineClass): string {
  return `This test failed from ${QUARANTINE_CAUSE_TEXT[cls]}, so your mark is recorded but quarantined — no labels, knowledge or proposals change.`
}

/** The time is the prior mark's history entry; without history the parenthetical drops. */
export function alreadyMarkedText(time?: string): string {
  return `You already said this${time === undefined ? '' : ` (${time})`}. A new note alone isn't recorded.`
}

// D-19: a refusal is runs.mark's own arm, read from its own fields; a failed read names why.

export type PreviewRefusalKind = (typeof MARK_PREVIEW_REFUSALS)[number]
export type PreviewRefusalArm<K extends PreviewRefusalKind = PreviewRefusalKind> = Extract<RunsMarkPreviewResult, { kind: K }>

export const PREVIEW_REFUSAL_TEXT = {
  'run-not-found': () => "This run is no longer in the run store, so feedback can't be recorded.",
  'member-not-found': () => "This test can't be found in the run, so feedback can't be recorded.",
  'step-not-found': (arm) =>
    arm.stepCount === 0
      ? 'This test recorded no steps, so there is nothing to mark.'
      : `This test recorded ${String(arm.stepCount)} ${arm.stepCount === 1 ? 'step' : 'steps'}, so there is no step ${String(arm.stepIndex + 1)} to mark.`,
  'ambiguous-address': (arm) =>
    `${String(arm.candidates.length)} tests in this run share this address, so the mark can't be placed.`,
  'ambiguous-correction': (arm) =>
    `A corrected action needs exactly one recorded decision; this mark covers ${String(arm.decisionCount)}. Remove the corrected action to continue.`,
} satisfies Record<(typeof MARK_PREVIEW_REFUSALS)[number], unknown> & {
  [K in PreviewRefusalKind]: (arm: PreviewRefusalArm<K>) => string
}

export function isPreviewRefusal(read: RunsMarkPreviewResult): read is PreviewRefusalArm {
  return PREVIEW_REFUSAL_KINDS.has(read.kind)
}

export function previewRefusalText(arm: PreviewRefusalArm): string {
  switch (arm.kind) {
    case 'run-not-found':
      return PREVIEW_REFUSAL_TEXT[arm.kind]()
    case 'member-not-found':
      return PREVIEW_REFUSAL_TEXT[arm.kind]()
    case 'step-not-found':
      return PREVIEW_REFUSAL_TEXT[arm.kind](arm)
    case 'ambiguous-address':
      return PREVIEW_REFUSAL_TEXT[arm.kind](arm)
    case 'ambiguous-correction':
      return PREVIEW_REFUSAL_TEXT[arm.kind](arm)
    default:
      return arm satisfies never
  }
}

export const FEEDBACK_READ_FAILURE_TEXT = {
  network: "the dashboard server didn't answer",
  'ledger-corrupt': "this run's feedback ledger is damaged",
  'ledger-unavailable': "this run's feedback ledger can't be read right now",
  refused: 'the server refused the request',
  shape: "the server's answer didn't match the expected shape",
} satisfies Record<FeedbackReadFailure, string>

/** The error's name never reaches the page; each failure is one product sentence. */
export function feedbackReadFailureReason(failure: FeedbackReadFailure): string {
  return FEEDBACK_READ_FAILURE_TEXT[failure]
}

export function PREVIEW_READ_FAILED_TEXT(reason: string): string {
  return `Couldn't check what this will do — ${reason}.`
}

/** The command is its own part so it paints in mono without splitting the sentence. */
export const CLI_ESCAPE_PARTS = {
  prefix: 'You can still record feedback from the CLI (',
  name: 'agent-qa runs mark',
  suffix: ') or over MCP.',
} as const satisfies Required<FeedbackTextParts>

export const CLI_ESCAPE_TEXT = feedbackPartsText(CLI_ESCAPE_PARTS)

export const RETRY_LABEL = 'Retry'
/** Label-in-name: the accessible name starts with the visible word and says what it retries. */
export const PREVIEW_RETRY_ACCESSIBLE_NAME = `${RETRY_LABEL} checking what this will do`
