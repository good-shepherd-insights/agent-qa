import { describe, expect, it } from 'vitest'

import { requiresFailClosed } from '../execution-context'

describe('requiresFailClosed', () => {
  it.each([
    ['local-interactive', false],
    ['local-headless', true],
    ['ci', true],
    ['cloud', true],
  ] as const)('returns %s for %s', (context, expected) => {
    expect(requiresFailClosed(context)).toBe(expected)
  })
})
