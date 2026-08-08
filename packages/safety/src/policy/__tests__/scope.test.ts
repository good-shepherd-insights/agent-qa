import { TRUST_SCOPE_KEYS } from '@vostride/agent-qa-schema'
import type { TrustScope, TrustScopeKey } from '@vostride/agent-qa-schema'
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

// The authorizing leg, ranged over the published key set (391-15, closing G-391-5).
//
// The two tables above are hand-spelled ON PURPOSE and range nothing, so their results mean the
// same thing in every cell of a differential. This block is the opposite: every case below is
// generated from `TRUST_SCOPE_KEYS`, so the case set grows the day the constant grows.

/** Every declared key, each carrying a distinct non-empty value. Ranges the constant. */
function scopeOverEveryDeclaredKey(): TrustScope {
  return Object.fromEntries(TRUST_SCOPE_KEYS.map((key) => [key, `value-for-${key}`])) as TrustScope
}

/** The same scope with exactly one named key's value changed. Ranges the constant. */
function scopeWithOneKeyChanged(changed: TrustScopeKey): TrustScope {
  return Object.fromEntries(
    TRUST_SCOPE_KEYS.map((key) => [
      key,
      key === changed ? `other-value-for-${key}` : `value-for-${key}`,
    ]),
  ) as TrustScope
}

describe('the authorizing leg ranges the published scope key set', () => {
  it('FIXTURE VALIDITY (hand-spelled, ranges nothing): two identical {project, org} scopes match', () => {
    // Hand-spelled deliberately, exactly as CONTROL B in the schema key-set differential is.
    const scope = { project: 'local-workspace', org: 'acme' }

    expect(
      scopeMatches(scope, scope),
      'FIXTURE VALIDITY RED: `scopeMatches` refused two identical scopes carrying only keys the ' +
        'set has always contained. The fixture is dead and NO other result in this block means ' +
        'anything — this is not key-set drift.',
    ).toBe(true)
  })

  for (const key of TRUST_SCOPE_KEYS) {
    it(`DISCRIMINATION: two scopes differing only on the declared key '${key}' do not match`, () => {
      const credentialScope = scopeOverEveryDeclaredKey()
      const actionScope = scopeWithOneKeyChanged(key)

      expect(
        scopeMatches(credentialScope, actionScope),
        `the authorizing leg MATCHED two scopes that differ on the declared key '${key}'. ` +
          '`populatedKeys` in policy/scope.ts is not ranging the published TRUST_SCOPE_KEYS, so ' +
          `'${key}' is filtered out of BOTH sides before the comparison and the scope WIDENS ` +
          'across the dimension that key exists to express.',
      ).toBe(false)
    })
  }

  it('the caller: a grant over every declared key does not cover an action differing on the last one', () => {
    // `scopeMatches` is the helper; `grantCovers` is what the policy gate actually calls, so a pin
    // on the helper alone leaves the caller unmeasured.
    const lastKey = TRUST_SCOPE_KEYS[TRUST_SCOPE_KEYS.length - 1] as TrustScopeKey
    const grant = { scope: scopeOverEveryDeclaredKey(), actionClass: 'file_issue' }
    const action = { name: 'file_issue', recognized: true } as const

    expect(
      grantCovers(grant, action, scopeWithOneKeyChanged(lastKey)),
      `\`grantCovers\` COVERED an action whose scope differs on the declared key '${lastKey}'. ` +
        'The leg that grants authority is not ranging the published TRUST_SCOPE_KEYS.',
    ).toBe(false)
  })
})
