// FLOOR-03 purity law: no clock, no randomness, no host modules; only supplied counts.
// Two-sided 95% normal quantile, pinned so no quantile function is needed.
export const Z_95 = 1.959964

export function wilsonInterval(
  k: number,
  n: number,
  z = Z_95,
): { lower: number; upper: number; halfWidth: number } | undefined {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || k < 0 || n < 0) {
    throw new TypeError('Wilson counts must be nonnegative safe integers')
  }
  if (!Number.isFinite(z * z) || z < 0) {
    throw new TypeError('Wilson z must be nonnegative with a finite square')
  }
  // An absent denominator is undefined, including the pinned (5, 0) vector.
  if (n === 0) return undefined
  if (k > n) throw new TypeError('Wilson successes must not exceed the denominator')
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return {
    lower: Math.max(0, centre - halfWidth),
    upper: Math.min(1, centre + halfWidth),
    halfWidth,
  }
}
