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

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { invokeFunction, CHAT_RESOLVER_TABLE } from '@vostride/agent-qa-agent'
import { CHAT_STAGE_SCOPES } from '@vostride/agent-qa-agent-local'
import {
  AGENT_QA_OP_CONTRACTS,
  AGENT_QA_TOOL_PROJECTIONS,
  UNPROJECTED_OPS,
} from '@vostride/agent-qa-mcp'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MCP_DEFAULT_GRANTED_SCOPES } from '../../commands/mcp.js'
import {
  CHAT_RESOLVER_PROBES,
  chatEnumerationOf,
  conformanceRegistry,
  enumerateMcpOpIds,
  expandMcpListedTools,
  listMcpToolNames,
  plausibleMcpToolSpelling,
  probeResolverTable,
  registryDeclarations,
  registryOpIds,
  withMcpClient,
  type ConformanceRegistryOptions,
  type ResolverOpTarget,
  type SurfaceEnumeration,
} from './adapters.js'
import {
  ASK_CAPABLE_OP_IDS,
  CONFORMANCE_EXECUTION_CONTEXT,
  conformanceResolveExecutionContext,
  coveringCallerFor,
  deriveAskCapableOpIds,
  EVERY_ASK_STANDING_APPROVED,
  refusingCallerFor,
  surfaceInertCallers,
  surfaceShapedCallers,
  type RiskClassifiable,
} from './policy-fixtures.js'
import { SURFACE_ROSTER } from './roster.js'
import {
  driveChatDispatch,
  driveMcpCall,
  genericFnClause,
  pinClassFor,
} from './surface-dispatch.js'
import {
  censusDiff,
  OP_INPUT_CONTRACTS,
  SCENARIO_TABLE,
  scenarioRowFor,
  scenarioTableOpIds,
  UNPROJECTED_REASON_SIGNATURES,
  unprojectedReasonKeyOf,
  type ScenarioOpId,
} from './scenario-table.js'

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

/**
 * Plan 03's own synthetic fixtures, named for THIS plan (never reusing 397-01's).
 *
 * Same reason the 397-01 constants above carry their plan number: 397-09's mutation script has to
 * tell each plan's deliberate fixtures from the strays it plants, and a shared name would make one
 * suite's control cell read as another suite's defect.
 */
const SYNTHETIC_UNCARRIED_OP_ID = 'control.uncarried.397.03'
const SYNTHETIC_STRAY_ROW_OP_ID = 'control.stray.row.397.03'
const SYNTHETIC_ABSENT_OP_ID = 'control.absent.397.03'
const SYNTHETIC_UNCLASSIFIABLE_REASON = 'control 397-03: prose in no declared class'
const SYNTHETIC_ASKING_OP_ID = 'fn:control.asking.397.03'
const SYNTHETIC_NON_ASKING_OP_ID = 'fn:control.reading.397.03'
const SYNTHETIC_LOCAL_OP_ID = 'fn:control.local.397.03'

/**
 * Plan 04's own synthetic fixtures, named for the plan that plants them.
 *
 * 397-09's mutation script tells a plan's deliberate strays from the ones IT plants by name, so
 * each plan's constants carry its number and no plan reuses another's.
 */
const SYNTHETIC_DRIVER_ABSENT_OP_ID = 'control.absent.397.04'

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

/** This directory, so a source assertion reads the file it names rather than a path it guessed. */
const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url))

/** A source file with its comments removed, so a header may name what its body must not contain. */
function commentStrippedSource(fileName: string): string {
  return readFileSync(join(CONFORMANCE_DIR, fileName), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

// ---- The gate wall (Phase 397 plan 04, D-11) ---------------------------------------------------

/**
 * Where one invocation stopped, as a comparable answer.
 *
 * A CLOSED, ORDERED VOCABULARY rather than a boolean or an error instance, because the two things
 * the verdict legs ask are "did these two callers get the same answer" and "is that answer one that
 * means the gate was consulted at all". A boolean can say the first and not the second, and a cell
 * that could not say the second would report policy identity over two identical INPUT errors —
 * which is two callers agreeing about a fixture rather than about a policy.
 *
 * The bands follow `invoke.ts`'s pinned order: `refused-input`/`refused-unknown` are pre-gate and
 * pre-caller, `refused-scope`/`refused-origin` are the pre-gate CALLER band, `gate-denied` is the
 * gate's own answer, and the two `allowed-` members are places only a call the gate ALLOWED can
 * reach (step 6's binding check, and step 7's dispatch).
 */
type GateAnswerKind =
  | 'refused-unknown'
  | 'refused-input'
  | 'refused-scope'
  | 'refused-origin'
  | 'gate-denied'
  | 'allowed-unbound'
  | 'allowed-dispatched'

interface GateAnswer {
  readonly kind: GateAnswerKind
  /** The scopes the refusal named, where it named any — so a refusal is attributable. */
  readonly missingScopes: readonly string[]
}

/**
 * Ask the gate about one capability, on behalf of one caller, and report where the call stopped.
 *
 * The call is a REAL `invokeFunction` against the shipped registry: the same eight steps, in the
 * same order, that every surface's dispatch crosses. What differs from a surface drive is only who
 * is asking — which is the point, since this wall exists to answer independently of any surface.
 */
async function gateAnswerFor(
  opId: string,
  input: unknown,
  caller: Parameters<typeof invokeFunction>[3],
  options: ConformanceRegistryOptions = {
    resolveExecutionContext: conformanceResolveExecutionContext,
  },
): Promise<GateAnswer> {
  const registry = conformanceRegistry(options)
  try {
    await invokeFunction(registry, opId, input, caller)
    return { kind: 'allowed-dispatched', missingScopes: [] }
  } catch (thrown) {
    const error = thrown as { name?: string; missingScopes?: readonly string[] }
    switch (error.name) {
      case 'UnknownFunctionError':
        return { kind: 'refused-unknown', missingScopes: [] }
      case 'FunctionInputError':
        return { kind: 'refused-input', missingScopes: [] }
      case 'FunctionScopeError':
        return { kind: 'refused-scope', missingScopes: [...(error.missingScopes ?? [])] }
      case 'FunctionOriginError':
        return { kind: 'refused-origin', missingScopes: [] }
      case 'FunctionDeniedError':
        return { kind: 'gate-denied', missingScopes: [] }
      case 'FunctionNotBoundError':
        // The gate ALLOWED and this composition cannot run it — step 6, which is only reachable
        // past step 5. Deliberately not lumped in with the refusals: "refused" and "allowed but
        // unrunnable here" are the disagreement `resolveBindingStatus` exists to prevent.
        return { kind: 'allowed-unbound', missingScopes: [] }
      default:
        // A dependency that is not there, reached because the gate let the call through to step 7.
        return { kind: 'allowed-dispatched', missingScopes: [] }
    }
  }
}

/** The answers that mean the call reached the gate band — i.e. that a verdict was actually taken. */
const REACHED_THE_GATE: readonly GateAnswerKind[] = Object.freeze([
  'gate-denied',
  'allowed-unbound',
  'allowed-dispatched',
])

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

  // ---- The census: ONE denominator, asserted in both directions (397-03, D-10 / D-15) ----------

  it('carries exactly one scenario row per registered capability, in both directions', () => {
    // 2026-08-16 · D-15: THIS CELL IS SC-4's CI RULE. The suite is an ordinary vitest suite inside
    // `turbo run test`, so it already runs in the workspace CI job on every PR — which means "a new
    // capability landed without a parity scenario" is a structurally named RED there, by op id, in
    // the existing job. There is deliberately no second mechanism: a diff-parsing check would be a
    // rule about what a patch looks like rather than about what the product contains, and the two
    // would disagree the first time a capability arrived by any route the parser did not model.
    //
    // BOTH DIRECTIONS, because a census that only checks one is the register that never notices it
    // has stopped growing (D-10). `censusDiff`'s ability to fire on each side is proven by the
    // control cell below rather than assumed from this cell's green.
    const diff = censusDiff(registryOpIds(), scenarioTableOpIds())
    expect(
      diff.missing,
      'capabilities the registry declares that no scenario row carries — add a row to the scenario '
        + 'table (this is SC-4: a capability without a scenario is not shippable)',
    ).toEqual([])
    expect(
      diff.stray,
      'scenario rows naming a capability the registry no longer declares — delete the row',
    ).toEqual([])
    // …and the census is not empty, which every line above would pass on.
    expect(scenarioTableOpIds().length, 'the scenario table is empty').toBeGreaterThan(0)
  })

  it('control: the census self-check fires on a missing row AND on a stray row', () => {
    // The Edge-Coverage-Register lesson, made mechanical. Each side is driven with synthetic input
    // so the branch is exercised without mutating a shipped file and without a skip, and a CLEAN
    // input is fed in the same cell — a self-check that fires on everything certifies as little as
    // one that fires on nothing.
    const census = registryOpIds()

    expect(censusDiff(census, census), 'identical id sets must diff to nothing').toEqual({
      missing: [],
      stray: [],
    })

    const withARowMissing = census.filter((id) => id !== census[0])
    expect(
      censusDiff([...census, SYNTHETIC_UNCARRIED_OP_ID], census).missing,
      'a registered capability carried by no row must be named on the missing side',
    ).toEqual([SYNTHETIC_UNCARRIED_OP_ID])
    expect(
      censusDiff(census, withARowMissing).missing,
      'a row deleted from the table must be named on the missing side',
    ).toEqual([census[0]])

    expect(
      censusDiff(census, [...census, SYNTHETIC_STRAY_ROW_OP_ID]).stray,
      'a row naming a capability the registry does not declare must be named on the stray side',
    ).toEqual([SYNTHETIC_STRAY_ROW_OP_ID])
  })

  // ---- The rows are typed against the ops' OWN contracts, and it is checkable (D-09) -----------

  it('types every scenario input against the contract the registry itself published for that op', () => {
    // The compile-time guarantee D-09 chose TypeScript for is only worth what the PAIRING is worth:
    // a row typed against the wrong op's schema would compile happily and certify nothing. So the
    // pairing is asserted two ways, and neither is a re-derivation of a contract.
    //
    // (a) OBJECT IDENTITY, wherever a published handle exists. `AGENT_QA_OP_CONTRACTS` names the
    //     live schemas for the 22 projected ops; `toBe` is the strongest available statement that
    //     the table holds the same object rather than a lookalike.
    // (b) For all 41, the PROJECTION relation: the schema the table paired, projected the way the
    //     registry projects it, must equal the projection the registry itself published on the
    //     declaration. That reaches the 19 ops no surface publishes a handle for.
    const declarations = registryDeclarations()
    let identityChecked = 0

    for (const declaration of declarations) {
      const paired = OP_INPUT_CONTRACTS[declaration.id as ScenarioOpId]
      expect(paired, `${declaration.id}: the scenario table pairs no input contract`).toBeDefined()

      const published = AGENT_QA_OP_CONTRACTS[declaration.id]
      if (published !== undefined) {
        expect(
          paired as unknown,
          `${declaration.id}: the table's contract must BE the object the MCP mapping projects, `
            + 'not an equal-looking copy',
        ).toBe(published.input as unknown)
        identityChecked += 1
      }

      expect(
        z.toJSONSchema(paired, { io: 'input' }),
        `${declaration.id}: the paired contract projects to a different document than the one the `
          + 'registry published on this declaration — the table is typed against another op',
      ).toEqual(declaration.input)
    }

    // …and the identity half actually ran over the projected partition rather than zero ops.
    expect(
      identityChecked,
      'no op contract was checked by identity, which the projected partition makes impossible',
    ).toBe(Object.keys(AGENT_QA_OP_CONTRACTS).length)
  })

  it('holds an invocation fixture every op would accept — the 384 samples, still valid', () => {
    // D-10's fold made the scenario row the invocation sample, so the sample's original obligation
    // travels with it: `invokeFunction` validates input BEFORE it consults binding, and a fixture
    // that stopped parsing would make 397-04's refusal legs report an input error while looking
    // like they had measured a policy verdict.
    for (const row of SCENARIO_TABLE) {
      const parsed = OP_INPUT_CONTRACTS[row.opId].safeParse(row.input)
      expect(
        parsed.success ? '' : JSON.stringify(parsed.error.issues),
        `${row.opId}: the scenario input no longer satisfies this op's own input contract`,
      ).toBe('')
    }
  })

  // ---- D-12: per-surface row data, joined to the shipped tables in BOTH directions -------------

  it('joins every row MCP expectation to the declared mapping, in both directions', () => {
    const toolByOpId = new Map<string, string>()
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      for (const opId of projection.ops) toolByOpId.set(opId, projection.name)
    }
    const unprojectedByOpId = new Map(UNPROJECTED_OPS.map((entry) => [entry.opId, entry]))

    // Direction 1 — every row's claim must be true of the mapping.
    for (const row of SCENARIO_TABLE) {
      const mcp = row.perSurface.mcp
      if ('unprojected' in mcp) {
        expect(
          toolByOpId.get(row.opId),
          `${row.opId} on mcp: the row claims unprojected, but the mapping projects it through a tool`,
        ).toBeUndefined()
        const shipped = unprojectedByOpId.get(row.opId)
        expect(
          shipped?.reason,
          `${row.opId} on mcp: the row claims unprojected, but the mapping carries no reason for it`,
        ).toBeDefined()
        expect(
          unprojectedReasonKeyOf(shipped!.reason),
          `${row.opId} on mcp: the row cites the ${mcp.unprojected} class, and the mapping's own `
            + 'reason is no longer written in it — scoping drift',
        ).toBe(mcp.unprojected)
      } else {
        expect(
          unprojectedByOpId.has(row.opId),
          `${row.opId} on mcp: the row claims a tool, but the mapping declares it unprojected`,
        ).toBe(false)
        expect(
          toolByOpId.get(row.opId),
          `${row.opId} on mcp: the row names a tool the mapping does not project it through`,
        ).toBe(mcp.reachable.tool)
      }
    }

    // Direction 2 — every mapping row must be true of the table. A row silently deleted, or one
    // whose partition moved without its row following, is named here rather than in a shortfall.
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      for (const opId of projection.ops) {
        expect(
          scenarioRowFor(opId)?.perSurface.mcp,
          `${opId} on mcp: projected by ${projection.name}, and its scenario row does not say so`,
        ).toEqual({ reachable: { tool: projection.name } })
      }
    }
    for (const entry of UNPROJECTED_OPS) {
      const mcp = scenarioRowFor(entry.opId)?.perSurface.mcp
      expect(
        mcp !== undefined && 'unprojected' in mcp,
        `${entry.opId} on mcp: declared unprojected by the mapping, and its scenario row claims reach`,
      ).toBe(true)
    }
  })

  it('classifies every shipped unprojected reason into exactly one declared class', () => {
    // The register's own self-check on the reason vocabulary. An unprojected op written with prose
    // outside the declared classes must RED rather than be filed under whichever class happened to
    // match last — "we scoped this out" and "this can never work here" are the two answers a reader
    // needs to be able to tell apart, and the second is the one D-03 wrote for `agent.ask`.
    const unclassifiable = UNPROJECTED_OPS.filter(
      (entry) => unprojectedReasonKeyOf(entry.reason) === undefined,
    ).map((entry) => entry.opId)
    expect(
      unclassifiable,
      'unprojected ops whose reason falls into no declared class — extend the vocabulary in '
        + 'scenario-table.ts, or write the reason in an existing class',
    ).toEqual([])
    expect(UNPROJECTED_OPS.length, 'the mapping declares no unprojected op at all').toBeGreaterThan(
      0,
    )
  })

  it('control: the reason classifier answers per class, and refuses prose it does not know', () => {
    for (const [key, signature] of UNPROJECTED_REASON_SIGNATURES) {
      expect(
        unprojectedReasonKeyOf(`a reason mentioning ${signature} and nothing else`),
        `${key}: its own signature must classify as it`,
      ).toBe(key)
    }
    expect(
      unprojectedReasonKeyOf(SYNTHETIC_UNCLASSIFIABLE_REASON),
      'prose in no declared class must classify as nothing rather than as the last class tried',
    ).toBeUndefined()
    // …and precedence is a DECISION rather than an accident of iteration order: a reason carrying
    // two signatures answers with the stronger one, which is what `grants.revoke` relies on.
    expect(
      unprojectedReasonKeyOf('declares requiresHumanOrigin. Not a mid-flight workflow write.'),
      'a reason in two classes must answer with the higher-precedence one',
    ).toBe('requires-human-origin')
  })

  it('joins every row chat expectation to the live chat enumeration, in both directions', () => {
    const chatReach = enumerationOf('chat').opIds
    for (const row of SCENARIO_TABLE) {
      expect(
        chatReach.has(row.opId),
        `${row.opId} on chat: the row claims reachable=${String(row.perSurface.chat.reachable)}, `
          + 'and the live composition disagrees',
      ).toBe(row.perSurface.chat.reachable)
    }
    for (const opId of sorted(chatReach)) {
      expect(
        scenarioRowFor(opId)?.perSurface.chat.reachable,
        `${opId} on chat: reachable in the live composition and claimed by no row`,
      ).toBe(true)
    }
  })

  // ---- D-12: the ASSERTED absences. No skip-list — a skip asserts nothing --------------------

  it('asserts the absence of every unprojected op over MCP: no fold, and no door of its own', async () => {
    const listed = await listMcpToolNames()
    const projectedOpIds = new Set(AGENT_QA_TOOL_PROJECTIONS.flatMap((p) => [...p.ops]))
    const unprojectedRows = SCENARIO_TABLE.filter((row) => 'unprojected' in row.perSurface.mcp)

    // The loop's own non-vacuity: it must range the whole declared unprojected partition, so a
    // table that quietly stopped claiming absences cannot make this cell pass by iterating nothing.
    expect(
      unprojectedRows.map((row) => row.opId).sort(),
      'the rows claiming unprojected must be exactly the mapping unprojected partition',
    ).toEqual(UNPROJECTED_OPS.map((entry) => entry.opId).sort())

    await withMcpClient(async (client) => {
      for (const row of unprojectedRows) {
        const mcp = row.perSurface.mcp as { readonly unprojected: string }
        const label = `${row.opId} on mcp (${mcp.unprojected})`

        // Wall 1: nothing the surface lists folds to it.
        expect(
          projectedOpIds.has(row.opId),
          `${label}: declared unprojected and reachable through a listed tool`,
        ).toBe(false)

        // Wall 2: the door does not exist under the spelling a caller would reach for. Read off the
        // REAL client/handler round trip rather than inferred from the mapping — the mapping is one
        // of the two artifacts this cell is comparing, so believing it about itself would be the
        // comparison of a table against itself the whole suite refuses.
        const spelling = plausibleMcpToolSpelling(row.opId)
        expect(
          listed,
          `${label}: the probe spelling collides with a live tool, so this cell would be calling a `
            + 'capability rather than probing an absence',
        ).not.toContain(spelling)
        await expect(
          client.callTool({ name: spelling, arguments: {} }),
          `${label}: a direct tools/call must answer unknown-tool`,
        ).rejects.toThrow(`Tool ${spelling} not found`)
      }
    })
  })

  it('control: the unknown-tool probe tells an absent door from a present one', async () => {
    // An asserted absence is worth exactly what the probe's ability to see a PRESENCE is worth. The
    // same call shape is sent to a name that exists and to one that does not, and the two answers
    // are different in kind: a registered tool answers in-band (an input-validation result), an
    // unregistered one is refused by the protocol before any tool is reached.
    const listed = await listMcpToolNames()
    const present = listed[0]
    expect(present, 'the live server listed no tool at all').toBeDefined()

    await withMcpClient(async (client) => {
      const absent = plausibleMcpToolSpelling(SYNTHETIC_ABSENT_OP_ID)
      expect(listed, 'the synthetic absent name must not be a live tool').not.toContain(absent)
      await expect(
        client.callTool({ name: absent, arguments: {} }),
        'a name no tool carries must be refused as unknown',
      ).rejects.toThrow(`Tool ${absent} not found`)

      const answered = await client.callTool({
        name: present!,
        arguments: { agent_qa_control_397_03: true },
      })
      expect(
        JSON.stringify(answered),
        `${present}: a REGISTERED tool must not answer the unknown-tool refusal, or the probe `
          + 'above would fire on every tool in the catalogue',
      ).not.toContain('not found')
    })
  })

  // ---- D-11: the ask set is PRODUCED by the shipped classifier, then pinned -------------------

  it('pins an ask-capable set equal to a fresh run of the shipped gate over the census', async () => {
    // T-397-07. The pin exists so a reader can see which capabilities stop and ask a person before
    // they act; this cell exists so the pin cannot quietly stop being true. A lexicon edit, a
    // declared-tier change or a new op arriving at `mutating-shared` reds HERE, by op id, rather
    // than silently re-scoping the ask points 397-04's verdict legs are driven from.
    const derived = await deriveAskCapableOpIds(registryDeclarations())
    expect(
      derived,
      'the pinned ask-capable set no longer equals what the shipped gate produces over the census',
    ).toEqual([...ASK_CAPABLE_OP_IDS].sort())
    expect(derived.length, 'no capability in this product can ask anyone anything').toBeGreaterThan(
      0,
    )
    expect(
      derived.length,
      'every capability asks, which would make the ask point say nothing about any of them',
    ).toBeLessThan(registryOpIds().length)

    // …and the injected context is LOAD-BEARING rather than decorative, which is the whole of
    // Pitfall 3 stated as a measurement: under any other context the gate fails closed before an
    // ask can be observed, so a fixture that read the ambient environment would report an EMPTY ask
    // set on precisely the machine (a CI runner) this suite exists to be believed on.
    expect(
      await deriveAskCapableOpIds(registryDeclarations(), 'ci'),
      'the derivation is indifferent to its execution context, so injecting one measures nothing',
    ).toEqual([])
  })

  it('control: the ask derivation tells an asking risk class from a non-asking one', () => {
    // The derivation reports an ABSENCE for 36 of 41 ops, and an absence is what a derivation that
    // cannot detect anything also reports. Synthetic descriptors drive both branches: a tier that
    // reaches the confirm port and two that do not, under the same injected context.
    const probes = [
      {
        id: SYNTHETIC_ASKING_OP_ID,
        risk: { name: SYNTHETIC_ASKING_OP_ID, recognized: true, declaredTier: 'mutating-shared' },
      },
      {
        id: SYNTHETIC_NON_ASKING_OP_ID,
        risk: { name: SYNTHETIC_NON_ASKING_OP_ID, recognized: true, readOnly: true },
      },
      {
        id: SYNTHETIC_LOCAL_OP_ID,
        risk: { name: SYNTHETIC_LOCAL_OP_ID, recognized: true, declaredTier: 'mutating-local' },
      },
    ] as const satisfies readonly RiskClassifiable[]

    return expect(deriveAskCapableOpIds(probes)).resolves.toEqual([SYNTHETIC_ASKING_OP_ID])
  })

  it('carries an ask policy point on exactly the ops that can ask, in both directions', () => {
    const rowsWithAsk = SCENARIO_TABLE.filter((row) => row.policyPoints.ask !== undefined)
      .map((row) => row.opId)
      .sort()
    expect(
      rowsWithAsk,
      'the rows declaring an ask policy point must be exactly the derived ask-capable set — a row '
        + 'short is a verdict nobody asserts, a row over is a verdict that cannot happen',
    ).toEqual([...ASK_CAPABLE_OP_IDS].sort())
    // …and the other direction is a different statement: every ask-capable op has a ROW at all.
    for (const opId of ASK_CAPABLE_OP_IDS) {
      expect(
        scenarioRowFor(opId)?.policyPoints.ask,
        `${opId}: the shipped classifier can ask for this capability and no scenario row says so`,
      ).toBe('ask')
    }
  })

  it('derives its policy fixtures from the declarations, and never from the ambient environment', () => {
    // Pitfall 3, as a source assertion rather than a hope. The gate branches on
    // `requiresFailClosed(ctx)`, and the shipped resolver answers `ci` wherever CI markers are set —
    // so a fixture that read the ambient context would compute one ask set on a laptop and a
    // different one on the PR that is supposed to be checking it. Comments are stripped BEFORE the
    // sweep, because the file's own header names these very identifiers to explain why it avoids
    // them, and a grep that counted prose would make the header unwritable.
    const source = readFileSync(new URL('./policy-fixtures.ts', import.meta.url), 'utf8')
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')

    for (const forbidden of ['getActiveExecutionContext', 'process.env', 'isTTY', 'isatty']) {
      expect(code, `policy-fixtures.ts reads the ambient environment through ${forbidden}`).not
        .toContain(forbidden)
    }
    // …and the sweep is over the real file rather than an empty string.
    expect(code, 'the policy fixtures source read back empty').toContain('deriveAskCapableOpIds')
    // The covering and refusing callers are DERIVED: no scope literal appears in the file at all.
    for (const scope of FunctionScopeSchema.options) {
      expect(code, `policy-fixtures.ts spells the ${scope} scope instead of reading it off the `
        + 'declaration').not.toContain(`'${scope}'`)
    }
  })

  it('derives a covering and a refusing caller for every capability, from its own declaration', () => {
    for (const declaration of registryDeclarations()) {
      const covering = coveringCallerFor(declaration)
      expect(
        [...covering.grantedScopes].sort(),
        `${declaration.id}: the covering caller must hold exactly this op's declared scopes`,
      ).toEqual([...declaration.requiredScopes].sort())

      const refusing = refusingCallerFor(declaration)
      expect(
        declaration.requiredScopes,
        `${declaration.id}: the withheld scope must be one this op actually requires`,
      ).toContain(refusing.withheldScope)
      expect(
        refusing.caller.grantedScopes,
        `${declaration.id}: the refusing caller still holds ${refusing.withheldScope}`,
      ).not.toContain(refusing.withheldScope)
      expect(
        [...refusing.caller.grantedScopes, refusing.withheldScope].sort(),
        `${declaration.id}: the refusing caller must differ from the covering one by exactly the `
          + 'one withheld grant — a wider gap would refuse on an axis nobody named',
      ).toEqual([...declaration.requiredScopes].sort())
    }
  })

  // ---- Plan 04: the surface drivers (FUNC-05 legs 3 and 4) --------------------------------------

  it('drives a capability through the chat surface\'s own composed dispatch, model-free', async () => {
    // The plan-04 tracer. `proposals.list` is the safe subject: read-only, bound in this host, and
    // its declared input is the empty object, so nothing about the drive depends on a store having
    // anything in it.
    //
    // WHAT PRODUCES THIS ANSWER is the shipped REPL: a typed clause, split by the shipped splitter,
    // routed by the shipped resolver's `/fn` branch, minted a caller by the composition, and
    // dispatched through the composed `ChatInvokeBinding`. The receipt read back is the record the
    // printed line renders.
    const row = scenarioRowFor('proposals.list')
    expect(row, 'the scenario table no longer carries proposals.list').toBeDefined()

    const outcome = await driveChatDispatch({ opId: 'proposals.list', input: row!.input })

    expect(
      outcome.unhandled,
      'the generic /fn route failed to resolve the clause the driver typed — the surface never '
        + 'reached a dispatch, so nothing below is a statement about a verdict',
    ).toEqual([])
    expect(outcome.receipt?.status, 'proposals.list on chat: the surface reached a definitive '
      + 'outcome').toBe('executed')
    // ORIGIN IS THE MODEL-FREE PROOF, and it is a fact the surface recorded rather than a promise
    // this file makes: the deterministic route mints `human` and the planner route mints `agent`
    // (391 D-06), so a receipt stamped `human` cannot have been planned by a model.
    expect(outcome.receipt?.origin, 'proposals.list on chat: the receipt must come from the '
      + 'deterministic route, or a model planned this call').toBe('human')
    // The gate saw it. One row per dispatched invocation is `invokeFunction`'s uniform-gating
    // promise (D-11), and this is the observation the D-14 ungated mutation has to be able to break.
    expect(
      outcome.auditRows.filter((auditRow) => auditRow.action === pinClassFor('proposals.list')),
      'proposals.list on chat: the surface dispatched and the gate wrote no audit row — a '
        + 'capability outside the gate is exactly this phase\'s subject',
    ).not.toEqual([])
  })

  it('drives the chat surface with no provider credential in the environment at all', async () => {
    // ZERO PROVIDER SPEND, asserted as behaviour rather than argued. Every environment variable
    // whose name could carry a model credential is removed for the duration of the drive; the
    // deterministic route still routes, because `chatCapabilities` resolves to the shipped HEADLESS
    // posture and the resolver table never touches a model.
    const removed: [string, string][] = []
    for (const [name, value] of Object.entries(process.env)) {
      if (/(_API_KEY|_TOKEN|_SECRET|_KEY)$/u.test(name) && value !== undefined) {
        removed.push([name, value])
        delete process.env[name]
      }
    }
    try {
      const outcome = await driveChatDispatch({ opId: 'proposals.list', input: {} })
      expect(
        outcome.receipt?.status,
        `proposals.list on chat: the drive needed one of the ${removed.length} credential-shaped `
          + 'environment variables it was denied',
      ).toBe('executed')
    } finally {
      for (const [name, value] of removed) process.env[name] = value
    }
  })

  it('drives a tool through the MCP surface\'s real protocol door', async () => {
    // The MCP half of the tracer, over the same `withMcpClient` wiring every enumeration leg reads
    // through — so an enumeration and a call in this suite cannot be talking to two servers.
    const answered = await driveMcpCall({
      toolName: 'agent_qa_list_proposals',
      args: {},
      grantedScopes: [...FunctionScopeSchema.options],
    })
    expect(
      answered.answered,
      'agent_qa_list_proposals on mcp: the protocol refused a tool the mapping projects',
    ).toBe(true)
    // The discriminating half: the SAME call shape against a name no server registers is refused
    // by the protocol rather than answered in band, which is what makes an absence probe a probe.
    const absent = await driveMcpCall({
      toolName: plausibleMcpToolSpelling(SYNTHETIC_DRIVER_ABSENT_OP_ID),
      args: {},
      grantedScopes: [...FunctionScopeSchema.options],
    })
    expect(
      absent.answered,
      'the MCP driver answered in band for a tool that does not exist — it cannot tell an absent '
        + 'door from a present one that declined',
    ).toBe(false)
  })

  // ---- LEG 3: policy identity (D-11, FUNC-03) ---------------------------------------------------

  it('answers identically for two callers that differ only in which surface minted them', async () => {
    // FUNC-03's claim, measured. `invoke.ts` reads the caller record in exactly three places and
    // `surface` is in none of them — it is attribution. So two callers agreeing on grants, origin
    // and safe mode and disagreeing only on `surface` must reach the same place for every one of
    // the 41 capabilities, and `if (caller.surface === 'chat')` anywhere under the gate reds here.
    //
    // WHAT PRODUCES EACH SIDE: the left caller is `CHAT_RESOLVER_CALLER` — the frozen record
    // `composeLocalAgent` spreads at its own per-stage mint — regranted to this op's declared
    // scopes; the right is `mcpFunctionCaller(...)`, the function `commands/mcp.ts` composes its
    // server with. Two producers in two packages, two `invokeFunction` calls, one comparison. A
    // helper that shaped both sides would be comparing a value to itself.
    const divergent: string[] = []
    for (const declaration of registryDeclarations()) {
      const row = scenarioRowFor(declaration.id as ScenarioOpId)
      const callers = surfaceInertCallers(declaration.requiredScopes)
      const onChat = await gateAnswerFor(declaration.id, row!.input, callers.chat)
      const onMcp = await gateAnswerFor(declaration.id, row!.input, callers.mcp)

      if (onChat.kind !== onMcp.kind) divergent.push(`${declaration.id}: ${onChat.kind}/${onMcp.kind}`)
      // NON-VACUITY, in the same loop rather than in a cell somebody could delete: an identity that
      // held over two identical INPUT errors would be two callers agreeing about a fixture. Under
      // its own declared grants every capability must reach the gate band.
      expect(
        REACHED_THE_GATE,
        `${declaration.id}: under its own declared scopes the call stopped at ${onChat.kind}, `
          + 'before any verdict was taken — the grant point measured the pre-gate band',
      ).toContain(onChat.kind)
    }
    expect(
      divergent,
      'capabilities whose verdict depends on WHICH SURFACE minted an otherwise identical caller — '
        + 'caller-as-data is broken and a surface has a private policy (FUNC-03)',
    ).toEqual([])
  }, 120_000)

  it('diverges between the surfaces\' own mints on exactly the human-origin capabilities', async () => {
    // The other half of leg 3, and the reason the cell above harmonises `origin`. The surfaces'
    // REAL mints differ on origin as well as on surface (391 D-06: a person typing an alias decided
    // that call; an MCP client did not), so their answers legitimately differ — but only where an
    // op declares it needs a human, and the divergent set is DERIVED from the declarations rather
    // than listed here. A cell that demanded blanket agreement would be asserting the product wrong;
    // one that never checked would let a surface acquire an exception nobody named.
    const divergent: string[] = []
    const declaredHumanOrigin: string[] = []
    for (const declaration of registryDeclarations()) {
      const row = scenarioRowFor(declaration.id as ScenarioOpId)
      const callers = surfaceShapedCallers(declaration.requiredScopes)
      const onChat = await gateAnswerFor(declaration.id, row!.input, callers.chat)
      const onMcp = await gateAnswerFor(declaration.id, row!.input, callers.mcp)
      if (declaration.requiresHumanOrigin === true) declaredHumanOrigin.push(declaration.id)
      if (onChat.kind === onMcp.kind) continue
      divergent.push(declaration.id)
      expect(
        onMcp.kind,
        `${declaration.id}: the two surfaces' own mints disagree, and not on the origin axis — `
          + 'a divergence with no declared reason is a private policy',
      ).toBe('refused-origin')
    }
    expect(
      sorted(divergent),
      'the capabilities whose answer differs between the surfaces\' own caller mints must be '
        + 'exactly the ones declaring requiresHumanOrigin',
    ).toEqual(sorted(declaredHumanOrigin))
    // …and the set is not empty, or the two directions above would both hold over nothing.
    expect(declaredHumanOrigin.length, 'no capability declares requiresHumanOrigin, so this cell '
      + 'asserts nothing').toBeGreaterThan(0)
    // The join D-12 already carries: every one of those ops is unprojected over MCP, citing that
    // very reason class. The divergence is not a hole — it is a scoping note, machine-checked.
    for (const opId of declaredHumanOrigin) {
      const entry = UNPROJECTED_OPS.find((candidate) => candidate.opId === opId)
      expect(
        entry === undefined ? undefined : unprojectedReasonKeyOf(entry.reason),
        `${opId}: it needs a human and MCP mints an agent, so the mapping must cite that as its `
          + 'unprojected reason rather than leaving a door the surface can never open',
      ).toBe('requires-human-origin')
    }
  }, 120_000)

  // ---- LEG 4: the refuse direction, two independent walls (D-11) --------------------------------

  it('refuses at the GATE WALL for every capability, naming the one withheld grant', async () => {
    // WALL ONE of two, and it is asserted alone: `invokeFunction` refuses a caller short of a
    // required scope whatever surface that caller came from, and it says which scope.
    //
    // The withheld grant is DERIVED per op by `refusingCallerFor` off the declaration's own
    // `requiredScopes` — no scope is named in this leg — so the day an op's scope set changes, the
    // refusal this cell demands changes with it.
    for (const declaration of registryDeclarations()) {
      const row = scenarioRowFor(declaration.id as ScenarioOpId)
      const refusing = refusingCallerFor(declaration)
      const callers = surfaceInertCallers(refusing.caller.grantedScopes)
      const onChat = await gateAnswerFor(declaration.id, row!.input, callers.chat)
      const onMcp = await gateAnswerFor(declaration.id, row!.input, callers.mcp)

      expect(onChat.kind, `${declaration.id} on chat (gate wall): a caller without `
        + `${refusing.withheldScope} was not refused for want of it`).toBe('refused-scope')
      expect(onMcp.kind, `${declaration.id} on mcp (gate wall): a caller without `
        + `${refusing.withheldScope} was not refused for want of it`).toBe('refused-scope')
      expect(
        onChat.missingScopes,
        `${declaration.id} on chat (gate wall): the refusal must name the grant that was withheld, `
          + 'or a refusal on another axis would read as this one',
      ).toEqual([refusing.withheldScope])
      expect(
        onMcp.missingScopes,
        `${declaration.id} on mcp (gate wall): the refusal must name the grant that was withheld`,
      ).toEqual([refusing.withheldScope])
    }
  }, 120_000)

  it('refuses at the CHAT SURFACE WALL for every capability, through its own composed dispatch', async () => {
    // WALL TWO of two for chat, asserted in its own cell over its own producer: no expression in
    // this body touches `invokeFunction`, and no expression in the gate-wall cell above touches a
    // driver. D-11 asks for two walls, and two walls averaged into one assertion is one wall.
    //
    // WHAT PRODUCES THIS SIDE: the shipped `agent-qa chat` REPL, typed at. The refusal observed is
    // `FunctionDeniedError` — the class `invokeFunction` throws when and only when the gate
    // returned `deny` — carried to the surface in the receipt a person reads, and corroborated by
    // the gate's own execution-audit row naming the action class and the outcome that produced it.
    // A capability rerouted around `invokeFunction` (D-14's ungated mutation) cannot be pinned: it
    // would execute, this cell would see `executed`, and it would red by name.
    for (const row of SCENARIO_TABLE) {
      const outcome = await driveChatDispatch({
        opId: row.opId,
        input: row.input,
        pinBefore: [pinClassFor(row.opId)],
      })
      expect(
        outcome.unhandled,
        `${row.opId} on chat (surface wall): the generic route did not resolve the clause, so this `
          + 'drive never reached a dispatch and its refusal would be a routing failure',
      ).toEqual([])
      expect(
        outcome.receipt?.status,
        `${row.opId} on chat (surface wall): the surface did not refuse a pinned capability`,
      ).toBe('failed')
      expect(
        outcome.receipt?.outcome,
        `${row.opId} on chat (surface wall): the refusal must be the gate's own — an input or `
          + 'unknown-id refusal would look the same to a person and mean the gate never ran',
      ).toBe('FunctionDeniedError')
      const denials = outcome.auditRows.filter(
        (auditRow) => auditRow.action === pinClassFor(row.opId) && auditRow.verdict === 'deny',
      )
      expect(
        denials.map((auditRow) => auditRow.outcome),
        `${row.opId} on chat (surface wall): the gate wrote no deny row for this action class, so `
          + 'nothing attributes the surface\'s refusal to the gate',
      ).toContain('session-pin-denied')
    }
  }, 300_000)

  it('refuses at the MCP SURFACE WALL for every projected capability: no door under the short grant', async () => {
    // WALL TWO of two for MCP, over its own producer. The MCP surface CAN be handed a caller short
    // of a scope, and its visibility law is a scope-union subset check — so the refusal this
    // surface produces is the DOOR NOT BEING THERE, asserted in both directions: the tool is listed
    // under a grant that covers it, and absent under the grant this op's own refusing caller holds,
    // and a direct call on it is refused by the protocol rather than answered in band.
    const everyScope = [...FunctionScopeSchema.options]
    const listedUnderEveryScope = await listMcpToolNames(everyScope)
    for (const row of SCENARIO_TABLE) {
      if (!('reachable' in row.perSurface.mcp)) continue
      const tool = row.perSurface.mcp.reachable.tool
      const declaration = registryDeclarations().find((candidate) => candidate.id === row.opId)
      const refusing = refusingCallerFor(declaration!)

      expect(
        listedUnderEveryScope,
        `${row.opId} on mcp (surface wall): the tool that projects it is not listed even under a `
          + 'grant holding every scope, so its absence below would say nothing',
      ).toContain(tool)
      const listedUnderShortGrant = await listMcpToolNames(refusing.caller.grantedScopes)
      expect(
        listedUnderShortGrant,
        `${row.opId} on mcp (surface wall): the tool is still listed to a caller without `
          + `${refusing.withheldScope} — the surface advertises a capability it must refuse`,
      ).not.toContain(tool)
      const called = await driveMcpCall({
        toolName: tool,
        args: {},
        grantedScopes: refusing.caller.grantedScopes,
      })
      expect(
        called.answered,
        `${row.opId} on mcp (surface wall): a caller without ${refusing.withheldScope} reached the `
          + 'tool in band — a door that is not advertised is still a door',
      ).toBe(false)
    }
  }, 300_000)

  it('records WHY the chat surface wall is a pin rather than a short grant', async () => {
    // THE MEASUREMENT BEHIND THE DESIGN, pinned so it cannot go stale silently. Both chat stage
    // callers hold `CHAT_STAGE_SCOPES`, and that constant is the WHOLE closed scope union — so "a
    // chat caller missing a required scope" is not a state this product can be in, and the chat
    // surface wall could not be a scope refusal however it were written. The day chat narrows its
    // grants, this cell reds and the wall above should be revisited.
    expect(
      sorted(CHAT_STAGE_SCOPES),
      'the chat stage callers no longer hold every scope — a scope-refused chat caller is now a '
        + 'state this product can be in, and the chat surface wall should assert it directly',
    ).toEqual(sorted(FunctionScopeSchema.options))
    // And the pin route reaches every capability, which is what lets the wall above range the whole
    // census: the pin is validated against the registry's own risk names.
    for (const declaration of registryDeclarations()) {
      expect(
        declaration.risk.name,
        `${declaration.id}: /pin normalises to fn:<id> and compares exact bytes, so a capability `
          + 'whose risk name is spelled otherwise is unpinnable and unwalled',
      ).toBe(pinClassFor(declaration.id))
    }
  })

  it('keeps the two walls in two cells: no assertion is fed by both a surface and the gate', () => {
    // D-11's "never averaged into one assertion", as a structural claim about this file. Splitting
    // on `it(` is coarse but exact enough for what is being forbidden: a cell that produced both a
    // surface answer and a gate answer could merge them, and none does.
    const code = commentStrippedSource('parity.test.ts')
    const gateProducers = ['gateAnswerFor']
    const surfaceProducers = ['driveChatDispatch', 'driveMcpCall', 'listMcpToolNames']
    // This cell's OWN body names every producer by construction — it is the sweep — so it is
    // excluded by the one token only the sweep uses. Without that, the check would report itself.
    const bodies = code
      .split(/\bit\(/u)
      .slice(1)
      .filter((body) => !body.includes('commentStrippedSource('))
    const merged = bodies
      .filter((body) => gateProducers.some((name) => body.includes(name)))
      .filter((body) => surfaceProducers.some((name) => body.includes(name)))
    expect(
      merged.length,
      'a cell produces BOTH a gate answer and a surface answer, so the two walls D-11 requires to '
        + 'be independent can be averaged into one expect',
    ).toBe(0)
    // Non-vacuity: both kinds of cell exist to be kept apart.
    expect(bodies.filter((body) => body.includes('gateAnswerFor')).length).toBeGreaterThan(0)
    expect(bodies.filter((body) => body.includes('driveChatDispatch')).length).toBeGreaterThan(0)
    // And no scope is spelled anywhere the refuse legs could have hand-typed one: the withheld
    // grant is derived per op or it is not derived at all.
    for (const wallBody of bodies.filter((body) => body.includes('(gate wall)'))) {
      for (const scope of FunctionScopeSchema.options) {
        expect(wallBody, `the gate-wall leg spells the ${scope} scope instead of deriving it from `
          + 'the declaration').not.toContain(`'${scope}'`)
      }
    }
  })

  // ---- The ASK points: verdict parity, handling per contract (2026-08-16, D-11) -----------------
  //
  // THE DIVERGENCE BELOW IS DESIGNED, AND IT IS ASSERTED RATHER THAN AVERAGED AWAY. D-11's clause
  // is verdict parity, NOT handling parity: the gate must reach the same `ask` for a capability
  // whichever surface asks, and then each surface answers it the way its own contract says. Chat
  // pauses at a confirm seam and refuses when there is nobody to ask; MCP's apply tools refuse and
  // TEACH the second call (396 D-11), and its other ask-tier tools refuse in band off the gate.
  // A cell that demanded one shared HANDLING would be asserting a false symmetry, and the way it
  // would be satisfied is by removing one of the two contracts.

  it('reaches the ask for every ask-capable capability, identically on both surfaces\' callers', async () => {
    // VERDICT PARITY (D-11's third policy point), at the gate. `evaluate` never RETURNS the string
    // `ask` — it resolves one — so "the verdict is ask" is only readable off behaviour: the confirm
    // port is reached on exactly the path where the base verdict was `ask` and no trust, credential
    // or standing grant satisfied it. Each side is a separate `invokeFunction` call under its own
    // surface's caller record.
    const askCapable = new Set(ASK_CAPABLE_OP_IDS)
    for (const declaration of registryDeclarations()) {
      const row = scenarioRowFor(declaration.id as ScenarioOpId)
      const callers = surfaceInertCallers(declaration.requiredScopes)
      const consulted = { chat: false, mcp: false }
      const answers = {
        chat: await gateAnswerFor(declaration.id, row!.input, callers.chat, {
          resolveExecutionContext: conformanceResolveExecutionContext,
          confirm: () => { consulted.chat = true; return false },
        }),
        mcp: await gateAnswerFor(declaration.id, row!.input, callers.mcp, {
          resolveExecutionContext: conformanceResolveExecutionContext,
          confirm: () => { consulted.mcp = true; return false },
        }),
      }
      expect(
        consulted.mcp,
        `${declaration.id}: the two surfaces disagree about whether this capability asks a person `
          + 'first — an ask on one surface and a silent proceed on the other is the divergence D-11 '
          + 'forbids',
      ).toBe(consulted.chat)
      // …and which way that shared answer went is the derived ask set, in both directions, so the
      // cell cannot pass by never reaching a confirm at all.
      expect(
        consulted.chat,
        `${declaration.id}: the shipped classifier's ask set and the confirm this call reached `
          + 'disagree',
      ).toBe(askCapable.has(declaration.id))
      if (askCapable.has(declaration.id)) {
        // Nothing approved it, so the ask resolves to a denial — and the capability does not run.
        expect(answers.chat.kind, `${declaration.id} on chat: an unapproved ask must not proceed`)
          .toBe('gate-denied')
        expect(answers.mcp.kind, `${declaration.id} on mcp: an unapproved ask must not proceed`)
          .toBe('gate-denied')
      }
    }
  }, 120_000)

  it('gets PAST the ask on a standing approval, identically on both surfaces\' callers', async () => {
    // The ask set's own GRANT point. A capability whose every measurement stops at an unapproved ask
    // has had its dispatch path measured nowhere, so this is the cell that proves the gate ALLOWS —
    // through the standing-approval arm, built from the action's own name rather than a list.
    //
    // THE CONFIRM THROWS. If the grant did not cover the action and the ladder fell through to the
    // prompt, this cell would otherwise report an allow that a confirm had produced.
    // THE CONFIRM RECORDS RATHER THAN THROWS, deliberately: a throw here would be swallowed by
    // `gateAnswerFor`'s dispatch-time arm and read as an ALLOW, which is the answer this guard
    // exists to refuse. The flag is checked after each call.
    for (const opId of ASK_CAPABLE_OP_IDS) {
      const declaration = registryDeclarations().find((candidate) => candidate.id === opId)
      const row = scenarioRowFor(opId as ScenarioOpId)
      const callers = surfaceInertCallers(declaration!.requiredScopes)
      const consulted = { chat: false, mcp: false }
      const optionsFor = (side: 'chat' | 'mcp'): ConformanceRegistryOptions => ({
        resolveExecutionContext: conformanceResolveExecutionContext,
        // A RESOLVER, which is the port's shape — a reader handed in directly is not callable and
        // `invokeFunction` would throw where the gate expects a value, which this suite's own
        // classifier would then read as a dispatch. Measured, not assumed: that was the first
        // spelling here and it made the cell green for the wrong reason.
        standingApprovalReader: () => EVERY_ASK_STANDING_APPROVED,
        confirm: () => { consulted[side] = true; return false },
      })
      const onChat = await gateAnswerFor(opId, row!.input, callers.chat, optionsFor('chat'))
      const onMcp = await gateAnswerFor(opId, row!.input, callers.mcp, optionsFor('mcp'))
      expect(
        consulted,
        `${opId}: the standing approval did not cover this action class, so the ladder fell through `
          + 'to the confirm — this cell would have measured a prompt while claiming a grant',
      ).toEqual({ chat: false, mcp: false })
      // WHERE a call that got past the ask lands is DERIVED from this composition's own binding
      // status, not asserted loosely as "somewhere past the gate". The looser form is what let the
      // first spelling of this cell pass while the reader port was mis-shaped: a gate port that
      // throws surfaces here as a dispatch-time error, i.e. as `allowed-dispatched`, and a cell
      // that accepted either answer accepted a broken gate as a granted one.
      const pastAsk = declaration!.bindingStatus === 'unbound'
        ? 'allowed-unbound'
        : 'allowed-dispatched'
      expect(
        onChat.kind,
        `${opId} on chat: a standing approval covering this action class did not get the call past `
          + `the ask and on to step ${pastAsk === 'allowed-unbound' ? '6' : '7'}`,
      ).toBe(pastAsk)
      expect(onMcp.kind, `${opId}: the two surfaces resolve the same ask differently under the same `
        + 'standing approval').toBe(onChat.kind)
    }
  }, 120_000)

  it('handles the ask on CHAT by pausing at its confirm seam, never by executing', async () => {
    // Chat's own contract. Driven through the shipped REPL with NO pin, so what refuses is the ask
    // arm itself: on a host with no terminal `createChatConfirmPort` binds nothing and the gate's
    // deny-by-default confirm answers, which is `prompted-denied` — the ladder REACHED the seam.
    //
    // The comparand a person sees is the receipt; the attribution is the gate's own audit row.
    for (const opId of ASK_CAPABLE_OP_IDS) {
      const row = scenarioRowFor(opId as ScenarioOpId)
      const outcome = await driveChatDispatch({ opId, input: row!.input })
      expect(outcome.unhandled, `${opId} on chat (ask): the clause did not route`).toEqual([])
      expect(
        outcome.receipt?.status,
        `${opId} on chat (ask): an ask-tier capability EXECUTED with nobody asked`,
      ).toBe('failed')
      expect(outcome.receipt?.outcome, `${opId} on chat (ask): the refusal is not the gate's`)
        .toBe('FunctionDeniedError')
      expect(
        outcome.auditRows
          .filter((auditRow) => auditRow.action === pinClassFor(opId))
          .map((auditRow) => auditRow.outcome),
        `${opId} on chat (ask): the gate did not record reaching the confirm seam`,
      ).toContain('prompted-denied')
    }
  }, 300_000)

  it('control: the same chat ask under the fail-closed context observes the other posture', async () => {
    // Pitfall 3, as a behaviour rather than an argument. The ONLY thing that changes between this
    // cell and the one above is the injected context — and the observation changes with it, from
    // "the seam was reached and declined" to "the seam was never reachable". A drive that read the
    // ambient context would report whichever of these the machine happened to be, and the cell
    // above would be green on a runner for a reason nobody chose.
    for (const opId of ASK_CAPABLE_OP_IDS) {
      const row = scenarioRowFor(opId as ScenarioOpId)
      const outcome = await driveChatDispatch({ opId, input: row!.input, executionContext: 'ci' })
      expect(
        outcome.auditRows
          .filter((auditRow) => auditRow.action === pinClassFor(opId))
          .map((auditRow) => auditRow.outcome),
        `${opId} on chat (ask, fail-closed context): the verdict did not follow the injected `
          + 'context, so the context is not what this suite is deciding under',
      ).toContain('fail-closed-denied')
      expect(outcome.receipt?.status, `${opId} on chat (ask, fail-closed context): it executed`)
        .toBe('failed')
    }
  }, 300_000)

  it('handles the ask on MCP per ITS contract — refuse-and-teach, or refuse in band', async () => {
    // MCP's own contract, and WHICH contract is DERIVED from the mapping's own `kind` rather than
    // picked per op: an `apply` tool is D-11's refuse-and-teach front door, and every other tool
    // crosses the generic handler and gets the gate's own answer back in band. Neither executes on
    // a blind first call, which is the property the two shapes share and the only one that is
    // averaged here.
    const everyScope = [...FunctionScopeSchema.options]
    let applyTools = 0
    let bandRefusals = 0
    for (const opId of ASK_CAPABLE_OP_IDS) {
      const projection = AGENT_QA_TOOL_PROJECTIONS.find((candidate) => candidate.ops.includes(opId))
      if (projection === undefined) {
        // Unprojected: this surface's handling is ABSENCE, already asserted by 397-03's D-12 leg.
        // What is asserted here is that the absence is the one the divergence above explains.
        const entry = UNPROJECTED_OPS.find((candidate) => candidate.opId === opId)
        expect(
          entry === undefined ? undefined : unprojectedReasonKeyOf(entry.reason),
          `${opId} on mcp (ask): it can ask, this surface does not project it, and the mapping `
            + 'gives no reason a reader can classify',
        ).toBe('requires-human-origin')
        continue
      }
      const row = scenarioRowFor(opId as ScenarioOpId)
      const args = projection.kind === 'apply'
        // The apply door's own argument name, read off the op's contract rather than typed: its
        // input carries exactly one field and the tool spells it in snake case.
        ? { proposal_id: (row!.input as { proposalId: string }).proposalId }
        : (row!.input as Record<string, unknown>)
      const answered = await driveMcpCall({ toolName: projection.name, args, grantedScopes: everyScope })
      expect(answered.answered, `${opId} on mcp (ask): the protocol refused the call outright`)
        .toBe(true)
      const inBand = answered as Extract<typeof answered, { answered: true }>
      if (projection.kind === 'apply') {
        applyTools += 1
        expect(inBand.isError, `${opId} on mcp (ask): refuse-and-teach is an ANSWER, not an error `
          + '— a caller told this is an error has been taught nothing').toBe(false)
        expect(
          inBand.structured?.['status'],
          `${opId} on mcp (ask): a first apply call must come back needing confirmation`,
        ).toBe('confirmation-required')
        expect(inBand.structured?.['applied'], `${opId} on mcp (ask): a first apply call committed`)
          .toBe(false)
        expect(
          String(inBand.structured?.['instruction'] ?? ''),
          `${opId} on mcp (ask): the teach must name the exact second call, or it is a refusal `
            + 'with no door behind it',
        ).toContain('confirmed')
      } else {
        bandRefusals += 1
        expect(inBand.isError, `${opId} on mcp (ask): an ask-tier capability answered without the `
          + 'gate refusing it').toBe(true)
        expect(inBand.text, `${opId} on mcp (ask): the in-band refusal must name the capability`)
          .toContain(opId)
      }
    }
    // Both arms were exercised, or one of the two contracts is asserted by nothing.
    expect(applyTools, 'no ask-capable op reached the refuse-and-teach arm').toBeGreaterThan(0)
    expect(bandRefusals, 'no ask-capable op reached the in-band refusal arm').toBeGreaterThan(0)
  }, 300_000)

  it('observes the chat surface through its own dispatch, never through the gate directly', () => {
    // PITFALL 5, AS A SOURCE ASSERTION. Every behavioural cell above would pass over a driver that
    // called `invokeFunction` itself — and such a driver is blind to D-14's ungated-op mutation by
    // construction, because the thing the mutation removes is the very call the driver would be
    // making. Comments are stripped first so this file's own prose may name what the driver's body
    // must not.
    const code = commentStrippedSource('surface-dispatch.ts')
    // Named identifiers rather than a bare word: the drivers' fixture config declares a
    // `registry.targets` block, and a token scan would have read the project's own configuration
    // vocabulary as a reach into the function registry (the rollcall's own negative control).
    for (const forbidden of [
      'invokeFunction',
      'evaluate(',
      'composeCliLocalAgent',
      'conformanceRegistry',
      'createFunctionRegistry',
      'registryDeclarations',
    ]) {
      expect(code, `surface-dispatch.ts reaches past the surface via ${forbidden}`)
        .not.toContain(forbidden)
    }
    // …and the sweep is over the real file rather than an empty string.
    expect(code, 'the surface-dispatch source read back empty').toContain('createChatCommand')
    // The context is injected there too, on policy-fixtures.ts's rule (Pitfall 3).
    expect(code, 'surface-dispatch.ts must inject the execution context it decides under')
      .toContain('setActiveExecutionContextResolver')
  })
})
