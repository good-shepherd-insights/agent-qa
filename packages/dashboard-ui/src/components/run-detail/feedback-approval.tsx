import type { ChatConfirmAnswer } from '@/lib/api'
import type { RunConfirmDialogProps } from '@/components/run-confirm-dialog'

export interface FeedbackApprovalProps {
  confirmId: string
  actionClass: string
  preview?: string
  resolution?: RunConfirmDialogProps['resolution']
  onAnswer: (answer: ChatConfirmAnswer) => void
}

export function FeedbackApproval(_props: FeedbackApprovalProps) {
  return null
}
