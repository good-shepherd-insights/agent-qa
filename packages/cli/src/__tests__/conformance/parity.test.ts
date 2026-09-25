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

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { invokeFunction, CHAT_RESOLVER_TABLE } from '@vostride/agent-qa-agent'
import type { FunctionDeclaration } from '@vostride/agent-qa-agent'
import {
  CHAT_PLANNER_CALLER,
  CHAT_RESOLVER_CALLER,
  CHAT_STAGE_SCOPES,
} from '@vostride/agent-qa-agent-local'
import {
  AGENT_QA_OP_CONTRACTS,
  AGENT_QA_TOOL_PROJECTIONS,
  armWithoutDiscriminant,
  compositionOf,
  DEGRADED_OUTPUT_CONTRACTS,
  UNPROJECTED_OPS,
  withoutDialect,
} from '@vostride/agent-qa-mcp'
import type { JsonDocument, ToolProjection } from '@vostride/agent-qa-mcp'
import { committedFileText, FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MCP_DEFAULT_GRANTED_SCOPES, mcpFunctionCaller } from '../../commands/mcp.js'
import {
  CHAT_RESOLVER_PROBES,
  chatEnumerationOf,
  CONFORMANCE_CENSUS_CALLER,
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
import {
  buildGoldenRows,
  emitGoldenText,
  GOLDEN_FILE_NAME,
  GOLDEN_PATH,
  GOLDEN_REGEN_INSTRUCTION,
  GOLDEN_REGEN_SCRIPT,
  goldenEmitRequested,
  goldenFieldsThatMoved,
  goldenFileOf,
  goldenFileText,
  goldenFindings,
  goldenPartitionOf,
  unaccountedGoldenFields,
  withGoldenRootRegistry,
  type GoldenFile,
  type GoldenRow,
} from './golden.js'
import {
  CANONICAL_ID_DOMAINS,
  domainCensus,
  domainOf,
  OP_ID_GRAMMAR,
  type CanonicalDomain,
} from './domain-list.js'
import { SURFACE_ROSTER } from './roster.js'
import {
  driveChatDispatch,
  driveDashboardDispatch,
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

/**
 * Plan 06's own synthetic fixtures, named for the plan that plants them.
 *
 * Same rule the three blocks above follow: 397-09's mutation script tells a plan's deliberate
 * fixtures from the strays it plants by NAME, so nothing here reuses another plan's constant.
 */
/**
 * Plan 08's own synthetic fixtures, named for the plan that plants them.
 *
 * Same rule every block above follows: 397-09's mutation script tells a plan's deliberate fixtures
 * from the strays it plants by NAME, so nothing here reuses another plan's constant. The domain
 * spellings are deliberately not real English domain words — a control that planted `billing` would
 * read, to a person scanning the taxonomy, like a domain someone meant to add.
 */
const SYNTHETIC_UNCATALOGUED_DOMAIN_OP_ID = 'controluncatalogued39708.probe'
const SYNTHETIC_MEMBERLESS_DOMAIN = 'controlmemberless39708'
const SYNTHETIC_RESERVED_DOMAIN = 'controlreserved39708'

const SYNTHETIC_GOLDEN_STRAY_OP_ID = 'control.golden.stray.397.06'
const SYNTHETIC_GOLDEN_UNCATALOGUED_OP_ID = 'control.golden.uncatalogued.397.06'
const SYNTHETIC_GOLDEN_STRAY_FIELD = 'controlGoldenField39706'

const enumerations = new Map<string, SurfaceEnumeration>()
let censusIds: readonly string[] = []
let censusIdSet: ReadonlySet<string> = new Set()

/**
 * The composition root's own listing, and each surface host's, taken from ONE composition (D-08).
 *
 * ONE COMPOSITION FOR ALL FOUR READS, because the question these cells ask is whether the root and
 * a host that runs over it can disagree — and four separately composed hosts would make a
 * disagreement unattributable to anything but the composing. The listings are inert frozen data, so
 * they outlive the host they were taken from without carrying a handle on it.
 */
let rootDeclarations: readonly FunctionDeclaration[] = []
const rootHostListings = new Map<string, readonly FunctionDeclaration[]>()

beforeAll(async () => {
  censusIds = registryOpIds()
  censusIdSet = new Set(censusIds)
  for (const entry of SURFACE_ROSTER) {
    enumerations.set(entry.id, await entry.adapter.enumerateOpIds())
  }
  await withGoldenRootRegistry((registry) => {
    rootDeclarations = registry.list(CONFORMANCE_CENSUS_CALLER)
    // The callers each shipped surface host actually lists under — the chat host's two stage mints
    // (392) and the MCP host's two grants (396's default, which withholds `config-write`, and the
    // every-scope grant an operator can start the server with). Read off the SAME registry object
    // the shipped commands hand their surface, which is what makes a disagreement here a fact about
    // the product rather than about this file's assembly.
    rootHostListings.set('chat:planner', registry.list(CHAT_PLANNER_CALLER))
    rootHostListings.set('chat:resolver', registry.list(CHAT_RESOLVER_CALLER))
    rootHostListings.set('mcp:every-scope', registry.list(mcpFunctionCaller([
      ...FunctionScopeSchema.options,
    ])))
    rootHostListings.set('mcp:default-grant', registry.list(mcpFunctionCaller(
      MCP_DEFAULT_GRANTED_SCOPES,
    )))
  })
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

/** A source file at an absolute path, with its comments removed. */
function commentStrippedFile(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** A source file with its comments removed, so a header may name what its body must not contain. */
function commentStrippedSource(fileName: string): string {
  return commentStrippedFile(join(CONFORMANCE_DIR, fileName))
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

// ---- Leg 2: structural schema equality, per OP, through the one lens (plan 06, D-06) -----------
//
// THE UNIVERSE HERE IS PER-OP, AND THAT IS THE WHOLE DIFFERENCE from the fidelity suite in
// `packages/mcp`. That suite ranges the fourteen TOOLS and asks whether each advertisement matches
// the contracts behind it; this leg ranges the twenty-two projected OPS and asks, of each
// capability, whether the shape a caller is shown for it is the shape `invokeFunction` validates it
// with. The two universes answer different questions — a fold's arm is one tool and several
// capabilities — and the per-op reading is the one FUNC-05 makes ("per spec × per surface"). Neither
// cell is duplicated: what is shared is the LENS, imported from the mcp barrel, never re-derived
// (D-06; a second normaliser drifts looser and the looser copy is the one that passes over drift).

/**
 * Why one op's schema is not compared byte for byte on one side, from a CLOSED vocabulary.
 *
 * Encoded as data with a reason apiece rather than as `if` branches, so the set of exemptions is
 * enumerable, each one is exercised (asserted below), and a new one has to be declared here rather
 * than added as a condition nobody counts. No skip-lists: every op is either compared or carries one
 * of these keys, and the arithmetic is pinned.
 */
type Leg2ExceptionKey =
  | 'apply-door-wire-envelope'
  | 'pipeline-downstream-op'
  | 'degraded-output-contract'

const LEG2_EXCEPTIONS: readonly (readonly [Leg2ExceptionKey, string])[] = Object.freeze([
  Object.freeze([
    'apply-door-wire-envelope',
    'the two apply doors advertise 396 D-11\'s wire vocabulary on the way IN — a `confirmed` '
      + 'envelope around the op\'s own input — because a tool call is one round trip with nobody to '
      + 'ask. The op\'s own document is still what the RECEIPT arm is, and that is compared',
  ] as const),
  Object.freeze([
    'pipeline-downstream-op',
    'a pipeline tool advertises its FIRST op\'s shapes; the downstream op runs inside the resolved '
      + 'arm and contributes no shape of its own. A document carrying one would mean the tool had '
      + 'invented a result envelope, which is the one thing a pure projection may not do',
  ] as const),
  Object.freeze([
    'degraded-output-contract',
    'the two tools whose result contract contains a branded transform advertise NO outputSchema '
      + '(mapping.ts DEGRADED_OUTPUT_CONTRACTS). The absence is ASSERTED rather than skipped, in '
      + 'both directions, together with the sentence that tells a caller about it',
  ] as const),
])

/** What this leg does with one op on one side of the comparison. */
type Leg2Plan =
  | { readonly kind: 'whole' }
  | { readonly kind: 'arm'; readonly at: number }
  | { readonly kind: 'exception'; readonly key: Leg2ExceptionKey }

/**
 * PURE, over the declared mapping — so the plan for every op is derived from the shipped tables
 * rather than from a per-op list this file would have to keep in step with them.
 */
function leg2InputPlan(projection: ToolProjection, opId: string): Leg2Plan {
  // The credential-required mark door takes its native op input; only proposal apply wraps it.
  if (projection.kind === 'apply' && projection.credential !== 'required') {
    return { kind: 'exception', key: 'apply-door-wire-envelope' }
  }
  const composition = compositionOf(projection)
  if (composition === 'union') return { kind: 'arm', at: projection.ops.indexOf(opId) }
  if (composition === 'pipeline' && projection.ops[0] !== opId) {
    return { kind: 'exception', key: 'pipeline-downstream-op' }
  }
  return { kind: 'whole' }
}

function leg2OutputPlan(projection: ToolProjection, opId: string): Leg2Plan {
  if (DEGRADED_OUTPUT_CONTRACTS.some((entry) => entry.tool === projection.name)) {
    return { kind: 'exception', key: 'degraded-output-contract' }
  }
  const composition = compositionOf(projection)
  if (composition === 'pipeline' && projection.ops[0] !== opId) {
    return { kind: 'exception', key: 'pipeline-downstream-op' }
  }
  return { kind: 'whole' }
}

/** The advertised output documents an op's own projection may equal: the doc, or the union's arms. */
function advertisedOutputMembers(advertised: JsonDocument): readonly JsonDocument[] {
  const arms = advertised.anyOf as readonly JsonDocument[] | undefined
  return arms === undefined ? [advertised] : arms
}

/** One listed tool, as `tools/list` describes it. */
interface AdvertisedTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema: JsonDocument
  readonly outputSchema?: JsonDocument
}

describe('the parity suite ranges the registry census over every rostered surface', () => {
  it('pins the roster at the four surfaces that exist today', () => {
    // D-04. An exact list rather than a length check or a contains check: a surface REPLACED would
    // pass both of those while the claim quietly moved to a different set of doors.
    //
    // 2026-08-20 (399.1 D-07): the `fn` door joins. The order is registration order and is asserted
    // as such — `roster.ts` reads as a dated history and a row that moved would be a row somebody
    // re-decided.
    //
    // 2026-08-21 (400-01 D-12): the dashboard chat door joins, on the day the door itself is first
    // committed rather than at the end of the phase that builds it. That is the whole content of
    // "day one, not at its end": every plan after this one builds under a suite that already ranges
    // the door, so a private power added to it is a named RED in the change that adds it.
    //
    // 2026-08-24 (402-07 D-04): the authed run service joins, in the phase that ships it, as the
    // third and last of the three arrivals `roster.ts`'s 2026-08-16 registration note reserved.
    expect(SURFACE_ROSTER.map((entry) => entry.id))
      .toEqual(['chat', 'mcp', 'fn', 'dashboard', 'run-service'])
    for (const entry of SURFACE_ROSTER) {
      expect(entry.adapter.id, `${entry.id}: the roster row and its adapter must name one surface`)
        .toBe(entry.id)
    }
  })

  it('makes every door state what it cannot do, by shape rather than by omission', () => {
    // 402-07, D-04. The four wide doors declare an EMPTY list and the run service declares a
    // populated one; what is asserted here is that BOTH are declarations. A door whose narrowness
    // showed up only as ops it happened not to enumerate reads exactly like a door that lost half
    // its reach in a regression, and 397 D-12's refusal to keep a skip list is what makes the
    // distinction matter: a skip list says which cells not to run, and this says which capabilities
    // the door does not have.
    //
    // THE FIELD IS REQUIRED ON THE INTERFACE, so this cell cannot be satisfied by absence — every
    // member below has to exist for the file to compile. What it adds is that a populated entry
    // carries a REASON, because an unexplained "not applicable" is the omission wearing a label.
    for (const entry of SURFACE_ROSTER) {
      expect(
        Array.isArray(entry.adapter.notApplicable),
        `${entry.id}: a rostered door must DECLARE its not-applicable set, even when it is empty`,
      ).toBe(true)
      for (const declared of entry.adapter.notApplicable) {
        expect(
          declared.capability.trim().length > 0 && declared.why.trim().length > 0,
          `${entry.id}: "${declared.capability}" is declared not-applicable with no reason`,
        ).toBe(true)
      }
    }
    // The narrow door is narrow ON PURPOSE and says so — asserted by NAME rather than over the
    // whole roster, because "some door declares something" is a claim any future row could satisfy
    // while this one went quiet.
    const runService = SURFACE_ROSTER.find((entry) => entry.id === 'run-service')
    expect(runService, 'the run-service row is what this cell is about').toBeDefined()
    expect(
      (runService as { adapter: { notApplicable: readonly unknown[] } }).adapter.notApplicable.length,
      'the run service reaches one op and a stream; a door that narrow must say what it declines',
    ).toBeGreaterThan(0)
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

  // ---- The taxonomy census: ONE canonical domain list, both directions (397-08, D-18) ----------

  it('names every capability over the ONE canonical domain list, in both directions', () => {
    // THE MANDATORY DIRECTION IS ids → list. A capability whose domain is absent from
    // `domain-list.ts` is a named RED here, by op id and by domain — which is what makes the pinned
    // list a thing the product is checked against rather than a comment nobody reads. This is the
    // duty the retired 384 stub's `ALLOWED_ID_DOMAINS` sweep carried, re-derived off the census.
    //
    // THE REVERSE DIRECTION IS ASSERTED TOO, because a taxonomy is exactly the kind of table that
    // quietly accumulates members nothing uses. A member matching no op must carry a dated
    // `reserved` sentence saying who holds the name and against what; a member carrying one while
    // ops exist is a reservation somebody forgot to retire. Both are named, neither is counted.
    const census = domainCensus(registryOpIds())

    expect(
      census.uncatalogued,
      'capabilities whose id domain is on no row of domain-list.ts — add the domain there with a '
        + 'one-line charter (D-18: ids are the locked contract, the taxonomy serves them, and a '
        + 'widening is a reviewed one-line diff rather than a silent Set.add)',
    ).toEqual([])
    expect(
      census.memberless,
      'domains pinned in domain-list.ts that no shipped capability uses and that carry no dated '
        + 'reserved marker — either an op was deleted, or the row is decoration',
    ).toEqual([])
    expect(
      census.staleReservations,
      'domains carrying a dated `reserved` marker that shipped capabilities now use — the marker '
        + 'says the name is merely held, and it is not',
    ).toEqual([])

    // …and neither side was empty, which every assertion above would pass on.
    expect(CANONICAL_ID_DOMAINS.length, 'the canonical domain list read back empty')
      .toBeGreaterThan(0)
    expect(new Set(registryOpIds().map(domainOf)).size, 'the census produced no domains at all')
      .toBeGreaterThan(0)

    // The list is a SET of domains, not a bag: two rows for one domain is how the retired stub's
    // literal came to hold fifteen entries for fourteen distinct domains (see the fold note).
    const domains = CANONICAL_ID_DOMAINS.map((entry) => entry.domain)
    expect(sorted(new Set(domains)), 'domain-list.ts repeats a domain').toEqual(domains)

    // Every row states what it owns, so "add a domain" is a claim a reviewer can refuse.
    for (const entry of CANONICAL_ID_DOMAINS) {
      expect(entry.charter.trim(), `${entry.domain}: the row states no charter`).not.toBe('')
      expect(entry.domain, `${entry.domain}: a domain is one lowercase id segment`)
        .toMatch(/^[a-z]+$/)
    }
  })

  it('spells every capability id in the grammar both surfaces can carry (D-15)', () => {
    // Carried across from the retired 384 stub, and it is not cosmetic: `chat/tool-names.ts` maps
    // `.` ↔ `_` as a bijection and refuses an id carrying the separator it maps onto, so an id with
    // an underscore is an id the chat surface cannot reach. `authoring.draft.verify` is spelled
    // that way — rather than `authoring.verify_draft` — for exactly this reason.
    const ids = registryOpIds()
    expect(ids.length, 'the census read back empty').toBeGreaterThan(0)
    for (const opId of ids) {
      expect(opId, `${opId}: not a lowercase dot-namespaced id`).toMatch(OP_ID_GRAMMAR)
    }
    // The grammar is not vacuous: the two spellings it exists to refuse are refused.
    expect('authoring.verify_draft', 'the grammar stopped refusing an underscore')
      .not.toMatch(OP_ID_GRAMMAR)
    expect('Runs.Get', 'the grammar stopped refusing an uppercase segment').not.toMatch(OP_ID_GRAMMAR)
  })

  it('control: the domain census fires on an uncatalogued domain, a memberless row and a stale reservation', () => {
    // Driven over the PURE core with synthetic taxonomies, so every branch is exercised without
    // mutating a shipped table and without a skip — and a CLEAN input is fed in the same cell,
    // because a self-check that fires on everything certifies as little as one that fires on
    // nothing (the 394 Edge-Coverage-Register lesson, made mechanical).
    const live = registryOpIds()

    expect(domainCensus(live), 'the shipped taxonomy must diff to nothing against the live ids')
      .toEqual({ uncatalogued: [], memberless: [], staleReservations: [] })

    // (a) an id whose domain is on no row.
    expect(
      domainCensus([...live, SYNTHETIC_UNCATALOGUED_DOMAIN_OP_ID]).uncatalogued,
      'an op carrying a domain the list does not pin must be named on the uncatalogued side',
    ).toEqual([SYNTHETIC_UNCATALOGUED_DOMAIN_OP_ID])

    // (b) a row no id matches, carrying no reserved marker.
    const withAMemberlessRow: readonly CanonicalDomain[] = [
      ...CANONICAL_ID_DOMAINS,
      { domain: SYNTHETIC_MEMBERLESS_DOMAIN, charter: 'control 397-08: a row nothing uses' },
    ]
    expect(
      domainCensus(live, withAMemberlessRow).memberless,
      'a pinned domain no capability uses, with no reserved marker, must be named',
    ).toEqual([SYNTHETIC_MEMBERLESS_DOMAIN])
    // …and the SAME row goes quiet once it carries a marker, which is the marker's whole job.
    expect(
      domainCensus(live, [
        ...CANONICAL_ID_DOMAINS,
        {
          domain: SYNTHETIC_MEMBERLESS_DOMAIN,
          charter: 'control 397-08: a row nothing uses',
          reserved: 'control 397-08: held deliberately',
        },
      ]).memberless,
      'a dated reserved marker must silence the memberless side for that row and no other',
    ).toEqual([])

    // (c) a reservation the ids have overtaken.
    expect(
      domainCensus([...live, `${SYNTHETIC_RESERVED_DOMAIN}.probe`], [
        ...CANONICAL_ID_DOMAINS,
        {
          domain: SYNTHETIC_RESERVED_DOMAIN,
          charter: 'control 397-08: a held name',
          reserved: 'control 397-08: held, but an op arrived',
        },
      ]).staleReservations,
      'a reserved row that shipped ids now use must be named on the stale side',
    ).toEqual([SYNTHETIC_RESERVED_DOMAIN])

    // …and dropping a real domain from the taxonomy reds the mandatory side, which is the case a
    // list-shaped guard is most likely to be silently wrong about.
    const withRunsDropped = CANONICAL_ID_DOMAINS.filter((entry) => entry.domain !== 'runs')
    expect(
      domainCensus(live, withRunsDropped).uncatalogued.map(domainOf),
      'deleting a live domain from the list must name every op that used it',
    ).toEqual(live.filter((opId) => domainOf(opId) === 'runs').map(() => 'runs'))
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

  it('refuses by NAME every capability this composition cannot run — covered, not missing', async () => {
    // PITFALL 11, re-derived here from the retired 384 stub (397-08, D-10). `unbound` is
    // COVERED-BUT-UNBOUND, not missing: a declared-but-unbound capability has a contract, a listing
    // row, a gate verdict and an audit trail, and reading it as a hole in the API is the silent gap
    // `bindingStatus` exists to prevent. The claim it carries is that the refusal is ATTRIBUTABLE —
    // the error names the op, so a caller can tell "this host cannot run that" from "that does not
    // exist" and from "you were not granted it".
    //
    // WHY IT LANDS HERE RATHER THAN STAYING IN `packages/agent`. It needs an input per op — and the
    // scenario table is the ONE place those live now. Restating them agent-side would have rebuilt
    // the second denominator this plan just retired.
    //
    // The caller is minted per declaration off its own `requiredScopes` with a human origin, and the
    // ask tier is standing-approved, so nothing here can be refused on an axis that precedes the
    // binding check and be mistaken for a binding refusal (the 387-08 measurement).
    const registry = conformanceRegistry({
      resolveExecutionContext: conformanceResolveExecutionContext,
      standingApprovalReader: () => EVERY_ASK_STANDING_APPROVED,
    })
    const unbound = registry
      .list(CONFORMANCE_CENSUS_CALLER)
      .filter((declaration) => declaration.bindingStatus === 'unbound')

    // Not an assertion that the count stays where it is — that the state EXISTS and is refused
    // distinctly. A composition binding everything would pass the loop below on zero iterations.
    expect(unbound.length, 'no capability reads unbound here, so this cell measured nothing')
      .toBeGreaterThan(0)

    for (const declaration of unbound) {
      const row = scenarioRowFor(declaration.id)
      expect(row, `${declaration.id}: no scenario row, so no input to reach the binding check with`)
        .toBeDefined()

      let thrown: unknown
      try {
        await invokeFunction(
          registry,
          declaration.id,
          (row as { input: unknown }).input,
          coveringCallerFor(declaration),
        )
      } catch (error) {
        thrown = error
      }

      // ASSERTED ON THE SHAPE OF THE ANSWER, never on "it threw": 397-04 measured a cell passing
      // because a `TypeError` was read as a dispatch. Both fields are checked, because the name
      // alone would not say WHICH capability the host refused.
      const error = thrown as { name?: string; functionId?: string } | undefined
      expect(
        { name: error?.name, functionId: error?.functionId },
        `${declaration.id}: an unbound capability must refuse by name at the binding check — a `
          + 'refusal on any other axis certifies nothing about binding',
      ).toEqual({ name: 'FunctionNotBoundError', functionId: declaration.id })
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

  it('carries the DATED 408 ruling in the shipped credential-mint reason (408 D-01 / D-14)', () => {
    // WHY THIS CELL EXISTS. `credential-mint-deferral` was admitted in 403 for one reason: the op
    // hands out a credential and WHO MAY MINT ONE OVER MCP was left to Phase 408. 408 D-01 answered
    // it — internal mint only, the token confined to host-rendered App HTML, a projected mint tool
    // rejected — and D-14 requires that answer RECORDED rather than silently absorbed. The record
    // lives in the shipped `UNPROJECTED_OPS` prose, which is the artifact a reader actually meets,
    // so this cell reads it there. A future rewrite that tidies the entry back into a bare
    // deferral, or drops the date, reds HERE by name instead of leaving a permanent absence
    // wearing an open question's clothes.
    // CORRECTED 2026-09-01 (408-08, the gap round, road `demote`; the ruling is in
    // `app-resource.ts`'s header and `mapping.ts`'s reason carries the same dated addendum). The
    // rationale above summarises D-01 as "the token confined to host-rendered App HTML", and that
    // half is WITHDRAWN rather than reworded away: whether the document this server serves is
    // host-rendered HTML or text a model consumes is a property of the CALLER, not of this server.
    // What holds is that the server writes the token into exactly one place — the frame src of the
    // document the `ui://` read serves — bounded by the operator-granted `read` scope plus a bound
    // mint. This is the most load-bearing of the four sites the 408-15 census found, because THIS
    // cell is the one that gates the shipped ruling prose: a gate whose own stated reason asserts a
    // withdrawn claim teaches every reader of it the thing the gate exists to stop. The assertions
    // below are untouched by the correction — the ruling they read is dated 2026-08-31 and is what
    // 408 actually decided; only this rationale's gloss on its channel was ever wrong.
    const entry = UNPROJECTED_OPS.find((candidate) => candidate.opId === 'runs.liveurl')
    expect(entry, 'runs.liveurl left the unprojected register — re-home this ruling before it does')
      .toBeDefined()
    // The class must still DERIVE from the prose: the ruling is an addendum to the 403 reason, not
    // a replacement of it, so the signature phrase the classifier keys on has to survive the edit.
    expect(
      unprojectedReasonKeyOf(entry!.reason),
      'the 408 ruling must EXTEND the credential reason, not overwrite the phrase its class derives '
        + 'from — a resolution that changes the class silently re-files a security decision',
    ).toBe('credential-mint-deferral')
    expect(entry!.reason, 'the credential fact the class is named for').toContain('MINTS A CREDENTIAL')
    // …and the ruling itself, dated, with its operative words.
    expect(entry!.reason, 'the dated 408 ruling marker (D-14: answered, never silently reclassified)')
      .toContain('408 D-01')
    expect(entry!.reason, 'the ruling is dated at its own artifact').toContain('2026-08-31')
    expect(entry!.reason, 'what 408 actually ruled').toContain('INTERNAL MINT ONLY')
    // The adjudicator column moves with the ruling: 403 deferred, 408 decided.
    expect(
      entry!.adjudication,
      'the provenance column still credits 403 with a ruling it explicitly declined to make',
    ).toBe('408')
    // And the row is unchanged in the one way that matters: the op is STILL unprojected. D-01
    // answered the question with a NO, so a resolution that quietly produced a tool would be the
    // opposite outcome wearing the same paperwork.
    expect(
      scenarioRowFor('runs.liveurl')?.perSurface.mcp,
      'the ruling keeps runs.liveurl unprojected — a mint tool is rejected, not deferred',
    ).toEqual({ unprojected: 'credential-mint-deferral' })
  })

  it('EDITOR-LIVEURL-UNPROJECTED-RULING: editor.liveurl stays unprojected by the 428 ruling (428 D-07)', () => {
    // D-07: an editor session's view credential is private to the dashboard page that owns it, and
    // the owner declined an MCP watch carrier for a draft execution. mapping-bump-guard pins the
    // counts; this cell pins the ruling on the conformance layer, so a mint tool for an editor
    // session reds here by name as well.
    const entry = UNPROJECTED_OPS.find((candidate) => candidate.opId === 'editor.liveurl')
    expect(entry, 'editor.liveurl left the unprojected register — re-home this ruling before it does')
      .toBeDefined()
    expect(
      unprojectedReasonKeyOf(entry!.reason),
      'the 428 ruling files the editor mint under the credential class, as runs.liveurl is filed',
    ).toBe('credential-mint-deferral')
    expect(entry!.reason, 'the credential fact the class is named for').toContain('MINTS A CREDENTIAL')
    expect(entry!.reason, 'the dated 428 ruling marker').toContain('2026-09-25')
    expect(entry!.adjudication, 'the provenance column credits the phase that ruled').toBe('428')
    expect(
      scenarioRowFor('editor.liveurl')?.perSurface.mcp,
      'the ruling keeps editor.liveurl unprojected — an editor watch tool is declined, not deferred',
    ).toEqual({ unprojected: 'credential-mint-deferral' })
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

  it('joins every row fn expectation to the live fn listing, in both directions', () => {
    // 2026-08-20 (399.1 D-07), the chat cell above with the third door substituted. The comparand
    // is the door's OWN `--list --json` stdout, folded through commander and the CLI composition
    // root — not this file's reading of a registry — so a `fn` listing that started filtering (a
    // narrowed CLI grant, a safe-mode default, a projection that dropped a column) reds here by
    // name rather than being absorbed by a comparison of the census against itself.
    const fnReach = enumerationOf('fn').opIds
    for (const row of SCENARIO_TABLE) {
      expect(
        fnReach.has(row.opId),
        `${row.opId} on fn: the row claims reachable=${String(row.perSurface.fn.reachable)}, `
          + 'and the shipped `agent-qa fn --list` disagrees',
      ).toBe(row.perSurface.fn.reachable)
    }
    for (const opId of sorted(fnReach)) {
      expect(
        scenarioRowFor(opId)?.perSurface.fn.reachable,
        `${opId} on fn: listed by the shipped command and claimed by no row`,
      ).toBe(true)
    }
  })

  it('joins the dashboard door\'s served listing to the registry census, in both directions', () => {
    // 2026-08-21 (400-01, D-12), the `fn` cell's shape with the fourth door substituted and the
    // CENSUS as the comparand rather than the scenario table's per-surface column.
    //
    // WHY THE CENSUS AND NOT A `perSurface.dashboard` COLUMN. The two are different claims and only
    // one of them is true of this door. MCP projects a SUBSET (a declared partition, with rows
    // saying which ops have no tool), and chat and `fn` each carry their own reachability column
    // because their routes can differ from the catalogue. The dashboard door dispatches ONE op and
    // lists the registry it dispatches through, so "reachable here" and "declared at all" are the
    // same set by construction — and a column restating that for 42 rows would be 42 places for the
    // restatement to rot. What this cell asserts is the construction itself, in both directions.
    //
    // THE COMPARANDS ARE NOT THE SAME OBJECT. One side is the door's own HTTP response bytes, taken
    // over a socket through the router, the injected-host seam, the door's caller mint and JSON
    // serialisation; the other is `registryOpIds()`. A door that started filtering — a narrowed
    // grant, a safe-mode default, a projection that dropped a column — shrinks one side and not the
    // other, and reds here by name.
    const dashboardReach = enumerationOf('dashboard').opIds
    expect(
      sorted(dashboardReach),
      'the dashboard door\'s served listing and the registry census must be one set: this door '
        + 'reaches every capability through one gated op and lists the registry it dispatches '
        + 'through, so a difference in either direction is a filter nobody declared',
    ).toEqual(sorted(censusIds))
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
    // THE GATE SAW *THIS* CALL — and that is a differential, not a presence check.
    //
    // 397-09 MEASURED THE PRESENCE CHECK VACUOUS FOR THIS OP, which is why it is written this way.
    // The first spelling asserted only that SOME `fn:proposals.list` row existed after the drive,
    // and called that "the observation the D-14 ungated mutation has to be able to break". It could
    // not break it: `chat/banner.ts` invokes `proposals.list` (with `{ status: 'pending' }`)
    // through the same gate when the session OPENS, so a row for this action class is written on
    // every drive whatever the clause does. Rerouting the clause's dispatch around `invokeFunction`
    // left that row untouched and the cell stayed green — a capability outside the gate, with this
    // cell reporting that the gate had seen it. The cell was green for a reason nobody chose.
    //
    // The fix is a two-drive differential rather than a bigger claim about one drive: a drive of a
    // DIFFERENT capability establishes what the session's own opening reads write by themselves,
    // and this drive must write STRICTLY MORE. `config.get` is the baseline subject because the
    // banner's three opening reads are `proposals.list`, `runs.list` and `runs.digest`, and it is
    // none of them — so its drive contributes nothing to the count being compared.
    const baselineRow = scenarioRowFor('config.get')
    expect(baselineRow, 'the scenario table no longer carries config.get').toBeDefined()
    const baselineDrive = await driveChatDispatch({
      opId: 'config.get',
      input: baselineRow!.input,
    })
    const rowsFrom = (drive: typeof outcome): number =>
      drive.auditRows.filter((auditRow) => auditRow.action === pinClassFor('proposals.list')).length
    const openingReads = rowsFrom(baselineDrive)
    expect(
      rowsFrom(outcome),
      `proposals.list on chat: this drive must add a gate row of its own beyond the `
        + `${openingReads} the session's opening reads write by themselves — otherwise the clause `
        + 'dispatched outside the gate and this cell would still be green',
    ).toBeGreaterThan(openingReads)
  })

  it('drives a capability through the dashboard door\'s own composed dispatch, model-free', async () => {
    // 2026-08-21 (400-01, D-09/D-12), the plan-04 tracer with the fourth door substituted, and it
    // is the cell that makes the roster row mean something: an enumeration reads a listing, and a
    // capability rerouted around `invokeFunction` still appears in every listing it ever appeared
    // in. Only a drive can tell those two worlds apart.
    //
    // WHAT PRODUCES THIS ANSWER: a real `node:http` server on an ephemeral port, the shipped
    // `createChatRouter`, the shipped `composeDashboardDoor`, one `invokeFunction(agent.ask, …)`,
    // the shipped resolver's `/fn` branch, the composition's caller mint, the gate. The receipt read
    // back is the record the served payload renders, taken off the session log rather than off the
    // response — the same reading its chat neighbour makes, over the SAME session substrate (D-04).
    const row = scenarioRowFor('proposals.list')
    expect(row, 'the scenario table no longer carries proposals.list').toBeDefined()

    const outcome = await driveDashboardDispatch({ opId: 'proposals.list', input: row!.input })

    expect(
      outcome.httpStatuses,
      'the door answered something other than 200 — a turn that carried a verdict would not',
    ).toEqual([200])
    expect(
      outcome.unhandled,
      'the generic /fn route failed to resolve the clause the driver typed — the surface never '
        + 'reached a dispatch, so nothing below is a statement about a verdict',
    ).toEqual([])
    expect(outcome.receipt?.status, 'proposals.list on dashboard: the surface reached a definitive '
      + 'outcome').toBe('executed')
    // ORIGIN IS THE MODEL-FREE PROOF, on the chat cell's own reasoning: the deterministic route
    // mints `human` and the planner route mints `agent` (391 D-06), so a receipt stamped `human`
    // cannot have been planned by a model — and this door is composed with no model at all.
    expect(outcome.receipt?.origin, 'proposals.list on dashboard: the receipt must come from the '
      + 'deterministic route, or a model planned this call').toBe('human')

    // THE GATE SAW *THIS* CALL, as a two-drive differential rather than a presence check — 397-09
    // measured the presence check VACUOUS for this op, because the session's own opening banner
    // reads `proposals.list` through the same gate. `config.get` is the baseline for the reason the
    // chat cell states: it is none of the three ops the banner reads, so its drive contributes
    // nothing to the count being compared.
    const baselineRow = scenarioRowFor('config.get')
    expect(baselineRow, 'the scenario table no longer carries config.get').toBeDefined()
    const baselineDrive = await driveDashboardDispatch({
      opId: 'config.get',
      input: baselineRow!.input,
    })
    const rowsFrom = (drive: typeof outcome): number =>
      drive.auditRows.filter((auditRow) => auditRow.action === pinClassFor('proposals.list')).length
    const openingReads = rowsFrom(baselineDrive)
    expect(
      rowsFrom(outcome),
      `proposals.list on dashboard: this drive must add a gate row of its own beyond the `
        + `${openingReads} the session's opening reads write by themselves — otherwise the clause `
        + 'dispatched outside the gate and this cell would still be green',
    ).toBeGreaterThan(openingReads)
  }, 120_000)

  it('refuses at the DASHBOARD SURFACE WALL for every capability, through its own dispatch', async () => {
    // WALL TWO of two for the fourth door, over its own producer and in its own cell — D-11's rule
    // that two walls averaged into one assertion is one wall. No expression in this body touches
    // `invokeFunction`; the refusal observed is `FunctionDeniedError`, the class the gate's `deny`
    // and nothing else produces, corroborated by the gate's own audit row naming the action class
    // and `session-pin-denied` as the outcome that produced it.
    //
    // A CAPABILITY REROUTED AROUND `invokeFunction` CANNOT BE PINNED: it would execute, this cell
    // would see `executed`, and it would red by name for that op. That is the mutation bar the
    // roster row exists to hold this door to, and it now holds it for all forty-two.
    //
    // THE PIN IS SESSION-SCOPED AND THE DRIVE THREADS THE SESSION ID (392 W-03), which is the one
    // thing this transport has to get right that the REPL got for free: each POST is a turn, and a
    // driver that started a fresh conversation for the second turn would have a pin that applied to
    // nothing while reading exactly like one that worked.
    for (const row of SCENARIO_TABLE) {
      const outcome = await driveDashboardDispatch({
        opId: row.opId,
        input: row.input,
        pinBefore: [pinClassFor(row.opId)],
      })
      expect(
        outcome.httpStatuses,
        `${row.opId} on dashboard (surface wall): a refusal must ride a 200 carrying a receipt, `
          + 'never an HTTP error — status from the result, never from the transport (DASH-01)',
      ).toEqual([200, 200])
      expect(
        outcome.unhandled,
        `${row.opId} on dashboard (surface wall): the generic route did not resolve the clause, so `
          + 'this drive never reached a dispatch and its refusal would be a routing failure',
      ).toEqual([])
      expect(
        outcome.receipt?.status,
        `${row.opId} on dashboard (surface wall): the surface did not refuse a pinned capability`,
      ).toBe('failed')
      expect(
        outcome.receipt?.outcome,
        `${row.opId} on dashboard (surface wall): the refusal must be the gate's own — an input or `
          + 'unknown-id refusal would look the same to a person and mean the gate never ran',
      ).toBe('FunctionDeniedError')
      const denials = outcome.auditRows.filter(
        (auditRow) => auditRow.action === pinClassFor(row.opId) && auditRow.verdict === 'deny',
      )
      expect(
        denials.map((auditRow) => auditRow.outcome),
        `${row.opId} on dashboard (surface wall): the gate wrote no deny row for this action `
          + 'class, so nothing attributes the surface\'s refusal to the gate',
      ).toContain('session-pin-denied')
      expect(
        outcome.lastHeaders?.get('access-control-allow-origin'),
        `${row.opId} on dashboard (surface wall): the mutating turn route wrote a cross-origin `
          + 'wildcard (T-400-03) — that header is an SSE read idiom and never a POST one',
      ).toBeNull()
    }
  }, 300_000)

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
      // 419 D-20: the declared credential wall refuses direct anonymous calls in-band,
      // before input parsing. Preserve the protocol wall for every scope-only projection.
      const projection = AGENT_QA_TOOL_PROJECTIONS.find(candidate => candidate.name === tool)!
      if (projection.credential === 'required') {
        expect(called.answered, `${row.opId}: the credential wall must give its typed remedy`).toBe(true)
        if (!called.answered) throw new Error('missing credential refusal')
        expect(called.isError).toBe(true)
        expect(called.structured?.['status']).toBe('credential-required')
        expect(called.structured?.['applied']).toBe(false)
        expect(called.text).toContain('present a bearer whose scopes include `knowledge-write`')
        continue
      }
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
          confirm: { surface: 'tty-prompt', ask: () => { consulted.chat = true; return false } },
        }),
        mcp: await gateAnswerFor(declaration.id, row!.input, callers.mcp, {
          resolveExecutionContext: conformanceResolveExecutionContext,
          confirm: { surface: 'tty-prompt', ask: () => { consulted.mcp = true; return false } },
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
        confirm: { surface: 'tty-prompt', ask: () => { consulted[side] = true; return false } },
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
      const args = projection.kind === 'apply' && projection.credential !== 'required'
        // The apply door's own argument name, read off the op's contract rather than typed: its
        // input carries exactly one field and the tool spells it in snake case.
        ? { proposal_id: (row!.input as { proposalId: string }).proposalId }
        : (row!.input as Record<string, unknown>)
      const answered = await driveMcpCall({ toolName: projection.name, args, grantedScopes: everyScope })
      expect(answered.answered, `${opId} on mcp (ask): the protocol refused the call outright`)
        .toBe(true)
      const inBand = answered as Extract<typeof answered, { answered: true }>
      if (projection.credential === 'required') {
        bandRefusals += 1
        expect(inBand.isError, `${opId}: anonymous credential-required call must refuse`).toBe(true)
        expect(inBand.structured?.['status']).toBe('credential-required')
        expect(inBand.structured?.['applied']).toBe(false)
        expect(inBand.text).toContain('present a bearer whose scopes include `knowledge-write`')
      } else if (projection.kind === 'apply') {
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

  it('observes each surface through its own dispatch, never through the gate directly', () => {
    // PITFALL 5, AS A SOURCE ASSERTION. Every behavioural cell above would pass over a driver that
    // called `invokeFunction` itself — and such a driver is blind to D-14's ungated-op mutation by
    // construction, because the thing the mutation removes is the very call the driver would be
    // making. Comments are stripped first so this file's own prose may name what the driver's body
    // must not.
    //
    // 2026-08-21 (400-01): the sweep now covers the dashboard driver too, and it covers it by
    // covering the FILE rather than by naming a function — which is what makes a fourth driver
    // added later inherit the rule instead of having to be remembered.
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
    // …and the sweep is over the real file rather than an empty string. Each driver's own shipped
    // entry point is named, so a file that had stopped driving a surface reads as an empty sweep
    // here rather than as a pass.
    expect(code, 'the surface-dispatch source read back empty').toContain('createChatCommand')
    expect(code, 'the dashboard driver no longer drives the shipped router')
      .toContain('createChatRouter')
    expect(code, 'the dashboard driver no longer composes the shipped door')
      .toContain('composeDashboardDoor')
    // The context is injected on both doors, on policy-fixtures.ts's rule (Pitfall 3) — but by two
    // MECHANISMS, and the difference is a product fact rather than a preference. The CLI chat
    // command resolves its context ambiently, so its driver sets and restores the process resolver;
    // the dashboard door takes `resolveExecutionContext` as a composition input (400-01), so the
    // posture travels with the door and there is nothing to restore. Both are asserted, so a driver
    // that quietly started inheriting the process's answer reds.
    expect(code, 'the chat driver must inject the execution context it decides under')
      .toContain('setActiveExecutionContextResolver')
    expect(code, 'the dashboard driver must inject the execution context it decides under')
      .toContain('resolveExecutionContext:')
  })

  // ---- The golden capability ledger (plan 06 — FUNC-05 leg 6, D-05/D-06/D-07/D-08) --------------
  //
  // WHAT THIS SECTION ADDS THAT NOTHING ABOVE HAS. Every leg above is a statement about the tree as
  // it stands: what is reachable, what refuses, what agrees. All of them stay green while a scope is
  // widened, a risk tier is lowered or a capability is moved out of the MCP partition, because each
  // of those leaves a self-consistent tree. The ledger is the one artifact that compares the product
  // against its own past, and the comparison is readable: one line per field per capability.

  it('matches the committed golden registry, op by op and field by field', () => {
    // A MISSING LEDGER IS A RED, NEVER A SKIP. Until the file is minted this is the only cell in the
    // directory that fails, and it fails saying exactly what to do about it.
    expect(
      existsSync(GOLDEN_PATH),
      `the committed capability ledger ${GOLDEN_FILE_NAME} does not exist — ${GOLDEN_REGEN_INSTRUCTION}`,
    ).toBe(true)

    const committedText = readFileSync(GOLDEN_PATH, 'utf8')
    const committed = JSON.parse(committedText) as GoldenFile
    const live = goldenFileOf(rootDeclarations)

    // Non-vacuity first: a comparison over zero rows passes for the wrong reason, and this cell is
    // the one most able to. The census leg above owns the registry ≡ scenario-table equality; the
    // ledger joins that same denominator rather than starting a third.
    expect(live.rows.length, 'the ledger was minted over no capabilities at all').toBe(
      censusIds.length,
    )
    expect(live.rows.length, 'the registry census read back empty').toBeGreaterThan(0)
    expect(
      sorted(live.rows.map((row) => row.id)),
      'the ledger and the registry census must range the same capabilities',
    ).toEqual(sorted(censusIds))
    expect(
      sorted(committed.rows.map((row) => row.id)),
      'the COMMITTED ledger and the scenario table must range the same capabilities, in both '
        + `directions — a capability with no ledger row is a capability nobody reviewed; ${GOLDEN_REGEN_INSTRUCTION}`,
    ).toEqual(sorted(scenarioTableOpIds()))

    const findings = goldenFindings(live.rows, committed.rows)
    const committedById = new Map(committed.rows.map((row) => [row.id, row]))

    // PER OP, STRUCTURALLY. The label names the capability and the FIELDS that moved; the diff
    // vitest prints under it is the structure itself. A bare digest inequality — "expected 9f3a… to
    // be 71bc…" — is what D-06 forbids, and it is what a comparison of two hashes can only ever say.
    for (const row of live.rows) {
      const moved = goldenFieldsThatMoved(findings, row.id)
      const label = moved.length === 0
        ? `${row.id}: the golden pins a different declaration projection`
        : `${row.id}: the golden pins a different ${moved.join(', ')} — if this change is `
          + `intended, ${GOLDEN_REGEN_INSTRUCTION}`
      expect(row, label).toEqual(committedById.get(row.id))
    }

    // The whole-set view, so a run reports every disagreement rather than the first one.
    expect(
      findings.map((finding) => finding.message),
      `the live registry and the committed ledger disagree; ${GOLDEN_REGEN_INSTRUCTION}`,
    ).toEqual([])

    expect(committed.opCount, 'the ledger\'s own count sentence disagrees with its rows')
      .toBe(committed.rows.length)
    expect(committed.$note, `the ledger's note was edited by hand; ${GOLDEN_REGEN_INSTRUCTION}`)
      .toEqual(live.$note)

    // LAST, AND ONLY AFTER EVERY NAMED COMPARISON ABOVE: the bytes. This catches a reformat, a lost
    // trailing newline or a key order the canonical serializer would not have produced — real drift
    // in the committed artifact that a structural comparison cannot see. It runs last so that a
    // genuine field change is named by the loop above rather than reported as a 40 kB text diff.
    expect(
      goldenFileText(live) === committedText,
      'the ledger\'s BYTES differ from the canonical serialization while every field agrees — the '
        + `file was reformatted or hand-edited; ${GOLDEN_REGEN_INSTRUCTION}`,
    ).toBe(true)

    // AND THE INSTRUCTION IS FOLLOWABLE. Every message above tells a reader to run one script; a
    // message naming a file that does not exist is worse than no message. Asserted here, where the
    // instruction is written, rather than in the prohibition cell below — so a missing ledger and a
    // missing regen script are one red rather than two saying the same thing.
    expect(
      existsSync(join(CONFORMANCE_DIR, '..', '..', '..', '..', '..', GOLDEN_REGEN_SCRIPT)),
      `${GOLDEN_REGEN_SCRIPT} is named by every ledger failure message but does not exist`,
    ).toBe(true)
  })

  it('mints the ledger deterministically, and offers the regen script a print rather than a write', async () => {
    // TWO INDEPENDENT COMPOSITIONS, in two different temp workspaces, compared byte for byte. That
    // is a stronger claim than calling the projection twice on one listing: it rules out a
    // workspace path, a clock or a per-composition identity reaching a digest, which is the way a
    // generated ledger becomes a file that reds on every regeneration and is therefore never
    // regenerated.
    const fresh = await withGoldenRootRegistry((registry) =>
      goldenFileText(goldenFileOf(registry.list(CONFORMANCE_CENSUS_CALLER))),
    )
    expect(fresh, 'two compositions of the one root minted two different ledgers').toBe(
      goldenFileText(goldenFileOf(rootDeclarations)),
    )

    // The committed SHAPE: pretty canonical JSON, sorted keys at every level, exactly one trailing
    // newline. Asserted as idempotence under the workspace's own serializer rather than by
    // inspecting the string, so this cell cannot disagree with the file the script writes.
    expect(committedFileText(JSON.parse(fresh)), 'the ledger text is not in canonical committed form')
      .toBe(fresh)
    expect(fresh.endsWith('\n'), 'the ledger must end in exactly one newline').toBe(true)
    expect(fresh.endsWith('\n\n'), 'the ledger must end in exactly one newline').toBe(false)

    // THE EMIT PORT (D-07). The regen script runs this suite with the flag set and lifts the text
    // out from between the sentinels; the SCRIPT then writes the file, after its own refuse-while-red
    // gate. Nothing here writes anything — see the source assertion two cells below.
    if (goldenEmitRequested()) emitGoldenText(fresh)
  })

  it('projects every declaration field into the ledger, or excludes it with a stated reason', () => {
    // THE NO-SILENT-DROP REGISTER. A projection that lists what it carries loses the next field
    // somebody adds, silently and forever: the ledger keeps its 41 identical rows and the column a
    // reviewer would have wanted never exists. Both sides are accounted, so a new declaration field
    // reds here by name instead of vanishing.
    expect(
      unaccountedGoldenFields(rootDeclarations).map(
        (field) => `${field.opId}: ${field.on}.${field.key}`,
      ),
      'declaration fields the ledger would drop without saying so — project them in golden.ts or '
        + 'add them to the excluded list WITH the reason they are not change-control surface',
    ).toEqual([])

    // The register is over a real census rather than an empty one.
    expect(rootDeclarations.length, 'the field register ranged no declarations').toBe(
      censusIds.length,
    )

    // …and it can fire. A synthetic declaration carrying a key nobody wrote, on each side.
    const sample = rootDeclarations[0]
    expect(sample, 'the census read back empty').toBeDefined()
    const withStrayDeclarationKey = {
      ...(sample as FunctionDeclaration),
      [SYNTHETIC_GOLDEN_STRAY_FIELD]: true,
    } as unknown as FunctionDeclaration
    const withStrayRiskKey = {
      ...(sample as FunctionDeclaration),
      risk: { ...(sample as FunctionDeclaration).risk, [SYNTHETIC_GOLDEN_STRAY_FIELD]: 'x' },
    } as unknown as FunctionDeclaration
    expect(
      unaccountedGoldenFields([withStrayDeclarationKey]).map((field) => `${field.on}.${field.key}`),
      'the register cannot see a new declaration field',
    ).toEqual([`declaration.${SYNTHETIC_GOLDEN_STRAY_FIELD}`])
    expect(
      unaccountedGoldenFields([withStrayRiskKey]).map((field) => `${field.on}.${field.key}`),
      'the register cannot see a new risk-descriptor field',
    ).toEqual([`risk.${SYNTHETIC_GOLDEN_STRAY_FIELD}`])
  })

  it('control: the ledger comparator names the op and the field that moved', () => {
    // THE NAMED-RED REQUIREMENT, DRIVEN. D-06/D-07 ask that a mismatch identify the capability and
    // the field rather than announce that two hashes differ. Proving that by breaking the committed
    // file would be a mutation of a shipped artifact; the comparator is pure, so the three changes
    // D-05 exists to make visible — a widened scope, a lowered tier, a moved partition — are driven
    // over real rows here, plus the two presence columns and the two digests.
    const rows = buildGoldenRows(rootDeclarations)
    expect(goldenFindings(rows, rows), 'a ledger compared against itself must report nothing')
      .toEqual([])

    const subject = rows[0] as GoldenRow
    const mutations: readonly (readonly [string, GoldenRow])[] = [
      ['requiredScopes', { ...subject, requiredScopes: [...subject.requiredScopes, 'config-write'] }],
      ['risk', { ...subject, risk: { ...subject.risk, declaredTier: 'readOnly' } }],
      ['partition', { ...subject, partition: { kind: 'unprojected', reason: 'not-mid-flight-read' } }],
      ['discloses', { ...subject, discloses: true }],
      ['requiresHumanOrigin', { ...subject, requiresHumanOrigin: true }],
      ['inputSchemaDigest', { ...subject, inputSchemaDigest: 'f'.repeat(64) }],
      ['bindingStatusAtRoot', { ...subject, bindingStatusAtRoot: 'unbound' }],
    ]
    for (const [field, mutated] of mutations) {
      const findings = goldenFindings([mutated, ...rows.slice(1)], rows)
      expect(findings.map((finding) => finding.field), `a moved ${field} must be named`)
        .toEqual([field])
      expect(findings[0]?.opId, `a moved ${field} must name the capability`).toBe(subject.id)
      expect(findings[0]?.message, `a moved ${field} must name the capability and the field`)
        .toContain(`${subject.id}.${field}`)
    }

    // Row presence, both directions — the two shapes a capability change takes.
    const strayRow: GoldenRow = { ...subject, id: SYNTHETIC_GOLDEN_STRAY_OP_ID }
    expect(
      goldenFindings(rows, [...rows, strayRow]).map((finding) => finding.opId),
      'a ledger row for a capability the registry no longer declares must be named',
    ).toEqual([SYNTHETIC_GOLDEN_STRAY_OP_ID])
    expect(
      goldenFindings([...rows, strayRow], rows).map((finding) => finding.opId),
      'a capability with no ledger row must be named',
    ).toEqual([SYNTHETIC_GOLDEN_STRAY_OP_ID])
  })

  it('control: the partition join answers all three states, including the uncatalogued one', () => {
    // Pitfall 11's shape at the partition. The third state is reachable only through a synthetic
    // mapping — which is exactly why it is driven here rather than left as a branch nobody has seen.
    const projectingTool = new Map([[SYNTHETIC_GOLDEN_STRAY_OP_ID, 'agent_qa_control_397_06']])
    expect(goldenPartitionOf(SYNTHETIC_GOLDEN_STRAY_OP_ID, projectingTool, [])).toEqual({
      kind: 'projected',
      tool: 'agent_qa_control_397_06',
    })
    expect(
      goldenPartitionOf(SYNTHETIC_GOLDEN_UNCATALOGUED_OP_ID, new Map(), [
        { opId: SYNTHETIC_GOLDEN_UNCATALOGUED_OP_ID, reason: 'a mid-flight workflow read' },
      ]),
    ).toEqual({ kind: 'unprojected', reason: 'not-mid-flight-read' })
    expect(
      goldenPartitionOf(SYNTHETIC_GOLDEN_UNCATALOGUED_OP_ID, new Map(), []),
      'a capability in neither half of the mapping must read uncatalogued, never a missing key',
    ).toEqual({ kind: 'uncatalogued' })

    // …and no LIVE capability sits in that third state.
    for (const row of buildGoldenRows(rootDeclarations)) {
      expect(
        row.partition.kind,
        `${row.id}: the declared mapping neither projects this capability nor declares it `
          + 'unprojected — it is catalogued nowhere',
      ).not.toBe('uncatalogued')
    }
  })

  it('censuses binding status at the one shipped composition root, spelling the third state', () => {
    // D-08. THE COLUMN IS A FACT ABOUT A COMPOSITION, not about the catalogue, and that is what
    // makes reading it off the RIGHT composition load-bearing. `composeCliLocalAgent` — the function
    // every shipped CLI surface composes through — binds all 41; this suite's own enumeration
    // registry supplies empty deps and binds 11. Same 41 capabilities, different answers.
    for (const declaration of rootDeclarations) {
      expect(
        ['bound', 'unbound'],
        `${declaration.id}: binding status at the root must be one of the two spelled states, `
          + 'never absent (Pitfall 11: the third state is data)',
      ).toContain(declaration.bindingStatus)
    }

    const suiteRegistryStatuses = new Map(
      registryDeclarations().map((declaration) => [declaration.id, declaration.bindingStatus]),
    )
    expect(
      sorted(suiteRegistryStatuses.keys()),
      'the two compositions must declare the same capabilities — binding is not membership',
    ).toEqual(sorted(rootDeclarations.map((declaration) => declaration.id)))

    // MEASURED 2026-08-16: 41 bound at the CLI root, 11 bound under empty deps, so 30 disagree. The
    // assertion is that the disagreement is NON-EMPTY rather than that it is thirty, because the
    // claim is "this column describes a composition" and a host binding one more capability is not
    // a reason for this cell to red. A ledger built off the suite's own registry instead of the
    // root would make this set empty, which is the mistake it exists to catch.
    const disagree = rootDeclarations.filter(
      (declaration) => suiteRegistryStatuses.get(declaration.id) !== declaration.bindingStatus,
    )
    expect(
      disagree.length,
      'the composition root and the empty-deps enumeration registry agree on every capability, so '
        + 'the ledger\'s binding column may be reading the wrong composition',
    ).toBeGreaterThan(0)

    // THE COLUMN HAS ONE PRODUCER, AND IT IS A READ. A hand-typed op → status map would satisfy
    // every assertion above on the day it was written and describe a composition nobody builds a
    // week later; `golden.ts` therefore spells neither status anywhere in its code. Comments are
    // stripped first, so its own docstrings may explain the states it must not literalise.
    const goldenCode = commentStrippedSource('golden.ts')
    expect(goldenCode, 'the ledger\'s binding column must be READ off the root\'s declaration')
      .toContain('bindingStatusAtRoot: declaration.bindingStatus')
    for (const status of ['bound', 'unbound']) {
      expect(goldenCode, `golden.ts spells the binding status '${status}' instead of reading it`)
        .not.toContain(`'${status}'`)
    }

    // The ledger's column is the ROOT's answer, per op.
    const rowById = new Map(buildGoldenRows(rootDeclarations).map((row) => [row.id, row]))
    for (const declaration of rootDeclarations) {
      expect(rowById.get(declaration.id)?.bindingStatusAtRoot, `${declaration.id}: ledger column`)
        .toBe(declaration.bindingStatus)
    }
  })

  it('agrees with the composition root on every capability each surface host can see', () => {
    // D-08's DIVERGENCE ASSERTION: "lists bound here, refuses there" is the disagreement
    // `resolveBindingStatus` exists to prevent, and the only way it can arise is a surface host that
    // composes a registry of its own. Each shipped host's listing — the chat host's two stage mints,
    // the MCP host's default and every-scope grants — is compared to the root's answer per
    // capability. The cell below pins the structural reason this holds.
    const rootStatus = new Map(
      rootDeclarations.map((declaration) => [declaration.id, declaration.bindingStatus]),
    )
    let compared = 0
    for (const [host, listing] of rootHostListings) {
      expect(listing.length, `${host}: the host listed no capabilities at all`).toBeGreaterThan(0)
      for (const declaration of listing) {
        expect(
          declaration.bindingStatus,
          `${declaration.id}: lists ${declaration.bindingStatus} on the ${host} host and `
            + `${rootStatus.get(declaration.id)} at the composition root`,
        ).toBe(rootStatus.get(declaration.id))
        compared += 1
      }
    }
    // Non-vacuity, and the shape of the roster's own claim: four listings, none of them empty.
    expect(rootHostListings.size, 'no surface host listing was taken').toBe(4)
    expect(compared, 'the divergence cell compared nothing').toBeGreaterThan(censusIds.length)
  })

  it('pins that neither surface host composes a registry of its own', () => {
    // WHY THIS CELL EXISTS BESIDE THE ONE ABOVE. That comparison is taken over the registry object
    // the shipped hosts hand their surface, so it can only stay meaningful while that remains true.
    // A host that built its own registry would answer its own questions consistently and diverge
    // from the root invisibly. Comments are stripped so this file may name what those files must not
    // contain.
    for (const command of ['mcp.ts', 'chat.ts']) {
      const code = commentStrippedFile(join(CONFORMANCE_DIR, '..', '..', 'commands', command))
      expect(code, `commands/${command} read back empty`).toContain('composeCliLocalAgent')
      expect(
        code,
        `commands/${command} composes a function registry of its own instead of taking the `
          + 'composition root\'s — a host with its own registry can list bound and refuse',
      ).not.toContain('createFunctionRegistry')
    }
  })

  it('never writes the golden ledger: the only writer is the regen script (D-07)', () => {
    // THE PROHIBITION, AS SOURCE. "A capability ledger must not be one keystroke from silently
    // blessed" is a claim about what this directory CAN do, not about what it happens to do today,
    // so the sweep ranges every file in the directory — including one added tomorrow — rather than
    // a list written now.
    const files = readdirSync(CONFORMANCE_DIR).filter((name) => name.endsWith('.ts'))
    expect(files.length, 'the conformance directory read back empty').toBeGreaterThan(4)

    // ASSEMBLED FROM FRAGMENTS, on `compose-authority-topology.test.ts`'s precedent and for its
    // reason: the sweep ranges every `.ts` file in this directory, THIS FILE INCLUDED, so a
    // forbidden token written out here would be the sweep reading its own prohibition as the defect.
    // Measured: it did, the first time this cell ran.
    const forbidden: readonly string[] = [
      ['toMatch', 'Snapshot'].join(''),
      ['toMatch', 'File', 'Snapshot'].join(''),
      ['toMatch', 'Inline', 'Snapshot'].join(''),
      ['writeFileSync(', 'GOLDEN_PATH'].join(''),
      ['writeFile(', 'GOLDEN_PATH'].join(''),
      ['appendFileSync(', 'GOLDEN_PATH'].join(''),
    ]
    let nameMentions = 0
    for (const file of files) {
      const code = commentStrippedSource(file)
      nameMentions += code.split(GOLDEN_FILE_NAME).length - 1
      for (const token of forbidden) {
        expect(code, `${file} carries a path that could bless the ledger: ${token}`)
          .not.toContain(token)
      }
    }
    // The ledger's own file name appears exactly once in the directory — as the constant golden.ts
    // resolves the read path from. A second spelling is a second place a writer could open it.
    expect(nameMentions, `${GOLDEN_FILE_NAME} is spelled more than once in the conformance sources`)
      .toBe(1)

    // …and the sweep is not vacuous: every forbidden shape is recognised in a control that carries
    // it, so a fragment assembled wrong cannot leave the sweep quietly searching for nothing.
    for (const token of forbidden) {
      expect(`prefix ${token} suffix`, `the sweep no longer recognises ${token}`).toContain(token)
    }
  })

  // ---- FUNC-05 leg 2: structural schema equality, per OP, through ONE lens (D-06) ---------------

  it('advertises, for every projected capability, the very shape the gate validates it with', async () => {
    const advertised = new Map(
      (await withMcpClient(async (client) => (await client.listTools()).tools)).map(
        (tool) => [tool.name, tool as unknown as AdvertisedTool],
      ),
    )
    const declared = new Map(registryDeclarations().map((row) => [row.id, row]))

    let inputsCompared = 0
    let outputsCompared = 0
    const exceptionsTaken = new Map<Leg2ExceptionKey, number>()
    const takeException = (key: Leg2ExceptionKey): void => {
      exceptionsTaken.set(key, (exceptionsTaken.get(key) ?? 0) + 1)
    }

    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      const tool = advertised.get(projection.name)
      expect(tool, `${projection.name}: declared by the mapping but not advertised`).toBeDefined()
      const composition = compositionOf(projection)

      for (const opId of projection.ops) {
        const declaration = declared.get(opId)
        expect(declaration, `${opId}: projected by ${projection.name} but not declared`).toBeDefined()
        const ownInput = withoutDialect(declaration!.input)
        const ownOutput = withoutDialect(declaration!.output)

        // ---- the input side --------------------------------------------------------------------
        const inputPlan = leg2InputPlan(projection, opId)
        if (inputPlan.kind === 'exception') {
          takeException(inputPlan.key)
        } else if (inputPlan.kind === 'arm') {
          // THE UNION-ARM NORMALISATION, through the lens's own function: the fold adds a
          // discriminant key whose value is the op id, and taking it back out is what makes the
          // advertised arm and the op's own document the same claim.
          const arms = (withoutDialect(tool!.inputSchema).oneOf ?? []) as readonly JsonDocument[]
          expect(arms.length, `${projection.name}: fold arms vs declared ops`)
            .toBe(projection.ops.length)
          expect(
            armWithoutDiscriminant(arms[inputPlan.at]!, projection.discriminant!),
            `${opId} on mcp (input, arm ${inputPlan.at} of ${projection.name}): the advertised `
              + 'shape is not this capability\'s own contract',
          ).toEqual(ownInput)
          inputsCompared += 1
        } else {
          expect(
            withoutDialect(tool!.inputSchema),
            `${opId} on mcp (input, via ${projection.name}): the advertised shape is not this `
              + 'capability\'s own contract',
          ).toEqual(ownInput)
          inputsCompared += 1
        }

        // ---- the output side -------------------------------------------------------------------
        const outputPlan = leg2OutputPlan(projection, opId)
        if (outputPlan.kind === 'exception') {
          takeException(outputPlan.key)
          if (outputPlan.key === 'degraded-output-contract') {
            // PITFALL 9: the ABSENCE is asserted, never skipped — a skip asserts nothing, and the
            // one thing a degraded tool must never do is quietly start advertising a stand-in.
            const entry = DEGRADED_OUTPUT_CONTRACTS.find((row) => row.tool === projection.name)!
            expect(
              tool!.outputSchema,
              `${opId} on mcp (output): ${projection.name} is a declared degradation and must `
                + 'advertise NO outputSchema',
            ).toBeUndefined()
            expect(
              tool!.description,
              `${opId} on mcp (output): the degradation must travel in the one channel that `
                + 'reaches the caller — the tool description',
            ).toContain('advertises no outputSchema')
            expect(
              tool!.description,
              `${opId} on mcp (output): the description must name the contract that degraded`,
            ).toContain(entry.schema)
          }
          continue
        }

        const advertisedOutput = withoutDialect(tool!.outputSchema ?? {})
        expect(
          tool!.outputSchema,
          `${opId} on mcp (output): ${projection.name} advertises no outputSchema and is not a `
            + 'declared degradation',
        ).toBeDefined()
        const members = advertisedOutputMembers(advertisedOutput)

        if (projection.kind === 'apply') {
          // The apply door's result is `op outcome OR refusal`. The RECEIPT arm is the op's own
          // document; the refusal arm is this surface's authored wire vocabulary (396 D-11) and is
          // owned by the fidelity suite, which compares it against the authored constant.
          expect(members.length, `${projection.name}: the apply door's output arms`).toBe(2)
          expect(
            members[0],
            `${opId} on mcp (output, receipt arm of ${projection.name}): the advertised receipt is `
              + 'not this capability\'s own contract',
          ).toEqual(ownOutput)
          outputsCompared += 1
          continue
        }

        if (composition === 'union') {
          // A fold whose arms answer one shape advertises that shape; the one whose arms differ
          // advertises an `anyOf`. Either way this capability's own document must BE one of them.
          expect(
            members.map((member) => JSON.stringify(member)),
            `${opId} on mcp (output, via ${projection.name}): this capability's own contract is not `
              + 'among the shapes the fold advertises',
          ).toContain(JSON.stringify(ownOutput))
          // …and the advertised set is exactly the fold's distinct arm outputs, so membership
          // cannot be satisfied by a sibling arm's shape while this op's own went unadvertised.
          const distinct = [
            ...new Set(
              projection.ops.map((armOpId) =>
                JSON.stringify(withoutDialect(declared.get(armOpId)!.output)),
              ),
            ),
          ]
          expect(
            sorted(members.map((member) => JSON.stringify(member))),
            `${projection.name}: the advertised output set is not the fold's own distinct arms`,
          ).toEqual(sorted(distinct))
          outputsCompared += 1
          continue
        }

        expect(members.length, `${projection.name}: a 1:1 tool advertises one output shape`).toBe(1)
        expect(
          members[0],
          `${opId} on mcp (output, via ${projection.name}): the advertised shape is not this `
            + 'capability\'s own contract',
        ).toEqual(ownOutput)
        outputsCompared += 1
      }
    }

    // THE ARITHMETIC, so a future reader can tell a real change from a loop that stopped ranging.
    // Twenty-six projected capabilities, on each side, every one of them either compared or
    // carrying a declared exception (2026-09-15, 423-21 D-18: the two feedback read tools add one
    // compared input and one compared output each):
    //   inputs  — 26 less the 2 proposal apply doors and 1 pipeline downstream op = 23
    //   outputs — 26 less the 2 degraded contracts and 1 pipeline downstream op   = 23
    const projectedOpCount = AGENT_QA_TOOL_PROJECTIONS.reduce(
      (total, projection) => total + projection.ops.length,
      0,
    )
    const exceptionTotal = [...exceptionsTaken.values()].reduce((total, at) => total + at, 0)
    expect(inputsCompared, 'leg 2 compared a different number of inputs').toBe(23)
    expect(outputsCompared, 'leg 2 compared a different number of outputs').toBe(23)
    expect(
      inputsCompared + outputsCompared + exceptionTotal,
      'every projected capability must be compared or excepted on BOTH sides — no skip-lists',
    ).toBe(projectedOpCount * 2)

    // Every declared exception is EXERCISED. An exemption nothing takes is dead prose that will
    // outlive the reason it was written for.
    for (const [key] of LEG2_EXCEPTIONS) {
      expect(exceptionsTaken.get(key) ?? 0, `the declared exception '${key}' is taken by nothing`)
        .toBeGreaterThan(0)
    }
    expect(
      sorted(exceptionsTaken.keys()),
      'an exception was taken that the declared vocabulary does not contain',
    ).toEqual(sorted(LEG2_EXCEPTIONS.map(([key]) => key)))
  }, 120_000)

  it('joins the declared output degradations to the live listing, in both directions', () => {
    // The REVERSE direction of the absence assertion above, and the one that keeps the exception
    // vocabulary from becoming a place to hide: a tool that advertises no output schema and is not
    // declared degraded is a caller being told less than the contract says, silently.
    return withMcpClient(async (client) => {
      const tools = (await client.listTools()).tools as unknown as readonly AdvertisedTool[]
      expect(tools.length, 'the listing read back empty').toBeGreaterThan(0)
      const undeclaredSilent = tools
        .filter((tool) => tool.outputSchema === undefined)
        .map((tool) => tool.name)
      expect(
        sorted(undeclaredSilent),
        'tools advertising no outputSchema must be exactly the declared degradations',
      ).toEqual(sorted(DEGRADED_OUTPUT_CONTRACTS.map((entry) => entry.tool)))
    })
  })

  it('looks through the ONE published lens, and defines no normaliser of its own', () => {
    // D-06's one-lens rule, as a source assertion (397-02 extracted the three normalisers to
    // `packages/mcp/src/conformance-support.ts` precisely so this leg would not have to re-derive
    // them). A second copy fails SILENTLY: the looser one passes over real drift, and nothing
    // compares the two copies to each other. Comments stripped so this file may name what its body
    // must not define.
    const definitionKeywords = ['function ', 'const ']
    for (const file of readdirSync(CONFORMANCE_DIR).filter((name) => name.endsWith('.ts'))) {
      const code = commentStrippedSource(file)
      for (const normaliser of [
        'withoutDialect',
        'stripRedundantObjectStamp',
        'armWithoutDiscriminant',
      ]) {
        for (const keyword of definitionKeywords) {
          expect(code, `${file} defines its own ${normaliser} instead of importing the one lens`)
            .not.toContain(`${keyword}${normaliser}`)
        }
      }
    }
    // …and the lens IS reached, from the barrel rather than from a path into another package.
    const code = commentStrippedSource('parity.test.ts')
    expect(code, 'the leg-2 comparison no longer imports the lens').toContain('withoutDialect')
    expect(code, 'the lens must come from the mcp barrel').toContain('@vostride/agent-qa-mcp')
    // Assembled from fragments for the reason the ledger sweep's tokens are: this cell reads its
    // own file, so a token written out here is the sweep finding its own prohibition.
    expect(code, 'the lens must be reached through the barrel, never by a path into its module')
      .not.toContain(['conformance', '-support.js'].join(''))
  })
})
