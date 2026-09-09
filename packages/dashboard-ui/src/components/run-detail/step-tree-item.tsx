import { useEffect, useRef, useState } from 'react'
import { MarkCorrectionFields, type MarkCorrection } from './mark-correction-fields'
import { Link } from 'react-router'
import { MARKS, type Mark, type RunDetailMemberMark } from '@vostride/agent-qa-schema'
import { DenialBlock } from '@/chat/chat-transcript'
import { MaskedText } from './masked-text'
import { routes } from '@/lib/routes'
import { MARK_LABELS, markChipText, markTriageText, type OnMark, type MarkDenial } from '@/lib/analysis-view'
import { CheckCircle2, XCircle, RefreshCw, Circle } from "lucide-react"
import { SubActionTreeItem } from "./sub-action-tree-item"
import { ExecutionTreeItem } from "./execution-tree-item"
import { StepNameWithPills } from "./step-name-pills"
import { CacheStatusIconWrapper } from "./cache-status-marker"
import type { ExecutionLogEntry } from "@/lib/api"
import type { DisplayStep } from "@/lib/display-step"
import type { Selection } from "@/lib/selection"
import { cn, formatDuration } from "@/lib/utils"

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
    case "healed":
    case "flaky":
      return <RefreshCw className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
  }
}

const MARK_ACTION_CLASS = 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-[2px] border px-2 py-1 font-mono text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

interface StepTreeItemProps {
  onMark?: OnMark
  marks?: readonly RunDetailMemberMark[]
  markDenial?: MarkDenial
  markPending?: boolean
  step: DisplayStep
  isSelected: boolean
  isExpanded: boolean
  selection: Selection | null
  onSelect: (sel: Selection | null) => void
  inlineLogs?: ExecutionLogEntry[]
  embedded?: boolean
}

export function StepTreeItem({ step, isSelected, isExpanded, selection, onSelect, inlineLogs = [], embedded = false, onMark, marks, markDenial, markPending = false }: StepTreeItemProps) {
  const [kind, setKind] = useState<Mark>()
  const [note, setNote] = useState('')
  const [correction, setCorrection] = useState<MarkCorrection>()
  const [correctionValid, setCorrectionValid] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [resultVisible, setResultVisible] = useState(true)
  const [lastDenial, setLastDenial] = useState<MarkDenial>()
  const submission = useRef<object | undefined>(undefined)
  useEffect(() => () => { submission.current = undefined }, [])
  useEffect(() => { if (markDenial) setLastDenial(markDenial) }, [markDenial])
  const edit = () => { setStatus(''); setResultVisible(false) }
  const clearDraft = () => { setKind(undefined); setNote(''); setCorrection(undefined); setCorrectionValid(true) }
  const submit = async () => {
    if (!onMark || kind === undefined || step.testIndex === undefined || step.stepIndex === undefined || markPending || submission.current || !correctionValid) return
    const request = {}
    submission.current = request
    setSubmitting(true)
    setResultVisible(false)
    setStatus('Mark submission pending.')
    try {
      const result = correction
        ? await onMark(step.testIndex, step.stepIndex, kind, note || undefined, correction)
        : await onMark(step.testIndex, step.stepIndex, kind, note || undefined)
      if (submission.current !== request) return
      if (result === 'refreshed') {
        clearDraft()
        setStatus('Mark saved. Receipt refreshed.')
      } else if (result !== 'stale') {
        setResultVisible(true)
        setStatus('Draft retained. Check the result below before retrying.')
      } else setStatus('')
    } catch {
      if (submission.current !== request) return
      setResultVisible(true)
      setStatus('Draft retained. Check the result below before retrying.')
    } finally {
      if (submission.current === request) { submission.current = undefined; setSubmitting(false) }
    }
  }
  const denial = markDenial ?? lastDenial
  const disabled = markPending || submitting
  const mark = marks?.find(entry => entry.stepIndex === step.stepIndex)
  // THE DURABLE SUB-ACTIONS, NOT THE v1 BLOB (405-08/405-11). The v1 sub-action array this row
  // used to read had no producer on this page, and 405-11 deleted it with the overview's readers.
  const subActions = step.subActions ?? []
  const hasSubActions = subActions.length > 0

  // THE STEP OWNS THE CACHE ANSWER, AND IT IS THREE-VALUED (D-01). `hit` means this step was served
  // from cache — every action under it with it. `miss` and `bypass` mean it was not, and there is
  // no partial state to render: the v1 shape counted cached sub-actions, and the projection that
  // replaced it records nothing per sub-action, so a "2 of 5" here would be a measurement nobody
  // took.
  const servedFromCache = step.cacheStatus === 'hit'

  const hasChildren = hasSubActions || inlineLogs.length > 0
  // A self-heal is a fact about the step the verdict alone does not carry, so it wins the glyph:
  // a step that passed only after healing is not the same story as one that just passed.
  const stepStatusIcon = <StepStatusIcon status={step.selfHealOccurred ? 'healed' : step.status} />
  const statusIconWithCacheMarker = servedFromCache ? (
    <CacheStatusIconWrapper
      marker="step-status"
      state="all"
      tone="primary"
      label="All actions cached"
    >
      {stepStatusIcon}
    </CacheStatusIconWrapper>
  ) : stepStatusIcon

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected && selection?.type === 'step'}
      aria-level={1}
      data-step-id={step.id}
      className={cn(
        !embedded && "mx-2 mb-1.5 rounded-[2px]",
        hasChildren && isExpanded && !embedded && "border border-border/70 bg-muted/15 relative before:absolute before:left-[19.5px] before:w-px before:bg-border/60 before:top-[19px] before:bottom-[13px]",
        hasChildren && isExpanded && embedded && "relative before:absolute before:left-[19.5px] before:w-px before:bg-border/60 before:top-[19px] before:bottom-[13px]"
      )}
    >
      <button
        className={cn(
          "flex w-full items-start gap-2 py-2 px-3 text-left rounded-[2px]",
          "hover:bg-muted/50 transition-colors",
          isSelected && selection?.type === 'step' && "bg-primary/10 ring-1 ring-primary/30"
        )}
        onClick={() => onSelect({ type: 'step', stepId: step.id })}
      >
        {statusIconWithCacheMarker}
        <div className="min-w-0 flex-1">
          {step.displayStepTotal ? (
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Step {step.displayStepOrder} of {step.displayStepTotal}
            </div>
          ) : null}
          <StepNameWithPills step={step} />
        </div>
        <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
          {formatDuration(step.duration)}
        </span>
      </button>

      {marks !== undefined && onMark && step.testIndex !== undefined && step.stepIndex !== undefined ? (
        <div data-step-mark aria-busy={submitting} className="mx-3 mb-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {MARKS.map(choice => (
            <button key={choice} type="button" data-mark-kind={choice} data-mark-step={step.stepIndex} aria-pressed={kind === choice}
              className={`${MARK_ACTION_CLASS} ${kind === choice ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
              disabled={disabled} onClick={() => { edit(); setKind(choice) }}>{MARK_LABELS[choice]}</button>
          ))}
          {kind === undefined ? null : (
            <div className="flex w-full flex-wrap items-center gap-1">
              <p className="w-full">Selected: {kind}</p>
              <textarea data-mark-note aria-label="Optional step mark note" maxLength={2000}
                className="w-full rounded-[2px] border border-border bg-background p-1 text-xs"
                value={note} onChange={event => { edit(); setNote(event.target.value) }} disabled={disabled} />
              <MarkCorrectionFields disabled={disabled} onChange={(value, valid) => { edit(); setCorrection(value); setCorrectionValid(valid) }} />
              <button type="button" data-mark-submit className={`${MARK_ACTION_CLASS} border-border bg-background`} disabled={disabled || !correctionValid}
                onClick={() => { void submit() }}>Record {kind} mark</button>
              <button type="button" data-mark-cancel className={`${MARK_ACTION_CLASS} border-border bg-background`} disabled={disabled}
                onClick={() => { edit(); clearDraft() }}>Cancel</button>
            </div>
          )}
          {mark === undefined ? null : (
            <>
              <span data-mark-chip>{markChipText(mark)}</span>
              <span data-mark-triage><MaskedText text={markTriageText(mark)} /></span>
              {mark.disposition.kind === 'drafted' ? <Link data-mark-confirm-link className={`${MARK_ACTION_CLASS} border-border bg-background`} to={routes.chat}>review in chat</Link> : null}
            </>
          )}
          <p data-mark-status role="status" aria-live="polite" aria-atomic="true" className="w-full">{status}</p>
          {!resultVisible || denial === undefined ? null : <div data-mark-denied role="alert" className="w-full"><DenialBlock neutralReason={denial.reason} remedies={denial.remedies} /></div>}
        </div>
      ) : null}

      {isExpanded && hasChildren && (
        <ul role="group">
          {inlineLogs.map(log => (
            <ExecutionTreeItem
              key={log.id}
              log={log}
              isSelected={
                selection?.type === 'execution' &&
                selection.logId === log.id
              }
              onSelect={() => onSelect({ type: 'execution', stepId: step.id, logId: log.id })}
            />
          ))}
          {subActions.map((sub) => (
            <SubActionTreeItem
              key={sub.subActionIndex}
              sub={sub}
              stepId={step.id}
              cached={servedFromCache}
              isSelected={
                selection?.type === 'subaction' &&
                selection.stepId === step.id &&
                selection.subIndex === sub.subActionIndex
              }
              onSelect={() => onSelect({ type: 'subaction', stepId: step.id, subIndex: sub.subActionIndex })}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
