import { expectTypeOf } from 'vitest'
import type {
  ContextHookResult,
  ExecutionPolicyResult,
  GateRemedy,
  ExecutionContext,
  MaskingContext,
  PolicyVerdict,
  RiskTier,
  ScanAction,
  ScanResult,
  ToolCallHookResult,
  ToolResultHookResult,
} from '../../index'

const policyResult: ExecutionPolicyResult = {
  verdict: 'allow',
  reason: 'read-only action',
  riskTier: 'read-only',
  remedies: [],
  neutralReason: 'read-only action',
}

expectTypeOf(policyResult.verdict).toEqualTypeOf<PolicyVerdict>()
expectTypeOf(policyResult.riskTier).toEqualTypeOf<RiskTier>()
// 400 D-15 reconciled the exact-shape pin: the decision gained a FOURTH member, and 400's gap
// round 1 a FIFTH (`neutralReason`, the prose half of the same finding). The pin is restated each
// time rather than loosened — an `expectTypeOf(...).toMatchTypeOf` here would have let any later
// member arrive unannounced, and the point of an exact pin on this type is that a field reaching
// every surface's render cannot be added quietly.
expectTypeOf<ExecutionPolicyResult>().toEqualTypeOf<{
  verdict: PolicyVerdict
  reason: string
  riskTier: RiskTier
  remedies: readonly GateRemedy[]
  neutralReason: string
}>()

const invalidVerdict: ExecutionPolicyResult = {
  // @ts-expect-error ExecutionPolicyResult uses allow | ask | deny; `auto` belonged to the
  // superseded v44 policy vocabulary, deleted in 391 (D-09), and is named here by role rather
  // than by identifier so a token scan cannot read this line as its resurrection.
  verdict: 'auto',
  reason: 'a policy word from the deleted vocabulary',
  riskTier: 'read-only',
  remedies: [],
  neutralReason: 'a policy word from the deleted vocabulary',
}

const invalidRiskTier: ExecutionPolicyResult = {
  verdict: 'allow',
  reason: 'invalid risk tier',
  // @ts-expect-error riskTier is the five-member execution-risk union.
  riskTier: 'shared',
  remedies: [],
  neutralReason: 'invalid risk tier',
}

const invalidRemedyKind: ExecutionPolicyResult = {
  verdict: 'deny',
  reason: 'a remedy kind outside the closed vocabulary',
  riskTier: 'mutating-shared',
  // @ts-expect-error GateRemedyKind is closed; a surface cannot be told to do something the
  // vocabulary never declared, which is the whole of D-15's guard shape.
  remedies: [{ kind: 'email-the-admin' }],
  neutralReason: 'a remedy kind outside the closed vocabulary',
}

expectTypeOf<ScanResult['action']>().toEqualTypeOf<ScanAction>()
expectTypeOf<ScanResult>().toEqualTypeOf<{
  action: ScanAction
  detector?: string
  redactedFingerprint?: string
}>()
expectTypeOf<MaskingContext>().toMatchTypeOf<{
  mask(text: string): string
  unmask(text: string): string
}>()
expectTypeOf<ExecutionContext>().toEqualTypeOf<'local-interactive' | 'local-headless' | 'ci' | 'cloud'>()

const allowedToolCall: ToolCallHookResult<{ name: string }> = {
  action: 'allow',
  call: { name: 'inspect' },
}
const mutatedToolCall: ToolCallHookResult<{ name: string }> = {
  action: 'mutate',
  mutated: { name: 'safe-inspect' },
}
const deniedToolCall: ToolCallHookResult = {
  action: 'deny',
  reason: 'restricted action',
}

expectTypeOf(allowedToolCall.action).toEqualTypeOf<'allow'>()
expectTypeOf(mutatedToolCall.action).toEqualTypeOf<'mutate'>()
expectTypeOf(deniedToolCall.action).toEqualTypeOf<'deny'>()
expectTypeOf<ToolResultHookResult<string>>().toEqualTypeOf<{ result: string }>()
expectTypeOf<ContextHookResult<readonly string[]>>().toEqualTypeOf<{ context: readonly string[] }>()
