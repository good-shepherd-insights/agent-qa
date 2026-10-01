import { expectTypeOf } from 'vitest'
import type {
  ContextHookResult,
  ExecutionContext,
  MaskingContext,
  RiskTier,
  ScanAction,
  ScanResult,
  ToolCallHookDenyResult,
  ToolCallHookResult,
  ToolResultHookResult,
} from '../../index'

// 2026-10-01 (432-19, D-15). The exact-shape pin on `ExecutionPolicyResult` (verdict, reason, tier,
// remedies, neutral reason) and its three invalid-member cells retire with the gate: the result, its
// `PolicyVerdict` and the remedy vocabulary are deleted, and each is now a type a consumer cannot
// name. The risk tier keeps its five-member exact pin because eval scores side effects with it.

// @ts-expect-error C432-REMEDY-TYPES-ABSENT: the execution-policy result is deleted
export type RetiredExecutionPolicyResult = import('../../index').ExecutionPolicyResult
// @ts-expect-error C432-REMEDY-TYPES-ABSENT: the allow/ask/deny verdict is deleted
export type RetiredPolicyVerdict = import('../../index').PolicyVerdict

expectTypeOf<RiskTier>().toEqualTypeOf<
  'read-only' | 'mutating-local' | 'mutating-shared' | 'destructive' | 'restricted'
>()
// @ts-expect-error riskTier is the five-member execution-risk union.
export const invalidRiskTier: RiskTier = 'shared'

// A deny result carries a reason and nothing a gate decided: no policy result rides it.
expectTypeOf<ToolCallHookDenyResult>().toEqualTypeOf<{ action: 'deny'; reason: string }>()

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
