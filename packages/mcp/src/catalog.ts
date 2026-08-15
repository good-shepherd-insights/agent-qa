// The per-caller server factory (Phase 396 plan 01, D-01 / D-05 / D-16 · MCPS-02).
//
// WHY THIS FILE EXISTS. `buildAgentQaMcpServer(deps)` is the only thing this package hands a host:
// give it a composed registry, the caller that host minted, and a masker, and it returns an
// `McpServer` carrying exactly the tools that caller may see, each of which does nothing but
// validate and call `invokeFunction`. Every serving entry in the v2 SDK takes a FACTORY and runs it
// once per serving unit — once per HTTP request, once per stdio connection — so a per-caller build
// is the official idiom rather than a trick, and it is what makes absence STRUCTURAL: a tool this
// caller may not see was never registered on this instance, so there is nothing to leak on a torn
// filter and nothing to distinguish from a tool that never existed (D-08).
//
// THE HANDLER DOES NOTHING. That is D-01's "pure projection" spelled as code, and it is the whole
// architectural claim of the phase: no MCP-local business logic, no second data path, no reaching
// past the function layer the way the v1 server reached the dashboard's REST API. Read any handler
// below and the only verbs are `invokeFunction` and the masker.
//
// Protocol grounding: SEP-2567 (no per-connection list variance — the variance here is per CALLER,
// keyed on the credential the host resolved, which is what the SDK's own `authInfo` factory example
// does), SEP-2549 (list results carry cache hints; a caller-varying listing must never be served
// from a shared cache entry), SEP-2106 (full JSON Schema 2020-12 for the advertised contracts).

import { McpServer } from '@modelcontextprotocol/server'
import { invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

import { AGENT_QA_OP_CONTRACTS, AGENT_QA_TOOL_PROJECTIONS } from './mapping.js'
import type { ToolProjection } from './mapping.js'
import { McpProjectionError, toRegisterToolConfig } from './projection.js'
import type { ProjectedOpSpec } from './projection.js'
import { visibleToCaller } from './visibility.js'

/**
 * The version this server reports.
 *
 * A constant here and NOT the package version read off disk: reading `package.json` at runtime is a
 * host capability this package does not have and must not acquire (its runtime dependency allow-list
 * is the two protocol packages, D-20). Plan 04 decides whether the host should pass its own version
 * in, which is the only place that fact honestly lives.
 */
export const AGENT_QA_MCP_SERVER_VERSION = '2.0.0'

/** What a host must supply to build a server for one caller. */
export interface AgentQaMcpServerDeps {
  /** The composed function registry. Built by the HOST, never by this package (D-09). */
  readonly registry: FunctionRegistry
  /**
   * WHO this server answers as. Minted by the composition root and passed through untouched — the
   * self-grant rule (391 D-06) is that a caller never asserts its own grants, and an MCP request
   * is the least trustworthy place in the system to start.
   */
  readonly caller: FunctionCaller
  /**
   * How text leaving this process is masked (threat T-396-01).
   *
   * REQUIRED, not optional, and the reason is a measured one rather than a preference: the defect
   * class this replaces (T-395-R5-10, closed in 395's final round) was a credential reaching an MCP
   * caller verbatim through an error serialization. An optional masker is absent exactly where
   * nobody thought to pass one, which is the same place the leak was found.
   */
  readonly maskText: (text: string) => string
}

/**
 * The scope set a tool needs — for a fold, the UNION across its arms.
 *
 * The union and not the intersection: a tool that can reach any of several ops must be withheld
 * from a caller who may reach only some of them, because listing it would advertise a door that
 * answers refusals. The union is computed HERE, once, and handed to the predicate, so the predicate
 * stays a statement about two scope sets and never learns what a fold is.
 */
function requiredScopeUnion(specs: readonly ProjectedOpSpec[]): readonly FunctionScope[] {
  const union = new Set<FunctionScope>()
  for (const spec of specs) {
    for (const scope of spec.requiredScopes) union.add(scope)
  }
  return [...union]
}

/**
 * Join the mapping's declared contracts with this host's registry declarations.
 *
 * Returns `undefined` when any arm is missing from the registry — which is a REAL answer and not an
 * error: a projection naming an op a given composition does not register is a tool that composition
 * genuinely cannot serve, and refusing to build the whole server over it would take an editor's MCP
 * connection down because one capability was unavailable. A contract missing from the mapping table
 * IS an error, because that is this repository disagreeing with itself.
 */
function resolveSpecs(
  projection: ToolProjection,
  declarations: ReadonlyMap<string, ProjectedOpSpec>,
): readonly ProjectedOpSpec[] | undefined {
  const specs: ProjectedOpSpec[] = []
  for (const opId of projection.ops) {
    const resolved = declarations.get(opId)
    if (resolved === undefined) return undefined
    specs.push(resolved)
  }
  return specs
}

/**
 * Build the server this caller sees.
 *
 * The listing is read through `registry.list(deps.caller)` — the registry's own view of itself for
 * this host — so `summary`, `requiredScopes` and `risk` describe the composition in front of the
 * caller rather than a table in this package that could describe a different one.
 */
export function buildAgentQaMcpServer(deps: AgentQaMcpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'agent-qa', version: AGENT_QA_MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  const declarations = new Map<string, ProjectedOpSpec>()
  for (const declaration of deps.registry.list(deps.caller)) {
    const contracts = AGENT_QA_OP_CONTRACTS[declaration.id]
    if (contracts === undefined) continue
    declarations.set(declaration.id, {
      id: declaration.id,
      summary: declaration.summary,
      requiredScopes: declaration.requiredScopes,
      risk: declaration.risk,
      input: contracts.input,
      output: contracts.output,
    })
  }

  const registered = new Set<string>()
  for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
    if (registered.has(projection.name)) {
      // Unreachable while the mapping table holds distinct names, and asserted anyway: a silent
      // last-wins here would drop a capability from every caller's vocabulary and leave the bump
      // guard comparing two sets that both lost the same member.
      throw new McpProjectionError(
        projection.name,
        'is declared twice in the mapping table; another projection already occupies that name',
      )
    }

    for (const opId of projection.ops) {
      if (AGENT_QA_OP_CONTRACTS[opId] === undefined) {
        throw new McpProjectionError(
          projection.name,
          `names op ${opId}, which has no entry in the contract table`,
        )
      }
    }

    const specs = resolveSpecs(projection, declarations)
    if (specs === undefined) continue
    if (!visibleToCaller(requiredScopeUnion(specs), deps.caller.grantedScopes)) continue

    registered.add(projection.name)
    // 1:1 today by construction: `toRegisterToolConfig` refuses a declared fold above rather than
    // approximating its contract, so a registered tool always has exactly one arm and the id below
    // is that arm. Plan 04 replaces this line together with the fold refusal, in one change.
    const opId = specs[0]!.id
    server.registerTool(
      projection.name,
      toRegisterToolConfig(projection, specs, deps.maskText),
      async (args: unknown) => {
        // The ENTIRE handler. Input validation happened twice before this line — once by the SDK
        // against the advertised schema, once inside `invokeFunction` against the same object — and
        // both parses are kept, because they are the same check made by two independent parties.
        try {
          const output = await invokeFunction(deps.registry, opId, args, deps.caller)
          const text = deps.maskText(JSON.stringify(output))
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: output as Record<string, unknown>,
          }
        } catch (err) {
          // A refusal is a RESULT, not a transport failure: the caller gets the reason as a tool
          // error it can read. The message is masked for the reason the whole file exists — an
          // error string is the channel 395's credential disclosure actually travelled down.
          return {
            content: [
              {
                type: 'text' as const,
                text: deps.maskText(err instanceof Error ? err.message : String(err)),
              },
            ],
            isError: true,
          }
        }
      },
    )
  }

  return server
}
