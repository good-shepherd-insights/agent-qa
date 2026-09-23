// A module-level box, like `currentRunConfirmScope` in `api.ts`: one confirm channel per page and one
// mark in flight per page (426-10, D-20). The claim only relays; the host keeps the channel and scope.
// Type imports only — see `run-confirm-dialog.tsx` on module-level reads of `@/lib/api`.

import type {
  ChatConfirmAnswer,
  ChatConfirmRequestFrame,
  ChatConfirmResolvedFrame,
} from '@/lib/api'

export interface MarkConfirmClaim {
  onRequest(frame: ChatConfirmRequestFrame, answer: (answer: ChatConfirmAnswer) => void): void
  onResolved(frame: ChatConfirmResolvedFrame): void
}

let claim: MarkConfirmClaim | undefined

export function claimMarkConfirms(next: MarkConfirmClaim): () => void {
  claim = next
  return () => {
    if (claim === next) claim = undefined
  }
}

export function markConfirmClaim(): MarkConfirmClaim | undefined {
  return claim
}
