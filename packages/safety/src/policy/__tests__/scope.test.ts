import { describe, expect, it } from 'vitest'

import { scopeMatches } from '../scope'

describe('scopeMatches', () => {
  it.each([
    {
      name: 'matches the same project exactly',
      credentialScope: { project: 'A' },
      actionScope: { project: 'A' },
      expected: true,
    },
    {
      name: 'rejects a different project',
      credentialScope: { project: 'A' },
      actionScope: { project: 'B' },
      expected: false,
    },
    {
      name: 'rejects an empty credential scope for a concrete action scope',
      credentialScope: {},
      actionScope: { project: 'A' },
      expected: false,
    },
    {
      name: 'rejects same-org but different-project scopes',
      credentialScope: { org: 'X', project: 'A' },
      actionScope: { org: 'X', project: 'B' },
      expected: false,
    },
    {
      name: 'rejects org-only credentials for project-scoped actions',
      credentialScope: { org: 'X' },
      actionScope: { org: 'X', project: 'A' },
      expected: false,
    },
    {
      name: 'rejects concrete credentials for empty action scopes',
      credentialScope: { project: 'A' },
      actionScope: {},
      expected: false,
    },
  ] as const)('$name', ({ credentialScope, actionScope, expected }) => {
    expect(scopeMatches(credentialScope, actionScope)).toBe(expected)
  })
})
