import type { RunsMarkPreviewResult } from '@vostride/agent-qa-schema'
import { PREVIEW_TITLE } from '@/lib/feedback-view'

export interface FeedbackPreviewProps {
  state: string
  current: boolean
  read?: RunsMarkPreviewResult
  updating?: boolean
  replacesTime?: string
}

export function FeedbackPreview({ state, current }: FeedbackPreviewProps) {
  return (
    <section data-feedback-preview data-preview-state={state} data-preview-current={String(current)}>
      <h3 className="text-xs font-medium text-muted-foreground">{PREVIEW_TITLE}</h3>
    </section>
  )
}
