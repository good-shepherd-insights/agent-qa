import { useEffect, useId, useRef } from 'react'
import type { ChatConfirmAnswer } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { MaskedText } from '@/components/run-detail/masked-text'
import {
  MARK_CONFIRM_TITLE,
  RESOLUTION_TEXT,
  markConfirmAnswers,
  type RunConfirmDialogProps,
} from '@/components/run-confirm-dialog'

export interface FeedbackApprovalProps {
  confirmId: string
  actionClass: string
  preview?: string
  resolution?: RunConfirmDialogProps['resolution']
  onAnswer: (answer: ChatConfirmAnswer) => void
}

/**
 * The mark's approval, in the composer's footer (426-10, D-20). The same question and answers
 * `RunConfirmDialog` offers, as a labelled group beside the evidence rather than a modal over it.
 */
export function FeedbackApproval({ confirmId, actionClass, preview, resolution, onAnswer }: FeedbackApprovalProps) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const yesRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { yesRef.current?.focus() }, [confirmId])
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-feedback-approval
      data-confirm-id={confirmId}
      className="space-y-2 rounded-md border border-primary/50 bg-primary/5 px-3 py-2"
    >
      <p id={titleId} className="text-sm font-medium">
        {MARK_CONFIRM_TITLE}
      </p>
      <p className="font-mono text-xs text-muted-foreground">{actionClass}</p>
      {preview === undefined ? null : (
        <p data-confirm-preview className="break-words text-xs text-muted-foreground">
          <MaskedText text={preview} />
        </p>
      )}
      {resolution === undefined ? (
        <div className="space-y-2">
          {markConfirmAnswers().map(({ answer, label, hint }) => {
            const hintId = `${baseId}-${answer}-hint`
            return (
              <div key={answer} className="flex items-center gap-2">
                <Button
                  ref={answer === 'accept' ? yesRef : undefined}
                  variant={answer === 'accept' ? 'default' : 'outline'}
                  size="sm"
                  data-confirm-answer={answer}
                  aria-describedby={hintId}
                  onClick={() => { onAnswer(answer) }}
                >
                  {label}
                </Button>
                <span id={hintId} className="min-w-0 break-words text-xs text-muted-foreground">
                  {hint}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p data-confirm-outcome className="text-xs text-muted-foreground">
          {resolution.answer === 'deny' && resolution.by !== 'answer'
            ? RESOLUTION_TEXT[resolution.by]
            : `${resolution.answer === 'deny' ? 'denied' : 'approved'} — ${RESOLUTION_TEXT.answer}`}
        </p>
      )}
    </div>
  )
}
