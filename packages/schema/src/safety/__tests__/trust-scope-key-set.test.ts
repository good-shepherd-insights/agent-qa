// What this file measures (Phase 391 plan 11, closing G-391-1): the strict wire projection
// `TrustScopeSchema` admits and refuses exactly the scope keys `TRUST_SCOPE_KEYS` declares.
//
// RE-SPELLED 2026-10-01 (432-18, D-03/D-15/D-22). This file was a two-leg differential: the
// structural guard on the committed grant ledger (`hasGrantEventShape` -> `isMatchableScope`) against
// the wire leg `grants.list` parsed its own output through. 432-18 deletes the ledger, its guard and
// `grants.list`, so the guard leg has no subject and its absence is pinned below. The wire leg stays,
// strict, because `config/run-service.ts` still parses a declared credential's trust scope through it
// until 432-22 removes that DTO.
//
// THE TWO CONTROLS ARE STILL NOT THE SAME KIND OF CASE:
//
//   CONTROL A ranges the constant, so it MOVES when the constant moves. Under a drift mutation that
//     adds a key to the constant alone it is PREDICTED RED against a hand-spelled wire leg, and its
//     failure message names the wire spelling.
//   CONTROL B is hand-spelled `{project, org}` and ranges NOTHING. It is the fixture-validity check
//     and it is asserted FIRST.
//
// Every leg is imported RELATIVELY from source, so no case can pass or fail on a stale built dist.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TrustScopeSchema } from '../grant-ops'
import { TRUST_SCOPE_KEYS } from '../trust-credential'

const SAFETY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** What the strict wire leg says about a scope. */
function wireAdmits(scope: Record<string, unknown>): boolean {
  return TrustScopeSchema.safeParse(scope).success
}

/** Every key the constant declares, each carrying a non-empty value. Ranges the constant. */
function scopeOverEveryDeclaredKey(): Record<string, string> {
  return Object.fromEntries(TRUST_SCOPE_KEYS.map((key) => [key, `value-for-${key}`]))
}

/**
 * A key OUTSIDE the constant, computed rather than typed, so this case cannot quietly become a
 * legal-key case the day the constant grows. Throws if every candidate has become legal.
 */
const ILLEGAL_KEY_CANDIDATES = ['tenant', 'workspace', 'region', 'cell'] as const

function anIllegalScopeKey(): string {
  const declared = TRUST_SCOPE_KEYS as readonly string[]
  const found = ILLEGAL_KEY_CANDIDATES.find((candidate) => !declared.includes(candidate))
  if (found === undefined) {
    throw new Error(
      `every candidate scope key (${ILLEGAL_KEY_CANDIDATES.join(', ')}) is now legal in ` +
        `TRUST_SCOPE_KEYS (${declared.join(', ')}); this file can no longer measure a ` +
        'refusal — add a candidate rather than letting the case pass',
    )
  }
  return found
}

describe('the wire leg ranges the ONE scope key set', () => {
  it('CONTROL B (fixed, fixture validity): the wire leg admits a hand-spelled {project, org} scope', () => {
    const scope = { project: 'local-workspace', org: 'acme' }

    expect(
      wireAdmits(scope),
      'CONTROL B RED: the wire leg refused a hand-spelled {project, org} scope. This is a dead ' +
        'fixture or a broken wire contract, not a key-set drift.',
    ).toBe(true)
  })

  it('CONTROL A (constant-ranged): the wire leg admits a scope carrying EVERY declared key', () => {
    const scope = scopeOverEveryDeclaredKey()

    expect(
      wireAdmits(scope),
      'CONTROL A RED on the WIRE leg: TrustScopeSchema refused a scope built from ' +
        `TRUST_SCOPE_KEYS (${(TRUST_SCOPE_KEYS as readonly string[]).join(', ')}). The wire leg is ` +
        'SPELLED APART from the constant — this is key-set drift, NOT a dead fixture.',
    ).toBe(true)
  })

  for (const key of TRUST_SCOPE_KEYS) {
    it(`AGREEMENT: the wire leg admits the single-key scope {${key}}`, () => {
      const scope = { [key]: `value-for-${key}` }

      expect(
        wireAdmits(scope),
        `the wire leg refused the declared key '${key}' — TrustScopeSchema does not range ` +
          'TRUST_SCOPE_KEYS',
      ).toBe(true)
    })
  }

  it('REFUSAL: the wire leg refuses a computed key that the constant does not contain', () => {
    const illegal = anIllegalScopeKey()
    const scope = { [TRUST_SCOPE_KEYS[0]]: 'legal-value', [illegal]: 'smuggled' }

    expect(wireAdmits(scope), `the wire leg ADMITTED the undeclared key '${illegal}'`).toBe(false)
  })

  it('REFUSAL: the wire leg refuses an empty-string scope value (min 1)', () => {
    expect(wireAdmits({ [TRUST_SCOPE_KEYS[0]]: '' })).toBe(false)
  })

  it('KEY-SET IDENTITY: TrustScopeSchema.shape has exactly the keys TRUST_SCOPE_KEYS declares', () => {
    const wireKeys = Object.keys(TrustScopeSchema.shape).sort()
    const declaredKeys = [...(TRUST_SCOPE_KEYS as readonly string[])].sort()

    expect(
      wireKeys,
      'the wire projection and the constant no longer name the same key set',
    ).toEqual(declaredKeys)
  })
})

describe('C432-NO-GRANT-CONTRACTS: the ledger guard leg is gone (432-18)', () => {
  it('C432-NO-GRANT-CONTRACTS: no grant-ledger guard module is left to range the key set', () => {
    expect(existsSync(join(SAFETY_DIR, 'grant-ledger.ts')), 'safety/grant-ledger.ts is still present')
      .toBe(false)
  })

  it('C432-NO-GRANT-CONTRACTS: grant-ops.ts carries the projection and no grant op contract', async () => {
    const module = await import('../grant-ops') as Record<string, unknown>
    expect(Object.keys(module).sort()).toEqual(['TrustScopeSchema'])
  })
})
