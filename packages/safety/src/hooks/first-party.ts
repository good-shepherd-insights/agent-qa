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
import type { AuditSink } from '../ports/audit-sink'
import { FIRST_PARTY } from './capability'
import type { SafetyHookRunner } from './interfaces'
import { HookRegistry } from './registry'

// The single canonical first-party registrar (D-01). It is the only public
// composition entry: masking -> guardrail on ONE HookRegistry, masking BEFORE
// guardrail (locked Phase 346 order), via the module-private FIRST_PARTY token.
//
// 2026-10-01 (432-19, D-15): the execution policy gate is no longer registered at the
// async tool_call point. The gate, its confirm and standing-approval ports and its
// trust input are deleted; masking, guardrail and the guardrail audit stay.
export interface FirstPartySafetyDeps {
  auditSink?: AuditSink
  guardrailPolicyInput?: unknown
}

// When the caller supplies no direct auditSink, every egress path resolves the
// active sink AT APPEND TIME (RESEARCH Pitfall 3): the run's ALS-stamped sink wins
// while a run is active, the D-03 process default wins outside (once 362-02 installs
// it). Registration-time capture silently dropped rows for the deps-less model
// registrar — this adapter closes that gap without touching its call signature (D-01).
function resolverBackedAuditSink(): AuditSink {
  return {
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

  return {
    registry,
    middleware: createProviderRequestMiddleware(
      registry,
      createGuardrailStreamScan(policy, auditSink),
    ),
  }
}
