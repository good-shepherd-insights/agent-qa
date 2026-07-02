import type {
  RiskActionDescriptor,
  StandingApprovalGrant,
  TrustScope,
} from '@vostride/agent-qa-schema'

export interface StandingApprovalReader {
  grantsFor(
    action: RiskActionDescriptor,
    actionScope: TrustScope,
  ): readonly StandingApprovalGrant[]
}

export const NO_STANDING_APPROVALS: StandingApprovalReader = {
  grantsFor: () => [],
}

export type ConfirmPort = (action: RiskActionDescriptor) => boolean | Promise<boolean>

export const DENY_CONFIRM: ConfirmPort = () => false
