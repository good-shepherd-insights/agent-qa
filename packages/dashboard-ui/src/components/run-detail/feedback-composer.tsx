import { useId } from 'react'
import { X } from 'lucide-react'
import type { Mark } from '@vostride/agent-qa-schema'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  CHOICE_LABELS,
  CLOSE_FEEDBACK_LABEL,
  PREVIEW_TITLE,
  SEND_FEEDBACK_LABEL,
  type FeedbackComposerState,
} from '@/lib/feedback-view'

export interface FeedbackComposerProps {
  composerId: string
  headingId: string
  heading: string
  state: FeedbackComposerState
  scope: 'test' | 'step'
  target: string
  choices: readonly Mark[]
  selected: Mark | undefined
  onChoose: (kind: Mark) => void
  previewState: string
  previewCurrent: boolean
  submitReason: string
  onSubmit: () => void
  status: string
  onClose: () => void
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
  state,
  scope,
  target,
  choices,
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
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-start gap-2">
          <h2 id={headingId} tabIndex={-1} className="min-w-0 flex-1 break-words text-base font-medium leading-snug">
            {heading}
          </h2>
          <Button variant="ghost" size="icon-sm" data-feedback-close aria-label={CLOSE_FEEDBACK_LABEL} onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <fieldset>
          <RadioGroup
            data-feedback-choices
            value={selected ?? ''}
            onValueChange={(value) => {
              const kind = choices.find((choice) => choice === value)
              if (kind !== undefined) onChoose(kind)
            }}
          >
            {choices.map((kind, index) => (
              <Label
                key={kind}
                htmlFor={`${baseId}-${kind}`}
                data-feedback-choice={kind}
                data-choice-position={index + 1}
                className="flex items-start gap-2 rounded-md border px-3 py-2 font-normal leading-normal cursor-pointer hover:bg-muted/40"
              >
                <RadioGroupItem id={`${baseId}-${kind}`} value={kind} className="mt-0.5" />
                {CHOICE_LABELS[kind]}
              </Label>
            ))}
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
