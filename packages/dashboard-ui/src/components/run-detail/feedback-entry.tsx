import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface FeedbackEntryButtonProps {
  scope: 'test' | 'step'
  label: string
  target: string
  marked: boolean
  expanded: boolean
  controls: string
  onOpen: (opener: HTMLElement) => void
}

/** A door to the composer: it opens it and never records a mark by itself (426 D-02). */
export function FeedbackEntryButton({ scope, label, target, marked, expanded, controls, onOpen }: FeedbackEntryButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      data-feedback-entry={scope}
      data-feedback-target={target}
      data-feedback-marked={String(marked)}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  )
}
