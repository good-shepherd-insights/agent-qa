import { useId, type Ref } from 'react'
import { X } from 'lucide-react'
import type { Mark, RunsMarkPreviewResult } from '@vostride/agent-qa-schema'
import type { MarkDenial } from '@/lib/analysis-view'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { DenialBlock } from '@/chat/chat-transcript'
import { FeedbackPreview } from '@/components/run-detail/feedback-preview'
import { MaskedText } from '@/components/run-detail/masked-text'
import {
  CHOICE_LABELS,
  CHOICE_LEGEND,
  CHOICE_MEANINGS,
  CLOSE_FEEDBACK_LABEL,
  CLOSE_FEEDBACK_TOOLTIP,
  FEEDBACK_CHOICE_ORDER,
  NOTE_LABEL,
  NO_UNIQUE_ADDRESS_TEXT,
  SEND_FEEDBACK_LABEL,
  TEST_SWITCHER_LABEL,
  resolvedStepText,
  showStepLabel,
  type FeedbackComposerState,
  type FeedbackOutcomeClass,
  type FeedbackPreviewState,
  type FeedbackTextParts,
} from '@/lib/feedback-view'

export interface FeedbackComposerProps {
  composerId: string
  headingId: string
  heading: FeedbackTextParts
  scopeLine: FeedbackTextParts
  state: FeedbackComposerState
  scope: 'test' | 'step'
  target: string
  outcomeClass: FeedbackOutcomeClass
  selected: Mark | undefined
  onChoose: (kind: Mark) => void
  /** D-01: the target has no unique mark address; the choices stay, nothing can be sent. */
  noUniqueAddress?: boolean
  /** D-03: a test-level target in a multi-member run can be moved to another test. */
  testSwitcher?: FeedbackTestSwitcher
  /** D-08: the selection has moved to another place; the target stays until the person switches. */
  pinned?: FeedbackPinned
  /** D-09: other addresses holding a non-empty draft. */
  unsentDrafts?: readonly FeedbackUnsentDraft[]
  note?: string
  onNoteChange?: (note: string) => void
  previewState: FeedbackPreviewState
  previewCurrent: boolean
  /** The read on screen, which may be an older one still showing while a re-fetch is in flight. */
  previewRead?: RunsMarkPreviewResult
  previewUpdating?: boolean
  previewReplacesTime?: string
  /** The target member's step count, for the resolved-step sentence. */
  stepCount?: number
  /** D-14: select the resolved step on the page without re-targeting the composer. */
  onShowStep?: (stepIndex: number) => void
  submitReason: string
  onSubmit: () => void
  status: string
  /** 419-15: the page's denial for this address, shown while its draft is retained. */
  denial?: MarkDenial
  headingRef?: Ref<HTMLHeadingElement>
  onClose: () => void
}

export interface FeedbackPinned {
  text: string
  switchLabel: string
  onSwitch: () => void
}

export interface FeedbackUnsentDraft {
  address: string
  label: string
  onOpen: () => void
}

export interface FeedbackTestSwitcher {
  value: number
  options: readonly { testIndex: number; label: string }[]
  onChange: (testIndex: number) => void
}

function TextParts({ parts }: { parts: FeedbackTextParts }) {
  return (
    <>
      {parts.prefix}
      {parts.name === undefined ? null : <MaskedText text={parts.name} />}
      {parts.suffix}
    </>
  )
}

/**
 * The docked feedback composer (426 D-07). Presentational (400 D-13): the page owns the target,
 * drafts, preview read and submission, and this paints them. A named section, never a dialog —
 * the tree, the evidence and every copy affordance stay usable while it is open.
 */
export function FeedbackComposer({
  composerId,
  headingId,
  heading,
  scopeLine,
  state,
  scope,
  target,
  outcomeClass,
  selected,
  onChoose,
  noUniqueAddress = false,
  testSwitcher,
  pinned,
  unsentDrafts = [],
  note = '',
  onNoteChange,
  previewState,
  previewCurrent,
  previewRead,
  previewUpdating = false,
  previewReplacesTime,
  stepCount = 0,
  onShowStep,
  submitReason,
  onSubmit,
  status,
  denial,
  headingRef,
  onClose,
}: FeedbackComposerProps) {
  const baseId = useId()
  const reasonId = `${baseId}-submit-reason`
  const switcherId = `${baseId}-test-switcher`
  const noteId = `${baseId}-note`
  const blocked = submitReason !== ''
  const choices = FEEDBACK_CHOICE_ORDER[outcomeClass]
  // D-14: the step a test-level mark lands on is the read's own answer, shown only for the current
  // read; already-marked and the refusals carry no resolved step (UI-SPEC U6).
  const resolvedPending = scope === 'test' && selected !== undefined && previewState !== 'idle' && !previewCurrent
  const resolved =
    scope === 'test' && selected !== undefined && previewCurrent &&
    (previewRead?.kind === 'consequences' || previewRead?.kind === 'quarantined')
      ? previewRead.resolvedStep
      : undefined
  const resolvedText =
    resolved === undefined || selected === undefined
      ? undefined
      : resolvedStepText(resolved.reason, selected, resolved.stepIndex + 1, stepCount)
  return (
    <section
      id={composerId}
      aria-labelledby={headingId}
      data-feedback-composer
      data-feedback-state={state}
      data-feedback-scope={scope}
      data-feedback-target={target}
      data-feedback-layout="docked"
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        // React delegates at the root container, so this stops the native event before the page's
        // document-level shortcut map; an Esc an open Radix layer consumed arrives defaultPrevented.
        event.stopPropagation()
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
      }}
    >
      <div className="shrink-0 space-y-1 border-b px-3 py-2">
        <div className="flex items-start gap-2">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 break-words text-base font-medium leading-snug">
            <TextParts parts={heading} />
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" data-feedback-close aria-label={CLOSE_FEEDBACK_LABEL} onClick={onClose}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{CLOSE_FEEDBACK_TOOLTIP}</TooltipContent>
          </Tooltip>
        </div>
        <p data-feedback-scope-line className="break-words text-xs text-muted-foreground">
          <TextParts parts={scopeLine} />
        </p>
        {testSwitcher === undefined ? null : (
          <div className="space-y-1 pt-1">
            <Label htmlFor={switcherId} className="text-xs font-medium">
              {TEST_SWITCHER_LABEL}
            </Label>
            <Select
              value={String(testSwitcher.value)}
              onValueChange={(value) => {
                const option = testSwitcher.options.find((entry) => String(entry.testIndex) === value)
                if (option !== undefined) testSwitcher.onChange(option.testIndex)
              }}
            >
              <SelectTrigger id={switcherId} className="w-full h-8 text-xs" data-feedback-test-switcher>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {testSwitcher.options.map((option) => (
                  <SelectItem key={option.testIndex} value={String(option.testIndex)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {pinned === undefined && unsentDrafts.length === 0 ? null : (
          <div className="space-y-1">
            {pinned === undefined ? null : (
              <div data-feedback-pinned role="note" className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p>{pinned.text}</p>
                <Button variant="ghost" size="xs" data-feedback-switch className="-ml-2 mt-1" onClick={pinned.onSwitch}>
                  {pinned.switchLabel}
                </Button>
              </div>
            )}
            {unsentDrafts.map((entry) => (
              <Button
                key={entry.address}
                variant="ghost"
                size="xs"
                data-feedback-unsent-draft={entry.address}
                className="text-muted-foreground hover:text-foreground"
                onClick={entry.onOpen}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        )}
        {noUniqueAddress ? (
          <div data-feedback-no-address>
            <DenialBlock neutralReason={NO_UNIQUE_ADDRESS_TEXT} remedies={[]} />
          </div>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">{CHOICE_LEGEND}</legend>
          <RadioGroup
            className="gap-2"
            data-feedback-choices
            data-feedback-outcome-class={outcomeClass}
            value={selected ?? ''}
            onValueChange={(value) => {
              const kind = choices.find((choice) => choice === value)
              if (kind !== undefined) onChoose(kind)
            }}
          >
            {choices.map((kind, index) => {
              const itemId = `${baseId}-${kind}`
              const meaningId = `${itemId}-meaning`
              return (
                <Label
                  key={kind}
                  htmlFor={itemId}
                  data-feedback-choice={kind}
                  data-choice-position={index + 1}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 font-normal leading-normal cursor-pointer hover:bg-muted/40 has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id={itemId} value={kind} aria-describedby={meaningId} className="mt-0.5" />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium leading-normal">{CHOICE_LABELS[kind]}</span>
                    <span id={meaningId} className="block text-xs text-muted-foreground">
                      {CHOICE_MEANINGS[outcomeClass][kind]}
                    </span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </fieldset>
        {resolvedPending ? (
          <Skeleton data-feedback-resolved-step-pending className="h-4 w-3/4 motion-reduce:animate-none" />
        ) : resolved !== undefined && resolvedText !== undefined ? (
          <div data-feedback-resolved-step data-resolved-reason={resolved.reason} className="flex flex-wrap items-center gap-x-2 text-xs">
            <p className="break-words">{resolvedText}</p>
            <Button variant="ghost" size="xs" data-feedback-show-step onClick={() => onShowStep?.(resolved.stepIndex)}>
              {showStepLabel(resolved.stepIndex + 1)}
            </Button>
          </div>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor={noteId} className="text-xs font-medium">
            {NOTE_LABEL}
          </Label>
          <Textarea
            id={noteId}
            data-feedback-note
            value={note}
            onChange={(event) => onNoteChange?.(event.target.value)}
            className="max-h-40 overflow-y-auto"
          />
        </div>

        <FeedbackPreview
          state={previewState}
          current={previewCurrent}
          read={previewRead}
          updating={previewUpdating}
          replacesTime={previewReplacesTime}
        />
      </div>

      <div className="shrink-0 space-y-2 border-t px-3 py-2">
        {denial === undefined ? null : (
          <div data-feedback-denied role="alert">
            <DenialBlock neutralReason={denial.reason} remedies={denial.remedies} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            data-feedback-submit
            aria-disabled={blocked}
            aria-describedby={reasonId}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!blocked) onSubmit()
            }}
          >
            {SEND_FEEDBACK_LABEL}
          </Button>
          <p id={reasonId} data-feedback-submit-reason className="text-xs text-muted-foreground">
            {submitReason}
          </p>
        </div>
        <p data-feedback-status role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">
          {status}
        </p>
      </div>
    </section>
  )
}
