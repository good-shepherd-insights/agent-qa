// The conformance & parity suite (Phase 397 plan 01 — FUNC-05 leg 5, D-01 / D-02 / D-03 / D-04).
//
// THE CLAIM. A capability exists iff it is one row in the registry, and every rostered surface
// reaches only rows that exist. This file carries the leg that makes the second half checkable:
// reverse completeness — `surface.enumerate() ⊆ registry.ids()` — asserted per surface, off real
// compositions, with every failure naming the op id and the surface it appeared on.
//
// ONE SUITE, RANGED OVER THE ROSTER AND THE REGISTRY. There is deliberately no `describe` per
// surface: a per-surface block is a place for a surface to acquire its own exceptions, and a claim
// that must hold everywhere has to be written once and driven over the members. Adding a surface
// adds a roster row and nothing here changes; adding a capability adds a registry row and nothing
// here changes. That is the structural half of the claim, and it is why the loops below read their
// per-surface work out of adapter output instead of out of a block.
//
// WHY THE ENUMERATIONS ARE TAKEN ONCE. The MCP side is a real protocol round trip against a real
// server instance. Taking it once and asserting many things about it keeps the cells fast and,
// more importantly, keeps every cell in this file asserting about THE SAME observed surface rather
// than about a fresh one that might differ — which would make a disagreement between two cells
// unattributable.

import { CHAT_RESOLVER_TABLE } from '@vostride/agent-qa-agent'
import { AGENT_QA_TOOL_PROJECTIONS, UNPROJECTED_OPS } from '@vostride/agent-qa-mcp'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CHAT_RESOLVER_PROBES,
  probeResolverTable,
  registryOpIds,
  type SurfaceEnumeration,
} from './adapters.js'
import { SURFACE_ROSTER } from './roster.js'

const enumerations = new Map<string, SurfaceEnumeration>()
let censusIds: readonly string[] = []
let censusIdSet: ReadonlySet<string> = new Set()

beforeAll(async () => {
  censusIds = registryOpIds()
  censusIdSet = new Set(censusIds)
  for (const entry of SURFACE_ROSTER) {
    enumerations.set(entry.id, await entry.adapter.enumerateOpIds())
  }
})

/** The enumeration for one roster id, or a failure that says which surface never produced one. */
function enumerationOf(surfaceId: string): SurfaceEnumeration {
  const enumeration = enumerations.get(surfaceId)
  expect(enumeration, `${surfaceId}: the roster names this surface but no enumeration was taken`)
    .toBeDefined()
  return enumeration as SurfaceEnumeration
}

const sorted = (ids: Iterable<string>): readonly string[] => [...ids].sort()

describe('the parity suite ranges the registry census over every rostered surface', () => {
  it('pins the roster at the two surfaces that exist today', () => {
    // D-04. An exact list rather than a length check or a contains check: a surface REPLACED would
    // pass both of those while the claim quietly moved to a different set of doors.
    expect(SURFACE_ROSTER.map((entry) => entry.id)).toEqual(['chat', 'mcp'])
    for (const entry of SURFACE_ROSTER) {
      expect(entry.adapter.id, `${entry.id}: the roster row and its adapter must name one surface`)
        .toBe(entry.id)
    }
  })

  it('reaches, on every rostered surface, only capabilities the registry declares', async () => {
    // FUNC-05 leg 5, and the driver is the roster with the census as the comparand. Two named REDs
    // per surface: a capability enumerated on the surface that no registry row declares, and a
    // listed door the declared data does not catalogue at all.
    for (const entry of SURFACE_ROSTER) {
      const enumeration = enumerationOf(entry.id)

      expect(
        enumeration.strays.map((stray) => `${stray.kind}: ${stray.name}`),
        `${entry.id}: reachable here and catalogued in no declared table — an uncatalogued capability`,
      ).toEqual([])

      expect(
        enumeration.opIds.size,
        `${entry.id}: enumerated nothing at all, which no surface in this product does`,
      ).toBeGreaterThan(0)

      for (const opId of sorted(enumeration.opIds)) {
        expect(
          censusIdSet.has(opId),
          `${opId} on ${entry.id}: reachable on this surface but absent from the registry census`,
        ).toBe(true)
      }
    }
  })

  it('drives every row of the deterministic chat table, and no row it no longer has', () => {
    // The chat enumeration's own honesty check, and it reds in BOTH directions: a resolver row
    // nothing here probes would enter the surface unwatched, and a probe naming a row that has been
    // deleted would keep this file asserting about an alias that is gone. A register that can only
    // red on one side is half a register.
    const probed = probeResolverTable(CHAT_RESOLVER_TABLE, CHAT_RESOLVER_PROBES)
    expect(probed.unprobedAliases, 'chat resolver rows reaching the surface with nothing driving them')
      .toEqual([])
    expect(probed.unknownProbeAliases, 'probes naming a chat resolver row that no longer exists')
      .toEqual([])
    expect(
      probed.roleMismatches,
      'chat resolver rows whose produced entry disagrees with the kind declared for them',
    ).toEqual([])
    expect(
      probed.targets.length,
      'the chat resolver table bound no capability at all, which would make its half of the '
        + 'enumeration vacuous',
    ).toBeGreaterThan(0)
  })

  it('enumerates over MCP exactly the op set the declared mapping projects', () => {
    // The comparand is DERIVED from the mapping rather than pinned here. Tool names are pinned by
    // the shipped bump guard and re-pinning them in this suite would be a second catalogue: what
    // this cell claims is that the LIVE listing, folded through the declared mapping, reaches the
    // ops that mapping declares — a different claim than the guard's, over a live server.
    const projected = sorted(AGENT_QA_TOOL_PROJECTIONS.flatMap((p) => [...p.ops]))
    expect(sorted(enumerationOf('mcp').opIds), 'the live MCP listing, fold-expanded to op ids')
      .toEqual(projected)
  })

  it('enumerates over chat every capability the registry declares', () => {
    // The chat planner binds the listing 1:1, so the chat surface's reach IS the census — which is
    // what makes the MCP surface's smaller reach a decision rather than an accident.
    expect(sorted(enumerationOf('chat').opIds), 'the chat planner and resolver routes, as op ids')
      .toEqual(sorted(censusIds))
  })

  it('accounts for every declared capability as MCP-reachable or declared-unprojected', () => {
    // The registry is the iteration driver here, and the partition it closes is consumed from the
    // mapping rather than restated: an op reachable over MCP, or an op with a dated reason for not
    // being. An op in neither has landed with nobody having decided anything about it.
    const mcpReach = enumerationOf('mcp').opIds
    const unprojected = new Set(UNPROJECTED_OPS.map((entry) => entry.opId))
    for (const opId of sorted(censusIds)) {
      expect(
        mcpReach.has(opId) !== unprojected.has(opId),
        `${opId} on mcp: must be reachable OR carry a declared unprojected reason — exactly one`,
      ).toBe(true)
    }
    // And the other direction, so a stale scoping-note row cannot sit here forever: every declared
    // unprojected op is a real capability.
    for (const opId of sorted(unprojected)) {
      expect(
        censusIdSet.has(opId),
        `${opId} on mcp: declared unprojected, but the registry declares no such capability`,
      ).toBe(true)
    }
  })
})
