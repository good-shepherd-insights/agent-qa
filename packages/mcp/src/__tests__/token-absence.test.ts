// THE STANDING TOKEN-ABSENCE SCAN — every model-readable channel of a full MCP flow
// (Phase 408 plan 04 · MCPA-01 · D-01 / D-14 · T-408-17).
//
// WHY THIS FILE EXISTS. D-01 splits the phase's credential by CHANNEL: a minted `liveUrl` token
// reaches a person only inside the HTML a host paints in its sandbox, and never inside anything a
// MODEL reads — not tool-result text, not `structuredContent`, not a listing, not a refusal echo,
// not a log line. That split is the whole security argument for minting over MCP at all, and it is
// worth exactly as much as the cell that reds when somebody leaks. This is that cell. It is
// RECORDED LAW rather than one-off proof (D-14): it drives the full flow, collects every byte
// stream a model can read, and asserts that no byte of any token the flow REALLY minted appears in
// any of them.
//
// THE SCAR IT GENERALISES. `masked-serialization.test.ts` is the T-395-R5-10 corpus: a declared
// credential reaching `content[].text` and `structuredContent` because the masker never saw the
// escaped spelling. Same shape, different credential — and a harder one, because a minted token is
// NOT registered with the masker at the moment the App renders it (it is offered to the host's
// masking store through `onMinted`, which is a best-effort second line, never the guard). So for
// this credential the only real defence is that no model-readable code path ever touches it. That
// is a claim about REACHABILITY, which is why the corpus below is the whole flow rather than one
// serializer.
//
// ==================================================================================================
// THE CORPUS DEFINITION — what is scanned, and the ONE thing that is excluded, BY RULING
// ==================================================================================================
//
// SCANNED (every channel a model reads):
//   1. the `tools/list` document
//   2. every carrier `tools/call` result — `content[].text`, `structuredContent`, and `_meta`
//   3. a NON-carrier `tools/call` result, on the same three members
//   4. `resources/list` and `resources/templates/list`
//   5. an entity `resources/read` payload (`agentqa://memory/MEM-001`)
//   6. the `ui://` read's response ENVELOPE — its `uri`, `mimeType` and `_meta` (see below)
//   7. every refusal: a malformed `ui://` address, and a non-negotiated read on a second client
//   8. everything the process wrote to `console.*` for the duration of the flow
//
// EXCLUDED — exactly ONE channel, and by the DATED RULING rather than by omission (Pitfall 2):
//   the `text` of the `ui://` read, i.e. the wrapper HTML document itself. That channel is the
//   credential's DESTINATION, not a leak: it is the host-rendered payload clause 1 of the four-clause
//   `ui://` read-channel adjudication in `../app-resource.ts` (adjudicated 2026-08-31, plan 02;
//   see that file's header, "THE `ui://` READ CHANNEL — the full ruling") reserves for the token.
//   The other three clauses are what make the exclusion narrow enough to be honest: the template is
//   UNLISTED so no enumeration reaches it (clause 2), a NON-NEGOTIATED read is refused before
//   anything is minted (clause 3), and the credential is view-scoped with a five-minute TTL
//   (clause 4). The exclusion is the wrapper HTML STRING and nothing else — the response's `uri`,
//   `mimeType` and `_meta` are scanned like any other channel, because a token has no business
//   there either.
//
//   AND THE EXCLUSION IS CONTROLLED. `(A0)` requires the wrapper HTML to CONTAIN every captured
//   token. If it did not, this file would be green because nothing was minted, which is the one
//   way a scan of this shape lies.
//
// THE GROUND TRUTH IS WHAT THE FLOW MINTED, NOT A PLANT. Tokens are captured at `LiveViewPort`'s
// `onMinted` hook — the single registration point `runs.liveurl` calls for every token it ever
// produces (`ops/runs-live-url.ts`). A planted lookalike would prove the scanner works; capturing
// the real mints proves the FLOW is clean. Every needle is therefore a string that really crossed
// the invocation wall in this test.
//
// THE MUTATION CONTROL (D-14, `(A9)` below, in this same file so both passes drive ONE
// `scanCorpus`). The leak is injected through the SHIPPED decoration path rather than by editing a
// captured string: the fixture's `liveLink.dashboardBaseUrl()` supplier — the one member
// `decorateCarrierResult` reads to compose D-08's line — answers a base carrying a REAL minted
// token. Production code then composes, masks and appends that line to the carrier's text channel
// and its `_meta.ui.resourceUri`, exactly as it would if a future change threaded a credential into
// a base. That is a defect this file must see, and `(A9)` asserts it DOES: the same `scanCorpus`
// that answers no findings in `(A1)` answers findings on a carrier text channel here.
//
// THE MINT HAPPENS FIRST IN THE FLOW, ON PURPOSE. The `ui://` read runs before the carrier calls,
// so every channel captured afterwards is captured in a world where live tokens for this run
// already exist. An absence asserted before anything was minted is an absence of nothing.
//
// THE MUTATION LEGS, APPLIED AND THEIR REDS OBSERVED (2026-08-31). A leg nobody ran is a leg
// nobody knows the strength of, so each was applied to its subject, the red read off the runner,
// and the subject restored:
//   L1  PRODUCTION LEAK. `app-resource.ts`'s served envelope gained a plausible debug member —
//       `_meta.ui.debugLiveUrl = mints[0].liveUrl` — beside the `csp` block. `(A1)` red naming
//       `ui://read:envelope` three times: once for the whole token, once for its body segment and
//       once for its signature, which is also the measurement proving `needlesOf`'s segments are
//       load-bearing rather than decorative.
//   L2  BLIND SCANNER. `scanCorpus` returned `[]` unconditionally. `(A0)` AND `(A9)` red — the two
//       cells whose whole job is to notice a scanner that cannot see. `(A1)` stayed green, which
//       is exactly why it may never be the only cell in this file.
//   L3  EXCLUSION DROPPED. The `ui://` read's wrapper HTML was folded into the corpus instead of
//       being excluded by the ruling. `(A1)` red on six channels. The exclusion is therefore
//       load-bearing rather than cosmetic, and this is the leg that says what it costs: remove the
//       ruling and the law contradicts the design it exists to protect.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server as NodeHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  createFunctionRegistry,
  type CreateFunctionRegistryOptions,
  type FunctionDeps,
  type FunctionRegistry,
  type LiveViewPort,
} from '@vostride/agent-qa-agent'
import { asRunId } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  FunctionScope,
  LiveUrlSigner,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { MCP_APPS_EXTENSION_ID, appResourceUriFor } from '../app-resource.js'
import { createAgentQaMcpNodeHandler } from '../http.js'

// ---- The scanner: one pure helper, driven by BOTH passes ---------------------------------------

/** One model-readable byte stream, named by the channel it was read off. */
interface CorpusChannel {
  readonly channel: string
  readonly text: string
}

/** One occurrence of minted bytes where none may appear. */
interface Leak {
  readonly channel: string
  readonly needle: string
  readonly excerpt: string
}

/**
 * The strings whose appearance anywhere in the corpus is a disclosure of `token`.
 *
 * NOT JUST THE WHOLE TOKEN. A minted `liveUrl` token is `v1.<body>.<signature>`, and a channel
 * carrying only the signature has disclosed the part an attacker cannot compute — so a cell that
 * asked only for the whole string would be satisfied by a leak that dropped the version prefix.
 * Each dot-separated segment of eight characters or more is therefore its own needle, on the
 * windowing rule `masked-serialization.test.ts` established for the same reason: absence has to be
 * asserted at a width narrower than the value, or the assertion sets a disclosure budget nobody
 * agreed to. The `v1` prefix is below the width and is deliberately not a needle — it is a public
 * format marker that occurs in this file's own prose.
 */
function needlesOf(token: string): readonly string[] {
  const segments = token.split('.').filter((segment) => segment.length >= 8)
  return [token, ...segments]
}

/**
 * Every occurrence of every token's needles across the corpus.
 *
 * TOTAL AND UNDECORATED: it answers what it found and never throws, so the SAME function can be
 * asked to find nothing (the standing law) and to find something (the mutation control). A scanner
 * that asserted internally could only ever be used one way round, and a control that drove a
 * second implementation would be measuring the control.
 */
function scanCorpus(
  corpus: readonly CorpusChannel[],
  tokens: readonly string[],
): readonly Leak[] {
  const leaks: Leak[] = []
  for (const token of tokens) {
    for (const needle of needlesOf(token)) {
      for (const entry of corpus) {
        const at = entry.text.indexOf(needle)
        if (at === -1) continue
        leaks.push({
          channel: entry.channel,
          needle,
          excerpt: entry.text.slice(Math.max(0, at - 40), at + needle.length + 40),
        })
      }
    }
  }
  return leaks
}

// ---- The fixture composition -------------------------------------------------------------------

const FIXTURE_RUN_ID = 'run-408-04-token-absence'
const FIXTURE_ORIGIN = 'http://127.0.0.1:7791'
const SIGNING_KEY = 'zz-408-04-token-absence-signing-key'
const DASHBOARD_BASE = 'http://localhost:4104'
const ENTITY_URI = 'agentqa://memory/MEM-001'
const HANDLES: readonly number[] = [0, 1]

function fixtureSigner(): LiveUrlSigner {
  return {
    sign: (data) => createHmac('sha256', SIGNING_KEY).update(data).digest('base64url'),
    equals: (a, b) => {
      const left = Buffer.from(a)
      const right = Buffer.from(b)
      return left.length === right.length && timingSafeEqual(left, right)
    },
  }
}

const runStartedEnvelope = (handles: readonly number[]): RunEventEnvelope => ({
  seq: 1,
  ts: 1_800_000_000_000,
  runId: FIXTURE_RUN_ID,
  type: 'runStarted',
  payload: {
    busSchemaVersion: 1,
    scope: { tier: 'test', key: 'TST-408-04' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    memberTestCount: handles.length,
    handles: [...handles],
  },
})

function handoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: 5,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'token-absence' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 't_token_absence',
        testName: 'a member this fixture recorded',
        filePath: 'tests/token-absence.yaml',
        testIndex: 0,
        outcome: 'passed',
        steps: [],
      },
    ],
  }
}

/**
 * The smallest registry in which the WHOLE flow answers: both carriers, the entity read, and a
 * `ui://` read that really mints.
 *
 * `liveView` is a real port with a real HMAC signer, and `onMinted` is the capture — the ground
 * truth every needle below is derived from.
 */
function fixtureRegistry(): { readonly registry: FunctionRegistry; readonly minted: string[] } {
  const minted: string[] = []
  let clock = 1_800_000_000_000

  const liveView: LiveViewPort = {
    signer: fixtureSigner(),
    origin: () => FIXTURE_ORIGIN,
    now: () => (clock += 1),
    capabilityOf: (runId, handle) =>
      runId === FIXTURE_RUN_ID && HANDLES.includes(handle) ? { kind: 'cdp-screencast' } : undefined,
    onMinted: (token) => {
      minted.push(token)
    },
  }

  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']

  const deps = {
    runs: {
      list: () => Promise.resolve([handoff(FIXTURE_RUN_ID)]),
      get: (runId: string) =>
        Promise.resolve(String(runId) === FIXTURE_RUN_ID ? handoff(FIXTURE_RUN_ID) : undefined),
      readEvents: (runId: string, fromSeq: number) =>
        Promise.resolve(
          runId === FIXTURE_RUN_ID && fromSeq <= 1 ? [runStartedEnvelope(HANDLES)] : [],
        ),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    runInvocation: { start: () => Promise.resolve({ runId: asRunId(FIXTURE_RUN_ID) }) },
    proposalsInbox: { list: () => Promise.resolve([]) },
    entities: {
      get: (ref: string) =>
        Promise.resolve(
          ref === ENTITY_URI || ref === 'MEM-001'
            ? {
                kind: 'MEM' as const,
                shortId: 'MEM-001',
                uri: ENTITY_URI,
                machineId: 'mem-001-token-absence',
                title: 'a memory this fixture recorded',
                statusSource: 'active',
              }
            : undefined,
        ),
    },
    // `{ entries: [] }` and not `{}`: `readEntityCardContext` reads the masked config through
    // `masked.entries.find(...)`, so an empty object makes the entity read refuse rather than
    // answer — and a corpus whose entity channel is a stack trace is not the entity channel.
    config: { getMasked: () => Promise.resolve({ entries: [] }) },
    liveView,
  } as unknown as FunctionDeps

  return { registry: createFunctionRegistry({ deps, auditSink }), minted }
}

const CALLER_SCOPES: readonly FunctionScope[] = ['read', 'run']

const caller: FunctionCaller = {
  surface: 'mcp',
  grantedScopes: CALLER_SCOPES,
  safeMode: false,
  origin: 'agent',
}

const identity = (text: string): string => text

// ---- The wire ----------------------------------------------------------------------------------

const openServers: NodeHttpServer[] = []
const openClients: Client[] = []

afterEach(async () => {
  for (const client of openClients.splice(0)) await client.close().catch(() => {})
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

/**
 * A REAL loopback socket, for plan 02's measured reason rather than for realism's sake: the
 * per-request client-capabilities envelope the negotiation gate reads is lifted by the transport
 * and exists only on the modern (2026-07-28) wire era, so a flow driven through the SDK's
 * in-process driver could never obtain the App at all — and a scan that never minted is the one
 * failure mode this file's `(A0)` control exists to make impossible.
 */
async function serve(listener: (req: never, res: never) => void): Promise<string> {
  const server = createServer(listener as never)
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
}

/** The shipped client, negotiating the Apps extension or deliberately not (plan 02's shape). */
async function connect(url: string, options: { readonly apps: boolean }): Promise<Client> {
  const client = new Client(
    { name: 'agent-qa-408-04-token-absence', version: '0.0.0' },
    {
      capabilities: options.apps ? { extensions: { [MCP_APPS_EXTENSION_ID]: {} } } : {},
      versionNegotiation: { mode: 'auto' as const },
    },
  )
  openClients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

// ---- Capturing the channels --------------------------------------------------------------------

interface ToolCallResult {
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly structuredContent?: unknown
  readonly isError?: boolean
  readonly _meta?: unknown
}

/** The three members of a tool result a MODEL reads, each as its own named channel. */
function toolChannels(label: string, result: ToolCallResult): readonly CorpusChannel[] {
  return [
    {
      channel: `${label}:content[].text`,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    },
    {
      channel: `${label}:structuredContent`,
      text: JSON.stringify(result.structuredContent ?? null),
    },
    { channel: `${label}:_meta`, text: JSON.stringify(result._meta ?? null) },
  ]
}

/** A refusal, serialized the way plan 02's leak cell serializes one — message, name and stack. */
function refusalChannel(label: string, error: unknown): CorpusChannel {
  return {
    channel: label,
    text:
      error === undefined
        ? ''
        : JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
  }
}

/**
 * Route `console.*` into an in-test sink for the duration of the flow.
 *
 * A LOG LINE IS A MODEL-READABLE CHANNEL in every host that pipes its server's stderr back into a
 * transcript, and D-14 names logs explicitly. Patching the console object rather than spying keeps
 * the capture total: anything the flow prints, however deep, lands in the corpus.
 */
function captureConsole(): { readonly lines: string[]; readonly restore: () => void } {
  const lines: string[] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
  const originals = new Map<string, unknown>()
  for (const method of methods) {
    originals.set(method, console[method])
    console[method] = ((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    }) as typeof console.log
  }
  return {
    lines,
    restore: () => {
      for (const method of methods) {
        console[method] = originals.get(method) as typeof console.log
      }
    },
  }
}

interface FlowResult {
  /** Every model-readable byte stream this flow produced. */
  readonly corpus: readonly CorpusChannel[]
  /** Every token the flow REALLY minted, captured at `onMinted`. */
  readonly tokens: readonly string[]
  /** The ONE excluded channel: the host-rendered wrapper document. */
  readonly wrapperHtml: string
}

/**
 * Drive the whole flow over the wire and collect every channel.
 *
 * `leak` is the mutation control: when set, the host's D-08 base supplier answers a base carrying a
 * real minted token, so the SHIPPED decoration composes it into the carrier's text and `_meta`.
 * Nothing about the corpus, the capture or the scanner changes between the two passes — which is
 * what makes the control a statement about the SCAN rather than about a second code path.
 */
async function driveFullFlow(options: { readonly leak?: boolean } = {}): Promise<FlowResult> {
  const { registry, minted } = fixtureRegistry()
  const handler = createAgentQaMcpNodeHandler(() => ({
    registry,
    caller,
    maskText: identity,
    liveLink: {
      dashboardBaseUrl: () =>
        options.leak === true && minted[0] !== undefined
          ? `https://leak.invalid/${minted[0]}`
          : DASHBOARD_BASE,
    },
  }))
  const url = await serve((req, res) => void handler(req as never, res as never))

  const corpus: CorpusChannel[] = []
  const console_ = captureConsole()
  let wrapperHtml = ''
  try {
    const client = await connect(url, { apps: true })

    // 1. the advertised catalogue
    corpus.push({ channel: 'tools/list', text: JSON.stringify(await client.listTools()) })

    // 2. THE MINT, FIRST. Everything captured after this line is captured in a world where live
    //    tokens for this run exist — which is what stops every absence below being vacuous.
    const app = (await client.readResource({ uri: appResourceUriFor(FIXTURE_RUN_ID) })) as {
      contents: readonly Record<string, unknown>[]
    }
    const appContent = app.contents[0] ?? {}
    wrapperHtml = String(appContent.text ?? '')
    // The ENVELOPE is scanned; only the `text` above is excluded, and only by the dated ruling.
    corpus.push({
      channel: 'ui://read:envelope (text excluded BY RULING — see header)',
      text: JSON.stringify({ ...appContent, text: undefined }),
    })

    // 3. both carriers
    const started = (await client.callTool({
      name: 'agent_qa_start_run',
      arguments: { runId: FIXTURE_RUN_ID },
    })) as unknown as ToolCallResult
    corpus.push(...toolChannels('tools/call:agent_qa_start_run', started))

    const digest = (await client.callTool({
      name: 'agent_qa_get_run_digest',
      arguments: { runId: FIXTURE_RUN_ID },
    })) as unknown as ToolCallResult
    corpus.push(...toolChannels('tools/call:agent_qa_get_run_digest', digest))

    // 4. a NON-carrier, on the same three members
    const listed = (await client.callTool({
      name: 'agent_qa_list_runs',
      arguments: {},
    })) as unknown as ToolCallResult
    corpus.push(...toolChannels('tools/call:agent_qa_list_runs', listed))

    // 5. both listings
    corpus.push({
      channel: 'resources/list',
      text: JSON.stringify(await client.listResources()),
    })
    corpus.push({
      channel: 'resources/templates/list',
      text: JSON.stringify(await client.listResourceTemplates()),
    })

    // 6. an entity resource read
    const entity = await client.readResource({ uri: ENTITY_URI }).then(
      (result) => JSON.stringify(result),
      (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
    )
    corpus.push({ channel: `resources/read:${ENTITY_URI}`, text: entity })

    // 7a. a malformed `ui://` address — the refusal that ECHOES caller text
    const malformed = await client
      .readResource({ uri: 'ui://agent-qa/live-run/..%2Fetc%2Fpasswd' })
      .then(() => undefined, (error: unknown) => error)
    corpus.push(refusalChannel('refusal:malformed-ui-uri', malformed))

    // 7b. a NON-NEGOTIATED read on a second client — plan 02's refuse-before-mint arm
    const stranger = await connect(url, { apps: false })
    const refused = await stranger
      .readResource({ uri: appResourceUriFor(FIXTURE_RUN_ID) })
      .then(() => undefined, (error: unknown) => error)
    corpus.push(refusalChannel('refusal:non-negotiated-ui-read', refused))
    // The carrier line reaches an App-less host too (D-09), so its channels are scanned as well.
    const strangerCarrier = (await stranger.callTool({
      name: 'agent_qa_get_run_digest',
      arguments: { runId: FIXTURE_RUN_ID },
    })) as unknown as ToolCallResult
    corpus.push(...toolChannels('tools/call:app-less:agent_qa_get_run_digest', strangerCarrier))
  } finally {
    console_.restore()
  }

  // 8. everything the flow printed
  corpus.push({ channel: 'console.*', text: console_.lines.join('\n') })

  return { corpus, tokens: [...minted], wrapperHtml }
}

// ---- The law ------------------------------------------------------------------------------------

describe('the minted liveUrl token reaches NO model-readable channel (408 D-01/D-14, T-408-17)', () => {
  it('(A0) CONTROL: the flow really minted, and the ONE legal channel really carries the tokens',
    async () => {
      const flow = await driveFullFlow()

      // Non-vacuity, half one: a scan of a flow that minted nothing is green for the wrong reason.
      expect(flow.tokens.length, 'the flow minted no token at all — every absence below is vacuous')
        .toBeGreaterThan(0)
      expect(flow.tokens.length, 'one mint per announced handle (D-06)').toBe(HANDLES.length)

      // Non-vacuity, half two: the excluded channel is excluded because it is the DESTINATION.
      // If the wrapper stopped carrying tokens, the exclusion would be protecting nothing and the
      // corpus below would be asserting the absence of a credential nobody serves.
      for (const token of flow.tokens) {
        expect(
          flow.wrapperHtml.includes(token),
          'the host-rendered wrapper does not carry the token it exists to deliver',
        ).toBe(true)
      }

      // And the scanner can see them: pointed AT the excluded channel it finds every one.
      const found = scanCorpus([{ channel: 'wrapper-html', text: flow.wrapperHtml }], flow.tokens)
      expect(found.length, 'the scanner is dead — it cannot find tokens that are demonstrably there')
        .toBeGreaterThanOrEqual(flow.tokens.length)
    })

  it('(A1) ZERO occurrences across the WHOLE corpus', async () => {
    const flow = await driveFullFlow()
    const leaks = scanCorpus(flow.corpus, flow.tokens)

    expect(
      leaks,
      `minted bytes reached ${leaks.length} model-readable channel(s): ${JSON.stringify(leaks, null, 2)}`,
    ).toEqual([])
  })

  it('(A2) the corpus really covers the channels this law is about', async () => {
    const flow = await driveFullFlow()
    const channels = flow.corpus.map((entry) => entry.channel)

    // Named individually rather than counted, so a channel that silently stopped being collected
    // reds HERE instead of quietly shrinking (A1)'s corpus to something that cannot fail.
    for (const required of [
      'tools/list',
      'tools/call:agent_qa_start_run:content[].text',
      'tools/call:agent_qa_start_run:structuredContent',
      'tools/call:agent_qa_start_run:_meta',
      'tools/call:agent_qa_get_run_digest:content[].text',
      'tools/call:agent_qa_get_run_digest:structuredContent',
      'tools/call:agent_qa_list_runs:structuredContent',
      'tools/call:app-less:agent_qa_get_run_digest:content[].text',
      'resources/list',
      'resources/templates/list',
      `resources/read:${ENTITY_URI}`,
      'refusal:malformed-ui-uri',
      'refusal:non-negotiated-ui-read',
      'console.*',
    ]) {
      expect(channels, `the corpus lost the ${required} channel`).toContain(required)
    }

    // Every collected channel came back with BYTES, so none of them is an absence asserted over a
    // stream nobody read. The console is the ONE honest exception and it is named rather than
    // filtered silently: this flow prints nothing at all, which is itself the fact worth pinning —
    // a server that started logging tool arguments would break this line before it broke `(A1)`.
    const empty = flow.corpus
      .filter((entry) => entry.text === '' && entry.channel !== 'console.*')
      .map((entry) => entry.channel)
    expect(empty, 'a channel came back as the empty string — it was never really read').toEqual([])
    expect(
      flow.corpus.find((entry) => entry.channel === 'console.*')?.text,
      'the flow printed something — read it, then decide whether it may say that',
    ).toBe('')
  })

  it('(A3) every collected channel really ANSWERED — no absence over a dead channel', async () => {
    const flow = await driveFullFlow()
    const at = (channel: string): string =>
      flow.corpus.find((entry) => entry.channel === channel)?.text ?? ''

    // The two refusals refused for their OWN reasons, not for a fixture accident.
    expect(at('refusal:malformed-ui-uri')).toContain('not a canonical ui://agent-qa/live-run')
    expect(at('refusal:non-negotiated-ui-read')).toContain(MCP_APPS_EXTENSION_ID)

    // The entity read served a CARD rather than a stack trace — the difference between scanning
    // the entity channel and scanning the error channel twice.
    expect(at(`resources/read:${ENTITY_URI}`)).toContain('MEM-001')
    expect(at(`resources/read:${ENTITY_URI}`)).toContain('application/json')

    // Both carriers really answered, and really carried D-08's line — so the text channel this
    // law is mostly about is a channel that had something to say.
    for (const carrier of ['agent_qa_start_run', 'agent_qa_get_run_digest']) {
      expect(
        at(`tools/call:${carrier}:content[].text`),
        `${carrier} produced no link line — its text channel is dead`,
      ).toContain(`${DASHBOARD_BASE}/runs/${FIXTURE_RUN_ID}/live`)
    }
    // Including on the App-LESS client, which is D-09's whole promise (plan 03).
    expect(at('tools/call:app-less:agent_qa_get_run_digest:content[].text')).toContain(
      `${DASHBOARD_BASE}/runs/${FIXTURE_RUN_ID}/live`,
    )
  })

  it('(A9) MUTATION CONTROL: a real minted token threaded into a carrier result REDS the scan',
    async () => {
      const flow = await driveFullFlow({ leak: true })

      expect(flow.tokens.length, 'the leaking pass minted nothing to leak').toBeGreaterThan(0)

      const leaks = scanCorpus(flow.corpus, flow.tokens)

      // The cell PASSES when the scan correctly FAILS. If this is ever empty, `(A1)` above is
      // green because the scanner cannot see, not because the flow is clean.
      expect(leaks.length, 'the scan did not see a token planted on a real carrier channel')
        .toBeGreaterThan(0)

      // And it saw it where the leak actually is: the model-readable text channel of a carrier
      // result, which is the T-395-R5-10 shape this whole file generalises.
      expect(
        leaks.map((leak) => leak.channel),
        JSON.stringify(leaks.map((leak) => leak.channel)),
      ).toContain('tools/call:agent_qa_get_run_digest:content[].text')
    })
})
