export interface DecisionVector { key: string; correct: boolean }
export interface PairedDecisionDiff {
  n: number
  both: number
  neither: number
  aOnly: number
  bOnly: number
  aUnpaired: number
  bUnpaired: number
  deltaAcc?: number
  flipRate?: number
}

// RED contract skeletons; Task 2 supplies the paired folds next.
export function pairedDecisionDiff(
  _a: readonly DecisionVector[], _b: readonly DecisionVector[],
): PairedDecisionDiff {
  return { n: 0, both: 0, neither: 0, aOnly: 0, bOnly: 0, aUnpaired: 0, bUnpaired: 0 }
}

export function mcnemarExactP(_aOnly: number, _bOnly: number): number {
  return 1
}
