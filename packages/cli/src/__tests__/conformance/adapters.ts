// The two surface adapters the parity suite enumerates through (Phase 397 plan 01, D-01/D-02/D-03).
//
// WHAT AN ADAPTER ANSWERS, AND IN WHAT VOCABULARY. `enumerateOpIds()` returns the set of REGISTRY OP
// IDS a surface can reach, never the surface's own names. D-01 makes the op id the comparison
// currency of every leg in this phase and of 398's catalogue projection, because the two surfaces
// spell the same capability differently — `runs.list` is `agent_qa_list_runs` over MCP and
// `runs_list` in a model plan — and a comparison conducted in either surface's spelling would be
// comparing that surface to itself.
//
// EVERY ENUMERATION BELOW IS PRODUCED. The MCP side reads `tools/list` off a REAL `McpServer` built
// by the shipped factory and driven by a real protocol client over the SDK's own in-process handler;
// the chat side runs the shipped planner projection and the shipped resolver table's own resolvers.
// Nothing here contains a listing of tool names or op ids. A hand-assembled listing would make this
// file's idea of a surface the subject, and the defect class the suite exists to catch — a
// capability reachable on a surface that the declared data never catalogued — is invisible to a
// comparison of a table against itself.
//
// THE FOLD EXPANSION AND THE STRAY DIAGNOSTIC ARE THE SAME MECHANISM (D-01). An MCP tool stands in
// front of one or more ops per the declared mapping; expanding a listed tool through that mapping is
// how a wire name becomes op ids, and a listed tool the mapping does not know is what is left over.
// That leftover IS the uncatalogued-capability shape the FUNC-06 mutation plants, so it is returned
// as data rather than thrown, and the suite asserts it empty by name.
//
// THE CORES ARE PURE so their named-RED branches can be driven with synthetic input in a control
// cell without mutating a shipped file or introducing a skip. A detector nobody has seen fire is a
// comment.

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  CHAT_RESOLVER_TABLE,
  createFunctionRegistry,
  fromToolName,
  isChatMetaToolName,
  projectPlannerTools,
  type ChatResolverTable,
  type CreateFunctionRegistryOptions,
  type FunctionDeclaration,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import { CHAT_PLANNER_CALLER } from '@vostride/agent-qa-agent-local'
import {
  AGENT_QA_TOOL_PROJECTIONS,
  buildAgentQaMcpServer,
  type ToolProjection,
} from '@vostride/agent-qa-mcp'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

import { mcpFunctionCaller } from '../../commands/mcp.js'

/** Which enumeration produced a capability the declared data does not catalogue. */
export interface SurfaceStray {
  readonly kind: 'mcp-listed-tool' | 'chat-alias-target'
  /** The stray itself — a wire tool name, or a resolver alias's function-id target. */
  readonly name: string
}

/** What one surface reaches, plus what it reached that nothing declares. */
export interface SurfaceEnumeration {
  readonly opIds: ReadonlySet<string>
  readonly strays: readonly SurfaceStray[]
}

/**
 * One rostered surface, as the suite drives it.
 *
 * `enumerateOpIds` is async because one of the two surfaces answers over a protocol round trip and
 * the other does not, and a shape that could only carry the synchronous one would have forced the
 * MCP side into a second, non-wire read — which is the hand-assembled listing this file refuses.
 */
export interface SurfaceAdapter {
  readonly id: string
  enumerateOpIds(): Promise<SurfaceEnumeration>
}

/**
 * Every scope the layer knows, so a census taken here can never under-count for want of a grant.
 *
 * DERIVED FROM THE ENUM RATHER THAN LISTED, and that is load-bearing rather than tidy: a
 * hand-written list one member behind the union silently shrinks the world every downstream
 * set-equality is checked against, and every one of them then passes on the smaller world. 387-08
 * measured exactly that failure, and `parity-coverage.test.ts` records the reasoning at its own
 * caller.
 *
 * `safeMode: false` because safe mode filters the LISTING to read-only ops — a cosmetic filter whose
 * whole job is to hide capabilities from a caller, which is the opposite of what a census wants.
 * `origin: 'human'` so the two ops declaring `requiresHumanOrigin` are reachable rather than refused
 * before anything about them is measured.
 */
export const CONFORMANCE_CENSUS_CALLER: FunctionCaller = Object.freeze({
  surface: 'conformance',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
})

/** Every scope, as the MCP enumeration's grant. See {@link MCP_ENUMERATION_CALLER}. */
export const MCP_ENUMERATION_SCOPES: readonly FunctionScope[] = Object.freeze([
  ...FunctionScopeSchema.options,
])

/**
 * The caller the MCP enumeration lists under.
 *
 * NOT the host's default grant, and the difference is the whole reason this constant exists: the
 * default MCP grant is every scope EXCEPT `config-write`, and MCP visibility is a scope-union subset
 * check, so the two configuration tools are simply not registered on a default caller's instance.
 * An enumeration taken under that caller would report a smaller surface than the surface has and
 * every completeness leg would pass on it. The mint goes through the shipped `mcpFunctionCaller`
 * rather than a literal object, so the surface attribution and the agent origin stay one decision.
 */
export const MCP_ENUMERATION_CALLER: FunctionCaller = mcpFunctionCaller(MCP_ENUMERATION_SCOPES)

/**
 * The built-in registry, with empty deps.
 *
 * Honest for a listing question and the precedent is `mapping-bump-guard.test.ts`: `list()` consults
 * the deps for one thing — whether an op is BOUND in this composition — and membership of the
 * catalogue is a property of the catalogue rather than of a host. Nothing here dispatches, so
 * nothing here can reach a port that is not there.
 */
export function conformanceRegistry(): FunctionRegistry {
  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']
  return createFunctionRegistry({ deps: {} as unknown as FunctionDeps, auditSink })
}

/** The census, as declarations. */
export function registryDeclarations(): readonly FunctionDeclaration[] {
  return conformanceRegistry().list(CONFORMANCE_CENSUS_CALLER)
}

/**
 * The census, as ids — this phase's reading of the `registry.ids()` the success criteria name.
 *
 * There is no such method: the public enumeration is `list(caller)`, which is why the caller above
 * is exported beside this and used by everything that asks the census a question.
 */
export function registryOpIds(): readonly string[] {
  return registryDeclarations().map((declaration) => declaration.id)
}

// ---- The MCP side ------------------------------------------------------------------------------

/** What a fold expansion produced, and what it could not expand. */
export interface McpFoldExpansion {
  readonly opIds: ReadonlySet<string>
  /** Listed tool names absent from the declared mapping — D-01's uncatalogued-capability shape. */
  readonly strayTools: readonly string[]
}

/**
 * Listed tool names, expanded through the declared mapping into registry op ids.
 *
 * PURE, TOTAL AND SYNCHRONOUS, and the two arguments are both supplied by the caller so a control
 * cell can drive it with a synthetic listing. The alternative — folding this into the wire read —
 * would have left the stray branch reachable only by mutating a shipped file, and a branch that
 * expensive to exercise is a branch nobody exercises.
 *
 * A stray is COLLECTED rather than thrown. The suite names it in a failure message alongside every
 * other stray on that surface; a throw would report the first one and hide the rest, and "how many
 * uncatalogued capabilities are there" is exactly the question a reader of that failure has.
 */
export function expandMcpListedTools(
  listedToolNames: readonly string[],
  projections: readonly ToolProjection[],
): McpFoldExpansion {
  const byName = new Map(projections.map((projection) => [projection.name, projection]))
  const opIds = new Set<string>()
  const strayTools: string[] = []
  for (const name of listedToolNames) {
    const projection = byName.get(name)
    if (projection === undefined) {
      strayTools.push(name)
      continue
    }
    for (const opId of projection.ops) opIds.add(opId)
  }
  return { opIds, strayTools }
}

/**
 * One connected protocol client against a real server, for the duration of one body.
 *
 * The SDK's own in-process handler driver, exactly as `projection-fidelity.test.ts` uses it: the
 * only thing replaced is the socket. `maskText` is passed by name and never defaulted — a masker
 * that can be omitted is a masker that will be — and the identity function is the right one here
 * because these reads' subject is WHICH tools exist rather than what their text says.
 *
 * The connection is scoped to the callback and closed in a `finally`, so nothing is left open for a
 * caller to remember to drain — and the callback shape is what lets the 397-03 absence probes ask
 * nineteen questions of ONE server instance rather than of nineteen freshly built ones, which would
 * make a disagreement between two answers unattributable.
 */
export async function withMcpClient<Answer>(
  body: (client: Client) => Promise<Answer>,
  grantedScopes: readonly FunctionScope[] = MCP_ENUMERATION_SCOPES,
): Promise<Answer> {
  const handler = createMcpHandler(() =>
    buildAgentQaMcpServer({
      registry: conformanceRegistry(),
      caller: mcpFunctionCaller(grantedScopes),
      maskText: (text: string) => text,
    }),
  )
  const client = new Client({ name: 'agent-qa-397-conformance', version: '0.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://conformance.local/mcp'), {
        fetch: ((url: URL | string, init?: RequestInit) =>
          handler.fetch(new Request(url, init))) as typeof fetch,
      }),
    )
    return await body(client)
  } finally {
    await client.close().catch(() => {})
  }
}

/** A real `tools/list`, off a real server, for one grant. */
export async function listMcpToolNames(
  grantedScopes: readonly FunctionScope[] = MCP_ENUMERATION_SCOPES,
): Promise<readonly string[]> {
  return withMcpClient(async (client) => {
    const listed = await client.listTools()
    return listed.tools.map((tool) => tool.name)
  }, grantedScopes)
}

/**
 * The wire name an unprojected op WOULD carry if this surface projected it, derived from its id.
 *
 * DERIVED RATHER THAN INVENTED PER OP, because the point of the D-12 absence probe is that the door
 * is not there under any spelling a caller would reach for, and nineteen hand-picked guesses would
 * be nineteen chances to pick a name nobody would ever try. The shipped prefix plus the op's own id
 * is the spelling a caller who knows the capability exists would attempt first.
 *
 * `parity.test.ts` asserts that the produced name is ABSENT from the live listing before it calls
 * it. Without that check, a derived spelling that happened to collide with a real tool would turn
 * an absence probe into a call against a live capability while still looking like a probe.
 */
export function plausibleMcpToolSpelling(opId: string): string {
  return `agent_qa_${opId.replace(/\./g, '_')}`
}

/** The MCP surface's op-id reach for one grant, read off the wire and folded through the mapping. */
export async function enumerateMcpOpIds(
  grantedScopes: readonly FunctionScope[] = MCP_ENUMERATION_SCOPES,
): Promise<SurfaceEnumeration> {
  const listedToolNames = await listMcpToolNames(grantedScopes)
  const expansion = expandMcpListedTools(listedToolNames, AGENT_QA_TOOL_PROJECTIONS)
  return {
    opIds: expansion.opIds,
    strays: expansion.strayTools.map((name) => ({ kind: 'mcp-listed-tool' as const, name })),
  }
}

export const mcpSurfaceAdapter: SurfaceAdapter = Object.freeze({
  id: 'mcp',
  enumerateOpIds: () => enumerateMcpOpIds(),
})

// ---- The chat side -----------------------------------------------------------------------------

/** One resolver alias and the registry op it bound, as the shipped rule produced it. */
export interface ResolverOpTarget {
  readonly alias: string
  readonly functionId: string
}

/**
 * What a resolver row is FOR — declared here, checked against what the row actually produces.
 *
 * The chat surface has three kinds of row and only one of them is a capability: an alias that binds
 * a registry op, a session directive that binds no op at all (`/model`, `/pin`, `/help`, `/quit` —
 * chrome and session state, not powers), and the one generic passthrough. Stating the kind and then
 * asserting the row produces it is what keeps this from being a curated reading of the table: a
 * directive that starts binding an op, or an alias that stops, is a mismatch the suite names.
 */
export type ResolverProbeRole = 'capability-alias' | 'directive' | 'generic-passthrough'

/**
 * A clause that makes one resolver row bind, and what that row is declared to be.
 *
 * THE CLAUSE IS AN INPUT, NOT AN ANSWER. Every rule in the shipped table folds matching and argument
 * binding into one function, so the only way to learn which op an alias targets is to run the rule —
 * the rows carry no static `functionId` field to read. What comes back is therefore produced by the
 * shipped resolver; nothing below states an op id.
 *
 * `/fn` is the generic passthrough and its target is whatever the person typed, so it contributes NO
 * op id to the enumeration: it reaches the whole registry by construction, and the id it carries is
 * validated where every id is, at the dispatch that knows what is registered. Counting the id from
 * this probe would be counting this file's own argument.
 */
export interface ResolverProbe {
  readonly alias: string
  readonly clause: string
  readonly role: ResolverProbeRole
}

export const CHAT_RESOLVER_PROBES: readonly ResolverProbe[] = Object.freeze([
  Object.freeze({ alias: 'run', clause: 'run tests/checkout.yaml', role: 'capability-alias' }),
  Object.freeze({ alias: 'status', clause: 'status', role: 'capability-alias' }),
  Object.freeze({ alias: 'test-ref', clause: 'test 42', role: 'capability-alias' }),
  Object.freeze({ alias: 'digest', clause: 'digest r_conformance', role: 'capability-alias' }),
  Object.freeze({ alias: 'proposals', clause: 'proposals', role: 'capability-alias' }),
  Object.freeze({ alias: 'model', clause: '/model a-model', role: 'directive' }),
  Object.freeze({ alias: 'pin', clause: '/pin an-action-class', role: 'directive' }),
  Object.freeze({ alias: 'fn', clause: '/fn runs.list {}', role: 'generic-passthrough' }),
  Object.freeze({ alias: 'help', clause: '/help', role: 'directive' }),
  Object.freeze({ alias: 'quit', clause: '/quit', role: 'directive' }),
] as const satisfies readonly ResolverProbe[])

/**
 * What probing a resolver table produced, WITH the register's own two-directional self-check.
 *
 * A register that can only red on one side is half a register. `unprobedAliases` reds when a row
 * lands in the shipped table with nothing here driving it — the way a new alias would otherwise
 * enter the surface unwatched — and `unknownProbeAliases` reds when a probe here names a row that no
 * longer exists, which is how this file would otherwise keep asserting about a deleted alias.
 */
export interface ResolverProbeOutcome {
  readonly targets: readonly ResolverOpTarget[]
  /** Rows whose produced entry disagreed with the role declared for them. */
  readonly roleMismatches: readonly string[]
  readonly unprobedAliases: readonly string[]
  readonly unknownProbeAliases: readonly string[]
}

export function probeResolverTable(
  table: ChatResolverTable,
  probes: readonly ResolverProbe[] = CHAT_RESOLVER_PROBES,
): ResolverProbeOutcome {
  const byAlias = new Map(table.map((rule) => [rule.alias, rule]))
  const targets: ResolverOpTarget[] = []
  const roleMismatches: string[] = []
  const unknownProbeAliases: string[] = []
  const probed = new Set<string>()

  for (const probe of probes) {
    const rule = byAlias.get(probe.alias)
    if (rule === undefined) {
      unknownProbeAliases.push(probe.alias)
      continue
    }
    probed.add(probe.alias)
    const entry = rule.resolve(probe.clause)
    const produced = entry === undefined ? 'no-match' : entry.kind
    const expected = probe.role === 'directive' ? 'directive' : 'op'
    if (produced !== expected) {
      roleMismatches.push(`${probe.alias}: declared ${probe.role}, produced ${produced}`)
      continue
    }
    if (probe.role === 'capability-alias' && entry !== undefined && entry.kind === 'op') {
      targets.push({ alias: probe.alias, functionId: entry.functionId })
    }
  }

  return {
    targets,
    roleMismatches,
    unknownProbeAliases,
    unprobedAliases: table.map((rule) => rule.alias).filter((alias) => !probed.has(alias)),
  }
}

/** What the chat surface reaches, over both of its routes. */
export interface ChatEnumeration {
  readonly opIds: ReadonlySet<string>
  /** Alias targets naming nothing the registry declares — D-03's uncatalogued-capability shape. */
  readonly strayAliasTargets: readonly ResolverOpTarget[]
}

/**
 * The chat surface's op-id reach: the planner's vocabulary UNION the deterministic route's targets.
 *
 * BOTH ROUTES, because a rule that only watches one door cannot claim there are no private powers.
 * The planner route is the one an LLM drives; the resolver route never touches a model at all, and
 * an alias bound to something the registry does not declare is a capability reachable by typing
 * three letters and catalogued nowhere.
 *
 * The two meta-tools are SUBTRACTED rather than mapped: `answer_only` and `mark_unhandled` are how a
 * model says it answered in prose or that nothing can carry a clause out. They name no registry op,
 * the shipped reverse mapping refuses them by name for that reason, and counting them would inflate
 * this surface's reach by two capabilities that do not exist.
 *
 * A STRAY TARGET IS COUNTED INTO `opIds` AS WELL AS REPORTED. That is deliberate: the reverse
 * completeness leg is a subset claim, and a stray excluded from the set it is a member of would
 * leave that leg unable to fire on the very defect it exists for. Both legs red, and each names the
 * id.
 */
export function chatEnumerationOf(
  plannerToolNames: readonly string[],
  resolverTargets: readonly ResolverOpTarget[],
  registryOpIdSet: ReadonlySet<string>,
): ChatEnumeration {
  const opIds = new Set<string>()
  for (const name of plannerToolNames) {
    if (isChatMetaToolName(name)) continue
    opIds.add(fromToolName(name))
  }
  const strayAliasTargets: ResolverOpTarget[] = []
  for (const target of resolverTargets) {
    opIds.add(target.functionId)
    if (!registryOpIdSet.has(target.functionId)) strayAliasTargets.push(target)
  }
  return { opIds, strayAliasTargets }
}

/**
 * The planner's actual tool vocabulary for this host's registry.
 *
 * Read off the shipped projection under the shipped planner caller, so the set is whatever the
 * composition root's planner would be handed. A walk of the registry spelled here instead would be a
 * second projection, free to disagree with the one the model is given.
 */
export function plannerToolNamesOf(registry: FunctionRegistry): readonly string[] {
  return Object.keys(projectPlannerTools(registry, CHAT_PLANNER_CALLER))
}

export async function enumerateChatOpIds(): Promise<SurfaceEnumeration> {
  const registry = conformanceRegistry()
  const registryOpIdSet = new Set(registry.list(CONFORMANCE_CENSUS_CALLER).map((d) => d.id))
  const probed = probeResolverTable(CHAT_RESOLVER_TABLE)
  const enumeration = chatEnumerationOf(
    plannerToolNamesOf(registry),
    probed.targets,
    registryOpIdSet,
  )
  return {
    opIds: enumeration.opIds,
    strays: enumeration.strayAliasTargets.map((target) => ({
      kind: 'chat-alias-target' as const,
      name: target.functionId,
    })),
  }
}

export const chatSurfaceAdapter: SurfaceAdapter = Object.freeze({
  id: 'chat',
  enumerateOpIds: () => enumerateChatOpIds(),
})
