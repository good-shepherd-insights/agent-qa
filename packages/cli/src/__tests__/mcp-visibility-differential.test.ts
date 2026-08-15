// MCPS-04: safe mode proven by ABSENCE, with two independent walls (Phase 396 plan 05, D-05/D-08).
//
// WHAT THIS SUITE IS AND WHY IT IS DRIVEN. Every cell below speaks to a REAL loopback socket, over
// a REAL `Authorization` header, against the production `createMcpHttpRequestListener` composed
// over the production `composeCliLocalAgent`. Nothing here hand-assembles a tool list or a caller.
// The reason is the lesson 395 round 2 paid for: ten cells passed while two shipped commands leaked
// a planted credential, because the corpus asserted on an internal error object while the live
// channel was that error's serialization. So this suite asserts on the bytes a caller reads — the
// wire payload and the HTTP response — and reaches them by being a caller.
//
// THE PLAN'S THESIS IS AN ABSENCE, WHICH IS THE EASIEST KIND OF CLAIM TO FAKE. A cell asserting
// "the list does not contain X" passes over a server that lists nothing at all, over a client that
// never connected, and over a filter that was deleted. Three things guard against that here:
//
//   1. EVERY absence is paired with the presence that proves the same machinery can answer the
//      other way. No cell says only "absent".
//   2. The absent NAME is always drawn from the shipped mapping rather than typed as a literal, so
//      a rename cannot silently turn the assertion into a tautology about a tool nobody ships.
//   3. `scripts/396-visibility-mutation.sh` tears each wall SEPARATELY and requires that the cells
//      aimed at THAT wall go red while the cells aimed at the other stay green. A conjunction of
//      two whole-input checks is weaker than the spec it implements; two legs is what tells the two
//      walls apart. Measured results are recorded in that script's header and in the SUMMARY.
//
// OBSERVED RED (2026-08-16), from `SHOW_REDS=1 bash scripts/396-visibility-mutation.sh`:
//   W1  `visibleToCaller` severed to always-true       -> RED, 10 cells across groups 1, 2, 4, 5,
//                                                         7 and 8 · the wall-2 group GREEN
//   W2  `invokeFunction`'s scope refusal defeated      -> RED, 2 cells, BOTH in group 3
//                                                         · the absence group GREEN
//   K1  the masker's declared-credential seeding cut   -> RED, 2 cells in group 9
//   K2  the 401 body made to echo the presented header -> RED, 2 cells in group 9
//
// W1's TEN and W2's TWO are the pair that carries D-08's independence claim. Tearing the listing
// filter reds cells in six different groups, because they are all instances of ONE law rather than
// six rules that happen to agree; tearing the function layer's check reds only the group that
// reaches it without a listing. Neither leg reds the other's cells. A single cell that only passed
// when both walls stood would have told us nothing about either.
//
// A2 (RESEARCH's flagged assumption on SEP-2549 caching) IS RESOLVED HERE BY MEASUREMENT, not by
// reading a default out of a type declaration: cell 8 connects on BOTH protocol eras and asserts
// what the SDK actually stamped. Measured 2026-08-16 — 2026-07-28 era: `ttlMs: 0`,
// `cacheScope: 'private'` on every `tools/list`, for every caller; 2025 era: no cache fields on the
// result at all (that codec has no cache path). Either way no shared cacheable identity exists
// between two callers' listings, which is T-396-16's whole content.

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { FunctionScopeError, invokeFunction } from '@vostride/agent-qa-agent'
import { AGENT_QA_TOOL_PROJECTIONS, buildAgentQaMcpServer } from '@vostride/agent-qa-mcp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { composeMcpMasking, createMcpHttpRequestListener, mcpFunctionCaller } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { resolveMcpTokens } from '../composition/mcp-token-resolution.js'
import type { ResolvedMcpToken } from '../composition/mcp-token-resolution.js'

/**
 * The two config tools, read OUT of the shipped mapping.
 *
 * Never typed as literals. An absence cell naming a tool by hand keeps passing after a rename —
 * it would then be asserting that a tool nobody ships is not listed, which is true of every string.
 */
const CONFIG_TOOL_NAMES = AGENT_QA_TOOL_PROJECTIONS
  .filter((projection) => projection.ops.every((op) => op.startsWith('config.')))
  .map((projection) => projection.name)

/** The declared order, for the ordering cell. Also read out of the mapping rather than restated. */
const DECLARED_TOOL_ORDER = AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name)

/** A tool whose required set has THREE members — the adjacency boundary needs one. */
const AUTHORING_TOOL = 'agent_qa_write_test'
const AUTHORING_SCOPES = ['test-write', 'run', 'read'] as const

/**
 * The planted credential. No suffix `sensitiveEnvSlice` recognises, deliberately: a probe named
 * `…_TOKEN` would be masked by machinery this suite is not testing and the cells would pass for
 * the wrong reason.
 */
const PLANTED_CFG = 'zz-396-05-cfg-credential-8c14ae'
const PLANTED_RO = 'zz-396-05-ro-credential-3b90fd'
const PLANTED_AUTHORING = 'zz-396-05-authoring-credential-71ca'
const PLANTED_WRONG = 'zz-396-05-never-declared-credential-ff02'

const TOKEN_ENV = {
  AGENT_QA_396_CFG: PLANTED_CFG,
  AGENT_QA_396_RO: PLANTED_RO,
  AGENT_QA_396_AUTHORING: PLANTED_AUTHORING,
  AGENT_QA_396_AUTHORING_MINUS_TEST_WRITE: 'zz-396-05-minus-test-write-a1',
  AGENT_QA_396_AUTHORING_MINUS_RUN: 'zz-396-05-minus-run-b2',
  AGENT_QA_396_AUTHORING_MINUS_READ: 'zz-396-05-minus-read-c3',
}

interface Harness {
  readonly server: Server
  readonly port: number
  readonly url: string
  readonly registry: Parameters<typeof invokeFunction>[0]
  readonly tokens: readonly ResolvedMcpToken[]
  readonly mask: (text: string) => string
  close(): Promise<void>
}

let harness: Harness

function workspace(): { root: string; configPath: string; agentQaRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-396-05-visibility-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        use: { mobile: { appState: 'preserve' } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  return { root, configPath, agentQaRoot }
}

beforeAll(async () => {
  const where = workspace()
  const host = composeCliLocalAgent({
    agentQaRoot: where.agentQaRoot,
    configPath: where.configPath,
    confirm: undefined,
  })

  // Produced, not literal, on the credential side too: the entries go through the SHIPPED resolver
  // against a planted environment, so what the server matches against is what a real start would
  // have produced from a real config.
  const tokens = resolveMcpTokens(
    [
      { name: 'cfg', tokenEnvVar: 'AGENT_QA_396_CFG', scopes: ['read', 'run', 'config-write'] },
      { name: 'ro', tokenEnvVar: 'AGENT_QA_396_RO', scopes: ['read'] },
      { name: 'authoring', tokenEnvVar: 'AGENT_QA_396_AUTHORING', scopes: [...AUTHORING_SCOPES] },
      {
        name: 'minus-test-write',
        tokenEnvVar: 'AGENT_QA_396_AUTHORING_MINUS_TEST_WRITE',
        scopes: ['run', 'read'],
      },
      {
        name: 'minus-run',
        tokenEnvVar: 'AGENT_QA_396_AUTHORING_MINUS_RUN',
        scopes: ['test-write', 'read'],
      },
      {
        name: 'minus-read',
        tokenEnvVar: 'AGENT_QA_396_AUTHORING_MINUS_READ',
        scopes: ['test-write', 'run'],
      },
    ],
    TOKEN_ENV,
  )

  // THE PRODUCTION MASKER, not a stand-in. `composeMcpMasking` is the function the `mcp` command
  // itself calls, seeded with these declared credentials; a suite that built its own masker here
  // would be asserting that ITS masker works, which is true and worthless. `env: {}` because the
  // only values under test are the declared token values — a real process environment would seed
  // this masker with unrelated secrets and a passing cell could then be passing on one of those.
  const masking = composeMcpMasking({ tokens, env: {} })
  const maskText = (text: string): string => masking.mask(text)

  const server = createServer(
    createMcpHttpRequestListener({ registry: host.registry, maskText, tokens }),
  )
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', () => listening()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  harness = {
    server,
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    registry: host.registry,
    tokens,
    mask: maskText,
    close: async () => {
      await new Promise<void>((closed) => server.close(() => closed()))
      await host.close().catch(() => {})
      rmSync(where.root, { recursive: true, force: true })
    },
  }
}, 60_000)

afterAll(async () => {
  await harness?.close()
})

/** One recorded HTTP exchange — the bytes, exactly as they crossed. */
interface Frame {
  readonly status: number
  readonly text: string
}

/**
 * Connect as a caller holding `token`, recording every response body.
 *
 * `era` is explicit because the SDK client defaults to the 2025 handshake and the two eras answer
 * differently on exactly the axis cell 8 measures. A suite that only ever spoke one of them would
 * be asserting a property of its own default.
 */
async function connectAs(
  token: string | undefined,
  era: 'legacy' | 'modern' = 'legacy',
): Promise<{ client: Client; frames: Frame[] }> {
  const frames: Frame[] = []
  const tokenFetch = (async (input: URL | string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
    const res = await fetch(input as string, { ...init, headers })
    const text = await res.clone().text()
    frames.push({ status: res.status, text })
    return res
  }) as typeof fetch

  const client = new Client(
    { name: 'agent-qa-396-05-differential', version: '0.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL(harness.url), { fetch: tokenFetch }),
  )
  return { client, frames }
}

async function toolNamesFor(token: string | undefined): Promise<string[]> {
  const { client } = await connectAs(token)
  try {
    return (await client.listTools()).tools.map((tool) => tool.name)
  } finally {
    await client.close().catch(() => {})
  }
}

/**
 * A raw HTTP request over a socket, because `fetch` refuses to let a caller set `Host`.
 *
 * The DNS-rebinding guard is a claim ABOUT the `Host` header, and undici silently overwrites it —
 * a cell built on `fetch` would have asserted the guard while never once presenting a bad host.
 */
async function rawRequest(headers: Record<string, string>): Promise<Frame> {
  return await new Promise((done, failed) => {
    const socket = netConnect(harness.port, '127.0.0.1', () => {
      const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
      socket.write(
        [
          'POST /mcp HTTP/1.1',
          ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          `Content-Length: ${Buffer.byteLength(body)}`,
          'Connection: close',
          '',
          body,
        ].join('\r\n'),
      )
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
    })
    socket.on('error', failed)
    socket.on('end', () => {
      done({
        status: Number.parseInt(buffer.split(' ')[1] ?? '0', 10),
        text: buffer,
      })
    })
  })
}

/** The JSON-RPC payload of the last frame that carried one, SSE framing removed. */
function lastPayload(frames: readonly Frame[]): unknown {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const text = frames[i]!.text
    const line = text.split('\n').find((candidate) => candidate.startsWith('data: '))
    const json = line === undefined ? text : line.slice('data: '.length)
    if (json.trim().startsWith('{')) return JSON.parse(json)
  }
  throw new Error('no JSON-RPC payload was recorded')
}

// ---------------------------------------------------------------------------------------------
// CELL 1 — ABSENCE, both sides (MCPS-04, D-05)
// ---------------------------------------------------------------------------------------------

describe('1 · the config tools are ABSENT from a caller without config-write', () => {
  it('names two config tools in the shipped mapping, so the absence below is about something', () => {
    // The integrity assertion that keeps every cell in this group from being a statement about the
    // empty set. Without it, deleting the config tools from the catalogue would make cell 1 pass.
    expect(CONFIG_TOOL_NAMES).toEqual([
      'agent_qa_propose_config_change',
      'agent_qa_apply_config_proposal',
    ])
  })

  it('a read-only caller sees NEITHER config tool', async () => {
    const names = await toolNamesFor(PLANTED_RO)
    for (const tool of CONFIG_TOOL_NAMES) {
      expect(names, `${tool} leaked into a read-only caller's listing`).not.toContain(tool)
    }
    // And it sees SOMETHING — an empty list would satisfy the assertion above for free.
    expect(names.length).toBeGreaterThan(0)
  })

  it('a config-write caller sees BOTH — the same machinery, answering the other way', async () => {
    const names = await toolNamesFor(PLANTED_CFG)
    for (const tool of CONFIG_TOOL_NAMES) {
      expect(names, `${tool} is missing from a config-write caller's listing`).toContain(tool)
    }
  })

  it('the two listings differ in EXACTLY the config tools and nothing else', async () => {
    // The sharpest form of the two-sided claim: a filter that dropped an unrelated tool from the
    // read-only listing would satisfy both cells above and fail this one.
    const [ro, cfg] = await Promise.all([toolNamesFor(PLANTED_RO), toolNamesFor(PLANTED_CFG)])
    const extra = cfg.filter((name) => !ro.includes(name))
    // `agent_qa_start_run` is in the difference too: the cfg token holds `run` and the ro token
    // does not. That is the same law, and stating the whole difference is what makes this an
    // equality rather than a containment.
    expect(extra.sort()).toEqual([...CONFIG_TOOL_NAMES, 'agent_qa_start_run'].sort())
    expect(ro.filter((name) => !cfg.includes(name))).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 2 — a hidden tool answers exactly as a tool that never existed (D-08, Pitfall 6)
// ---------------------------------------------------------------------------------------------

describe('2 · calling a hidden tool is indistinguishable from calling a nonexistent one', () => {
  it('produces two refusal payloads identical everywhere but the name the caller itself sent', async () => {
    const hiddenName = CONFIG_TOOL_NAMES[0]!
    const ghostName = 'agent_qa_a_tool_that_was_never_declared'

    const { client, frames } = await connectAs(PLANTED_RO)
    try {
      await client
        .callTool({ name: hiddenName, arguments: { action: 'config.field.set' } })
        .catch(() => undefined)
      const hidden = lastPayload(frames)
      await client.callTool({ name: ghostName, arguments: {} }).catch(() => undefined)
      const ghost = lastPayload(frames)

      // STRUCTURAL equality over the full payloads, not a substring check. The only permitted
      // differences are the JSON-RPC id (transport bookkeeping) and the tool name — which the
      // CALLER supplied, so an answer that did not contain it would be answering a different
      // question. Both are normalised to a constant and everything else must match byte for byte.
      const normalise = (payload: unknown, name: string): string =>
        JSON.stringify(payload)
          .split(name).join('<NAME>')
          .replace(/"id":\s*\d+/g, '"id":<ID>')

      expect(normalise(hidden, hiddenName)).toBe(normalise(ghost, ghostName))

      // And the shared answer is the UNKNOWN-tool shape rather than a scope refusal: an answer
      // that said "you lack config-write" would be identical between the two only if the server had
      // invented that reason for the ghost too, which is the enumeration oracle D-08 forbids.
      expect(JSON.stringify(hidden)).toContain('not found')
      expect(JSON.stringify(hidden)).not.toContain('config-write')
      expect(JSON.stringify(hidden)).not.toContain('scope')
    } finally {
      await client.close().catch(() => {})
    }
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 3 — THE SECOND WALL, reached with the listing bypassed entirely (D-08, T-396-14)
// ---------------------------------------------------------------------------------------------

describe('3 · the function layer refuses independently of anything a surface listed', () => {
  it('refuses a config op for a caller without the scope, naming the missing scope', async () => {
    // No MCP server is involved in this cell AT ALL. That is the point: this wall is reached by
    // going around the listing rather than through it, so a listing filter torn to always-true
    // cannot change this answer — and the W1 mutation leg measures exactly that.
    const caller = mcpFunctionCaller(['read'])
    let thrown: unknown
    try {
      await invokeFunction(harness.registry, 'config.field.set', { path: 'a.b', value: 1 }, caller)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(FunctionScopeError)
    expect((thrown as FunctionScopeError).missingScopes).toEqual(['config-write'])
    expect((thrown as FunctionScopeError).functionId).toBe('config.field.set')
  })

  it('admits the same op for a caller that holds the scope — the wall opens, it does not just close', async () => {
    // The other side. A wall that refused everything would satisfy the cell above.
    const caller = mcpFunctionCaller(['read', 'config-write'])
    let thrown: unknown
    try {
      await invokeFunction(harness.registry, 'config.field.set', { path: 'a.b', value: 1 }, caller)
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeInstanceOf(FunctionScopeError)
  })

  it('refuses even when the SERVER was built for a caller that holds the scope', async () => {
    // The "claimed scope" case, as close to a forge as this surface allows. The instance is built
    // with a config-write caller so the config tools ARE registered on it — the listing wall is
    // wide open — and the invoke is then made with a caller that lacks the scope. The refusal is
    // the second wall answering with the first one bypassed by construction.
    const openServer = buildAgentQaMcpServer({
      registry: harness.registry,
      caller: mcpFunctionCaller(['read', 'run', 'config-write']),
      maskText: (text: string) => text,
    })
    expect(openServer).toBeDefined()

    const impoverished = mcpFunctionCaller(['read', 'run'])
    await expect(
      invokeFunction(harness.registry, 'config.field.set', { path: 'a.b', value: 1 }, impoverished),
    ).rejects.toBeInstanceOf(FunctionScopeError)
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 4 — the equality boundary, one step either side (MCPS-04 adjacency row)
// ---------------------------------------------------------------------------------------------

describe('4 · a caller granted EXACTLY a tool\'s required set sees it; minus any one member, it does not', () => {
  it('names a three-scope tool, so the boundary below has three sides to test', () => {
    const projection = AGENT_QA_TOOL_PROJECTIONS.find((entry) => entry.name === AUTHORING_TOOL)
    expect(projection, `${AUTHORING_TOOL} is not in the shipped mapping`).toBeDefined()
    expect(AUTHORING_SCOPES).toHaveLength(3)
  })

  it('the exact set sees it', async () => {
    expect(await toolNamesFor(PLANTED_AUTHORING)).toContain(AUTHORING_TOOL)
  })

  it('the exact set minus test-write does not', async () => {
    expect(await toolNamesFor(TOKEN_ENV.AGENT_QA_396_AUTHORING_MINUS_TEST_WRITE)).not.toContain(
      AUTHORING_TOOL,
    )
  })

  it('the exact set minus run does not', async () => {
    expect(await toolNamesFor(TOKEN_ENV.AGENT_QA_396_AUTHORING_MINUS_RUN)).not.toContain(
      AUTHORING_TOOL,
    )
  })

  it('the exact set minus read does not', async () => {
    expect(await toolNamesFor(TOKEN_ENV.AGENT_QA_396_AUTHORING_MINUS_READ)).not.toContain(
      AUTHORING_TOOL,
    )
  })

  it('the config tools need config-write ALONE — a read grant is not adjacent to it', async () => {
    // The other adjacency the plan names: `config-write` by itself is the config tools' whole
    // required set, so a caller holding only that sees them, and a caller holding only `read` does
    // not. Driven at the factory because config forbids declaring a single-scope credential with
    // no read — which is itself worth stating rather than working around silently.
    const onlyConfigWrite = await namesFromFactory(['config-write'])
    for (const tool of CONFIG_TOOL_NAMES) expect(onlyConfigWrite).toContain(tool)
    const onlyRead = await namesFromFactory(['read'])
    for (const tool of CONFIG_TOOL_NAMES) expect(onlyRead).not.toContain(tool)
  })
})

/**
 * List the tools a caller with an arbitrary scope set is registered, through the production factory.
 *
 * Used only where a scope set is not expressible as a config token — the empty grant, and a
 * `config-write`-only grant. It is the same `buildAgentQaMcpServer` the socket path builds; what is
 * skipped is the credential, not the server.
 */
async function namesFromFactory(scopes: readonly string[]): Promise<string[]> {
  const handler = createMcpHandler(() =>
    buildAgentQaMcpServer({
      registry: harness.registry,
      caller: mcpFunctionCaller(scopes as Parameters<typeof mcpFunctionCaller>[0]),
      maskText: (text: string) => text,
    }),
  )
  const client = new Client({ name: 'agent-qa-396-05-factory', version: '0.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://factory.local/mcp'), {
        fetch: ((url: URL | string, init?: RequestInit) =>
          handler.fetch(new Request(url, init))) as typeof fetch,
      }),
    )
    return (await client.listTools()).tools.map((tool) => tool.name)
  } finally {
    await client.close().catch(() => {})
    await handler.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------------------------
// CELL 5 — the floor of the law (MCPS-04 empty row)
// ---------------------------------------------------------------------------------------------

describe('5 · a caller granted NOTHING is served an empty catalogue', () => {
  it('lists zero tools', async () => {
    // Reachability, stated rather than assumed: this state is NOT reachable through a config token,
    // because `McpTokenEntrySchema` requires a non-empty scope set (a zero-scope credential is
    // indistinguishable from a typo). It is the floor of D-05's law and it is driven through the
    // production factory. If 397 ever admits a zero-scope credential, this cell already covers it.
    expect(await namesFromFactory([])).toEqual([])
  })

  it('and the same factory with one scope lists more than zero — the empty answer is a filter, not a break', async () => {
    expect((await namesFromFactory(['read'])).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 6 — ordering (MCPS-04 ordering row, SEP-2567)
// ---------------------------------------------------------------------------------------------

describe('6 · tools/list order is stable and derived from the mapping', () => {
  it('is identical across repeated requests with the same token', async () => {
    const [first, second] = await Promise.all([toolNamesFor(PLANTED_CFG), toolNamesFor(PLANTED_CFG)])
    expect(first).toEqual(second)
  })

  it('equals the mapping\'s DECLARED order, filtered to what this caller may see', async () => {
    const names = await toolNamesFor(PLANTED_CFG)
    expect(names).toEqual(DECLARED_TOOL_ORDER.filter((name) => names.includes(name)))
  })

  it('and that is NOT merely the sorted order — the assertion above discriminates', async () => {
    // Without this, the cell above would pass over a server that sorted its output, and the claim
    // "the order comes from the mapping" would be untested. 396-04 chose declared order over sorted
    // deliberately; this is where that choice is measurable.
    const names = await toolNamesFor(PLANTED_CFG)
    expect(names).not.toEqual([...names].sort())
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 7 — concurrency (MCPS-02 concurrency row, SEP-2575)
// ---------------------------------------------------------------------------------------------

describe('7 · interleaved requests bearing different tokens each get their own catalogue', () => {
  it('answers four simultaneous connections by their own credentials', async () => {
    // Fired together on ONE socket-bound server. A factory that memoised an instance, or a module
    // holding the last caller it saw, answers this wrong — and per-request construction is the only
    // reason it can answer it right.
    const [cfgA, roA, cfgB, roB] = await Promise.all([
      toolNamesFor(PLANTED_CFG),
      toolNamesFor(PLANTED_RO),
      toolNamesFor(PLANTED_CFG),
      toolNamesFor(PLANTED_RO),
    ])
    expect(cfgA).toEqual(cfgB)
    expect(roA).toEqual(roB)
    for (const tool of CONFIG_TOOL_NAMES) {
      expect(cfgA).toContain(tool)
      expect(roA).not.toContain(tool)
      expect(roB).not.toContain(tool)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 8 — cache identity (Pitfall 8 / SEP-2549 · T-396-16 · RESEARCH A2)
// ---------------------------------------------------------------------------------------------

describe('8 · two callers\' listings never share a cacheable identity', () => {
  it('stamps cacheScope private and ttlMs 0 on BOTH callers\' lists, on the 2026-07-28 era', async () => {
    // The measured value, asserted rather than described in a comment. `private` is what makes a
    // per-caller listing safe to cache at all: a shared cache may not hold it, so one caller's
    // absent config tools can never be served to another.
    const cfg = await connectAs(PLANTED_CFG, 'modern')
    const ro = await connectAs(PLANTED_RO, 'modern')
    try {
      const cfgList = (await cfg.client.listTools()) as unknown as Record<string, unknown>
      const roList = (await ro.client.listTools()) as unknown as Record<string, unknown>
      expect(cfgList.cacheScope).toBe('private')
      expect(roList.cacheScope).toBe('private')
      expect(cfgList.ttlMs).toBe(0)
      expect(roList.ttlMs).toBe(0)
      // And the two are genuinely different documents, so "private" is protecting something.
      expect((cfgList.tools as unknown[]).length).not.toBe((roList.tools as unknown[]).length)
    } finally {
      await cfg.client.close().catch(() => {})
      await ro.client.close().catch(() => {})
    }
  })

  it('stamps no cache fields at all on the 2025 era — that codec has no cache path', async () => {
    const { client } = await connectAs(PLANTED_CFG, 'legacy')
    try {
      const listed = (await client.listTools()) as unknown as Record<string, unknown>
      expect(Object.keys(listed)).toEqual(['tools'])
      expect(listed.cacheScope).toBeUndefined()
      expect(listed.ttlMs).toBeUndefined()
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('emits no HTTP cache header that a shared proxy could key on', async () => {
    // The other place a cache identity could live. Asserted on the raw response because the client
    // does not report headers it does not read — the same reason the CORS prohibition is asserted
    // on a raw response in the tracer.
    const raw = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Authorization: `Bearer ${PLANTED_RO}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })
    const headerBlock = raw.text.split('\r\n\r\n')[0]!.toLowerCase()
    expect(headerBlock).not.toContain('cache-control: public')
    expect(headerBlock).not.toContain('etag:')
  })
})

// ---------------------------------------------------------------------------------------------
// CELL 9 — the guards in front, and what they must never echo (T-396-13, T-396-17)
// ---------------------------------------------------------------------------------------------

describe('9 · the walls in front of the handler refuse without becoming a channel', () => {
  it('refuses a rebound Host with 403, before anything else', async () => {
    const refused = await rawRequest({
      Host: 'evil.example.com',
      'Content-Type': 'application/json',
    })
    expect(refused.status).toBe(403)
    expect(refused.text).toContain('forbidden_host')
  })

  it('accepts a loopback Host — the guard is a filter, not a wall against everything', async () => {
    const allowed = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Authorization: `Bearer ${PLANTED_RO}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })
    expect(allowed.status).toBe(200)
  })

  it('refuses a cross-origin Origin with 403', async () => {
    const refused = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Origin: 'https://evil.example.com',
      'Content-Type': 'application/json',
    })
    expect(refused.status).toBe(403)
    expect(refused.text).toContain('forbidden_origin')
  })

  it('checks Host BEFORE the credential — a valid token does not buy a rebound host', async () => {
    const refused = await rawRequest({
      Host: 'evil.example.com',
      Authorization: `Bearer ${PLANTED_CFG}`,
      'Content-Type': 'application/json',
    })
    expect(refused.status).toBe(403)
    expect(refused.text).toContain('forbidden_host')
    expect(refused.text).not.toContain('invalid_token')
  })

  it('answers 401 for an undeclared credential and NEVER echoes it', async () => {
    // The masking claim on the one path composed entirely of caller-supplied text. 396-03 measured
    // that dropping the masker from a refusal path left an entire suite green; this cell is what
    // that lesson buys here, and leg K2 reds it.
    const refused = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Authorization: `Bearer ${PLANTED_WRONG}`,
      'Content-Type': 'application/json',
    })
    expect(refused.status).toBe(401)
    expect(refused.text).toContain('invalid_token')
    expect(refused.text).not.toContain(PLANTED_WRONG)
    expect(refused.text.toLowerCase()).not.toContain('bearer zz')
  })

  it('answers the SAME 401 body for a malformed header as for a wrong credential', async () => {
    // A prober must not learn which of the two it produced. Compared after stripping the status
    // line's date and the chunked framing — the JSON body is the whole answer.
    const wrong = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Authorization: `Bearer ${PLANTED_WRONG}`,
      'Content-Type': 'application/json',
    })
    const malformed = await rawRequest({
      Host: `127.0.0.1:${harness.port}`,
      Authorization: 'Basic aGk6dGhlcmU=',
      'Content-Type': 'application/json',
    })
    const bodyOf = (frame: Frame): string =>
      frame.text.split('\r\n\r\n').slice(1).join('').replace(/[0-9a-f]+\r\n/gi, '').trim()
    expect(bodyOf(wrong)).toBe(bodyOf(malformed))
    expect(wrong.status).toBe(malformed.status)
  })

  it('a valid credential presented to a REFUSED tool still does not leak it into the answer', async () => {
    // The refusal path a caller reaches with a good credential: a hidden tool. Every byte of the
    // answer is checked for the credential the caller presented, because a server that echoed the
    // Authorization header into a tool error would be exactly T-395-R5-10 arriving on this surface.
    const { client, frames } = await connectAs(PLANTED_RO)
    try {
      await client
        .callTool({ name: CONFIG_TOOL_NAMES[0]!, arguments: {} })
        .catch(() => undefined)
      for (const frame of frames) expect(frame.text).not.toContain(PLANTED_RO)
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('masks a declared credential a caller smuggles back through a tool argument', async () => {
    // The general masking claim, driven through the channel a caller reads rather than asserted on
    // an internal error object — the 395-round-2 lesson applied. `runs.digest` is used because it
    // was MEASURED (2026-08-16) to be an echoing path: its refusal for an unknown id is composed
    // from the caller's own string, which is exactly the shape T-395-R5-10's credential rode out
    // on. The host seeds the run masker with its declared credentials, so the echo comes back
    // masked. Leg K1 removes that seeding and reds this cell.
    const { client, frames } = await connectAs(PLANTED_RO)
    try {
      const called = await client.callTool({
        name: 'agent_qa_get_run_digest',
        arguments: { runId: PLANTED_RO },
      })
      const rendered = JSON.stringify(called)
      // The path echoes SOMETHING — otherwise there is no channel here and the absence below is
      // free. This is the integrity half of the cell.
      expect(rendered).toContain('No completed run recorded for id')
      expect(rendered).not.toContain(PLANTED_RO)
      // And not on the wire either, which is the surface a person actually reads.
      for (const frame of frames) expect(frame.text).not.toContain(PLANTED_RO)
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('the masker the COMMAND composes hides every declared credential', async () => {
    // The same claim one layer down, so a failure can be read as "the seeding is gone" rather than
    // only as "some tool stopped echoing". Both cells red under leg K1; this is the one that says
    // why.
    for (const token of harness.tokens) {
      expect(harness.mask(`presented ${token.value} here`)).not.toContain(token.value)
    }
  })
})
