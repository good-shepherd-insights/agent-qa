import { describe, expect, it } from 'vitest'

import type { RiskActionDescriptor, RiskTier } from '@vostride/agent-qa-schema'
import { classifyRisk } from '../risk-classifier'

interface ClassifierCase {
  name: string
  action: RiskActionDescriptor
  expectedTier: RiskTier
  reasonFragment: string
}

describe('classifyRisk', () => {
  const cases: ClassifierCase[] = [
    {
      name: 'uses readOnly advisory signal',
      action: { name: 'assert_visible', recognized: true, readOnly: true },
      expectedTier: 'read-only',
      reasonFragment: 'readOnly',
    },
    {
      name: 'treats destructive advisory flag as mutating-local only',
      action: { name: 'web_fill', recognized: true, destructive: true },
      expectedTier: 'mutating-local',
      reasonFragment: 'recognized',
    },
    {
      name: 'floors recognized flagless actions to mutating-local',
      action: { name: 'web_click', recognized: true },
      expectedTier: 'mutating-local',
      reasonFragment: 'recognized',
    },
    {
      name: 'raises soft lexicon hits to destructive',
      action: { name: 'delete_record', recognized: true },
      expectedTier: 'destructive',
      reasonFragment: 'soft destructive lexicon',
    },
    {
      name: 'raises hard lexicon hits to restricted',
      action: { name: 'run_shell', recognized: true, command: 'rm -rf /' },
      expectedTier: 'restricted',
      reasonFragment: 'hard destructive lexicon',
    },
    {
      name: 'respects declared mutating-shared floor',
      action: { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' },
      expectedTier: 'mutating-shared',
      reasonFragment: 'declared',
    },
    {
      name: 'lets hard lexicon raise a declared tier',
      action: {
        name: 'push_to_remote',
        recognized: true,
        declaredTier: 'mutating-shared',
        command: 'sudo dd',
      },
      expectedTier: 'restricted',
      reasonFragment: 'hard destructive lexicon',
    },
    {
      name: 'defaults unrecognized actions to restricted',
      action: { name: 'totally_unknown', recognized: false },
      expectedTier: 'restricted',
      reasonFragment: 'unrecognized',
    },
  ]

  it.each(cases)('$name', ({ action, expectedTier, reasonFragment }) => {
    const result = classifyRisk(action)

    expect(result.riskTier).toBe(expectedTier)
    expect(result.reason).toContain(reasonFragment)
    expect(result.reason.length).toBeGreaterThan(0)
    expect(Object.keys(result).sort()).toEqual(['reason', 'riskTier'])
    expect('verdict' in result).toBe(false)
  })
})
