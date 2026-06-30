export type PolicyVerdict = 'allow' | 'ask' | 'deny'

export type RiskTier =
  | 'read-only'
  | 'mutating-local'
  | 'mutating-shared'
  | 'destructive'
  | 'restricted'

export interface ExecutionPolicyResult {
  verdict: PolicyVerdict
  reason: string
  riskTier: RiskTier
}
