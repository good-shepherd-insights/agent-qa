// RE-SPELLED 2026-10-01 (432-19, D-15). This file pinned the remedy memberships after the dashboard
// left them (Phase 430, D-06): each kind's exact surfaces (C430-REMEDY-MEMBERSHIPS-EXACT), the five
// doors (C430-REMEDY-SURFACES-EXACT) and an empty dashboard projection
// (C430-DASHBOARD-PROJECTION-EMPTY). The execution gate that minted remedies is deleted, and the
// vocabulary goes with it, so every one of those memberships is now empty for the strongest reason
// there is: no kind, no surface table and no projection exist. The .test-d.ts twin pins the same
// absence by type. The plain refusal that replaced every denial is C432-PLAIN-REFUSAL (the mark
// refusal key set in `__tests__/432-deleted-runtime-sets.test.ts`, the run denial at the CLI door).
//
// Imported through the package barrel, so a value that came back through any re-export reds.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as schema from '../../index'
import * as safety from '../index'

const RETIRED_REMEDY_VALUES = [
  'GATE_REMEDY_KINDS',
  'GATE_REMEDY_SURFACES',
  'GATE_REMEDY_SURFACES_BY_KIND',
  'remediesRenderableBy',
] as const

const SAFETY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('the remedy memberships, exact (430 D-06)', () => {
  it('C432-REMEDY-TYPES-ABSENT: no remedy kind, surface table or projection is exported from either barrel', () => {
    for (const name of RETIRED_REMEDY_VALUES) {
      expect(Object.keys(schema), `root: ${name}`).not.toContain(name)
      expect(Object.keys(safety), `safety: ${name}`).not.toContain(name)
    }
    // Non-vacuity: these are the real barrels.
    expect(typeof schema.buildProductionRefusal).toBe('function')
    expect(typeof safety.TRUST_SCOPE_KEYS).toBe('object')
  })

  it('C432-REMEDY-TYPES-ABSENT: the remedy module and the policy-result DTO are deleted; the risk tier stays', () => {
    expect(existsSync(join(SAFETY_DIR, 'remedies.ts'))).toBe(false)
    expect(existsSync(join(SAFETY_DIR, 'risk-tier.ts'))).toBe(true)
  })

  it('C432-REMEDY-TYPES-ABSENT: no denial DTO on any door carries a remedy list', () => {
    // The two shared denial bodies that used to: the run-service 403 and the chat clause denial.
    const runDenial = schema.RunServiceDenialBodySchema
    expect(Object.keys(runDenial.shape).sort()).toEqual(['error', 'neutralReason'])
    expect(runDenial.safeParse({ error: 'run_denied', neutralReason: 'refused' }).success).toBe(true)
    expect(runDenial.safeParse({ error: 'run_denied', neutralReason: 'refused', remedies: [] }).success).toBe(false)
    expect(Object.keys(schema)).not.toContain('ClauseDenialSchema')
    expect(Object.keys(schema.AgentAskResultSchema.shape)).not.toContain('denials')
  })
})
