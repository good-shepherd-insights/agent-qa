import { useId } from 'react'
import { X } from 'lucide-react'
import type { Mark } from '@vostride/agent-qa-schema'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { MaskedText } from '@/components/run-detail/masked-text'
import {
  CHOICE_LABELS,
  CHOICE_LEGEND,
  CHOICE_MEANINGS,
  CLOSE_FEEDBACK_LABEL,
  FEEDBACK_CHOICE_ORDER,
  PREVIEW_TITLE,
  SEND_FEEDBACK_LABEL,
  type FeedbackComposerState,
  type FeedbackOutcomeClass,
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
  previewState: string
  previewCurrent: boolean
  submitReason: string
  onSubmit: () => void
  status: string
  onClose: () => void
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
  previewState,
  previewCurrent,
  submitReason,
  onSubmit,
  status,
  onClose,
}: FeedbackComposerProps) {
  const baseId = useId()
  const reasonId = `${baseId}-submit-reason`
  const blocked = submitReason !== ''
  const choices = FEEDBACK_CHOICE_ORDER[outcomeClass]
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
    >
      <div className="shrink-0 space-y-1 border-b px-3 py-2">
        <div className="flex items-start gap-2">
          <h2 id={headingId} tabIndex={-1} className="min-w-0 flex-1 break-words text-base font-medium leading-snug">
            <TextParts parts={heading} />
          </h2>
          <Button variant="ghost" size="icon-sm" data-feedback-close aria-label={CLOSE_FEEDBACK_LABEL} onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        <p data-feedback-scope-line className="break-words text-xs text-muted-foreground">
          <TextParts parts={scopeLine} />
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
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

        <section data-feedback-preview data-preview-state={previewState} data-preview-current={String(previewCurrent)}>
          <h3 className="text-xs font-medium text-muted-foreground">{PREVIEW_TITLE}</h3>
        </section>
      </div>

      <div className="shrink-0 space-y-2 border-t px-3 py-2">
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
