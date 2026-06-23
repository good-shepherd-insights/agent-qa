declare const approvalIdBrand: unique symbol
declare const proposalIdBrand: unique symbol

export type ApprovalId = string & { readonly [approvalIdBrand]: 'ApprovalId' }
export type ProposalId = string & { readonly [proposalIdBrand]: 'ProposalId' }

export const asApprovalId = (value: string): ApprovalId => value as ApprovalId
export const asProposalId = (value: string): ProposalId => value as ProposalId
