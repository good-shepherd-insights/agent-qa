import { describe, expect, it } from 'vitest'

import { grantCovers, scopeMatches } from '../scope'

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

describe('grantCovers', () => {
  it.each([
    {
      name: 'covers the same action class in the same scope',
      grant: { scope: { project: 'A' }, actionClass: 'file_issue' },
      action: { name: 'file_issue', recognized: true },
      actionScope: { project: 'A' },
      expected: true,
    },
    {
      name: 'rejects a different action class in the same scope',
      grant: { scope: { project: 'A' }, actionClass: 'file_issue' },
      action: { name: 'delete_account', recognized: true },
      actionScope: { project: 'A' },
      expected: false,
    },
    {
      name: 'rejects the same action class in a different scope',
      grant: { scope: { project: 'A' }, actionClass: 'file_issue' },
      action: { name: 'file_issue', recognized: true },
      actionScope: { project: 'B' },
      expected: false,
    },
    {
      name: 'rejects empty grant scopes for concrete actions',
      grant: { scope: {}, actionClass: 'file_issue' },
      action: { name: 'file_issue', recognized: true },
      actionScope: { project: 'A' },
      expected: false,
    },
  ] as const)('$name', ({ grant, action, actionScope, expected }) => {
    expect(grantCovers(grant, action, actionScope)).toBe(expected)
  })
})
