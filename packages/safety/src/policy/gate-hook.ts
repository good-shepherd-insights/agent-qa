import type { ExecutionContext, RiskActionDescriptor } from '@vostride/agent-qa-schema'

import type { AsyncToolCallHook } from '../hooks/interfaces'
import type { AuditSink } from '../ports/audit-sink'
import type { ConfirmPort, StandingApprovalReader } from '../ports/policy-ports'
import { getActiveExecutionContext } from './execution-context'
import { evaluate, type GateTrust } from './gate'

// Adapts the execution policy gate (349) into an async tool_call hook (D-02).
//
// The hook is the async attachment point the registrar wires via
// registerToolCallAsync(gateHook, FIRST_PARTY). It performs ZERO audit work and
// ZERO ask-resolution: evaluate() is the single execution-audit author (349 D-02,
// gate.ts:174) and resolves ask internally with its DENY_CONFIRM /
// NO_STANDING_APPROVALS fail-closed defaults.
export interface PolicyGateHookDeps {
  auditSink?: AuditSink
  reader?: StandingApprovalReader
  confirm?: ConfirmPort
  resolveExecutionContext?: () => ExecutionContext
  trust?: GateTrust
}

export function createPolicyGateToolCallHook(
  deps: PolicyGateHookDeps = {},
): AsyncToolCallHook<RiskActionDescriptor> {
  const resolveContext = deps.resolveExecutionContext ?? getActiveExecutionContext

  return async (action) => {
    const result = await evaluate(action, resolveContext(), deps.trust ?? {}, {
      auditSink: deps.auditSink,
      reader: deps.reader,
      confirm: deps.confirm,
    })

    if (result.verdict === 'deny') {
      return { action: 'deny', reason: result.reason, policy: result }
    }

    return { action: 'allow', call: action }
  }
}
