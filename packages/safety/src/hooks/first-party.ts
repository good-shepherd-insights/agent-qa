import type { ExecutionContext } from '@vostride/agent-qa-schema'
import type { LanguageModelMiddleware } from 'ai'

import { createProviderRequestMiddleware } from '../egress/provider-request-middleware'
import { createGuardrailProviderRequestHook } from '../guardrail/egress-hook'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '../guardrail/policy-loader'
import { createGuardrailStreamScan } from '../guardrail/stream-scan'
import { createMaskingProviderRequestHook } from '../masking/egress-hook'
import { getActiveMaskingContext } from '../masking/resolver'
import { getActiveAuditSink } from '../policy/audit-sink-resolver'
import type { GateTrust } from '../policy/gate'
import { createPolicyGateToolCallHook } from '../policy/gate-hook'
import type { AuditSink } from '../ports/audit-sink'
import type { ConfirmPort, StandingApprovalReader } from '../ports/policy-ports'
import { FIRST_PARTY } from './capability'
import type { AsyncToolCallHook, SafetyHookRunner } from './interfaces'
import { HookRegistry } from './registry'

// The single canonical first-party registrar (D-01). It is the only public
// composition entry: masking -> guardrail -> policy gate on ONE HookRegistry,
// masking BEFORE guardrail (locked Phase 346 order), the gate at the async
// tool_call point via the module-private FIRST_PARTY token.
export interface FirstPartySafetyDeps {
  auditSink?: AuditSink
  reader?: StandingApprovalReader
  confirm?: ConfirmPort
  resolveExecutionContext?: () => ExecutionContext
  trust?: GateTrust
  guardrailPolicyInput?: unknown
}

// When the caller supplies no direct auditSink, every egress path resolves the
// active sink AT APPEND TIME (RESEARCH Pitfall 3): the run's ALS-stamped sink wins
// while a run is active, the D-03 process default wins outside (once 362-02 installs
// it). Registration-time capture silently dropped rows for the deps-less model
// registrar — this adapter closes that gap without touching its call signature (D-01).
function resolverBackedAuditSink(): AuditSink {
  return {
    appendExecutionAudit(row) {
      return getActiveAuditSink()?.appendExecutionAudit(row)
    },
    appendGuardrailAudit(row) {
      return getActiveAuditSink()?.appendGuardrailAudit(row)
    },
  }
}

export interface FirstPartySafetyHooks {
  // Typed as the run-facing surface (not the concrete HookRegistry) so plan
  // 350-04's barrel narrowing has zero declaration-emit ripple.
  registry: SafetyHookRunner
  middleware: LanguageModelMiddleware
}

export function registerFirstPartySafetyHooks(
  deps: FirstPartySafetyDeps = {},
): FirstPartySafetyHooks {
  // (1) Load the policy FIRST — a throw here (GuardrailConfigError) is the
  // fail-closed composition surface SAFE-03(b) drives. Never monkeypatch the
  // default: garbage input is passed explicitly by callers/tests.
  const policy = loadGuardrailPolicy(deps.guardrailPolicyInput ?? defaultGuardrailPolicyInput)

  // A single composition-level sink threaded to every egress path: the caller's
  // direct sink when provided, otherwise the resolver-backed adapter (Pitfall 3).
  const auditSink: AuditSink = deps.auditSink ?? resolverBackedAuditSink()

  // (2) One registry, wired to the composed audit sink.
  const registry = new HookRegistry({ auditSink })

  // (3) masking BEFORE guardrail (locked 346 order: guardrail scans an
  // already-masked request). Every register method is token-gated (D-03), so the
  // FIRST_PARTY token threads through both provider_request registrations.
  registry.registerProviderRequest(
    createMaskingProviderRequestHook(getActiveMaskingContext),
    FIRST_PARTY,
  )
  registry.registerProviderRequest(
    createGuardrailProviderRequestHook(policy, auditSink),
    FIRST_PARTY,
  )

  // (4) The policy gate at the async tool_call point, via the FIRST_PARTY token.
  // The gate hook is precise about its RiskActionDescriptor input; the registry
  // slot is the erased AsyncToolCallHook<unknown> (function params are
  // contravariant), so widen at this single trusted registration site — tool_call
  // dispatch only ever threads RiskActionDescriptors here (HOOK-FUT-01).
  const gateHook = createPolicyGateToolCallHook({
    auditSink,
    reader: deps.reader,
    confirm: deps.confirm,
    resolveExecutionContext: deps.resolveExecutionContext,
    trust: deps.trust,
  }) as AsyncToolCallHook
  registry.registerToolCallAsync(gateHook, FIRST_PARTY)

  return {
    registry,
    middleware: createProviderRequestMiddleware(
      registry,
      createGuardrailStreamScan(policy, auditSink),
    ),
  }
}
