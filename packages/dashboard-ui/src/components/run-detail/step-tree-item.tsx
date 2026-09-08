import { useState } from 'react'
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
        <div className="mx-3 mb-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {MARKS.map(kind => (
            <button key={kind} type="button" data-mark-kind={kind} data-mark-step={step.stepIndex}
              className="rounded-[2px] border border-border/60 px-1.5 py-0.5 font-mono hover:bg-muted/60"
              disabled={markPending} onClick={() => { setKind(kind); setNote('') }}>{MARK_LABELS[kind]}</button>
          ))}
          {kind === undefined ? null : (
            <div className="flex w-full flex-wrap items-center gap-1">
              <textarea data-mark-note aria-label="Optional step mark note" maxLength={2000}
                className="w-full rounded-[2px] border border-border bg-background p-1 text-xs"
                value={note} onChange={event => setNote(event.target.value)} disabled={markPending} />
              <button type="button" data-mark-submit disabled={markPending}
                onClick={() => { onMark(step.testIndex!, step.stepIndex!, kind, note || undefined); setKind(undefined) }}>Mark</button>
              <button type="button" data-mark-cancel disabled={markPending}
                onClick={() => { setKind(undefined); setNote('') }}>Cancel</button>
            </div>
          )}
          {mark === undefined ? null : (
            <>
              <span data-mark-chip>{markChipText(mark)}</span>
              <span data-mark-triage><MaskedText text={markTriageText(mark)} /></span>
              {mark.disposition.kind === 'drafted' ? <Link data-mark-confirm-link to={routes.chat}>review in chat</Link> : null}
            </>
          )}
          {markDenial === undefined ? null : <div data-mark-denied className="w-full"><DenialBlock neutralReason={markDenial.reason} remedies={markDenial.remedies} /></div>}
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
