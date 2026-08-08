// The scope key set has ONE spelling, and the two legs that range it agree BY CONSTRUCTION
// (Phase 391 plan 11, closing G-391-1).
//
// Two readers decide what a scope key is: the structural guard on the committed grant ledger
// (`hasGrantEventShape` -> `isMatchableScope`, which ranges `TRUST_SCOPE_KEYS`) and the strict wire
// projection `TrustScopeSchema`, which `grants.list` parses its OWN output through. A key one leg
// admits and the other refuses is a grant in force that the enumeration verb cannot render — the
// line authorizes at the gate and throws the whole listing away.
//
// THE TWO CONTROLS ARE NOT THE SAME KIND OF CASE, and conflating them is what made the UAT probe
// pass over a dead fixture:
//
//   CONTROL A ranges the constant, so it MOVES when the constant moves. Under a drift mutation that
//     adds a key to the constant alone it is PREDICTED RED against a hand-spelled wire leg. That is
//     the correct answer, not a fault, so its failure message names the wire spelling — never the
//     fixture.
//   CONTROL B is hand-spelled `{project, org}` and ranges NOTHING. It is the only case in this file
//     whose result means the same thing in every cell, so it is the fixture-validity check and it is
//     asserted FIRST. If it reds, the grant event fixture is dead and no other result here means
//     anything.
//
// Every leg is imported RELATIVELY from source, so no case can pass or fail on a stale built dist.

import { describe, expect, it } from 'vitest'

import { CURRENT_GRANT_LEDGER_SCHEMA_VERSION, hasGrantEventShape } from '../grant-ledger'
import { TrustScopeSchema } from '../grant-ops'
import { TRUST_SCOPE_KEYS } from '../trust-credential'

/**
 * A grant event carrying the field names `hasGrantEventShape` ACTUALLY reads, sourced from the
 * guard rather than remembered: `schemaVersion` (from the exported current version), `kind`, `at`,
 * `grantId`, `actionClass`, `scope`. The UAT's probe used `version` / `grantedAt` and the guard
 * refused it before the scope clause ever ran.
 */
function grantEventWithScope(scope: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
    kind: 'grant',
    at: '2026-08-08T12:00:00.000Z',
    grantId: 'grant_scope_probe',
    actionClass: 'fn:knowledge.proposal.apply',
    scope,
  }
}

/** What the structural guard leg says about a scope. */
function guardAdmits(scope: Record<string, unknown>): boolean {
  return hasGrantEventShape(grantEventWithScope(scope))
}

/** What the strict wire leg says about the same scope. */
function wireAdmits(scope: Record<string, unknown>): boolean {
  return TrustScopeSchema.safeParse(scope).success
}

/** Every key the constant declares, each carrying a non-empty value. Ranges the constant. */
function scopeOverEveryDeclaredKey(): Record<string, string> {
  return Object.fromEntries(TRUST_SCOPE_KEYS.map((key) => [key, `value-for-${key}`]))
}

/**
 * A key OUTSIDE the constant, computed rather than typed, so this case cannot quietly become a
 * legal-key case the day the constant grows. Throws if every candidate has become legal — a fixture
 * that cannot find an illegal key must fail loudly rather than fall through to a legal one.
 */
const ILLEGAL_KEY_CANDIDATES = ['tenant', 'workspace', 'region', 'cell'] as const

function anIllegalScopeKey(): string {
  const declared = TRUST_SCOPE_KEYS as readonly string[]
  const found = ILLEGAL_KEY_CANDIDATES.find((candidate) => !declared.includes(candidate))
  if (found === undefined) {
    throw new Error(
      `every candidate scope key (${ILLEGAL_KEY_CANDIDATES.join(', ')}) is now legal in ` +
        `TRUST_SCOPE_KEYS (${declared.join(', ')}); this differential can no longer measure a ` +
        'refusal — add a candidate rather than letting the case pass',
    )
  }
  return found
}

describe('the guard leg and the wire leg range ONE scope key set', () => {
  it('CONTROL B (fixed, fixture validity): both legs admit a hand-spelled {project, org} scope', () => {
    // Hand-spelled ON PURPOSE. This case ranges nothing the rest of the file is measuring, so its
    // result means the same thing in every cell of the drift differential.
    const scope = { project: 'local-workspace', org: 'acme' }

    expect(
      guardAdmits(scope),
      'CONTROL B RED: the grant event FIXTURE is dead — the structural guard refused an event ' +
        'whose scope carries only keys both spellings have always contained. Nothing else measured ' +
        'in this run means anything until the fixture is fixed.',
    ).toBe(true)
    expect(
      wireAdmits(scope),
      'CONTROL B RED: the wire leg refused a hand-spelled {project, org} scope. This is a dead ' +
        'fixture or a broken wire contract, not a key-set drift.',
    ).toBe(true)
  })

  it('CONTROL A (constant-ranged): both legs admit a scope carrying EVERY declared key', () => {
    const scope = scopeOverEveryDeclaredKey()

    expect(
      guardAdmits(scope),
      'CONTROL A RED on the GUARD leg: the structural guard refused a scope built from ' +
        'TRUST_SCOPE_KEYS itself. The guard has stopped ranging the constant.',
    ).toBe(true)
    expect(
      wireAdmits(scope),
      'CONTROL A RED on the WIRE leg: TrustScopeSchema refused a scope built from ' +
        `TRUST_SCOPE_KEYS (${(TRUST_SCOPE_KEYS as readonly string[]).join(', ')}). The wire leg is ` +
        'SPELLED APART from the constant — this is key-set drift, NOT a dead fixture (CONTROL B is ' +
        'the fixture-validity check and it is unaffected by this).',
    ).toBe(true)
  })

  for (const key of TRUST_SCOPE_KEYS) {
    it(`AGREEMENT: both legs admit the single-key scope {${key}}`, () => {
      const scope = { [key]: `value-for-${key}` }

      expect(guardAdmits(scope), `the guard leg refused the declared key '${key}'`).toBe(true)
      expect(
        wireAdmits(scope),
        `the wire leg refused the declared key '${key}' — TrustScopeSchema does not range ` +
          'TRUST_SCOPE_KEYS',
      ).toBe(true)
    })
  }

  it('REFUSAL: both legs refuse a computed key that the constant does not contain', () => {
    const illegal = anIllegalScopeKey()
    const scope = { [TRUST_SCOPE_KEYS[0]]: 'legal-value', [illegal]: 'smuggled' }

    expect(guardAdmits(scope), `the guard leg ADMITTED the undeclared key '${illegal}'`).toBe(false)
    expect(wireAdmits(scope), `the wire leg ADMITTED the undeclared key '${illegal}'`).toBe(false)
  })

  it('KEY-SET IDENTITY: TrustScopeSchema.shape has exactly the keys TRUST_SCOPE_KEYS declares', () => {
    // The assertion that reds the moment the wire leg is spelled apart from the constant again.
    const wireKeys = Object.keys(TrustScopeSchema.shape).sort()
    const declaredKeys = [...(TRUST_SCOPE_KEYS as readonly string[])].sort()

    expect(
      wireKeys,
      'the wire projection and the constant no longer name the same key set',
    ).toEqual(declaredKeys)
  })
})
