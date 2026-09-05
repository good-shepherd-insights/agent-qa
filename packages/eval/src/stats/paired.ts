// FLOOR-03 purity law: no clock, no randomness, no host modules; only keyed evidence.
export interface DecisionVector {
  key: string
  correct: boolean
}

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

function uniqueDecisions(vectors: readonly DecisionVector[]): Map<string, boolean> {
  const byKey = new Map(vectors.map(v => [v.key, v.correct]))
  if (byKey.size !== vectors.length) throw new TypeError('decision keys must be unique within a run')
  return byKey
}

/** deltaAcc is accuracy(a) minus accuracy(b), over shared keys only. */
export function pairedDecisionDiff(
  a: readonly DecisionVector[],
  b: readonly DecisionVector[],
): PairedDecisionDiff {
  const aByKey = uniqueDecisions(a)
  const bByKey = uniqueDecisions(b)
  let both = 0
  let neither = 0
  let aOnly = 0
  let bOnly = 0
  for (const [key, correct] of aByKey) {
    const other = bByKey.get(key)
    if (other === undefined) continue
    if (correct && other) both++
    else if (!correct && !other) neither++
    else if (correct) aOnly++
    else bOnly++
  }
  const n = both + neither + aOnly + bOnly
  return {
    n,
    both,
    neither,
    aOnly,
    bOnly,
    aUnpaired: a.length - n,
    bUnpaired: b.length - n,
    deltaAcc: n === 0 ? undefined : (aOnly - bOnly) / n,
    flipRate: n === 0 ? undefined : (aOnly + bOnly) / n,
  }
}

/**
 * Two-sided exact binomial p at p = 0.5; honesty metadata, never a gate.
 * Iterate PMF weights relative to the mode, then normalize. Starting at 2^-n
 * would underflow above 1074 discordances and erase a nonzero central tail.
 */
export function mcnemarExactP(aOnly: number, bOnly: number): number {
  const n = aOnly + bOnly
  if (
    !Number.isSafeInteger(aOnly) || !Number.isSafeInteger(bOnly) ||
    aOnly < 0 || bOnly < 0 || !Number.isSafeInteger(n)
  ) {
    throw new TypeError('discordant counts and their sum must be nonnegative safe integers')
  }
  if (Math.abs(aOnly - bOnly) <= 1) return 1
  const tailLimit = Math.min(aOnly, bOnly)
  let mass = 1
  let total = n % 2 === 0 ? 1 : 2
  let tail = 0
  for (let k = Math.floor(n / 2); k > 0; k--) {
    mass *= k / (n - k + 1)
    total += 2 * mass
    if (k - 1 <= tailLimit) tail += mass
  }
  return Math.min(1, (2 * tail) / total)
}
