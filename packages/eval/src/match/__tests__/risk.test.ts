import type { Action, RiskTier } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { classifySideEffect } from '../risk'

function action(type: string): Action {
  return { type } as unknown as Action
}

describe('classifySideEffect', () => {
  it('does not flag equal risk tiers', () => {
    expect(classifySideEffect(action('click'), action('click'))).toEqual({ kind: 'none' })
  })

  it('flags a candidate whose risk tier strictly exceeds the gold tier', () => {
    expect(classifySideEffect(action('inspect'), action('unrecognized-candidate'))).toEqual({
      kind: 'flagged',
      reason: 'unrecognized action fail-safe',
      riskFamily: 'restricted',
    })
  })

  it('does not flag a candidate whose risk tier is lower than the gold tier', () => {
    expect(classifySideEffect(action('unrecognized-gold'), action('inspect'))).toEqual({
      kind: 'none',
    })
  })

  it('keeps both verdict variants structurally non-numeric', () => {
    const none = classifySideEffect(action('click'), action('click'))
    const flagged = classifySideEffect(action('inspect'), action('unrecognized-candidate'))

    expect(Object.keys(none).sort()).toEqual(['kind'])
    expect(Object.keys(flagged).sort()).toEqual(['kind', 'reason', 'riskFamily'])
    expect(Object.values(none).some(value => typeof value === 'number')).toBe(false)
    expect(Object.values(flagged).some(value => typeof value === 'number')).toBe(false)

    if (flagged.kind !== 'flagged') throw new Error('expected flagged verdict')
    const riskFamily: RiskTier = flagged.riskFamily
    expect(typeof flagged.reason).toBe('string')
    expect(typeof riskFamily).toBe('string')
  })
})
