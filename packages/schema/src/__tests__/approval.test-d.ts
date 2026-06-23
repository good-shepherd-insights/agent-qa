import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import type { Approval, ActionProposal } from '../approval/approval'
import { approvalSchema, actionProposalSchema } from '../approval/approval'

expectTypeOf<z.infer<typeof approvalSchema>>().toEqualTypeOf<Approval>()
expectTypeOf<z.infer<typeof actionProposalSchema>>().toEqualTypeOf<ActionProposal>()

const proposal: ActionProposal = {
  id: 'proposal_1' as ActionProposal['id'],
  kind: 'patch',
  status: 'proposed',
  policy: 'ask',
  summary: 'Review patch proposal',
  rationale: 'The patch changes committed config.',
}

const invalidProposal: ActionProposal = {
  id: 'proposal_2' as ActionProposal['id'],
  kind: 'patch',
  status: 'proposed',
  // @ts-expect-error ApprovalPolicy exposes only allow|auto|ask, not runtime resolutions.
  policy: 'allowed',
  summary: 'Invalid policy proposal',
  rationale: 'Runtime resolution belongs to the agent layer.',
}

const approval: Approval = {
  id: 'approval_1' as Approval['id'],
  proposalRef: 'proposal_1' as Approval['proposalRef'],
  policy: 'ask',
  summary: 'Approval needed for config mutation',
  requestedAt: '2026-06-23T15:00:00.000Z',
}

void proposal
void invalidProposal
void approval
