import type {
  ActionProposal,
  Approval,
  ApprovalDecision,
  ApprovalId,
  ApprovalPolicy,
} from '@vostride/agent-qa-schema'

export interface ApprovalsPort {
  requestApproval(proposal: ActionProposal): Promise<Approval>
  decide(approvalId: ApprovalId, decision: ApprovalDecision): Promise<void>
  resolvePolicy(proposal: ActionProposal): Promise<ApprovalPolicy>
}
