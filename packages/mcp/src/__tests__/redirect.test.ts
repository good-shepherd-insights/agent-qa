// The retired-v1-name redirect at the unknown-tool seam (Phase 398 plan 05, D-15 · XPLN-03).
//
// WHY THIS FILE EXISTS. `migration-map.ts` is thirty-three rulings as data; nothing yet speaks them
// to the agent that arrives holding a v1 tool name. D-15 says such a call ALWAYS errors — never a
// forward, never an invocation — but that the error carries the ruling, and that the `renamed-to`
// arm's v2 tool name passes the SAME visibility law as `tools/list` before it is spoken. That is
// three claims and each one is an ABSENCE or an EQUALITY, which are the two easiest kinds of claim
// to fake.
//
// 2026-10-01 (432-20, D-12): THE VISIBILITY LAW IS DELETED. Every caller of a composition sees the
// same catalogue, so "the SAME visibility law as `tools/list`" now means one thing: the v2 name is
// spoken exactly when THIS INSTANCE registers the tool, which is a fact about the composition and
// never about the caller. The walls below keep their claims and re-derive "sighted" from what the
// fixture composition registers; the caller-invariance cells now range over three caller records
// that differ in every retired permission field. So every cell below drives a REAL client over a REAL transport against the shipped
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
//     else would answer on one transport and not the other. The wrapper closes over the tool set
//     this instance registered, never over connection state.
//
// Protocol grounding: SEP-2567 (no per-connection variance, and since 432-20 no per-caller
// variance either), SEP-2575 (stateless; there is no handshake in which the old vocabulary
// could have been negotiated, so the only place a v1 caller's name can be answered is at the call),
// SEP-2106 (the advertised contracts a sighted caller is pointed back at).

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { McpServer } from '@modelcontextprotocol/server'
import type { FunctionDeclaration, FunctionRegistry } from '@vostride/agent-qa-agent'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildAgentQaMcpServer, v1RedirectFor, v1RedirectMessage } from '../catalog.js'
import { AGENT_QA_TOOL_PROJECTIONS } from '../mapping.js'
import type { ToolProjection } from '../mapping.js'
import { V1_TOOL_MIGRATION_MAP } from '../migration-map.js'
import type { V1ToolMigrationEntry } from '../migration-map.js'

// ---------------------------------------------------------------------------------------------
// The fixture composition
// ---------------------------------------------------------------------------------------------

/** Every op any shipped projection names — the fixture's own denominator, read from the mapping. */
const PROJECTED_OP_IDS: readonly string[] = [
  ...new Set(AGENT_QA_TOOL_PROJECTIONS.flatMap((projection) => [...projection.ops])),
]

/**
 * The declarations a composition serving every projected op — minus `omitted` — would publish.
 *
 * Stated here rather than read from a live registry because this package cannot compose one. No
 * declaration carries a scope (432-20, D-12): the only thing that decides whether a tool exists on
 * an instance is whether the composition registers its ops, so `omitted` is how a cell builds a
 * composition that genuinely cannot serve a target.
 */
function fixtureDeclarations(omitted: ReadonlySet<string> = new Set()): readonly FunctionDeclaration[] {
  return PROJECTED_OP_IDS.filter((id) => !omitted.has(id)).map(
    (id) =>
      ({
        id,
        summary: `The fixture declaration for ${id}.`,
        resultKind: 'unary',
        risk: { name: `fn:${id}`, recognized: true, readOnly: id.startsWith('entities.') },
        bindingStatus: 'bound',
        input: {},
        output: {},
      }) as unknown as FunctionDeclaration,
  )
}

function fixtureRegistry(omitted: ReadonlySet<string> = new Set()): FunctionRegistry {
  return { list: () => fixtureDeclarations(omitted) }
}

const FIXTURE_REGISTRY: FunctionRegistry = fixtureRegistry()

/** Identity masking: the cells assert on exact bytes, so a masker must not be in the way. */
const identity = (text: string): string => text

function caller(grantedScopes: readonly FunctionScope[]): FunctionCaller {
  return { surface: 'mcp', origin: 'agent', grantedScopes, safeMode: false }
}

/**
 * Three caller records that differ in every retired permission field — every scope, read only,
 * and a tokenless record carrying none. Since 432-20 they must all be answered alike.
 */
const EVERY_SCOPE_CALLER: FunctionCaller = caller([
  'read', 'run', 'config-write', 'knowledge-write', 'approval-write', 'test-write',
])
const READ_ONLY_CALLER: FunctionCaller = caller(['read'])
const TOKENLESS_CALLER: FunctionCaller = { surface: 'mcp', origin: 'agent' }
const CALLERS: readonly FunctionCaller[] = [EVERY_SCOPE_CALLER, READ_ONLY_CALLER, TOKENLESS_CALLER]

/** A driven server plus the client talking to it, over the SDK's own in-memory transport pair. */
interface DrivenServer {
  readonly client: Client
  readonly server: McpServer
  close(): Promise<void>
}

async function drive(
  who: FunctionCaller = TOKENLESS_CALLER,
  registry: FunctionRegistry = FIXTURE_REGISTRY,
): Promise<DrivenServer> {
  const server = buildAgentQaMcpServer({
    registry,
    caller: who,
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
  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'assigns a non-empty scope set to every op the
  // shipped mapping projects' and 'declares no scope the fixture does not also grant to the
  // everything caller'. The fixture carries no scopes; what keeps the cells below non-vacuous now is
  // that it serves every projected op, and that an omission really removes a tool.
  it('serves every op the shipped mapping projects, with no permission key', () => {
    const declared = fixtureDeclarations().map((declaration) => declaration.id)
    expect([...declared].sort()).toEqual([...PROJECTED_OP_IDS].sort())
    for (const declaration of fixtureDeclarations()) {
      expect(Object.keys(declaration), declaration.id).not.toContain('requiredScopes')
    }
  })

  it('removes a tool from the instance when its op is omitted from the composition', async () => {
    const entry = RENAMED_ENTRIES[0]!
    const full = await drive()
    const partial = await drive(TOKENLESS_CALLER, fixtureRegistry(targetOps(entry)))
    try {
      expect((await full.client.listTools()).tools.map((tool) => tool.name)).toContain(entry.v2Tool!)
      expect((await partial.client.listTools()).tools.map((tool) => tool.name))
        .not.toContain(entry.v2Tool!)
    } finally {
      await full.close()
      await partial.close()
    }
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
    const driven = await drive(EVERY_SCOPE_CALLER)
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
  // by caller record.
  it('answers identically for a caller granted nothing at all', async () => {
    const sighted = await drive(EVERY_SCOPE_CALLER)
    const unsighted = await drive(TOKENLESS_CALLER)
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
    const driven = await drive(EVERY_SCOPE_CALLER)
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

// ---------------------------------------------------------------------------------------------
// The three walls
// ---------------------------------------------------------------------------------------------

const RENAMED_ENTRIES = V1_TOOL_MIGRATION_MAP.filter((entry) => entry.arm === 'renamed-to')
const RETIRED_OR_PENDING = V1_TOOL_MIGRATION_MAP.filter((entry) => entry.arm !== 'renamed-to')

function targetProjection(entry: V1ToolMigrationEntry): ToolProjection | undefined {
  return AGENT_QA_TOOL_PROJECTIONS.find((projection) => projection.name === entry.v2Tool)
}

/** The ops a renamed-to entry's target tool dispatches over — what a composition must omit to hide it. */
function targetOps(entry: V1ToolMigrationEntry): ReadonlySet<string> {
  return new Set(targetProjection(entry)?.ops ?? [])
}

/**
 * Two renamed-to entries whose targets share no op, so ONE composition can serve the first and not
 * the second. Derived from the shipped tables, never typed.
 */
const SIGHTED_ENTRY = RENAMED_ENTRIES[0]
const HIDDEN_ENTRY = RENAMED_ENTRIES.find((entry) =>
  SIGHTED_ENTRY !== undefined
  && entry.v2Tool !== SIGHTED_ENTRY.v2Tool
  && [...targetOps(entry)].every((op) => !targetOps(SIGHTED_ENTRY).has(op)),
)
const PARTIAL_REGISTRY: FunctionRegistry = fixtureRegistry(
  HIDDEN_ENTRY === undefined ? new Set() : targetOps(HIDDEN_ENTRY),
)

describe('the redirect fires on exact members, and only errors (D-15 · T-398-12)', () => {
  // Complete set, three caller records: all thirty-three, never a hand-picked example of each arm.
  it.each(V1_TOOL_MIGRATION_MAP.map((entry) => [entry.v1Name, entry] as const))(
    'answers %s with a teaching error and never a result',
    async (_name, entry) => {
      for (const who of CALLERS) {
        const driven = await drive(who)
        try {
          const outcome = await callOutcome(driven.client, entry.v1Name)

          // THREW, not returned. A handler reached — the only way an op could be invoked — answers
          // with a CallToolResult, so this single assertion is also the no-invocation wall.
          expect(outcome.threw).toBe(true)
          expect(outcome.name).toBe('ProtocolError')
          expect(outcome.code).toBe(MEASURED_UNKNOWN_TOOL_CODE)
          expect(outcome.message).not.toBe(measuredUnknownToolMessage(entry.v1Name))
          expect(outcome.message).toContain(entry.v1Name)
          expect(outcome.serialized).not.toContain('Unknown function')
        } finally {
          await driven.close()
        }
      }
    },
  )
})

describe('the sighted wall: the v2 name is spoken where the instance serves it', () => {
  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'has a renamed-to entry on each side of the read-only
  // caller, so the split is measurable'. The split is now one composition serving one target and
  // not the other.
  it('has a renamed-to entry on each side of one composition, so the split is measurable', () => {
    expect(RENAMED_ENTRIES.length).toBeGreaterThan(0)
    expect(SIGHTED_ENTRY).toBeDefined()
    expect(HIDDEN_ENTRY).toBeDefined()
  })

  // RE-SPELLED from 'names the v2 tool for %s when the caller is granted its scope union'.
  it.each(RENAMED_ENTRIES.map((entry) => [entry.v1Name, entry] as const))(
    'names the v2 tool for %s to every caller of a composition serving it',
    async (_name, entry) => {
      for (const who of CALLERS) {
        const driven = await drive(who)
        try {
          const outcome = await callOutcome(driven.client, entry.v1Name)
          const target = targetProjection(entry)

          expect(target).toBeDefined()
          expect(outcome.message).toContain(`\`${entry.v2Tool!}\``)
          expect(outcome.message).toContain('input shape')
          expect(outcome.message).toContain('tools/list')
        } finally {
          await driven.close()
        }
      }
    },
  )
})

describe('the unsighted wall: the v2 name is withheld (T-398-11)', () => {
  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'leaks no tool name for %s to a caller granted
  // nothing'. No caller is unsighted any more; a composition that does not serve the target is, and
  // the scan is still over the WHOLE serialized answer.
  it.each(RENAMED_ENTRIES.map((entry) => [entry.v1Name, entry] as const))(
    'leaks no tool name for %s from a composition that does not serve it',
    async (_name, entry) => {
      const driven = await drive(TOKENLESS_CALLER, fixtureRegistry(targetOps(entry)))
      try {
        const outcome = await callOutcome(driven.client, entry.v1Name)

        expect(outcome.serialized.split(entry.v2Tool!).length - 1).toBe(0)
        expect(outcome.message).toContain('tools/list')
        expect(outcome.message).toContain('init --agent')
      } finally {
        await driven.close()
      }
    },
  )

  // THE SHARP ONE, re-spelled from 'names one target and withholds another for the SAME read-only
  // caller': same composition, same caller, same arm, two entries.
  it('names one target and withholds another for the SAME composition and caller', async () => {
    const sighted = SIGHTED_ENTRY!
    const hidden = HIDDEN_ENTRY!
    const driven = await drive(TOKENLESS_CALLER, PARTIAL_REGISTRY)
    try {
      const named = await callOutcome(driven.client, sighted.v1Name)
      const withheld = await callOutcome(driven.client, hidden.v1Name)

      expect(named.message).toContain(`\`${sighted.v2Tool!}\``)
      expect(withheld.serialized.split(hidden.v2Tool!).length - 1).toBe(0)
    } finally {
      await driven.close()
    }
  })

  // RE-SPELLED from 'speaks the target for %s exactly when visibleToCaller admits it and it is
  // listed'. The redirect's verdict IS the listing's verdict, for every caller and composition.
  it.each(RENAMED_ENTRIES.map((entry) => [entry.v1Name, entry] as const))(
    'speaks the target for %s exactly when it is listed, for every caller',
    async (_name, entry) => {
      for (const registry of [FIXTURE_REGISTRY, fixtureRegistry(targetOps(entry))]) {
        for (const who of CALLERS) {
          const driven = await drive(who, registry)
          try {
            const listed = (await driven.client.listTools()).tools.map((tool) => tool.name)
            const outcome = await callOutcome(driven.client, entry.v1Name)
            const spoken = outcome.serialized.includes(entry.v2Tool!)

            expect(spoken).toBe(listed.includes(entry.v2Tool!))
            expect(spoken).toBe(registry === FIXTURE_REGISTRY)
          } finally {
            await driven.close()
          }
        }
      }
    },
  )
})

describe('caller-invariance on the retired and pending arms (T-398-13 · Pitfall 8)', () => {
  // Complete set again, and byte equality on the whole serialized answer. These arms describe
  // HISTORY; a scope-dependent word in either would make the seam an oracle in the one place it is
  // supposed to be a constant.
  it.each(RETIRED_OR_PENDING.map((entry) => [entry.v1Name, entry] as const))(
    'answers %s identically under three different caller records',
    async (_name, entry) => {
      const answers: string[] = []
      for (const who of CALLERS) {
        const driven = await drive(who)
        try {
          answers.push((await callOutcome(driven.client, entry.v1Name)).serialized)
        } finally {
          await driven.close()
        }
      }
      expect(new Set(answers).size).toBe(1)
      // Non-vacuity: an empty or missing answer would also be "identical three times".
      expect(answers[0]!).toContain(entry.v1Name)
    },
  )

  it('covers both arms, so the invariance claim is not about one of them', () => {
    expect(RETIRED_OR_PENDING.some((entry) => entry.arm === 'retired')).toBe(true)
    expect(RETIRED_OR_PENDING.some((entry) => entry.arm === 'pending')).toBe(true)
  })
})

describe('v1RedirectFor: a live handler always wins (the ordering, given a bar)', () => {
  // WHY THIS IS DRIVEN DIRECTLY. Through the server this ordering is observationally inert: the
  // migration map and the live vocabulary are disjoint, so no name reaches it from both sides, and
  // mutation leg M9 (dropping the check entirely) reds nothing at the wire. A doctored `registered`
  // set is the only way to state the claim as something that can fail — and it is worth stating,
  // because it is what makes the disjointness cell's failure a missed redirect rather than a live
  // tool shadowed by an error.
  it('answers undefined for a map member that IS registered on this instance', () => {
    const member = V1_MEMBER_NAMES[0]!
    expect(v1RedirectFor(member, new Set())).toBeDefined()
    expect(v1RedirectFor(member, new Set([member]))).toBeUndefined()
  })

  it('answers the entry for a member no handler serves, and nothing for a non-member', () => {
    const member = V1_MEMBER_NAMES[0]!
    expect(v1RedirectFor(member, new Set(LIVE_TOOL_NAMES))?.v1Name).toBe(member)
    expect(v1RedirectFor(NON_MEMBER_NAME, new Set(LIVE_TOOL_NAMES))).toBeUndefined()
  })

  it('is byte-exact on the name (a case-variant is not a member)', () => {
    const member = V1_MEMBER_NAMES[0]!
    expect(v1RedirectFor(member.toUpperCase(), new Set())).toBeUndefined()
  })

  // The invariant the ordering is insurance for, asserted here too so this file states the premise
  // its own inertness argument rests on rather than borrowing it silently from another file.
  it('has nothing in both vocabularies today', () => {
    expect(V1_MEMBER_NAMES.filter((name) => LIVE_TOOL_NAMES.includes(name))).toEqual([])
  })
})

describe('v1RedirectMessage, driven directly', () => {
  // The withholding is in the SIGNATURE — there is no target to leak when none is passed — and this
  // cell is what says the sighted text is not reachable by accident from the unsighted call.
  it.each(RENAMED_ENTRIES.map((entry) => [entry.v1Name, entry] as const))(
    'writes no tool name at all for %s without a visible target',
    (_name, entry) => {
      const message = v1RedirectMessage(entry)
      for (const live of LIVE_TOOL_NAMES) expect(message).not.toContain(live)
      expect(message).toContain(entry.v1Name)
    },
  )

  // THE BAR for the input-shape note: a derivation that answered the same sentence for every tool
  // reds here, because a fold's line has to carry the discriminant and every arm — the field v1's
  // one-tool-per-verb vocabulary has no equivalent for, and the single likeliest thing a migrating
  // caller gets wrong.
  it('derives a fold target’s note from its declared discriminant and arms', () => {
    const foldEntry = RENAMED_ENTRIES.find((entry) => targetProjection(entry)?.discriminant)
    expect(foldEntry).toBeDefined()
    const fold = targetProjection(foldEntry!)!
    const message = v1RedirectMessage(foldEntry!, fold)

    expect(message).toContain(fold.discriminant!)
    for (const op of fold.ops) expect(message).toContain(op)
  })

  it('derives a single-op target’s note without inventing a discriminant', () => {
    const singleEntry = RENAMED_ENTRIES.find((entry) => {
      const projection = targetProjection(entry)
      return projection !== undefined && projection.ops.length === 1
    })
    expect(singleEntry).toBeDefined()
    const single = targetProjection(singleEntry!)!
    const message = v1RedirectMessage(singleEntry!, single)

    expect(message).toContain(`\`${single.name}\``)
    expect(message).toContain('one input object')
  })

  // Every entry's own ruled text reaches the caller on the arms where it is safe to speak it. A
  // redirect that answered a generic sentence per arm would pass the wall cells and red here.
  it.each(RETIRED_OR_PENDING.map((entry) => [entry.v1Name, entry] as const))(
    'carries %s’s own ruled note and route',
    (_name, entry) => {
      const message = v1RedirectMessage(entry)
      expect(message).toContain(entry.note)
      if (entry.route !== undefined) expect(message).toContain(entry.route)
      if (entry.owner !== undefined && entry.arm === 'pending') {
        expect(message).toContain(entry.owner)
      }
    },
  )
})

describe('the listing is what it was (D-15: no v1 name is resurrected)', () => {
  // The redirect answers a name; it must never make one appear. This cell is the standing guard
  // that a later "just register the v1 names and refuse in the handler" implementation reds on.
  it('lists no migration-map member to a caller granted everything', async () => {
    const driven = await drive(EVERY_SCOPE_CALLER)
    try {
      const listed = (await driven.client.listTools()).tools.map((tool) => tool.name)

      expect(listed.length).toBeGreaterThan(0)
      expect(listed.filter((name) => V1_MEMBER_NAMES.includes(name))).toEqual([])
    } finally {
      await driven.close()
    }
  })
})
