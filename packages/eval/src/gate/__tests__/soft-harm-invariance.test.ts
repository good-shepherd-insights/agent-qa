import { describe, expect, it } from 'vitest'
import { diffArms, foldPerAxisScore, orderHarmed, weightFor, type ArmDecision } from '../decision-diff'
import { decideGate1 } from '../gate-verdict'

function arm(tier: 'gold' | 'near-gold' | 'silver', softWeight?: number): ArmDecision {
  const vector = (headline: 'correct' | 'incorrect') => ({
    key: `${tier}#-#0`, cassetteId: tier, decisionOrdinal: 0, product: 'fixture',
    briefSource: 'proof' as const,
    axes: { headline, elementIdentity: headline, value: 'not-applicable' as const,
      opClass: headline, sideEffect: headline, loop: 'not-applicable' as const },
  })
  return {
    cassetteId: tier, decisionOrdinal: 0, origin: 'gate-set',
    label: { tier, sourceChannel: 'recorded-verdict', verdict: { pass: true, reasoning: 'fixture' } },
    ...(softWeight === undefined ? {} : { softWeight }),
    baseline: { kind: 'scored', vector: vector('correct'), briefSource: 'proof' },
    candidate: { kind: 'scored', vector: vector('incorrect'), briefSource: 'proof' },
  }
}

describe('SOFT never dilutes categorical harm', () => {
  for (const tier of ['gold', 'near-gold', 'silver'] as const) {
    it.each([0, 0.25, 1, undefined])(`${tier} preserves disclosure %s and identical harm`, (softWeight) => {
      const original = arm(tier)
      const supplied = arm(tier, softWeight)
      const [diff] = diffArms([supplied])
      expect(diff).toEqual({ ...diffArms([original])[0],
        ...(softWeight === undefined ? {} : { softWeight }) })
      expect(Object.hasOwn(diff!, 'softWeight')).toBe(softWeight !== undefined)
      expect(weightFor(supplied.label)).toBe(tier)
      const decide = (rows: ArmDecision[]) => decideGate1({ kind: 'fact', sameFamilyRefused: false,
        targets: [], collateral: diffArms(rows), crossCheck: 'not-run' })
      const result = decide([supplied])
      expect(result).toEqual({ ...decide([original]), harmed: [diff] })
      expect(result.verdict).toBe('fail')
      expect(result.reasons).toContain('collateral-harm')
      const measured = { n: 1, pairs: [], aggregateFloor: 0.1 }
      const floors = { headline: measured, elementIdentity: measured, value: measured,
        opClass: measured, sideEffect: measured, loop: measured }
      expect(foldPerAxisScore([supplied], floors)).toEqual(foldPerAxisScore([original], floors))
    })
  }
  it.each([0, 0.25, 1, undefined])('keeps gold then near-gold then silver ordering at %s', (softWeight) => {
    const rows = diffArms(['silver', 'gold', 'near-gold'].map((tier) =>
      arm(tier as 'gold' | 'near-gold' | 'silver', softWeight)))
    expect(orderHarmed(rows).map((row) => row.weight)).toEqual(['gold', 'near-gold', 'silver'])
  })
})
