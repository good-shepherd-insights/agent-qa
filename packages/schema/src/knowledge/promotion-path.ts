export type PromotionPath = 'deterministic-verdict-floor' | 'gate1-lower-trust' | 'gate1+gate2' | 'user-sovereign'
// prettier-ignore
export const PROMOTION_PATHS = ['deterministic-verdict-floor', 'gate1-lower-trust', 'gate1+gate2', 'user-sovereign'] as const satisfies readonly PromotionPath[]
export const PROMOTION_PATH_STRENGTH: Record<PromotionPath, number> = {
  'deterministic-verdict-floor': 0,
  'gate1-lower-trust': 1,
  'gate1+gate2': 2,
  'user-sovereign': 3,
}
export function strongerPromotionPath(a: PromotionPath, b: PromotionPath): PromotionPath {
  return PROMOTION_PATH_STRENGTH[a] >= PROMOTION_PATH_STRENGTH[b] ? a : b
}

