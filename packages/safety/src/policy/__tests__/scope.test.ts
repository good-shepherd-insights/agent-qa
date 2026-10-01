import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TRUST_SCOPE_KEYS } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

// RE-SPELLED 2026-10-01 (432-19, D-15). This file pinned `scopeMatches` and `grantCovers`, the
// gate's credential and standing-approval scope checks (exact-scope matching, org-only refusal, and
// the leg that ranged the published TRUST_SCOPE_KEYS so no declared key could widen a grant). The
// gate is deleted and nothing authorizes by scope any more, so the module goes with it. The scope
// key SET is still published by schema (its own differential lives in
// `schema/src/safety/__tests__/trust-scope-key-set.test.ts`); safety simply no longer reads it.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('C432-NO-ASK-PORTS: no scope check authorizes anything in safety', () => {
  it('C432-NO-ASK-PORTS: the scope policy module and its two matchers are gone', () => {
    expect(existsSync(join(SRC, 'policy', 'scope.ts'))).toBe(false)
    expect(Object.keys(safety)).not.toContain('scopeMatches')
    expect(Object.keys(safety)).not.toContain('grantCovers')
  })

  it('C432-NO-ASK-PORTS: no safety production source ranges the trust scope key set', () => {
    const texts: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path)
        } else if (entry.name.endsWith('.ts')) {
          texts.push(readFileSync(path, 'utf8'))
        }
      }
    }
    walk(SRC)
    expect(texts.length).toBeGreaterThan(20)
    expect(texts.filter((text) => text.includes('TRUST_SCOPE_KEYS'))).toEqual([])
    // Non-vacuity: the key set is still published where it lives.
    expect(TRUST_SCOPE_KEYS.length).toBeGreaterThan(0)
  })
})
