// The retired-v1-name redirect at the unknown-tool seam (Phase 398 plan 05, D-15 · XPLN-03).
//
// WHY THIS FILE EXISTS. `migration-map.ts` is thirty-three rulings as data; nothing yet speaks them
// to the agent that arrives holding a v1 tool name. D-15 says such a call ALWAYS errors — never a
// forward, never an invocation — but that the error carries the ruling, and that the `renamed-to`
// arm's v2 tool name passes the SAME visibility law as `tools/list` before it is spoken. That is
// three claims and each one is an ABSENCE or an EQUALITY, which are the two easiest kinds of claim
// to fake. So every cell below drives a REAL client over a REAL transport against the shipped
// `buildAgentQaMcpServer`, and asserts on the bytes that reach the caller.
//
// TODAY'S ANSWER IS MEASURED, NOT DOCUMENTED (2026-08-17). The whole of D-15's containment argument
// is that a NON-member unknown name keeps answering exactly as it does today, so the only new
// distinguishable set is the closed retired list — history, not grants. A baseline read out of a
// changelog would pin whatever the SDK's docs claim; the constant below was produced by driving
// `@modelcontextprotocol/server@2.0.0` through `InMemoryTransport` with a name nothing registers,
// and reading the error the client threw:
//
//     ProtocolError: Tool zz_not_a_tool_398_05 not found     code -32602 (InvalidParams), no `data`
//
// THE PLACEMENT FINDING, which is what this probe was really for (measured 2026-08-17). An
// unregistered tool name never reaches any code this package wrote. `McpServer`'s constructor
// installs the SDK's own `tools/call` request handler on the underlying `Server` (it runs
// `setToolRequestHandlers()` eagerly because `catalog.ts` passes `capabilities.tools`), and that
// handler looks the name up in the SDK's registered-tool table and throws `InvalidParams` when the
// lookup misses. So:
//
//   * There is NO fall-through into `catalog.ts`. A redirect cannot be a handler, because a handler
//     only exists for a name that was registered — and registering a v1 name would put it back in
//     `tools/list`, resurrecting the v1 surface as a listed door, which is the exact thing D-15
//     refuses.
//   * The seam therefore has to be the DISPATCH EDGE: the installed `tools/call` handler, wrapped
//     so that member names are answered and everything else — registered tools included — is passed
//     through to the SDK's own handler untouched.
//   * It has to live in `buildAgentQaMcpServer`, not in `http.ts`. Both hosts reach that one factory
//     (`serveStdio(() => buildAgentQaMcpServer(...))` and
//     `createMcpHandler((ctx) => buildAgentQaMcpServer(...))`), so a redirect installed anywhere
//     else would answer on one transport and not the other. SEP-2567's per-request factory model is
//     what makes that placement per-CALLER as well: the wrapper closes over the scope verdicts this
//     instance was built with, never over connection state.
//
// Protocol grounding: SEP-2567 (no per-connection variance — the variance is per caller, resolved
// when the factory runs), SEP-2575 (stateless; there is no handshake in which the old vocabulary
// could have been negotiated, so the only place a v1 caller's name can be answered is at the call),
// SEP-2106 (the advertised contracts a sighted caller is pointed back at).

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { McpServer } from '@modelcontextprotocol/server'
import type { FunctionDeclaration, FunctionRegistry } from '@vostride/agent-qa-agent'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildAgentQaMcpServer } from '../catalog.js'
import { AGENT_QA_TOOL_PROJECTIONS } from '../mapping.js'
import { V1_TOOL_MIGRATION_MAP } from '../migration-map.js'

// ---------------------------------------------------------------------------------------------
// The fixture composition
// ---------------------------------------------------------------------------------------------

/**
 * What each projected op requires, IN THIS FIXTURE.
 *
 * Stated here rather than read from a live registry because this package cannot compose one — the
 * scopes a real host declares live in `packages/agent`, behind deps this package is forbidden to
 * acquire. What the cells below are about is the WIRING (does the redirect ask the same question
 * the listing asked?), and the wiring is observable with any honest scope assignment.
 *
 * `config.project.scaffold` deliberately requires TWO scopes. It is an arm of the config fold, so
 * the fold's required set is a UNION with two members, and a caller granted `config-write` alone
 * can reach some arms and not the tool. A fixture where every arm needed exactly one scope could
 * not tell a union from an intersection, or from reading the first arm and stopping.
 */
const FIXTURE_OP_SCOPES: Readonly<Record<string, readonly FunctionScope[]>> = Object.freeze({
  'authoring.draft.write': ['test-write'],
  'authoring.draft.edit': ['test-write'],
  'authoring.draft.verify': ['test-write'],
  'runs.start': ['run'],
  'config.field.set': ['config-write'],
  'config.target.create': ['config-write'],
  'config.target.edit': ['config-write'],
  'config.auth.set': ['config-write'],
  'config.hook.add': ['config-write'],
  'config.project.scaffold': ['config-write', 'run'],
  'config.undo.propose': ['config-write'],
  'config.proposal.apply': ['config-write', 'approval-write'],
  'knowledge.accept.propose': ['knowledge-write'],
  'knowledge.reject.propose': ['knowledge-write'],
  'knowledge.forget.propose': ['knowledge-write'],
  'knowledge.proposal.apply': ['knowledge-write', 'approval-write'],
  'entities.resolve': ['read'],
  'entities.get': ['read'],
  'runs.list': ['read'],
  'runs.digest': ['read'],
  'proposals.list': ['read'],
  'proposals.show': ['read'],
})

/** Every op any shipped projection names — the fixture's own denominator, read from the mapping. */
const PROJECTED_OP_IDS: readonly string[] = [
  ...new Set(AGENT_QA_TOOL_PROJECTIONS.flatMap((projection) => [...projection.ops])),
]

/**
 * The declarations a composition serving every projected op would publish.
 *
 * `FunctionDeclaration` carries more than this package reads (`catalog.ts` takes `id`, `summary`,
 * `requiredScopes` and `risk`), so the unread fields are filled with the shape a real declaration
 * has rather than left off.
 */
function fixtureDeclarations(): readonly FunctionDeclaration[] {
  return PROJECTED_OP_IDS.map(
    (id) =>
      ({
        id,
        summary: `The fixture declaration for ${id}.`,
        requiredScopes: FIXTURE_OP_SCOPES[id] ?? [],
        resultKind: 'unary',
        risk: { name: `fn:${id}`, recognized: true, readOnly: id.startsWith('entities.') },
        bindingStatus: 'bound',
        input: {},
        output: {},
      }) as unknown as FunctionDeclaration,
  )
}

const FIXTURE_REGISTRY: FunctionRegistry = { list: () => fixtureDeclarations() }

/** Identity masking: the cells assert on exact bytes, so a masker must not be in the way. */
const identity = (text: string): string => text

function caller(grantedScopes: readonly FunctionScope[]): FunctionCaller {
  return { surface: 'mcp', origin: 'agent', grantedScopes, safeMode: false }
}

/** Every scope this fixture uses — the "sees everything" caller, derived rather than typed. */
const ALL_FIXTURE_SCOPES: readonly FunctionScope[] = [
  ...new Set(Object.values(FIXTURE_OP_SCOPES).flat()),
]

/** A driven server plus the client talking to it, over the SDK's own in-memory transport pair. */
interface DrivenServer {
  readonly client: Client
  readonly server: McpServer
  close(): Promise<void>
}

async function drive(grantedScopes: readonly FunctionScope[]): Promise<DrivenServer> {
  const server = buildAgentQaMcpServer({
    registry: FIXTURE_REGISTRY,
    caller: caller(grantedScopes),
    maskText: identity,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'redirect-probe', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    server,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

/** What a `tools/call` answered, as one comparable value — a thrown error or a returned result. */
interface CallOutcome {
  readonly threw: boolean
  readonly name: string | undefined
  readonly code: unknown
  readonly message: string | undefined
  readonly data: unknown
  /** The whole answer, serialized. The unsighted-wall scan reads THIS, not one hand-picked field. */
  readonly serialized: string
}

async function callOutcome(client: Client, toolName: string): Promise<CallOutcome> {
  try {
    const result = await client.callTool({ name: toolName, arguments: {} })
    return {
      threw: false,
      name: undefined,
      code: undefined,
      message: undefined,
      data: undefined,
      serialized: JSON.stringify(result),
    }
  } catch (err) {
    const error = err as Error & { code?: unknown; data?: unknown }
    return {
      threw: true,
      name: error.name,
      code: error.code,
      message: error.message,
      data: error.data,
      // Own properties, so `message`, `code` and any `data` are all in the scanned text. `stack`
      // is excluded deliberately: it carries absolute file paths from this machine, and a wall
      // asserting "this string does not appear" must not be reading the runner's directory names.
      serialized: JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        data: error.data,
      }),
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The measured non-member baseline
// ---------------------------------------------------------------------------------------------

/**
 * TODAY'S ANSWER for a tool name nothing serves, MEASURED on 2026-08-17 by driving the shipped
 * server through a real client (see the file header) — not transcribed from documentation.
 *
 * `-32602` is JSON-RPC `InvalidParams`, which is the SDK's own choice for this case. The message
 * template is the SDK's, echoing the name the caller sent.
 */
const MEASURED_UNKNOWN_TOOL_CODE = -32602
const measuredUnknownToolMessage = (toolName: string): string => `Tool ${toolName} not found`

/** A name that is neither a live tool nor a map member. Asserted to be both, below. */
const NON_MEMBER_NAME = 'zz_not_a_tool_398_05'

const V1_MEMBER_NAMES: readonly string[] = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name)
const LIVE_TOOL_NAMES: readonly string[] = AGENT_QA_TOOL_PROJECTIONS.map(
  (projection) => projection.name,
)

describe('the fixture can answer the question it is asked', () => {
  // Without this cell every scope assertion below could be vacuous: `visibleToCaller` admits an
  // EMPTY required set, so an op with no fixture entry would fall through `?? []` and be visible to
  // a caller granted nothing. A new projected op must arrive with a scope or this reds.
  it('assigns a non-empty scope set to every op the shipped mapping projects', () => {
    const unscoped = PROJECTED_OP_IDS.filter(
      (id) => (FIXTURE_OP_SCOPES[id] ?? []).length === 0,
    ).sort()
    expect(unscoped).toEqual([])
  })

  it('declares no scope the fixture does not also grant to the everything caller', () => {
    const missing = PROJECTED_OP_IDS.flatMap((id) => FIXTURE_OP_SCOPES[id] ?? []).filter(
      (scope) => !ALL_FIXTURE_SCOPES.includes(scope),
    )
    expect(missing).toEqual([])
  })

  // The probe name has to be a non-member of BOTH closed sets or the baseline cell is asserting
  // the unknown-tool answer for something that is not unknown.
  it('probes with a name that is neither a live tool nor a migration-map member', () => {
    expect(LIVE_TOOL_NAMES).not.toContain(NON_MEMBER_NAME)
    expect(V1_MEMBER_NAMES).not.toContain(NON_MEMBER_NAME)
  })
})

describe("the non-member wall: today's unknown-tool answer, pinned (D-15)", () => {
  it('answers a name nothing serves with the measured InvalidParams error', async () => {
    const driven = await drive(ALL_FIXTURE_SCOPES)
    try {
      const outcome = await callOutcome(driven.client, NON_MEMBER_NAME)

      expect(outcome.threw).toBe(true)
      expect(outcome.name).toBe('ProtocolError')
      expect(outcome.code).toBe(MEASURED_UNKNOWN_TOOL_CODE)
      expect(outcome.message).toBe(measuredUnknownToolMessage(NON_MEMBER_NAME))
      expect(outcome.data).toBeUndefined()
    } finally {
      await driven.close()
    }
  })

  // The same answer for a caller granted nothing. An unknown name must not become distinguishable
  // by scope set — that would make the seam an oracle over what a caller cannot see (D-08).
  it('answers identically for a caller granted nothing at all', async () => {
    const sighted = await drive(ALL_FIXTURE_SCOPES)
    const unsighted = await drive([])
    try {
      const a = await callOutcome(sighted.client, NON_MEMBER_NAME)
      const b = await callOutcome(unsighted.client, NON_MEMBER_NAME)
      expect(b.serialized).toBe(a.serialized)
    } finally {
      await sighted.close()
      await unsighted.close()
    }
  })
})

describe('membership is exact byte equality (edge XPLN-03/encoding)', () => {
  /**
   * A case-variant of a REAL member, built at runtime from the map.
   *
   * Never a hand-typed near-miss: a literal would keep passing after the entry it shadows was
   * renamed, and would then be asserting the unknown-tool answer for a string nobody ships — true
   * of every string, which is the definition of a decorative cell.
   */
  const memberName = V1_MEMBER_NAMES[0]!
  const caseVariant = memberName.toUpperCase()

  it('derives a variant that is genuinely a non-member', () => {
    expect(caseVariant).not.toBe(memberName)
    expect(V1_MEMBER_NAMES).not.toContain(caseVariant)
    expect(LIVE_TOOL_NAMES).not.toContain(caseVariant)
    // Case-INSENSITIVE membership, which is what a `toLowerCase()` lookup would implement, is what
    // this cell exists to refuse. Stated so the difference between the two readings is visible.
    expect(V1_MEMBER_NAMES.map((name) => name.toLowerCase())).toContain(caseVariant.toLowerCase())
  })

  it('answers a case-variant of a member on the non-member path', async () => {
    const driven = await drive(ALL_FIXTURE_SCOPES)
    try {
      const outcome = await callOutcome(driven.client, caseVariant)

      expect(outcome.threw).toBe(true)
      expect(outcome.name).toBe('ProtocolError')
      expect(outcome.code).toBe(MEASURED_UNKNOWN_TOOL_CODE)
      expect(outcome.message).toBe(measuredUnknownToolMessage(caseVariant))
    } finally {
      await driven.close()
    }
  })
})

describe('the listing is what it was (D-15: no v1 name is resurrected)', () => {
  // The redirect answers a name; it must never make one appear. This cell is the standing guard
  // that a later "just register the v1 names and refuse in the handler" implementation reds on.
  it('lists no migration-map member to a caller granted everything', async () => {
    const driven = await drive(ALL_FIXTURE_SCOPES)
    try {
      const listed = (await driven.client.listTools()).tools.map((tool) => tool.name)

      expect(listed.length).toBeGreaterThan(0)
      expect(listed.filter((name) => V1_MEMBER_NAMES.includes(name))).toEqual([])
    } finally {
      await driven.close()
    }
  })
})
