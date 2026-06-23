export type ScopeTier = 'global' | 'product' | 'suite' | 'test'

export interface ScopeKey {
  tier: ScopeTier
  key: string
}
