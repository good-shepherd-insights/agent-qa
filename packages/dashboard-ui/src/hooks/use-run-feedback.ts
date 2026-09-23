import { useEffect, useId, useRef, useState } from 'react'
import type { Mark, RunDetailProjection } from '@vostride/agent-qa-schema'
import type { FeedbackComposerProps } from '@/components/run-detail/feedback-composer'
import type { FeedbackEntryButtonProps } from '@/components/run-detail/feedback-entry'
import type { StepTreeFeedback } from '@/components/run-detail/step-tree'
import { fetchMarkPreview, type MarkPreviewRead } from '@/lib/api'
import type { OnMark } from '@/lib/analysis-view'
import {
  EMPTY_DRAFT,
  PREVIEW_DEBOUNCE_MS,
  SENDING_STATUS,
  feedbackAddress,
  feedbackEntryLabel,
  feedbackRecordedText,
  feedbackTargetView,
  hasUniqueAddress,
  previewInputFor,
  previewRequestKey,
  resolveHeaderFeedbackTarget,
  submitBlockedReason,
  type FeedbackComposerState,
  type FeedbackDraft,
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
  beforeOpen?: () => void
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
  beforeOpen,
}: UseRunFeedbackInput) {
  const baseId = useId()
  const composerId = `${baseId}-feedback`
  const headingId = `${baseId}-feedback-heading`
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<FeedbackTarget | null>(null)
  const [drafts, setDrafts] = useState<ReadonlyMap<string, FeedbackDraft>>(() => new Map())
  const [landed, setLanded] = useState<LandedPreview>()
  const [state, setState] = useState<FeedbackComposerState>('composing')
  const [status, setStatus] = useState('')
  const [recorded, setRecorded] = useState<FeedbackTarget>()
  const opener = useRef<HTMLElement | null>(null)
  const previewGeneration = useRef(0)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const submission = useRef<object | undefined>(undefined)
  const runRef = useRef(runId)
  const detailRef = useRef(detail)
  useEffect(() => { detailRef.current = detail }, [detail])

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
    setState('composing')
    setStatus('')
    setRecorded(undefined)
    return () => {
      previewGeneration.current += 1
      clearTimeout(previewTimer.current)
    }
  }, [runId])

  const address = target === null ? undefined : feedbackAddress(target)
  const draft = (address === undefined ? undefined : drafts.get(address)) ?? EMPTY_DRAFT
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

  const openFeedback = (next: FeedbackTarget, openerElement: HTMLElement) => {
    beforeOpen?.()
    opener.current = openerElement
    const nextAddress = feedbackAddress(next)
    if (address !== nextAddress) {
      previewGeneration.current += 1
      setState('composing')
      setStatus('')
      setRecorded(undefined)
      const kind = drafts.get(nextAddress)?.kind
      if (kind === undefined) clearTimeout(previewTimer.current)
      else schedulePreview(next, kind)
    }
    setTarget(next)
    setOpen(true)
  }

  // D-03's switcher: the composer moves to another test's address and shows that address's draft.
  // The page's member filter and selection are not touched.
  const retarget = (next: FeedbackTarget) => {
    const nextAddress = feedbackAddress(next)
    if (state === 'submitting' || nextAddress === address) return
    previewGeneration.current += 1
    setState('composing')
    setStatus('')
    setRecorded(undefined)
    setTarget(next)
    const kind = drafts.get(nextAddress)?.kind
    if (kind === undefined) clearTimeout(previewTimer.current)
    else schedulePreview(next, kind)
  }

  const close = () => {
    setOpen(false)
    if (opener.current?.isConnected) opener.current.focus()
  }

  const choose = (kind: Mark) => {
    if (target === null || address === undefined || state === 'submitting') return
    setDrafts((previous) => new Map(previous).set(address, { ...(previous.get(address) ?? EMPTY_DRAFT), kind }))
    setState('composing')
    setStatus('')
    setRecorded(undefined)
    schedulePreview(target, kind)
  }

  const submit = async () => {
    if (target === null || address === undefined || draft.kind === undefined || submitReason !== '' || submission.current) return
    const request = {}
    const submitted = target
    submission.current = request
    setState('submitting')
    setStatus(SENDING_STATUS)
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
        setRecorded(submitted)
        setState('recorded')
        setStatus('')
      } else {
        setState(result === 'retained' ? 'retained' : 'composing')
        setStatus('')
      }
    } finally {
      if (submission.current === request) submission.current = undefined
    }
  }

  // The receipt is read from the refreshed projection, never from the POST's answer (419-15).
  const recordedMark = recorded === undefined
    ? undefined
    : detail?.members.find((entry) => entry.testIndex === recorded.testIndex)
      ?.marks?.find((entry) => entry.stepIndex === recorded.stepIndex)
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
        previewState: draft.kind === undefined || !addressable ? 'idle' : previewCurrent && landedOutcome !== undefined ? landedOutcome : 'loading',
        previewCurrent,
        submitReason,
        onSubmit: () => { void submit() },
        status: statusText,
        onClose: close,
      }

  // D-03: one test-level door per page, whatever the suite shape. Absent until the target member's
  // marks have landed, never a disabled placeholder.
  const headerTarget = resolveHeaderFeedbackTarget({ detail, selectedStep, memberFilter, runStatus })
  const headerMember = headerTarget === undefined
    ? undefined
    : detail?.members.find((entry) => entry.testIndex === headerTarget.testIndex)
  const headerMark = headerMember?.marks?.find((entry) => entry.stepIndex === undefined)
  const suite = (detail?.members.length ?? 0) > 1
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
