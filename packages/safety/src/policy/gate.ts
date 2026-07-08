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
      // spec/v2/execution-safety.md §2.1, ratified 2026-07-05: mutating-local
      // allows in EVERY execution context. §2.2: recognized in-test verbs never
      // reach resolveAsk in any context — ask + fail-closed stay reserved for
      // mutating-shared/destructive. (Supersedes the pre-ratification ternary.)
      return 'allow'
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
      // §2.4: a restricted-tier action is never executable — no grant, credential,
      // or trust mode overrides a restricted deny (D-16 finality clause).
      return `blocked: ${classificationReason}: restricted actions are never executable; no grant overrides them`
    case 'fail-closed-denied':
      // D-16: name the classification AND the way out in one line — never an
      // env-var bypass (forbidden by D-15/§2.3); scoped run-tokens arrive with M5.
      return `fail-closed: ask in ${ctx} without trust (${classificationReason}): re-run locally to confirm interactively or opt in with --trust-session; scoped CI/cloud run-tokens arrive with the M5 run-invocation API`
    case 'prompted-approved':
      return `prompted-approved: ${classificationReason}`
    case 'prompted-denied':
      // D-16: the human denied at the interactive prompt; it can be re-run and
      // approved, or trusted for the session with --trust-session.
      return `prompted-denied: ${classificationReason}: the interactive prompt was declined; re-run and approve, or opt in with --trust-session`
  }
}
