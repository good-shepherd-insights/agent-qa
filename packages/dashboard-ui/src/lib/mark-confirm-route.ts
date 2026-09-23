import type {
  ChatConfirmAnswer,
  ChatConfirmRequestFrame,
  ChatConfirmResolvedFrame,
} from '@/lib/api'

export interface MarkConfirmClaim {
  onRequest(frame: ChatConfirmRequestFrame, answer: (answer: ChatConfirmAnswer) => void): void
  onResolved(frame: ChatConfirmResolvedFrame): void
}

export function claimMarkConfirms(_next: MarkConfirmClaim): () => void {
  return () => undefined
}

export function markConfirmClaim(): MarkConfirmClaim | undefined {
  return undefined
}
