import { useEffect, useId, useRef, useState } from 'react'
import type { Mark, RunDetailProjection } from '@vostride/agent-qa-schema'
import type { FeedbackComposerProps } from '@/components/run-detail/feedback-composer'
import type { FeedbackEntryButtonProps } from '@/components/run-detail/feedback-entry'
import type { StepTreeFeedback } from '@/components/run-detail/step-tree'
import { fetchMarkPreview, type MarkPreviewRead } from '@/lib/api'
import type { MarkDenial, OnMark } from '@/lib/analysis-view'
import {
  DRAFT_KEPT_STATUS,
  EMPTY_DRAFT,
  PREVIEW_DEBOUNCE_MS,
  SENDING_STATUS,
  feedbackAddress,
  feedbackEntryLabel,
  feedbackRecordedText,
  feedbackTargetView,
  hasUniqueAddress,
  isDraftEmpty,
  pinnedTargetText,
  previewInputFor,
  previewRequestKey,
  resolveHeaderFeedbackTarget,
  submitBlockedReason,
  switchTargetLabel,
  unsentDraftLabel,
  type FeedbackComposerState,
  type FeedbackDraft,
  type FeedbackPlace,
  type FeedbackTarget,
} from '@/lib/feedback-view'
import { memberDisplayName, memberHandleLabel } from '@/lib/run-detail-view'

interface UseRunFeedbackInput {
  runId: string | undefined
  runStatus: string | undefined
  detail: RunDetailProjection | null | undefined
  onMark: OnMark
  markPending: boolean
  selectedStep: { testIndex: number; stepIndex: number } | null
  memberFilter: number | undefined
  /** The page's denial, addressed; shown only on the composer address it names. */
  markDenial?: MarkDenial & FeedbackTarget
  /** The page's guarded runs.detail re-read, called on every open (a mark written elsewhere shows). */
  reloadDetail?: () => Promise<unknown>
  beforeOpen?: () => void
}

/** 419-15's local announcement, kept per address so re-targeting shows each address its own. */
interface AddressOutcome {
  state: FeedbackComposerState
  status: string
}

const COMPOSING: AddressOutcome = { state: 'composing', status: '' }

function targetOfAddress(address: string): FeedbackTarget {
  const [testIndex, stepIndex] = address.split(':')
  return stepIndex === 'run' ? { testIndex: Number(testIndex) } : { testIndex: Number(testIndex), stepIndex: Number(stepIndex) }
}

interface LandedPreview {
  key: string
  read: MarkPreviewRead
}

/**
 * The run-detail page's feedback state (426 D-09). It lives above the composer so drafts survive the
 * composer closing and a run change discards them; the page's own `onMark` is the only writer.
 * Nothing is fetched until a choice is picked in an open composer.
 */
export function useRunFeedback({
  runId,
  runStatus,
  detail,
  onMark,
  markPending,
  selectedStep,
  memberFilter,
  markDenial,
  reloadDetail,
  beforeOpen,
}: UseRunFeedbackInput) {
  const baseId = useId()
  const composerId = `${baseId}-feedback`
  const headingId = `${baseId}-feedback-heading`
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<FeedbackTarget | null>(null)
  const [drafts, setDrafts] = useState<ReadonlyMap<string, FeedbackDraft>>(() => new Map())
  const [landed, setLanded] = useState<LandedPreview>()
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, AddressOutcome>>(() => new Map())
  const [focusRequest, setFocusRequest] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const previewGeneration = useRef(0)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const submission = useRef<object | undefined>(undefined)
  const runRef = useRef(runId)
  const detailRef = useRef(detail)
  useEffect(() => { detailRef.current = detail }, [detail])
  useEffect(() => { if (focusRequest > 0) headingRef.current?.focus() }, [focusRequest])

  useEffect(() => {
    runRef.current = runId
    previewGeneration.current += 1
    clearTimeout(previewTimer.current)
    submission.current = undefined
    opener.current = null
    setOpen(false)
    setTarget(null)
    setDrafts(new Map())
    setLanded(undefined)
    setOutcomes(new Map())
    return () => {
      previewGeneration.current += 1
      clearTimeout(previewTimer.current)
    }
  }, [runId])

  const address = target === null ? undefined : feedbackAddress(target)
  const draft = (address === undefined ? undefined : drafts.get(address)) ?? EMPTY_DRAFT
  const { state, status } = (address === undefined ? undefined : outcomes.get(address)) ?? COMPOSING
  const setOutcome = (key: string, next: AddressOutcome) => setOutcomes((previous) => new Map(previous).set(key, next))
  const currentKey = target === null || draft.kind === undefined ? '' : previewRequestKey({ kind: draft.kind, ...target })
  const landedOutcome = landed === undefined ? undefined : landed.read.kind === 'read' ? landed.read.result.kind : 'failed'
  const previewCurrent = landed !== undefined && currentKey !== '' && landed.key === currentKey
  const addressable = target === null || hasUniqueAddress(detail, target.testIndex)
  const submitReason = submitBlockedReason({
    noUniqueAddress: !addressable,
    kind: draft.kind,
    currentKey,
    landedKey: landed?.key,
    landedOutcome,
    inFlight: markPending || state === 'submitting',
  })

  const schedulePreview = (next: FeedbackTarget, kind: Mark) => {
    clearTimeout(previewTimer.current)
    // D-01: a test onMark would refuse is never previewed either.
    if (!hasUniqueAddress(detailRef.current, next.testIndex)) return
    previewTimer.current = setTimeout(() => {
      const generation = ++previewGeneration.current
      const requestRunId = runRef.current
      const previewMember = detailRef.current?.members.find((entry) => entry.testIndex === next.testIndex)
      if (requestRunId === undefined || previewMember === undefined) return
      const key = previewRequestKey({ kind, ...next })
      void fetchMarkPreview(requestRunId, previewInputFor(previewMember, next, kind)).then((read) => {
        if (previewGeneration.current !== generation || runRef.current !== requestRunId) return
        setLanded({ key, read })
      })
    }, PREVIEW_DEBOUNCE_MS)
  }

  // Re-activating the entry already open keeps it open and refocuses the heading (D-07).
  const openFeedback = (next: FeedbackTarget, openerElement: HTMLElement) => {
    beforeOpen?.()
    opener.current = openerElement
    void reloadDetail?.().catch(() => undefined)
    const nextAddress = feedbackAddress(next)
    if (address !== nextAddress) {
      previewGeneration.current += 1
      const kind = drafts.get(nextAddress)?.kind
      if (kind === undefined) clearTimeout(previewTimer.current)
      else schedulePreview(next, kind)
    }
    setTarget(next)
    setOpen(true)
    setFocusRequest((count) => count + 1)
  }

  // D-03's switcher: the composer moves to another test's address and shows that address's draft.
  // The page's member filter and selection are not touched.
  const retarget = (next: FeedbackTarget) => {
    const nextAddress = feedbackAddress(next)
    if (state === 'submitting' || nextAddress === address) return
    previewGeneration.current += 1
    setTarget(next)
    setFocusRequest((count) => count + 1)
    const kind = drafts.get(nextAddress)?.kind
    if (kind === undefined) clearTimeout(previewTimer.current)
    else schedulePreview(next, kind)
  }

  // Closing keeps every draft; focus goes back to the opener, else the header entry, else the
  // evidence strip's active tab (D-07).
  const close = () => {
    setOpen(false)
    const back = opener.current?.isConnected
      ? opener.current
      : (document.querySelector<HTMLElement>('[data-feedback-entry="test"]') ??
        document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))
    back?.focus()
  }

  const editNote = (note: string) => {
    if (address === undefined || state === 'submitting') return
    setDrafts((previous) => new Map(previous).set(address, { ...(previous.get(address) ?? EMPTY_DRAFT), note }))
    setOutcome(address, COMPOSING)
  }

  const choose = (kind: Mark) => {
    if (target === null || address === undefined || state === 'submitting') return
    setDrafts((previous) => new Map(previous).set(address, { ...(previous.get(address) ?? EMPTY_DRAFT), kind }))
    setOutcome(address, COMPOSING)
    schedulePreview(target, kind)
  }

  const submit = async () => {
    if (target === null || address === undefined || draft.kind === undefined || submitReason !== '' || submission.current) return
    const request = {}
    const submitted = target
    submission.current = request
    setOutcome(address, { state: 'submitting', status: SENDING_STATUS })
    try {
      const result = await onMark(submitted.testIndex, submitted.stepIndex, draft.kind, draft.note || undefined, undefined)
      if (submission.current !== request) return
      if (result === 'refreshed') {
        setDrafts((previous) => {
          const next = new Map(previous)
          next.delete(address)
          return next
        })
        setLanded(undefined)
        setOutcome(address, { state: 'recorded', status: '' })
      } else if (result === 'retained') {
        setOutcome(address, { state: 'retained', status: DRAFT_KEPT_STATUS })
      } else {
        setOutcome(address, COMPOSING)
      }
    } finally {
      if (submission.current === request) submission.current = undefined
    }
  }

  // The receipt is read from the refreshed projection, never from the POST's answer (419-15).
  const recordedMark = state !== 'recorded' || target === null
    ? undefined
    : detail?.members.find((entry) => entry.testIndex === target.testIndex)
      ?.marks?.find((entry) => entry.stepIndex === target.stepIndex)
  const statusText = state === 'recorded' ? (recordedMark === undefined ? '' : feedbackRecordedText(recordedMark.disposition)) : status

  const view = target === null ? undefined : feedbackTargetView({ detail, target, runStatus })
  const members = detail?.members ?? []
  const testSwitcher = target === null || target.stepIndex !== undefined || members.length <= 1
    ? undefined
    : {
        value: target.testIndex,
        options: members.map((entry) => ({
          testIndex: entry.testIndex,
          label: `${memberDisplayName(entry)} ${memberHandleLabel(entry.testIndex)}`,
        })),
        onChange: (testIndex: number) => retarget({ testIndex }),
      }

  // D-08: the target is set only by an explicit act; the selection it was opened from may move on.
  // `selectedStep` is the step owning the selection, null for a hook or no selection.
  const suite = (detail?.members.length ?? 0) > 1
  const placeMember = (testIndex: number) =>
    suite ? (members.find((entry) => entry.testIndex === testIndex) ?? { testIndex }) : undefined
  const viewing = selectedStep
  const showPinned = target !== null && viewing !== null && (
    target.stepIndex === undefined ? viewing.testIndex !== target.testIndex : feedbackAddress(viewing) !== address
  )
  const pinned = !showPinned || target === null || viewing === null
    ? undefined
    : {
        text: pinnedTargetText(
          { stepIndex: viewing.stepIndex, member: placeMember(viewing.testIndex) },
          { stepIndex: target.stepIndex, member: placeMember(target.testIndex) },
        ),
        switchLabel: switchTargetLabel(
          target.stepIndex === undefined
            ? { member: placeMember(viewing.testIndex) }
            : { stepIndex: viewing.stepIndex, member: viewing.testIndex === target.testIndex ? undefined : placeMember(viewing.testIndex) },
        ),
        onSwitch: () => retarget(target.stepIndex === undefined ? { testIndex: viewing.testIndex } : viewing),
      }

  // D-09: every other address holding a non-empty draft is one link away.
  const unsentDrafts = [...drafts]
    .filter(([key, entry]) => key !== address && !isDraftEmpty(entry))
    .map(([key]) => {
      const other = targetOfAddress(key)
      const place: FeedbackPlace = {
        stepIndex: other.stepIndex,
        member: other.stepIndex !== undefined && other.testIndex === target?.testIndex ? undefined : placeMember(other.testIndex),
      }
      return { address: key, label: unsentDraftLabel(place), onOpen: () => retarget(other) }
    })

  const denial = state === 'retained' && markDenial !== undefined && feedbackAddress(markDenial) === address
    ? { reason: markDenial.reason, remedies: markDenial.remedies }
    : undefined

  const composer: FeedbackComposerProps | undefined = !open || target === null || address === undefined || view === undefined
    ? undefined
    : {
        composerId,
        headingId,
        heading: view.heading,
        scopeLine: view.scopeLine,
        state,
        scope: target.stepIndex === undefined ? 'test' : 'step',
        target: address,
        outcomeClass: view.outcomeClass,
        selected: draft.kind,
        onChoose: choose,
        noUniqueAddress: !addressable,
        testSwitcher,
        pinned,
        unsentDrafts,
        note: draft.note,
        onNoteChange: editNote,
        previewState: draft.kind === undefined || !addressable ? 'idle' : previewCurrent && landedOutcome !== undefined ? landedOutcome : 'loading',
        previewCurrent,
        submitReason,
        onSubmit: () => { void submit() },
        status: statusText,
        denial,
        headingRef,
        onClose: close,
      }

  // D-03: one test-level door per page, whatever the suite shape. Absent until the target member's
  // marks have landed, never a disabled placeholder.
  const headerTarget = resolveHeaderFeedbackTarget({ detail, selectedStep, memberFilter, runStatus })
  const headerMember = headerTarget === undefined
    ? undefined
    : detail?.members.find((entry) => entry.testIndex === headerTarget.testIndex)
  const headerMark = headerMember?.marks?.find((entry) => entry.stepIndex === undefined)
  const headerEntry: Omit<FeedbackEntryButtonProps, 'scope'> | undefined =
    headerTarget === undefined || headerMember?.marks === undefined
      ? undefined
      : {
          label: feedbackEntryLabel({
            scope: 'test',
            ...(suite ? { memberName: memberDisplayName(headerMember), handle: memberHandleLabel(headerMember.testIndex) } : {}),
            ...(headerMark === undefined ? {} : { markedChoice: headerMark.kind }),
          }),
          target: feedbackAddress(headerTarget),
          marked: headerMark !== undefined,
          expanded: open && target?.stepIndex === undefined,
          controls: composerId,
          onOpen: (openerElement: HTMLElement) => openFeedback(headerTarget, openerElement),
        }

  const openStepFeedback = (testIndex: number, stepIndex: number, openerElement: HTMLElement) =>
    openFeedback({ testIndex, stepIndex }, openerElement)

  // D-04: the step door on the row owning the selection opens the composer on that row's own step.
  const tree: StepTreeFeedback = {
    composerId,
    expandedAddress: open && target?.stepIndex !== undefined ? address : undefined,
    onOpenStep: openStepFeedback,
  }

  return { open, target, composerId, openFeedback, openStepFeedback, retarget, composer, headerEntry, tree }
}
