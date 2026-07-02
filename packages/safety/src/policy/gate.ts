import type {
  ExecutionContext,
  ExecutionPolicyResult,
  PolicyVerdict,
  RiskActionDescriptor,
  RiskTier,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'

import type { AuditSink, ExecutionAuditRow } from '../ports/audit-sink'
import type { ConfirmPort, StandingApprovalReader } from '../ports/policy-ports'
import { DENY_CONFIRM, NO_STANDING_APPROVALS } from '../ports/policy-ports'
import { requiresFailClosed } from './execution-context'
import { classifyRisk } from './risk-classifier'
import { grantCovers, scopeMatches } from './scope'

export type ExecutionPolicyOutcome =
  | 'proceeded'
  | 'prompted-approved'
  | 'prompted-denied'
  | 'fail-closed-denied'
  | 'blocked'

export type ExecutionPolicyTrustSource =
  | 'session-trust-mode'
  | 'trust-credential'
  | 'standing-approval'
  | 'tty-prompt'

export interface GateTrust {
  trustMode?: boolean
  credential?: TrustCredential
  actionScope?: TrustScope
}

export interface GateDeps {
  auditSink?: AuditSink
  reader?: StandingApprovalReader
  confirm?: ConfirmPort
}

export interface ResolveAskInput extends GateTrust {
  action: RiskActionDescriptor
  actionScope: TrustScope
  reader: StandingApprovalReader
  ctx: ExecutionContext
  confirm: ConfirmPort
}

export interface ResolveAskResult {
  verdict: Extract<PolicyVerdict, 'allow' | 'deny'>
  outcome: ExecutionPolicyOutcome
  trustSource?: ExecutionPolicyTrustSource
}

export interface BuildExecutionAuditRowInput {
  action: RiskActionDescriptor | string
  riskTier: RiskTier
  verdict: PolicyVerdict
  outcome: ExecutionPolicyOutcome
  reason: string
  trustSource?: ExecutionPolicyTrustSource
}

export function baseVerdict(tier: RiskTier, ctx: ExecutionContext): PolicyVerdict {
  switch (tier) {
    case 'read-only':
      return 'allow'
    case 'restricted':
      return 'deny'
    case 'mutating-local':
      return ctx === 'local-interactive' ? 'allow' : 'ask'
    case 'mutating-shared':
    case 'destructive':
      return 'ask'
  }
}

export async function resolveAsk(input: ResolveAskInput): Promise<ResolveAskResult> {
  if (input.trustMode === true) {
    return {
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'session-trust-mode',
    }
  }

  if (
    input.credential !== undefined &&
    scopeMatches(input.credential.scope, input.actionScope)
  ) {
    return {
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'trust-credential',
    }
  }

  const grants = input.reader.grantsFor(input.action, input.actionScope)
  if (grants.some((grant) => grantCovers(grant, input.action, input.actionScope))) {
    return {
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'standing-approval',
    }
  }

  if (requiresFailClosed(input.ctx)) {
    return {
      verdict: 'deny',
      outcome: 'fail-closed-denied',
    }
  }

  if (await input.confirm(input.action)) {
    return {
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'tty-prompt',
    }
  }

  return {
    verdict: 'deny',
    outcome: 'prompted-denied',
  }
}

export function buildExecutionAuditRow(
  input: BuildExecutionAuditRowInput,
): ExecutionAuditRow {
  return {
    action: typeof input.action === 'string' ? input.action : input.action.name,
    riskTier: input.riskTier,
    verdict: input.verdict,
    outcome: input.outcome,
    reason: input.reason,
    ...(input.trustSource === undefined ? {} : { trustSource: input.trustSource }),
  }
}

export async function evaluate(
  action: RiskActionDescriptor,
  ctx: ExecutionContext,
  trust: GateTrust = {},
  deps: GateDeps = {},
): Promise<ExecutionPolicyResult> {
  const { riskTier, reason: classificationReason } = classifyRisk(action)
  const base = baseVerdict(riskTier, ctx)
  const resolved =
    base === 'allow'
      ? ({ verdict: 'allow', outcome: 'proceeded' } satisfies ResolveAskResult)
      : base === 'deny'
        ? ({ verdict: 'deny', outcome: 'blocked' } satisfies ResolveAskResult)
        : await resolveAsk({
            ...trust,
            action,
            actionScope: trust.actionScope ?? {},
            reader: deps.reader ?? NO_STANDING_APPROVALS,
            ctx,
            confirm: deps.confirm ?? DENY_CONFIRM,
          })
  const decisionReason = buildDecisionReason(classificationReason, ctx, resolved)
  const row = buildExecutionAuditRow({
    action,
    riskTier,
    verdict: resolved.verdict,
    outcome: resolved.outcome,
    reason: decisionReason,
    trustSource: resolved.trustSource,
  })

  await deps.auditSink?.appendExecutionAudit(row)

  return {
    verdict: resolved.verdict,
    reason: decisionReason,
    riskTier,
  }
}

function buildDecisionReason(
  classificationReason: string,
  ctx: ExecutionContext,
  resolved: ResolveAskResult,
): string {
  switch (resolved.outcome) {
    case 'proceeded':
      return resolved.trustSource === undefined
        ? classificationReason
        : `${classificationReason}; ask satisfied by ${resolved.trustSource}`
    case 'blocked':
      return `blocked: ${classificationReason}`
    case 'fail-closed-denied':
      return `fail-closed: ask in ${ctx} without trust (${classificationReason})`
    case 'prompted-approved':
      return `prompted-approved: ${classificationReason}`
    case 'prompted-denied':
      return `prompted-denied: ${classificationReason}`
  }
}
