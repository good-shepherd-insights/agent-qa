import { expectTypeOf } from 'vitest'
import type {
  ExecutionPolicyResult,
  MaskingContext,
  PolicyVerdict,
  RiskTier,
  ScanAction,
  ScanResult,
} from '../../index'

const policyResult: ExecutionPolicyResult = {
  verdict: 'allow',
  reason: 'read-only action',
  riskTier: 'read-only',
}

expectTypeOf(policyResult.verdict).toEqualTypeOf<PolicyVerdict>()
expectTypeOf(policyResult.riskTier).toEqualTypeOf<RiskTier>()
expectTypeOf<ScanResult['action']>().toEqualTypeOf<ScanAction>()
expectTypeOf<MaskingContext>().toMatchTypeOf<{
  mask(text: string): string
  unmask(text: string): string
}>()
