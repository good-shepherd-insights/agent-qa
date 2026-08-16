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

import { MCP_DEFAULT_GRANTED_SCOPES } from '../../commands/mcp.js'
import {
  CHAT_RESOLVER_PROBES,
  chatEnumerationOf,
  enumerateMcpOpIds,
  expandMcpListedTools,
  probeResolverTable,
  registryDeclarations,
  registryOpIds,
  type ResolverOpTarget,
  type SurfaceEnumeration,
} from './adapters.js'
import { SURFACE_ROSTER } from './roster.js'

/**
 * What the control cells plant, and it exists nowhere else in this product.
 *
 * NAMED CONSTANTS rather than literals buried in the cells, because 397-09's mutation script has to
 * be able to tell the control cells' own synthetic strays apart from the strays IT plants: a script
 * that grepped for a generic name would read this file's deliberate fixture as the defect it went
 * looking for.
 */
const SYNTHETIC_UNCATALOGUED_TOOL = 'agent_qa_control_uncatalogued_397_01'

const SYNTHETIC_STRAY_ALIAS_TARGET: ResolverOpTarget = Object.freeze({
  alias: 'control-stray-397-01',
  functionId: 'control.stray.397.01',
})

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

  // ---- The control cells: proof that the two detectors above can FIRE --------------------------
  //
  // A detector nobody has seen fire is a comment. Every cell before this one asserts an ABSENCE —
  // no stray tool, no stray alias — and an absence is exactly what a detector that cannot detect
  // reports. The two cells below drive the pure cores with synthetic input, so the branches are
  // exercised without mutating a shipped file and without a skip-list anywhere. Each also feeds a
  // CLEAN input in the same cell, because a detector that fires on everything is no better than one
  // that fires on nothing.
  //
  // 397-09's mutation script names these two cells: they are what makes its "an allowed cell failed
  // to red" side of the discrimination meaningful.

  it('control: the MCP stray-tool branch fires on a listed tool the mapping does not catalogue', () => {
    const catalogued = AGENT_QA_TOOL_PROJECTIONS[0]
    expect(catalogued, 'the declared mapping projects no tool at all').toBeDefined()

    const clean = expandMcpListedTools([catalogued!.name], AGENT_QA_TOOL_PROJECTIONS)
    expect(clean.strayTools, 'a catalogued listing must produce no stray').toEqual([])
    expect(sorted(clean.opIds), 'a catalogued tool expands to its declared ops').toEqual(
      sorted(catalogued!.ops),
    )

    const planted = expandMcpListedTools(
      [catalogued!.name, SYNTHETIC_UNCATALOGUED_TOOL],
      AGENT_QA_TOOL_PROJECTIONS,
    )
    expect(
      planted.strayTools,
      'a listed tool absent from the declared mapping must be reported by name',
    ).toEqual([SYNTHETIC_UNCATALOGUED_TOOL])
    // And the op ids are UNCHANGED by the stray: an uncatalogued tool expands to nothing, which is
    // precisely why its absence from the mapping has to be reported rather than inferred from a
    // shortfall in the op set.
    expect(sorted(planted.opIds), 'a stray tool contributes no op id').toEqual(
      sorted(catalogued!.ops),
    )
  })

  it('control: the chat stray-alias branch fires on an alias target the registry does not declare', () => {
    const realTarget = { alias: 'status', functionId: censusIds[0]! }

    const clean = chatEnumerationOf([], [realTarget], censusIdSet)
    expect(clean.strayAliasTargets, 'an alias bound to a declared op must produce no stray').toEqual(
      [],
    )
    expect(sorted(clean.opIds), 'a declared alias target is counted into the reach').toEqual([
      realTarget.functionId,
    ])

    const planted = chatEnumerationOf(
      [],
      [realTarget, SYNTHETIC_STRAY_ALIAS_TARGET],
      censusIdSet,
    )
    expect(
      planted.strayAliasTargets,
      'an alias bound to something the registry does not declare must be reported by alias and id',
    ).toEqual([SYNTHETIC_STRAY_ALIAS_TARGET])
    // Counted in as well as reported, which is what lets the reverse-completeness leg above red on
    // this same defect rather than leaving one leg to carry it alone.
    expect(
      planted.opIds.has(SYNTHETIC_STRAY_ALIAS_TARGET.functionId),
      'a stray alias target is part of what the surface reaches, not merely a diagnostic',
    ).toBe(true)
  })

  it('pins the config-write listing delta between the every-scope and the default MCP grant', async () => {
    // The surface-absence wall, measured. MCP visibility is a scope-union subset check, so a tool
    // whose fold touches an op requiring `config-write` is not registered at all on a default
    // caller's instance — the door is absent rather than refusing. This is the foundation the D-11
    // refuse points build on in 397-04, and it is pinned here as a PRODUCED set: the expectation is
    // the mapping's rows joined to the declarations' own `requiredScopes`, never a pair of tool
    // names typed into this cell.
    const declarationsById = new Map(
      registryDeclarations().map((declaration) => [declaration.id, declaration]),
    )
    const expectedDelta = sorted(
      AGENT_QA_TOOL_PROJECTIONS.filter((projection) =>
        projection.ops.some((opId) =>
          (declarationsById.get(opId)?.requiredScopes ?? []).includes('config-write'),
        ),
      ).flatMap((projection) => [...projection.ops]),
    )
    expect(
      expectedDelta.length,
      'no declared tool touches config-write, so this cell would assert nothing',
    ).toBeGreaterThan(0)

    const everyScope = enumerationOf('mcp')
    const defaultGrant = await enumerateMcpOpIds(MCP_DEFAULT_GRANTED_SCOPES)
    expect(
      defaultGrant.strays,
      'mcp under the default grant: an uncatalogued door in the reduced listing',
    ).toEqual([])

    const delta = sorted([...everyScope.opIds].filter((opId) => !defaultGrant.opIds.has(opId)))
    expect(
      delta,
      'the ops the default MCP grant cannot see — exactly the config-write folds, derived from the '
        + 'mapping joined to the declarations',
    ).toEqual(expectedDelta)
    // The other direction: the reduced grant reaches nothing the full grant does not, so the delta
    // is a subtraction rather than two different surfaces.
    expect(
      sorted([...defaultGrant.opIds].filter((opId) => !everyScope.opIds.has(opId))),
      'ops visible ONLY to the reduced grant, which no scope filter can produce',
    ).toEqual([])
  })
})
