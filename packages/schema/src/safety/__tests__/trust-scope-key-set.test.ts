// What this file measures (Phase 391 plan 11, closing G-391-1; re-spelled by 432-18 and 432-22).
//
// It was a two-leg differential between the scope key set `TRUST_SCOPE_KEYS` and the strict wire
// projection `TrustScopeSchema`. 432-18 deleted the ledger guard leg. 2026-10-01 (432-22, D-03/D-12):
// the run-service token DTO, the projection's last consumer, is deleted with
// `services.dashboard.runServiceTokens`, so the wire leg and its module (`grant-ops.ts`) are deleted
// too and their absence is pinned below.
//
// WHAT SURVIVES: the key set itself, which the retained `TrustScope` / `TrustCredential` caller types
// still range until 432-39 removes the optional caller fields. CONTROL B stays hand-spelled and
// ranges nothing; the key-union pin in `trust-credential.ts` holds the constant against the DTO at
// compile time.
//
// Every leg is imported RELATIVELY from source, so no case can pass or fail on a stale built dist.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as safety from '../index'
import * as trustCredential from '../trust-credential'
import { TRUST_SCOPE_KEYS } from '../trust-credential'

const SAFETY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(SAFETY_DIR, '..')

describe('the ONE scope key set', () => {
  it('CONTROL B (fixed, fixture validity): the key set is exactly the hand-spelled {project, org}', () => {
    expect(
      [...TRUST_SCOPE_KEYS],
      'CONTROL B RED: TRUST_SCOPE_KEYS no longer spells {project, org}. The caller types range it; ' +
        'a key added here must be added to TrustScope too (the compile-time pin enforces that).',
    ).toEqual(['project', 'org'])
  })

  it('the safety barrel publishes the key set and nothing that parses a scope', () => {
    expect((safety as Record<string, unknown>).TRUST_SCOPE_KEYS).toEqual(['project', 'org'])
    expect(Object.keys(trustCredential).sort()).toEqual(['TRUST_SCOPE_KEYS'])
  })
})

describe('C432-NO-TRUST-CONTRACT: the wire leg is gone (432-22)', () => {
  it('C432-NO-TRUST-CONTRACT: no grant-ledger guard and no projection module is left to range the key set', () => {
    expect(existsSync(join(SAFETY_DIR, 'grant-ledger.ts')), 'safety/grant-ledger.ts is still present').toBe(false)
    expect(existsSync(join(SAFETY_DIR, 'grant-ops.ts')), 'safety/grant-ops.ts is still present').toBe(false)
  })

  it('C432-NO-TRUST-CONTRACT: the safety barrel exports no trust-scope schema', () => {
    expect(Object.keys(safety).filter(name => /TrustScope/.test(name))).toEqual([])
  })

  it('C432-NO-TRUST-CONTRACT: no schema source spells the projection any more', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path)
        } else if (entry.name.endsWith('.ts') && readFileSync(path, 'utf8').includes('TrustScope' + 'Schema =')) {
          offenders.push(path)
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
