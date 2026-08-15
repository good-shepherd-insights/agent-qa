// The write path at the wire: propose, refuse, confirm, ONE commit, replay (396-06 · MCPS-03 · D-11).
//
// WHAT THIS FILE IS FOR, and how it differs from the suite one layer down. `apply-refusal.test.ts`
// proved the handler HERMETICALLY: a recording invoke double, no store, no repository, no protocol.
// That is the right bar for a primitive and it cannot answer the only question a person actually has
// about a write surface, which is whether anything commits when it should not. This file drives the
// SHIPPED composition — `composeCliLocalAgent`, the real proposals store on disk, the real
// `config.proposal.apply` port, a real git repository — over a real MCP client speaking the real
// wire, and every mutation-adjacent cell reads `git rev-list --count HEAD` before and after.
//
// A COMMIT COUNT IS THE ONLY HONEST ASSERTION HERE. An outcome string is what the server SAYS it
// did; the number of commits in the person's repository is what happened. Every cell below that
// touches an apply door asserts that number, and the cells that must not commit assert it against a
// repository that already has a commit in it — an absence measured over an empty channel is the trap
// this project keeps recording.
//
// ASSERTED ON THE WIRE, NEVER ON AN INTERNAL OBJECT. `connect()` records the raw response body of
// every exchange and the payload cells assert on that recorded text. The 395 lesson is that a corpus
// asserting on an internal error object passes while the serialization a caller reads leaks; the
// client's parsed view is used only where a typed read is what a cell is about.
//
// WHAT THIS FILE FOUND, which is why it exists rather than being a second spelling of plan 02. The
// era claim plan 02 could only make about a PAYLOAD — "the teach travels in ordinary content, the
// form is an affordance layered on top of it" — was FALSE at the wire on the shipped SDK, in both
// directions, and this suite is what measured it (2026-08-16):
//
//   legacy (2025-era) connection: the SDK's shim REPLACED the handler's whole result with
//     {"content":[{"type":"text","text":"Cannot request input 'confirm' (elicitation/create): the
//     client on this 2025-era connection did not declare the required capability (no client
//     capabilities are available on this connection — per-request legacy serving cannot receive
//     server-to-client requests)"}],"isError":true}
//
//   2026-07-28 connection whose client declares no `elicitation` capability: the call THREW at the
//     client — `ProtocolError: Cannot request input 'confirm' (elicitation/create): the request's
//     client capabilities do not declare the required capability` (-32021, HTTP 400 — RESEARCH
//     Pitfall 11), so the caller received no teach, no summary and no readable refusal at all.
//
// Nothing on day zero speaks the 2026 wire and almost nothing declares `elicitation`, so that was
// the answer nearly every real caller got from D-11's door. The fix is in `apply-refusal.ts`: the
// form is attached ONLY to a connection whose declared capabilities can carry it, and the teach is
// what every other caller gets — which is what the module always said it did. See the SUMMARY's
// deviations; group 6 is the three-way measurement that pins it.
//
// OBSERVED REDS — 2026-08-16, `SHOW_REDS=1 bash scripts/396-06-mutation.sh`, verbatim headlines:
//
//   A1 (7 cells) the refusal branch severed so an unconfirmed call applies — plan 02's M2 at the
//        wire, where it is measurable as a COMMIT rather than as a call count:
//          FAIL … 2 · the FIRST apply refuses and teaches …
//          AssertionError: an unconfirmed apply committed: expected 2 to be 1
//          FAIL … 4 · … (4b) refuses confirmed: false and teaches instead
//          AssertionError: confirmed: false committed: expected 2 to be 1
//   A2 (0 cells HERE, 1 in the hermetic suite) `args.confirmed === true` widened to
//        `if (args.confirmed)`. THE WIRE CANNOT SEE IT, and that is a measurement rather than a
//        gap: the SDK's `inputSchema` validation refuses the string `'true'` — the only input that
//        distinguishes a boolean gate from a truthiness gate — before the handler runs. The bar
//        lives in `packages/mcp/src/__tests__/apply-refusal.test.ts` and M1 reds it there. The leg
//        is kept, and requires that hermetic red in the same run.
//   A3 (5 cells) the capability check inverted so the form is attached unconditionally — the
//        behaviour that shipped before this plan:
//          FAIL … (6b) a 2026-07-28 caller that declares no elicitation capability …
//          ProtocolError: Cannot request input 'confirm' (elicitation/create): the request's client
//          capabilities do not declare the required capability
//   A4 (5 cells) the structured refusal deleted, leaving `content` alone:
//          AssertionError: Output validation error: Tool agent_qa_apply_config_proposal has an
//          output schema but no structured content was provided
//
// Protocol grounding: SEP-2322 (`input_required` results and the client retry), SEP-2567 (no
// session — the `proposal_id` is the cross-call handle), SEP-2575 (stateless per-request servers).

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildAgentQaMcpServer } from '@vostride/agent-qa-mcp'
import { createGrantOperations } from '@vostride/agent-qa-knowledge-local'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeMcpMasking, mcpFunctionCaller } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { resolveStdioScopes } from '../composition/mcp-token-resolution.js'

/** The grantable class, READ off the shipped op id rather than typed as policy (391 D-04). */
const CONFIG_APPLY_CLASS = 'fn:config.proposal.apply'

const CONFIG_FILE = 'agent-qa.config.yaml'

/** The two apply doors, by the names the shipped catalogue gives them. */
const CONFIG_DOOR = 'agent_qa_apply_config_proposal'
const KNOWLEDGE_DOOR = 'agent_qa_apply_proposal'

/** The house-style config, valid against the real schema — an invalid one files a BLOCKED record. */
const SEEDED_CONFIG = `# agent-qa Configuration

workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra
  targets:
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html

use:
  llm: judge
  timeout:
    step: 30s
    test: 90m
    navigation: 2m
  mobile:
    appState: reset
  parallel: false
`

let root: string
let configPath: string
let agentQaRoot: string
let knowledgeRoot: string
let host: ReturnType<typeof composeCliLocalAgent> | undefined
let masking: ReturnType<typeof composeMcpMasking> | undefined

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    // 395-24 · WR-12 — a `git` that ran and failed must not return quietly.
    throw new Error(`git ${args.join(' ')} exited ${String(result.status)}: ${result.stderr}`)
  }
  return result.stdout
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').trim())
}

/** The working tree's own answer about whether anything is uncommitted. */
function porcelain(): string {
  return git('status', '--porcelain').trim()
}

/** One committed standing approval through the REAL mint (produced-not-literal, 391's own law). */
async function mintGrant(actionClass: string): Promise<void> {
  const verbs = createGrantOperations({
    resolveKnowledgeRoot: () => knowledgeRoot,
    auditBaseDir: agentQaRoot,
    now: () => '2026-08-16T09:00:00.000Z',
  })
  const outcome = await verbs.record({ actionClass, scope: STANDING_APPROVAL_SCOPE })
  if (outcome.kind !== 'recorded') throw new Error(`fixture mint failed: ${outcome.kind}`)
}

/** One recorded exchange: the bytes a caller's transport actually received. */
interface Frame {
  readonly status: number
  readonly text: string
}

interface Session {
  readonly client: Client
  readonly frames: Frame[]
  close(): Promise<void>
}

/** Which protocol era, and whether the client tells the server it can answer an input request. */
interface Era {
  readonly wire: 'legacy' | 'modern'
  readonly elicitation: boolean
}

const LEGACY: Era = { wire: 'legacy', elicitation: false }
const MODERN_PLAIN: Era = { wire: 'modern', elicitation: false }
const MODERN_CAPABLE: Era = { wire: 'modern', elicitation: true }

/**
 * The id the capable-client cell answers its form with.
 *
 * A module-level handle rather than a closure argument because the elicitation handler is registered
 * at connect time and the proposal does not exist until later in the same cell. It is the CLIENT's
 * memory of what it is confirming, which is what a real host's UI would hold.
 */
let lastElicitedProposalId: string | undefined

/**
 * Connect a REAL MCP client to a server built by the SHIPPED factory over the SHIPPED composition.
 *
 * The only thing replaced is the socket — `handler.fetch` is the SDK's own documented in-process
 * driver, and the loopback face has its own cells in `mcp-visibility-differential.test.ts`. The
 * caller's scope set comes from `resolveStdioScopes(true)`, which is D-07's config opt-in: the
 * shipped route by which an MCP caller comes to hold `config-write`, rather than a scope array typed
 * here.
 *
 * `era` is explicit on every connection because the SDK client defaults to the 2025 handshake, and
 * the three combinations answer D-11's refusal in three different ways (group 6).
 */
async function connect(era: Era = LEGACY): Promise<Session> {
  const frames: Frame[] = []
  const handler = createMcpHandler(() =>
    buildAgentQaMcpServer({
      registry: host!.registry,
      caller: mcpFunctionCaller(resolveStdioScopes(true)),
      maskText: (text: string) => masking!.mask(text),
    }),
  )
  const recordingFetch = (async (url: URL | string, init?: RequestInit) => {
    const res = await handler.fetch(new Request(url as string, init))
    frames.push({ status: res.status, text: await res.clone().text() })
    return res
  }) as typeof fetch

  const client = new Client({ name: 'agent-qa-396-06-apply', version: '0.0.0' }, {
    ...(era.wire === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
    ...(era.elicitation ? { capabilities: { elicitation: {} } } : {}),
  } as never)

  if (era.elicitation) {
    // The client half of SEP-2322's multi-round-trip: the SDK re-issues the call carrying this
    // answer, so this handler is what turns the server's form into an applied proposal.
    client.setRequestHandler(
      'elicitation/create' as never,
      (() => ({
        action: 'accept',
        content: { proposal_id: lastElicitedProposalId ?? '' },
      })) as never,
    )
  }

  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://apply.local/mcp'), { fetch: recordingFetch }),
  )
  return {
    client,
    frames,
    close: async () => {
      await client.close().catch(() => {})
      await handler.close().catch(() => {})
    },
  }
}

/** The last recorded response body — the serialization the caller read. */
function lastFrame(session: Session): string {
  return session.frames[session.frames.length - 1]!.text
}

/** Every byte this session received, in order — used where a cell is about an earlier round trip. */
function allFrames(session: Session): string {
  return session.frames.map((frame) => frame.text).join('\n')
}

interface ToolResult {
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
  readonly resultType?: string
  readonly inputRequests?: Record<string, unknown>
}

async function call(
  session: Session,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await session.client.callTool({ name, arguments: args })) as ToolResult
}

/** The text a caller reads, joined — the content channel of a tool result. */
function rendered(result: ToolResult): string {
  return (result.content ?? []).map((block) => block.text ?? '').join('\n')
}

/** File a config proposal through the SHIPPED propose tool and answer its id. */
async function proposeConfigChange(session: Session, value = '45s'): Promise<string> {
  const result = await call(session, 'agent_qa_propose_config_change', {
    action: 'config.field.set',
    path: 'use.timeout.step',
    value,
  })
  const structured = result.structuredContent as { outcome?: string; proposalId?: string }
  expect(structured.outcome, rendered(result)).toBe('proposed')
  return structured.proposalId!
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-qa-396-06-apply-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  knowledgeRoot = join(root, 'agent-qa-knowledge')
  mkdirSync(agentQaRoot, { recursive: true })
  mkdirSync(knowledgeRoot, { recursive: true })
  writeFileSync(configPath, SEEDED_CONFIG)
  lastElicitedProposalId = undefined

  git('init', '--quiet')
  // A fresh temp repository has no identity and `git commit` refuses without one; signing is off so
  // a developer machine configured to sign every commit does not make this suite depend on a key.
  git('config', 'user.name', 'agent-qa 396-06 apply differential')
  git('config', 'user.email', 'apply-differential@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), '.agent-qa/\nagent-qa-knowledge/\n')
  git('add', '--', '.gitignore', CONFIG_FILE)
  git('commit', '--quiet', '-m', 'seed')

  // D-02's read side, and the reason a commit below means what it says: `config.proposal.apply` is
  // `mutating-shared`, the MCP host binds NO confirm port (D-09), and this process is headless — so
  // a standing approval is the ONLY rung of the ladder that can allow. A cell that commits below
  // committed on this grant and on nothing else.
  await mintGrant(CONFIG_APPLY_CLASS)

  host = composeCliLocalAgent({ agentQaRoot, configPath, confirm: undefined })
  // THE PRODUCTION MASKER, composed by the function the `mcp` command itself calls. Empty seeds
  // because this file's subject is the write path; the credential surface has its own suite.
  masking = composeMcpMasking({ tokens: [], env: {} })
})

afterEach(async () => {
  await host?.close().catch(() => {})
  masking?.dispose()
  host = undefined
  masking = undefined
  rmSync(root, { recursive: true, force: true })
})

/** Everything runs headless, which is the arrangement the grant above is the only way out of. */
function headless<T>(fn: () => Promise<T>): Promise<T> {
  return runSafetyScope({ executionContext: 'local-headless' }, fn)
}

/** Run a cell against one open session, closing it however the cell ends. */
async function driven(era: Era, cell: (session: Session) => Promise<void>): Promise<void> {
  await headless(async () => {
    const session = await connect(era)
    try {
      await cell(session)
    } finally {
      await session.close()
    }
  })
}

describe('1 · proposing commits nothing', () => {
  it('files a pending proposal and leaves the repository exactly where it was', async () => {
    await driven(LEGACY, async (session) => {
      const before = commitCount()
      const proposalId = await proposeConfigChange(session)

      // The one-write-path law as an observation rather than a rule: the propose tool is a
      // `workflow` entry, and workflow entries commit nothing, ever.
      expect(commitCount(), 'proposing must not commit').toBe(before)
      expect(porcelain(), 'proposing must not dirty the working tree').toBe('')

      // The proposal really is addressable through the SAME wire — read back through the shipped
      // read tool rather than off disk, because a caller has no disk.
      const shown = await call(session, 'agent_qa_show_proposal', { proposalId })
      expect((shown.structuredContent as { kind?: string }).kind, rendered(shown)).toBe('found')
      expect(lastFrame(session)).toContain(proposalId)
    })
  })
})

describe('2 · the FIRST apply refuses and teaches, and the repository does not move', () => {
  it('answers a non-error refusal carrying the summary and the exact re-call, and commits nothing',
    async () => {
      await driven(LEGACY, async (session) => {
        const proposalId = await proposeConfigChange(session)
        const before = commitCount()

        const refusal = await call(session, CONFIG_DOOR, { proposal_id: proposalId })

        // THE NUMBER, first. Everything else in this cell is about what the caller was told; this
        // line is about what happened to their repository.
        expect(commitCount(), 'an unconfirmed apply committed').toBe(before)
        expect(porcelain()).toBe('')

        // NOT an error. Refusing to commit unasked is this tool working, and an error result would
        // teach a host to surface it as a fault and an agent to retry it as one.
        expect(refusal.isError ?? false, rendered(refusal)).toBe(false)

        // Asserted on the RECORDED WIRE BYTES, not on the parsed object: the teach is only a teach
        // if it survived serialization to the caller.
        const wire = lastFrame(session)
        expect(wire).toContain(proposalId)
        expect(wire).toContain('confirmed')
        expect(wire).toContain('Nothing has been changed by this call.')

        // The summary a human authorises against describes THIS proposal, read through the same
        // wall every other tool crosses.
        expect(rendered(refusal)).toContain('a config proposal, status pending')

        // THE MACHINE HALF. A model caller reads `structuredContent`, not prose, and the refusal
        // arrives there as data on the arm the tool advertises for it — including `applied: false`,
        // which is the one field a reader that mishandles the union still gets right.
        const structured = refusal.structuredContent as Record<string, unknown>
        expect(structured['status']).toBe('confirmation-required')
        expect(structured['applied']).toBe(false)
        expect(structured['proposal_id']).toBe(proposalId)
        expect(String(structured['instruction'])).toContain('confirmed: true')
      })
    })

  it('advertises both arms of that answer in tools/list, so a caller can see the union', async () => {
    await driven(LEGACY, async (session) => {
      const listed = await session.client.listTools()
      const door = listed.tools.find((tool) => tool.name === CONFIG_DOOR)
      expect(door, listed.tools.map((tool) => tool.name).join(', ')).toBeDefined()

      // Two arms and no more: the op's own outcome, and D-11's refusal. A door advertising only
      // the receipt is a door whose refusal a strict caller must treat as a contract violation —
      // and the SDK agrees, which is why it refuses to serve one.
      const output = door!.outputSchema as { anyOf?: readonly Record<string, unknown>[] }
      expect(output.anyOf).toHaveLength(2)
      const arms = output.anyOf!
      const refusalArm = arms.find(
        (arm) => (arm.properties as Record<string, unknown> | undefined)?.['status'] !== undefined,
      )
      expect(refusalArm, JSON.stringify(arms).slice(0, 400)).toBeDefined()
      expect(Object.keys(refusalArm!.properties as Record<string, unknown>).sort()).toEqual([
        'applied',
        'instruction',
        'proposal_id',
        'status',
        'summary',
      ])
    })
  })
})

describe('3 · the confirmed apply commits EXACTLY once, with the receipts on the wire', () => {
  it('makes one commit and answers the applied receipt as structured content', async () => {
    await driven(LEGACY, async (session) => {
      const proposalId = await proposeConfigChange(session)
      await call(session, CONFIG_DOOR, { proposal_id: proposalId })
      const before = commitCount()

      const applied = await call(session, CONFIG_DOOR, { proposal_id: proposalId, confirmed: true })

      expect(applied.isError ?? false, rendered(applied)).toBe(false)
      expect(commitCount(), 'a confirmed apply must make exactly one commit').toBe(before + 1)
      expect(porcelain(), 'the apply must leave nothing uncommitted').toBe('')

      // T-396-20: the receipts travel untouched in `structuredContent`, which is the machine half of
      // the answer — a caller that only read the prose could not tell which commit was made.
      const receipt = applied.structuredContent as {
        outcome?: string
        commits?: readonly { role?: string; hash?: string }[]
        files?: readonly string[]
      }
      expect(receipt.outcome).toBe('applied')
      expect(receipt.files).toEqual([CONFIG_FILE])
      expect(receipt.commits).toHaveLength(1)

      // The hash the wire carried is a commit that really is in the person's history, and it is the
      // one at the tip. Read from git, not from the receipt that claimed it.
      const claimed = receipt.commits![0]!.hash!
      expect(git('rev-parse', 'HEAD').trim().startsWith(claimed)).toBe(true)
      expect(lastFrame(session)).toContain(claimed)

      // And the bytes really changed — an apply that committed an empty tree would satisfy every
      // line above.
      expect(git('show', '--stat', '--name-only', '--format=', 'HEAD').trim()).toBe(CONFIG_FILE)
      expect(git('show', `HEAD:${CONFIG_FILE}`)).toContain('step: 45s')
    })
  })
})

describe('4 · doctored one-shots commit nothing', () => {
  it('(4a) refuses the STRING "true" at the schema wall, before the handler runs', async () => {
    await driven(LEGACY, async (session) => {
      const proposalId = await proposeConfigChange(session)
      const before = commitCount()

      const doctored = await call(session, CONFIG_DOOR, {
        proposal_id: proposalId,
        confirmed: 'true',
      })

      // THE FIRST of the two walls under `confirmed`, and the one the hermetic suite could not
      // reach: the SDK validates the call against the advertised `inputSchema` BEFORE the handler
      // runs, so a string never meets the handler's strict `=== true` at all.
      expect(doctored.isError, rendered(doctored)).toBe(true)
      expect(commitCount(), 'a string confirmation committed').toBe(before)
      expect(porcelain()).toBe('')

      // The handler never ran, evidenced without a spy: a handler that HAD run would have read the
      // proposal and answered the teach, and neither the summary nor the re-call instruction is
      // anywhere in the bytes the caller received.
      const wire = lastFrame(session)
      expect(wire).not.toContain('Nothing has been changed by this call.')
      expect(wire).not.toContain('a config proposal, status pending')
    })
  })

  it('(4b) refuses confirmed: false and teaches instead', async () => {
    await driven(LEGACY, async (session) => {
      const proposalId = await proposeConfigChange(session)
      const before = commitCount()

      const refused = await call(session, CONFIG_DOOR, {
        proposal_id: proposalId,
        confirmed: false,
      })

      expect(refused.isError ?? false, rendered(refused)).toBe(false)
      expect(commitCount(), 'confirmed: false committed').toBe(before)
      expect(rendered(refused)).toContain('Nothing has been changed by this call.')
    })
  })

  it('(4c) a confirmed apply of an id that names no proposal commits nothing, and says so',
    async () => {
      await driven(LEGACY, async (session) => {
        const before = commitCount()
        const answer = await call(session, CONFIG_DOOR, {
          proposal_id: 'prop_00000000-0000-4000-8000-000000000000',
          confirmed: true,
        })

        expect(commitCount(), 'a confirmed apply of a nonexistent proposal committed').toBe(before)
        expect(porcelain()).toBe('')
        // A refusal a caller can read, on the wire, rather than a transport failure.
        expect(rendered(answer).length).toBeGreaterThan(0)
      })
    })
})

describe('5 · a replayed confirmation answers as DATA and commits nothing further', () => {
  it('answers the already-applied outcome with the ORIGINAL receipt and an unchanged count',
    async () => {
      await driven(LEGACY, async (session) => {
        const proposalId = await proposeConfigChange(session)
        const first = await call(session, CONFIG_DOOR, {
          proposal_id: proposalId,
          confirmed: true,
        })
        const afterFirst = commitCount()
        const firstHash = (first.structuredContent as {
          commits?: readonly { hash?: string }[]
        }).commits![0]!.hash

        const replay = await call(session, CONFIG_DOOR, { proposal_id: proposalId, confirmed: true })

        // DATA, NOT AN ERROR. A retrying surface — a dropped socket, a re-issued MCP call, an agent
        // that lost its transcript — must be able to learn that its apply already happened AND what
        // it did. `isError` would say the first half while discarding the receipt.
        expect(replay.isError ?? false, rendered(replay)).toBe(false)
        const receipt = replay.structuredContent as {
          outcome?: string
          commits?: readonly { hash?: string }[]
        }
        expect(receipt.outcome).toBe('already-applied')
        expect(receipt.commits![0]!.hash).toBe(firstHash)

        expect(commitCount(), 'a replayed confirmation committed a second time').toBe(afterFirst)
        expect(porcelain()).toBe('')
      })
    })
})

describe('6 · both eras at the wire, and the capability that decides the shape', () => {
  // THE THREE-WAY MEASUREMENT. `inputRequired` is not a payload the server composes and an
  // uninterested client ignores: the SDK REFUSES to serve it to a connection that cannot answer it,
  // and until this suite measured that, D-11's door answered an SDK capability error — no summary,
  // no re-call — to every caller that did not declare `elicitation`, which is nearly all of them.
  //
  // The three cells are one law seen from three sides: the teach is always available, and the form
  // is added exactly where it can be used.

  it('(6a) a 2025-era caller receives the deterministic instruction as an ordinary result',
    async () => {
      await driven(LEGACY, async (session) => {
        const proposalId = await proposeConfigChange(session)
        const before = commitCount()

        const refusal = await call(session, CONFIG_DOOR, { proposal_id: proposalId })

        expect(refusal.isError ?? false, rendered(refusal)).toBe(false)
        // The 2025 codec has no place to put an input request, so the payload must carry none —
        // asserted on the wire, because the wire is where the SDK would have replaced it.
        expect(refusal.resultType).toBeUndefined()
        expect(lastFrame(session)).not.toContain('Cannot request input')
        expect(rendered(refusal)).toContain('confirmed: true')
        expect(commitCount()).toBe(before)
      })
    })

  it('(6b) a 2026-07-28 caller that declares no elicitation capability gets the same teach, not a '
    + 'protocol error', async () => {
    await driven(MODERN_PLAIN, async (session) => {
      const proposalId = await proposeConfigChange(session)
      const before = commitCount()

      // Before the fix this line THREW `ProtocolError … -32021` (HTTP 400, RESEARCH Pitfall 11) and
      // the caller received nothing readable at all.
      const refusal = await call(session, CONFIG_DOOR, { proposal_id: proposalId })

      expect(refusal.isError ?? false, rendered(refusal)).toBe(false)
      expect(refusal.resultType).toBeUndefined()
      expect(rendered(refusal)).toContain('confirmed: true')
      expect(lastFrame(session)).not.toContain('-32021')
      expect(commitCount()).toBe(before)
    })
  })

  it('(6c) a 2026-07-28 caller that DOES declare elicitation is served the form, and answering it '
    + 'applies', async () => {
    await driven(MODERN_CAPABLE, async (session) => {
      const proposalId = await proposeConfigChange(session)
      lastElicitedProposalId = proposalId
      const before = commitCount()

      // The SDK drives SEP-2322's round trip: the server returns `input_required`, this client's
      // elicitation handler answers with the proposal id, the SDK re-issues the same call carrying
      // `inputResponses`, and the handler's SECONDARY route applies. One `callTool` from here.
      const applied = await call(session, CONFIG_DOOR, { proposal_id: proposalId })

      expect(applied.isError ?? false, rendered(applied)).toBe(false)
      expect((applied.structuredContent as { outcome?: string }).outcome).toBe('applied')
      expect(commitCount(), 'the answered form must commit exactly once').toBe(before + 1)

      // The form really was served on this connection, and it asked for exactly one field — a form
      // that also asked for a password would satisfy a containment check on `proposal_id` alone.
      const served = allFrames(session)
      expect(served).toContain('input_required')
      expect(served).toContain('proposal_id')
      expect(served).not.toContain('"reason"')
    })
  })
})

describe('7 · the SECOND door, and the family split', () => {
  it('(7a) the knowledge door refuses first, teaches, and commits nothing', async () => {
    await driven(LEGACY, async (session) => {
      const proposalId = await proposeConfigChange(session)
      const before = commitCount()

      const refusal = await call(session, KNOWLEDGE_DOOR, { proposal_id: proposalId })

      expect(refusal.isError ?? false, rendered(refusal)).toBe(false)
      expect(rendered(refusal)).toContain('Nothing has been changed by this call.')
      expect(commitCount()).toBe(before)
    })
  })

  // (7b) AND (7c) ARE ONE DIFFERENTIAL, and the pair is what makes it a measurement rather than a
  // naming convention. Same proposal, same grants, same era, same confirmation — the ONLY thing
  // that differs between them is which door the call went through. One commits and one cannot,
  // which is exactly the claim "each tool binds one applyOpId at registration" makes.
  //
  // The knowledge apply class is granted in BOTH, so the policy gate is not what refuses in (7b):
  // without that grant the refusal reads `denied knowledge.proposal.apply: fail-closed …`, which
  // would have been a cell about the safety ladder wearing this cell's name. With it, the call
  // reaches `knowledge.proposal.apply` itself and is refused there — by the KIND of the proposal.

  it('(7b) the knowledge door CONFIRMED on a config proposal reaches the KNOWLEDGE op and commits '
    + 'nothing', async () => {
    await mintGrant('fn:knowledge.proposal.apply')
    await driven(LEGACY, async (session) => {
      const proposalId = await proposeConfigChange(session)
      const before = commitCount()

      const answer = await call(session, KNOWLEDGE_DOOR, {
        proposal_id: proposalId,
        confirmed: true,
      })

      // THE NUMBER is the claim: a door bound to `knowledge.proposal.apply` cannot commit a config
      // proposal, whatever it is asked. A single fold over both ops would have.
      expect(commitCount(), 'the knowledge door committed a config proposal').toBe(before)
      expect(porcelain()).toBe('')

      // And the refusal came from the op this door binds — which is the half that says WHICH op was
      // reached rather than only that nothing happened.
      expect(rendered(answer).toLowerCase()).toContain('knowledge')
    })
  })

  it('(7c) CONTROL: the same proposal, the same grants, through the CONFIG door — commits once',
    async () => {
      await mintGrant('fn:knowledge.proposal.apply')
      await driven(LEGACY, async (session) => {
        const proposalId = await proposeConfigChange(session)
        const before = commitCount()

        const applied = await call(session, CONFIG_DOOR, {
          proposal_id: proposalId,
          confirmed: true,
        })

        expect((applied.structuredContent as { outcome?: string }).outcome, rendered(applied))
          .toBe('applied')
        expect(commitCount(), 'the control must commit, or (7b) proves nothing').toBe(before + 1)
      })
    })
})
