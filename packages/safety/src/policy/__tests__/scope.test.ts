import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

// RE-SPELLED 2026-10-01 (432-19, D-15). This file pinned `scopeMatches` and `grantCovers`, the
// gate's credential and standing-approval scope checks (exact-scope matching, org-only refusal, and
// the leg that ranged the published TRUST_SCOPE_KEYS so no declared key could widen a grant). The
// gate is deleted and nothing authorizes by scope any more, so the module goes with it.
// 2026-10-02 (432-42, D-12): the scope key SET is deleted from schema too (it ranged nothing), so the
// non-vacuity leg below is re-spelled to its absence.
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
    // RE-SPELLED 2026-10-02 (432-42): the key set is published nowhere; the schema barrel is the real one.
    expect(Object.keys(schema)).not.toContain('TRUST_SCOPE_KEYS')
    expect(Object.keys(schema)).toContain('FUNCTION_CALLER_ORIGINS')
  })
})
