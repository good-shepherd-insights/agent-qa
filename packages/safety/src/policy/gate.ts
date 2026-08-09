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
  // 392 D-21: a session-scoped `/pin` refused this action class. Its OWN outcome value rather
  // than a reuse of `blocked`, because the two answer different questions for an operator
  // reading the audit trail: `blocked` means the tier makes this action non-executable for
  // everyone forever, while this means a person, in this conversation, asked for it to stop.
  | 'session-pin-denied'

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

/**
 * A TIGHTEN-ONLY session overlay (392 D-21).
 *
 * Answers one question — "is this action class refused for this session?" — and the answer is a
 * boolean because `true` is the only thing it is allowed to be able to say. A hook returning a
 * verdict, or a map of per-class verdicts, would be able to express "allow this", and the thing
 * it would be loosening is the authorization ladder. Tighten-only is therefore a property of this
 * signature, not a rule the gate remembers to apply in one direction.
 *
 * SYNCHRONOUS, unlike {@link ConfirmPort}. A pin is an in-memory set that dies with the session;
 * an awaited overlay would admit an I/O-backed or model-backed deny, which is a network call
 * placed between a caller and its authorization decision.
 *
 * `false` means "no opinion", never "allow": the gate's own ladder still decides. The absence of
 * the hook and a hook answering `false` are the same behaviour, deep-equal down to the audit row,
 * and that equivalence is asserted rather than assumed.
 */
export type SessionDenyOverlay = (action: RiskActionDescriptor) => boolean

export interface GateDeps {
  auditSink?: AuditSink
  reader?: StandingApprovalReader
  confirm?: ConfirmPort
  /**
   * Optional session-scoped deny overlay (392 D-21). ABSENT BY DEFAULT and absent in every
   * composition that does not run a chat session — the ladder below is untouched when nothing
   * supplies one.
   */
  deny?: SessionDenyOverlay
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
  // 392 D-21. The session pin is consulted AFTER classification — so the refusal carries the
  // classified action and lands an ordinary execution-audit row a few lines below, rather than
  // being a pre-gate throw that writes nothing (the repudiation gap `invokeFunction` names at
  // its head) — and BEFORE `resolveAsk`, which is what makes §2.4 structural here. A grant, a
  // credential, or session trust mode cannot resurrect a pinned action because none of them is
  // read: there is no ordering between the pin and the trust sources for a later edit to invert.
  // Placing it after `resolveAsk` would have been the same verdict today and a live confirm
  // prompt for an action the person had already refused.
  //
  // `base === 'deny'` is deliberately NOT consulted: a restricted action was never executable and
  // §2.4's finality clause is what an operator needs to read, so the pin does not relabel a
  // decision the tier had already made. That also makes the overlay idempotent over a deny.
  const pinDenied = base !== 'deny' && deps.deny !== undefined && deps.deny(action)
  const resolved = pinDenied
    ? ({ verdict: 'deny', outcome: 'session-pin-denied' } satisfies ResolveAskResult)
    : base === 'allow'
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
    case 'session-pin-denied':
      // 392 D-21: name the classification AND the way out, in the same shape the two clauses
      // above use. The way out is the session boundary, because a pin has no revoke verb by
      // design — an overlay that could be lifted mid-conversation would be a loosening path, and
      // the whole point of `/pin` is that it only ever goes one way.
      return `session-pin-denied: ${classificationReason}: this action class is pinned DENY for this chat session; a pin cannot be lifted — it ends when the session does`
  }
}
