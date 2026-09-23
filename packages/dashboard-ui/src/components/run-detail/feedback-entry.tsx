import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  FEEDBACK_ENTRY_MARKED_TOOLTIP,
  FEEDBACK_ENTRY_TOOLTIP,
  type FeedbackEntryScope,
} from '@/lib/feedback-view'
import { cn } from '@/lib/utils'

export interface FeedbackEntryButtonProps {
  scope: FeedbackEntryScope
  label: string
  target: string
  marked: boolean
  expanded: boolean
  controls: string
  onOpen: (opener: HTMLElement) => void
}

/**
 * A door to the composer: it opens it and never records a mark by itself (426 D-02). The tooltip
 * opens on focus as well as hover; its provider is the page's.
 */
export function FeedbackEntryButton({ scope, label, target, marked, expanded, controls, onOpen }: FeedbackEntryButtonProps) {
  const Glyph = marked ? MessageSquare : MessageSquarePlus
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('shrink-0', marked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          data-feedback-entry={scope}
          data-feedback-target={target}
          data-feedback-marked={String(marked)}
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          <Glyph className={cn('h-3.5 w-3.5', marked && 'fill-current')} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{marked ? FEEDBACK_ENTRY_MARKED_TOOLTIP : FEEDBACK_ENTRY_TOOLTIP}</TooltipContent>
    </Tooltip>
  )
}
