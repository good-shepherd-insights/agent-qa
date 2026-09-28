// The remedy memberships after the dashboard left them (Phase 430, D-06), pinned at runtime.
//
// The dashboard renders a refusal's reason only, so it takes no remedy kind, the way run-service
// already takes none. vitest transforms without typechecking, so the membership lists are read
// here as values; the .test-d.ts twin pins the same facts by type.
//
// Imported through the package barrel, so a dropped export reds too.

import { describe, expect, it } from 'vitest'

import {
  GATE_REMEDY_KINDS,
  GATE_REMEDY_SURFACES,
  GATE_REMEDY_SURFACES_BY_KIND,
  remediesRenderableBy,
} from '../../index'

describe('the remedy memberships, exact (430 D-06)', () => {
  // Exact list equality, never containment: a membership holding more fails as loudly as one
  // holding less.
  it('C430-REMEDY-MEMBERSHIPS-EXACT: each kind lists exactly its surfaces', () => {
    expect(Object.keys(GATE_REMEDY_SURFACES_BY_KIND)).toEqual([...GATE_REMEDY_KINDS])
    expect([...GATE_REMEDY_SURFACES_BY_KIND['answer-confirm']]).toEqual(['cli', 'chat'])
    expect([...GATE_REMEDY_SURFACES_BY_KIND['trust-session-flag']]).toEqual(['cli'])
    expect([...GATE_REMEDY_SURFACES_BY_KIND['session-pin-final']]).toEqual(['chat'])
    expect([...GATE_REMEDY_SURFACES_BY_KIND['present-bearer-scope']]).toEqual(['mcp'])
  })

  it('C430-REMEDY-SURFACES-EXACT: the surfaces are exactly the five doors, dashboard kept', () => {
    expect([...GATE_REMEDY_SURFACES]).toEqual(['cli', 'chat', 'mcp', 'dashboard', 'run-service'])
  })

  it('C430-DASHBOARD-PROJECTION-EMPTY: the dashboard takes no remedy of any kind', () => {
    expect(remediesRenderableBy('dashboard', GATE_REMEDY_KINDS.map((kind) => ({ kind })))).toEqual([])
    for (const kind of GATE_REMEDY_KINDS) {
      expect(remediesRenderableBy('dashboard', [{ kind }])).toEqual([])
    }
  })
})
