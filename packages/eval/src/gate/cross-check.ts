/**
 * 417 D-09..D-12: attribution requires a supermajority in both arms of the target.
 * Pure evidence fold; createSeededRng is the only randomness. Sample one is inherited,
 * and the caller uses the remaining seeds for separate single-sample replay calls.
 */
import type { CrossCheck } from '@vostride/agent-qa-schema'
import { decisionIdentityKey, type DecisionIdentity } from '../replay/identity'
import type { ReplaySampleOutcome } from '../replay/result'
import { createSeededRng } from '../stats/prng'

function assertSampleCount(k: number): void {
  if (!Number.isSafeInteger(k) || k < 3 || k % 2 === 0)
    throw new TypeError('k must be an odd integer of at least 3')
}

export function foldCrossCheckAcrossTargets(
  words: readonly Exclude<CrossCheck, 'not-run'>[],
): Exclude<CrossCheck, 'not-run'> {
  if (words.length === 0) throw new TypeError('cross-check requires at least one target')
  if (words.every((word) => word === 'flipped')) return 'flipped'
  if (words.every((word) => word === 'held')) return 'held'
  return 'inconclusive'
}

export function deriveSampleSeeds(baseSeed: number, k: number): number[] {
  assertSampleCount(k)
  const rng = createSeededRng(baseSeed)
  return Array.from({ length: k - 1 }, () => rng.nextInt(0, 2 ** 31 - 1))
}

export function requiredAgreement(k: number): number {
  assertSampleCount(k)
  return Math.ceil(k / 2) + 1
}

function sampleClass(sample: ReplaySampleOutcome): string {
  switch (sample.kind) {
    case 'decision':
      return `decision:${decisionIdentityKey(sample.identity)}`
    case 'planner-failure':
      return `planner-failure:${sample.reason}`
    case 'unservable-divergence':
      return 'unservable-divergence'
    case 'harness-error':
      return 'harness-error'
  }
}

export function foldRemovalSamples(input: {
  withRecord: readonly ReplaySampleOutcome[]
  withoutRecord: readonly ReplaySampleOutcome[]
  gold: DecisionIdentity
}): Exclude<CrossCheck, 'not-run'> {
  const { withRecord, withoutRecord, gold } = input
  if (withRecord.length !== withoutRecord.length)
    throw new TypeError('cross-check arms must have equal lengths')
  const threshold = requiredAgreement(withRecord.length)
  const goldKey = decisionIdentityKey(gold)
  const isGold = (sample: ReplaySampleOutcome) =>
    sample.kind === 'decision' && decisionIdentityKey(sample.identity) === goldKey
  // Infrastructure failure cannot provide evidence that removing the record changed a decision.
  if (
    withRecord.filter(isGold).length >= threshold &&
    withoutRecord.filter((sample) => sample.kind !== 'harness-error' && !isGold(sample)).length >=
      threshold
  )
    return 'flipped'
  const counts = (samples: readonly ReplaySampleOutcome[]) => {
    const classes = new Map<string, number>()
    for (const sample of samples) {
      const key = sampleClass(sample)
      classes.set(key, (classes.get(key) ?? 0) + 1)
    }
    return classes
  }
  const withoutCounts = counts(withoutRecord)
  for (const [key, n] of counts(withRecord)) {
    if (n >= threshold && (withoutCounts.get(key) ?? 0) >= threshold) return 'held'
  }
  return 'inconclusive'
}
