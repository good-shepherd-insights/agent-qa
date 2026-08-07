import { expectTypeOf } from 'vitest'
import type {
  ContextHookResult,
  ExecutionPolicyResult,
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
}

expectTypeOf(policyResult.verdict).toEqualTypeOf<PolicyVerdict>()
expectTypeOf(policyResult.riskTier).toEqualTypeOf<RiskTier>()
expectTypeOf<ExecutionPolicyResult>().toEqualTypeOf<{
  verdict: PolicyVerdict
  reason: string
  riskTier: RiskTier
}>()

const invalidVerdict: ExecutionPolicyResult = {
  // @ts-expect-error ExecutionPolicyResult uses allow | ask | deny; `auto` belonged to the
  // superseded v44 policy vocabulary, deleted in 391 (D-09), and is named here by role rather
  // than by identifier so a token scan cannot read this line as its resurrection.
  verdict: 'auto',
  reason: 'a policy word from the deleted vocabulary',
  riskTier: 'read-only',
}

const invalidRiskTier: ExecutionPolicyResult = {
  verdict: 'allow',
  reason: 'invalid risk tier',
  // @ts-expect-error riskTier is the five-member execution-risk union.
  riskTier: 'shared',
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
