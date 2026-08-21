// The fourth door, end to end (Phase 400 plan 01, DASH-01 / D-01 / D-02).
//
// WHAT THIS CELL DRIVES, AND WHY IT IS NOT A UNIT TEST. Every stage between a browser and a receipt
// is in the path: a real `node:http` server on an ephemeral port, real request bytes over a real
// socket, the shipped `createChatRouter`, the shipped `composeDashboardAgentHost` seam, the shipped
// `composeCliLocalAgent` composition root, `invokeFunction(agent.ask, …)`, the turn engine's
// resolver table, the v48 gate, and the classifier folds that decide what a receipt SAYS. Nothing
// below constructs a lookalike of any of them. A cell that called the route handler with a fake
// request object would be measuring this file's idea of the door.
//
// MODEL-FREE, AND THAT IS THE SHIPPED HEADLESS POSTURE RATHER THAN A STUB. `chatModel` is simply
// not supplied, which is what `compose-local-agent.ts` calls a posture and not an unconfigured
// state: the deterministic resolver table still routes every `/fn` clause, and a natural-language
// utterance would fail the turn closed by name. So these cells cost no provider spend and answer
// the same on a laptop with a key in the environment and on a runner without one.
//
// THE EXECUTION CONTEXT IS INJECTED, NEVER PINNED ON THE PROCESS. `resolveExecutionContext` rides
// through `composeCliLocalAgent` into the registry (400-01's new seam), so this file never touches
// `setActiveExecutionContextResolver` — the process global whose forgotten restore leaks a posture
// into every sibling cell (Pitfall 5). There is nothing to restore because nothing was set.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import {
  CHAT_STREAM_BOUNDS,
  createChatRouter,
  recordStreamedEvent,
  type ChatTurnResponse,
  type SessionStreamWindow,
} from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { remediesRenderableBy, type ChatSessionEvent } from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveCapabilityCatalogPath } from '../capability-catalog/loader.js'
import {
  composeDashboardDoor,
  overlayDashboardBaseUrl,
  DASHBOARD_FUNCTION_CALLER,
} from '../commands/dashboard.js'

/**
 * A deterministic project the door can open a conversation in, and nothing more.
 *
 * The `surface-dispatch.ts` fixture, verbatim in shape and for its stated reasons: it VALIDATES
 * against `AgentQaConfigSchema` (an invalid config is green for 40 capabilities and kills the one
 * that reads configuration before dispatch), and it declares one target so a project is in the
 * ordinary posture rather than the empty one that refuses before the gate.
 */
function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-400-01-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'reset' } },
      registry: {
        targets: {
          conformance: { platform: 'web', url: 'https://conformance.invalid' },
        },
      },
    })}\n`,
    'utf8',
  )
  return configPath
}

interface DoorFixture {
  readonly origin: string
  readonly configRoot: string
  readonly host: LocalAgentHost
  readonly server: Server
  /** How many SSE streams this door is holding open right now — the leak cell's only observable. */
  readonly streamCount: () => number
}

async function openDoor(): Promise<DoorFixture> {
  const configPath = fixtureWorkspace()
  const configRoot = dirname(resolve(configPath))
  // The bound origin, closed over and written after `listen` — the same mutable box the shipped
  // command uses, and driven here so D-16's second supplier is exercised rather than argued.
  let boundOrigin: string | undefined
  // THE SHIPPED COMPOSER, not an assembly beside it. `composeDashboardDoor` is the function
  // `agent-qa dashboard` calls; a host built here from its parts would be a door this product does
  // not ship, and every cell below would then be a statement about this file.
  const { host, agentHost } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    resolveExecutionContext: () => 'local-interactive',
  })
  const router = createChatRouter(agentHost)
  const server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new TypeError('the door bound no port')
  }
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  return { origin: boundOrigin, configRoot, host, server, streamCount: router.openStreamCount }
}

async function closeDoor(door: DoorFixture): Promise<void> {
  await new Promise<void>((closed) => door.server.close(() => closed()))
  await door.host.close()
  rmSync(door.configRoot, { recursive: true, force: true })
}

/** One turn, driven the way a browser drives it. */
async function postTurn(
  origin: string,
  body: unknown,
): Promise<{ readonly status: number; readonly headers: Headers; readonly body: unknown }> {
  const response = await fetch(`${origin}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

describe('the dashboard chat door dispatches one utterance end to end', () => {
  let door: DoorFixture

  beforeAll(async () => {
    door = await openDoor()
  })

  afterAll(async () => {
    await closeDoor(door)
  })

  it('carries a `/fn` utterance from the wire to an executed receipt and a typed payload', async () => {
    // THE TRACER. `config.get` is chosen because it is bound in this composition, reads nothing a
    // fixture has to stage, and returns a real typed payload — so a green here means the whole path
    // moved a value, not that a refusal travelled cleanly.
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })

    expect(answered.status).toBe(200)
    const turn = answered.body as ChatTurnResponse

    expect(
      turn.result.receipts.map((receipt) => `${receipt.functionId}:${receipt.status}`),
      'the turn filed exactly one receipt, for the op the utterance named',
    ).toEqual(['config.get:executed'])
    expect(turn.result.receipts[0]?.status).toBe('executed')

    // 399.1 D-05: `results[]` is the STRUCTURAL channel a render reads. A door that filed a receipt
    // and carried no payload is the exact G-399-2 defect ("<op> completed"), one surface later.
    expect(turn.result.results).toHaveLength(1)
    expect(turn.result.results[0]?.functionId).toBe('config.get')
    expect(turn.result.results[0]?.payload).toBeDefined()

    // The folds ride BESIDE the payload, computed server-side because folding needs the registry.
    expect(turn.folds.map((fold) => fold.functionId)).toEqual(['config.get'])
    expect(turn.folds[0]?.verdict.status).toBe('executed')
  })

  it('derives an unknown op\'s status from the result, never from an HTTP error', async () => {
    // DASH-01's central prohibition, driven in the refuse direction. `control.absent.400.01` is
    // registered nowhere — the name carries this plan's number so 397-09's mutation script can tell
    // a deliberate fixture from a planted stray — so the turn reaches a dispatch that has no such
    // capability and the turn's own record is what says so.
    const answered = await postTurn(door.origin, { message: '/fn control.absent.400.01 {}' })

    // 200, and this is the assertion the prohibition is really about: a door that answered 4xx here
    // would be reporting a REFUSAL as a transport failure, and every client would then have two
    // places to learn what happened — the status line and the receipt — free to disagree.
    expect(answered.status, 'a refused turn is a 200 carrying a refusal, not an HTTP error')
      .toBe(200)

    const turn = answered.body as ChatTurnResponse
    // The EXACT shipped bytes rather than a set membership: a `toContain` over two statuses would
    // stay green through a door that started answering the other one, which is the whole question.
    expect(turn.result.receipts.map((receipt) => ({
      functionId: receipt.functionId,
      status: receipt.status,
      outcome: receipt.outcome,
    }))).toEqual([{
      functionId: 'control.absent.400.01',
      status: 'failed',
      outcome: 'UnknownFunctionError',
    }])
    expect(turn.result.status).toBe('failed')
    // Nothing ran, so there is no result to fold — and the door reports the emptiness rather than
    // fabricating a fold for a clause that produced nothing.
    expect(turn.result.results).toEqual([])
    expect(turn.folds).toEqual([])
  })

  it('carries a session-scoped `/pin` denial back as a 200 with a receipt (the refuse wall)', async () => {
    // The refuse-direction wall the conformance suite drives, proven here on the door that ships
    // it. `/pin` is a directive: it writes a deny into THIS session's overlay, so the second turn
    // has to carry the session id — a fresh session would be a different conversation and the pin
    // would not apply, which is exactly the W-03 scoping the overlay exists for.
    const pinned = await postTurn(door.origin, { message: '/pin fn:config.get' })
    expect(pinned.status).toBe(200)
    const sessionId = (pinned.body as ChatTurnResponse).result.sessionId
    expect(sessionId).toBeTruthy()

    const denied = await postTurn(door.origin, { message: '/fn config.get {}', sessionId })
    expect(denied.status, 'a gate denial is a 200 carrying a receipt, not an HTTP error').toBe(200)
    const turn = denied.body as ChatTurnResponse
    expect(turn.result.receipts.map((receipt) => ({
      functionId: receipt.functionId,
      status: receipt.status,
      outcome: receipt.outcome,
    }))).toEqual([{
      functionId: 'config.get',
      status: 'failed',
      outcome: 'FunctionDeniedError',
    }])
    // And the SAME op executed one cell up in an unpinned session. The pin is what changed, so the
    // door's answer is a fact about the gate rather than about the fixture.
  })

  it('carries the denial\'s REMEDIES to the browser, beside the receipts (400-06, window #188)', async () => {
    // WHAT THIS CLOSES. `ClauseReceipt` is a five-string record by charter (398-13 D-21) and its
    // key set is mirrored in the append-only session-event grammar, so 400-02 could mint a typed
    // `GateRemedy` vocabulary and feed only the CLI's single-op door from `FunctionDeniedError`.
    // Inside a TURN that error is caught by `turn-engine.ts`'s dispatch catch, which keeps
    // `refusalName(error)` — the NAME — and drops the reason and the remedies on the floor. So
    // every interactive door rendered `failed FunctionDeniedError` and nothing a person could act
    // on. The carrier is a SIBLING of `receipts`, exactly as `results[]` is: the receipt stays the
    // map, and the territory of a denial — its canonical reason and the typed ways forward —
    // travels beside it.
    //
    // DRIVEN THROUGH THE REAL GATE. `/pin` writes a deny into this conversation's overlay and the
    // second turn trips it, so the remedy below is minted by `buildDecisionRemedies`'s
    // `session-pin-denied` arm rather than by anything this file knows how to spell.
    const pinned = await postTurn(door.origin, { message: '/pin fn:config.get' })
    expect(pinned.status).toBe(200)
    const sessionId = (pinned.body as ChatTurnResponse).result.sessionId

    const denied = await postTurn(door.origin, { message: '/fn config.get {}', sessionId })
    expect(denied.status).toBe(200)
    const turn = denied.body as ChatTurnResponse

    // The receipt is unchanged — five strings, the refusal NAME. The charter is intact.
    expect(turn.result.receipts.map((receipt) => ({
      functionId: receipt.functionId,
      status: receipt.status,
      outcome: receipt.outcome,
    }))).toEqual([{
      functionId: 'config.get',
      status: 'failed',
      outcome: 'FunctionDeniedError',
    }])

    // And beside it, what the browser needs to offer a way forward. The clause is named so a
    // compound turn's second denial is not silently attributed to its first.
    expect(turn.result.denials).toEqual([{
      clause: '/fn config.get {}',
      functionId: 'config.get',
      reason: expect.stringContaining('session-pin-denied'),
      remedies: [{ kind: 'session-pin-final' }],
    }])

    // The remedy the gate minted is one a BROWSER can take, which is the whole of D-15: the same
    // denial projects EMPTY for `mcp`, and the dashboard render runs the same projection.
    const remedies = turn.result.denials![0]!.remedies
    expect(remediesRenderableBy('dashboard', remedies)).toEqual([{ kind: 'session-pin-final' }])
    expect(remediesRenderableBy('mcp', remedies)).toEqual([])
  })

  it('reports an empty denial list on a turn nothing denied (the emptiness is the claim)', async () => {
    // ON `results[]`'s OWN ARGUMENT. A turn that omitted the field would leave "nothing was
    // denied" and "this build does not report denials" as the same bytes — and "the gate refused
    // nothing here" is a claim a reader of a green transcript is entitled to.
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })
    expect(answered.status).toBe(200)
    expect((answered.body as ChatTurnResponse).result.denials).toEqual([])
  })

  it('serves the COMMITTED capability catalog, byte for byte (400-06, RESEARCH Open Q4)', async () => {
    // ONE ARTIFACT, A FOURTH PROJECTION. The catalog is produced from a real composition's
    // declarations and committed; `/help`, the completer and `init --agent` all read that file.
    // The browser needs the same document, and the only way to be sure it IS the same document is
    // to compare the served bytes against the file on disk — a shape assertion ("it has rows")
    // would stay green against a catalog this door assembled for itself, which is the second
    // source of truth the whole artifact exists to prevent.
    const response = await fetch(`${door.origin}/api/chat/catalog`)
    expect(response.status).toBe(200)
    // No wildcard here either: this route rides the same prefix and the same responder.
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const served = await response.json() as { rowCount: number; rowsDigest: string; rows: unknown[] }
    const committed = JSON.parse(
      readFileSync(resolveCapabilityCatalogPath(), 'utf8'),
    ) as { rowCount: number; rowsDigest: string; rows: unknown[] }
    expect(served).toEqual(committed)
    // And the artifact's own mechanical self-check still holds over what was served.
    expect(served.rows).toHaveLength(served.rowCount)
    expect(served.rowsDigest).toBe(committed.rowsDigest)
  })

  it('writes no cross-origin wildcard on the mutating turn route (T-400-03)', async () => {
    // The shared `json()` helper in `routes.ts` sets `Access-Control-Allow-Origin: *` on everything
    // it writes, and the run-events SSE stream sets it deliberately. That is a READ idiom. On a
    // route that starts work it is an invitation for any page a person has open to drive their
    // local agent, so this door writes its own responder — and this cell is what stops somebody
    // "tidying up" by reaching for the shared one.
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })
    expect(answered.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers its own preflight without granting a cross-origin caller anything', async () => {
    // The same reasoning one cell up, in the direction a browser actually takes first. The shared
    // `cors()` arm answers every OPTIONS with `*`; a chat route left behind it would hand a
    // cross-origin page the preflight it needs even though the POST response withholds the header.
    const response = await fetch(`${door.origin}/api/chat/turn`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a malformed body before a turn is minted', async () => {
    // T-400-01. Both arms of the door's zod guard: bytes that are not the contract, and bytes that
    // are not JSON at all. A 400 here is not a receipt status — nothing was asked of the agent.
    const emptyMessage = await postTurn(door.origin, { message: '' })
    expect(emptyMessage.status).toBe(400)

    const unknownField = await postTurn(door.origin, { message: 'hello', scope: 'nope' })
    expect(unknownField.status, 'an unknown field is refused rather than silently dropped')
      .toBe(400)

    const notJson = await fetch(`${door.origin}/api/chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    })
    expect(notJson.status).toBe(400)
  })

  it('overlays services.dashboard.baseUrl with the origin it actually bound (D-16)', async () => {
    // 387 D-10 made the entity card's `url` config-derived and absent by default, read through the
    // masker at `services.dashboard.baseUrl`. D-16 adds the SECOND SUPPLIER: a dashboard serving
    // its own conversation knows its own origin, so cards in that conversation carry working links
    // with no user setup — one mechanism, two suppliers, and no change to the card producer.
    //
    // MEASURED AT THE OP BOUNDARY, which is the only place the claim is about the product. The
    // producer reads `deps.config.getMasked()`, so driving `config.get` through the door reads the
    // exact entry the producer would: same port, same composition, same masking oracle. A cell that
    // inspected the overlay function directly would be asserting about this file's wiring.
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })
    const payload = (answered.body as ChatTurnResponse).result.results[0]?.payload as {
      entries?: readonly { key: string; value: string; source: string; masked: boolean }[]
    }
    const entry = payload.entries?.find((row) => row.key === 'services.dashboard.baseUrl')
    expect(entry, 'the door composed no dashboard base URL, so every card it renders would be '
      + 'url-absent even though this server has an address').toBeDefined()
    expect(entry?.value, 'the base URL must be the origin this server BOUND, not a guess: an '
      + 'ephemeral port is a real posture and a value captured before `listen` would be wrong')
      .toBe(door.origin)
    // `masked: false` is load-bearing, not decoration. The producer decides a base is usable by
    // reading that flag — a `true` here would make the whole overlay contribute nothing, and the
    // cards would be url-absent with everything else looking correct.
    expect(entry?.masked, 'a masked base is treated as NO base by the card producer').toBe(false)
    expect(entry?.source, 'no file, environment variable or flag carries this value').toBe('default')
  })

  it('lets an operator\'s own configured base URL win over the bound origin (D-16)', async () => {
    // THE OVERLAY FILLS AN ABSENCE AND NEVER REPLACES A PRESENCE. A configured base is somebody
    // pointing at something — a reverse proxy, a tunnel, a path prefix — and overwriting it with
    // `http://127.0.0.1:<port>` would silently redirect every card link away from the address they
    // chose. The knob stays THE mechanism; this door is its second supplier, not its owner.
    const configured = 'https://qa.example.invalid'
    const overlaid = overlayDashboardBaseUrl(
      {
        getMasked: async () => Promise.resolve({
          schemaVersion: 1,
          configPath: 'agent-qa.config.yaml',
          entries: [{
            key: 'services.dashboard.baseUrl',
            value: configured,
            source: 'config-file' as const,
            masked: false,
          }],
        }),
      },
      () => 'http://127.0.0.1:9999',
    )
    const masked = await overlaid.getMasked()
    expect(
      masked.entries.filter((row) => row.key === 'services.dashboard.baseUrl'),
      'the operator\'s value must survive, exactly once',
    ).toEqual([{
      key: 'services.dashboard.baseUrl',
      value: configured,
      source: 'config-file',
      masked: false,
    }])
  })

  it('lists what it reaches, through the door itself', async () => {
    // The listing the conformance adapter enumerates through. Driven here as well as there so the
    // route is proven by the plan that ships it rather than only by the suite that consumes it.
    const response = await fetch(`${door.origin}/api/chat/capabilities`)
    expect(response.status).toBe(200)
    const listing = await response.json() as { ops: readonly { id: string }[] }
    expect(listing.ops.length).toBeGreaterThan(0)
    expect(listing.ops.map((op) => op.id)).toContain('agent.ask')
  })
})

describe('the door is composed once, and mounted where the server serves it', () => {
  it('dispatches as a caller derived from the CLI chat door\'s own mint (D-08)', async () => {
    // Pitfall 9's check, in the only form that can catch it: the two mints are compared as SETS
    // rather than each spelled here. A literal list in this cell would be a third copy, agreeing
    // with both today and with neither the day a seventh scope lands.
    const { CLI_FUNCTION_CALLER } = await import('../composition/local-agent-host.js')
    expect([...DASHBOARD_FUNCTION_CALLER.grantedScopes].sort())
      .toEqual([...CLI_FUNCTION_CALLER.grantedScopes].sort())
    expect(DASHBOARD_FUNCTION_CALLER.origin).toBe(CLI_FUNCTION_CALLER.origin)
    expect(DASHBOARD_FUNCTION_CALLER.safeMode).toBe(CLI_FUNCTION_CALLER.safeMode)
    // Attribution is the one difference, and it is the only legitimate one.
    expect(DASHBOARD_FUNCTION_CALLER.surface).toBe('dashboard')
  })

  it('mounts the SAME router the cells above drive (no second door)', () => {
    // A SOURCE assertion, because this is the one property these cells cannot observe by driving:
    // they stand up `createChatRouter` themselves, so a `routes.ts` that mounted a second,
    // divergent handler would leave every cell above green while the shipped server served
    // something else. `parity.test.ts`'s own comment-stripped source idiom.
    const routesPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../dashboard-server/src/server/routes.ts',
    )
    const source = readFileSync(routesPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(source).toContain('createChatRouter(deps.agentHost)')
    expect(source).toContain('CHAT_ROUTE_PREFIX')
  })
})

// ---- The turn-events stream (400-01 task 3, D-03 / T-400-04) -----------------------------------
//
// WHAT THE STREAM IS, STATED BEFORE IT IS TESTED. The session's append-only JSONL log is the
// DURABLE TRUTH and the stream is a push optimisation over it — the same law the run chips are
// under. So every cell below reads its expectations off the log the turn wrote, never off a list
// this file keeps: a stream that dropped an event, reordered two, or invented one that was never
// appended is a difference between the two, and a cell comparing the stream against a hand-written
// expectation could not see any of the three.

/** One SSE frame, as the wire carries it. */
interface SseFrame {
  readonly id: string | undefined
  readonly event: string | undefined
  readonly data: string
}

/**
 * Read frames off a real SSE connection until a predicate is satisfied or the budget runs out.
 *
 * The connection is ABORTED rather than left to time out, because that is what a browser tab
 * closing does — and cell three's whole subject is what the server does when it happens.
 */
async function readFrames(
  url: string,
  options: {
    readonly lastEventId?: string
    readonly until: (frames: readonly SseFrame[]) => boolean
    readonly budgetMs?: number
  },
): Promise<{ readonly frames: readonly SseFrame[]; readonly raw: string; readonly abort: () => void }> {
  const controller = new AbortController()
  const response = await fetch(url, {
    signal: controller.signal,
    headers: options.lastEventId === undefined ? {} : { 'Last-Event-ID': options.lastEventId },
  })
  if (response.body === null) throw new TypeError('the stream carried no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  let raw = ''
  const deadline = Date.now() + (options.budgetMs ?? 10_000)
  try {
    while (!options.until(frames) && Date.now() < deadline) {
      const chunk = await reader.read()
      if (chunk.done) break
      raw += decoder.decode(chunk.value, { stream: true })
      // Frames are separated by a blank line; a trailing partial stays in `raw` for the next read.
      const parts = raw.split('\n\n')
      raw = parts.pop() ?? ''
      for (const part of parts) {
        if (part.trim() === '' || part.startsWith(':')) continue
        const lines = part.split('\n')
        frames.push({
          id: lines.find((line) => line.startsWith('id: '))?.slice(4),
          event: lines.find((line) => line.startsWith('event: '))?.slice(7),
          data: lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '',
        })
      }
    }
  } finally {
    controller.abort()
  }
  return { frames, raw, abort: () => controller.abort() }
}

/** Poll a condition the SERVER decides, rather than sleeping a number somebody guessed. */
async function waitUntil(condition: () => boolean, budgetMs = 5_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((settled) => setTimeout(settled, 10))
  }
}

/** Every event the session's own JSONL log carries, in file order — the durable truth. */
function loggedEvents(configRoot: string, sessionId: string): readonly Record<string, unknown>[] {
  const path = join(configRoot, '.agent-qa', 'sessions', `${sessionId}.jsonl`)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    // The first line is the session HEADER, which carries no `kind` and is not an event.
    .filter((record) => typeof record['kind'] === 'string')
}

describe('the turn-events stream is a projection of the session log', () => {
  let door: DoorFixture

  beforeAll(async () => {
    door = await openDoor()
  })

  afterAll(async () => {
    await closeDoor(door)
  })

  it('delivers every event the turn appended, in append order, closing on turn_complete', async () => {
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })
    const { sessionId } = (answered.body as ChatTurnResponse).result

    const { frames } = await readFrames(
      `${door.origin}/api/chat/sessions/${sessionId}/events`,
      { until: (seen) => seen.some((frame) => frame.event === 'turn_complete') },
    )

    // THE COMPARAND IS THE LOG, not a list written here. A stream that dropped, reordered or
    // invented an event differs from the file the turn wrote, and nothing else can say so.
    const logged = loggedEvents(door.configRoot, sessionId)
    expect(logged.length, 'the turn appended nothing at all, so this cell would assert about an '
      + 'empty stream and pass').toBeGreaterThan(0)
    expect(frames.map((frame) => frame.event)).toEqual(logged.map((record) => record['kind']))
    expect(frames.map((frame) => JSON.parse(frame.data) as unknown)).toEqual(logged)

    // The ids are the replay currency, so they must be present, distinct and ascending.
    const ids = frames.map((frame) => Number(frame.id))
    expect(ids.every((id) => Number.isInteger(id))).toBe(true)
    expect(ids).toEqual([...ids].sort((left, right) => left - right))
    expect(new Set(ids).size).toBe(ids.length)

    // The turn closes on the log's own closing event, carrying that turn's id — the typed result
    // reference a client needs to join the frame to the response it already has.
    const last = frames.at(-1)
    expect(last?.event).toBe('turn_complete')
    expect((JSON.parse(last?.data ?? '{}') as { turnId?: string }).turnId)
      .toBe((answered.body as ChatTurnResponse).result.turnId)
  })

  it('replays from Last-Event-ID with no duplicates and no gaps', async () => {
    const answered = await postTurn(door.origin, { message: '/fn config.get {}' })
    const { sessionId } = (answered.body as ChatTurnResponse).result
    const streamUrl = `${door.origin}/api/chat/sessions/${sessionId}/events`

    const first = await readFrames(streamUrl, {
      until: (seen) => seen.some((frame) => frame.event === 'turn_complete'),
    })
    expect(first.frames.length, 'nothing to reconnect into').toBeGreaterThan(1)

    // Reconnect as a browser does: the id of the last frame it actually saw.
    const seenThrough = first.frames[0]!.id!
    const resumed = await readFrames(streamUrl, {
      lastEventId: seenThrough,
      until: (seen) => seen.some((frame) => frame.event === 'turn_complete'),
    })

    // NO DUPLICATES: nothing at or before the id the client acknowledged.
    expect(
      resumed.frames.map((frame) => Number(frame.id)).filter((id) => id <= Number(seenThrough)),
      'the replay re-sent an event the client had already seen',
    ).toEqual([])
    // NO GAPS: everything after it, in the same order, byte for byte.
    expect(resumed.frames).toEqual(
      first.frames.filter((frame) => Number(frame.id) > Number(seenThrough)),
    )
  })

  it('delivers LIVE, and tears down its listener and heartbeat when the client disconnects', async () => {
    // TWO CLAIMS IN ONE CELL BECAUSE NEITHER IS HONEST ALONE. A teardown cell that only counted
    // down would pass over a server that never subscribed at all — the count would be zero before
    // and zero after, and every replay-based cell above would stay green, because a turn that has
    // already finished replays out of the window whether anybody is subscribed or not. So the
    // subscription is asserted UP (a stream is registered while it is open) and DOWN (it is gone
    // when the socket closes), and a turn posted while the connection is open has to arrive on it.
    const opened = await postTurn(door.origin, { message: '/fn config.get {}' })
    const { sessionId } = (opened.body as ChatTurnResponse).result
    const streamUrl = `${door.origin}/api/chat/sessions/${sessionId}/events`

    // Everything the first turn appended, so the live half below can start from a known point
    // instead of re-reading the window's history.
    const priorFrames = await readFrames(streamUrl, {
      until: (seen) => seen.some((frame) => frame.event === 'turn_complete'),
    })
    let seenThrough = Math.max(...priorFrames.frames.map((frame) => Number(frame.id)))

    // WAITED FOR RATHER THAN READ, because a socket this file aborted a moment ago is torn down on
    // the SERVER's turn of the loop and not on the client's — the first draft of this cell read the
    // count while the previous connection was still registered and measured a baseline of one. The
    // settle is itself a small proof that teardown is asynchronous and real.
    await waitUntil(() => door.streamCount() === 0)
    const baseline = door.streamCount()
    expect(baseline, 'a stream from an earlier cell is still registered').toBe(0)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const controller = new AbortController()
      const response = await fetch(streamUrl, {
        signal: controller.signal,
        headers: { 'Last-Event-ID': String(seenThrough) },
      })
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      await waitUntil(() => door.streamCount() === baseline + 1)
      expect(
        door.streamCount(),
        `cycle ${String(cycle)}: the server served a stream without registering a subscription, `
          + 'so nothing it appends later can reach this client',
      ).toBe(baseline + 1)

      // The live half: a turn posted with the connection ALREADY OPEN. Its events cannot come from
      // the replay — the reconnect id is past everything the window held when this socket opened.
      const posted = await postTurn(door.origin, { message: '/fn config.get {}', sessionId })
      const posturnId = (posted.body as ChatTurnResponse).result.turnId
      let text = ''
      const deadline = Date.now() + 10_000
      while (!text.includes('event: turn_complete') && Date.now() < deadline) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += decoder.decode(chunk.value, { stream: true })
      }
      expect(
        text,
        `cycle ${String(cycle)}: the turn's events never reached the open stream — the push half `
          + 'of D-03 is not connected, and every other cell here would still pass on the replay',
      ).toContain(`"turnId":"${posturnId}"`)
      for (const line of text.split('\n')) {
        if (line.startsWith('id: ')) seenThrough = Math.max(seenThrough, Number(line.slice(4)))
      }

      controller.abort()
      await waitUntil(() => door.streamCount() === baseline)
      expect(
        door.streamCount(),
        `cycle ${String(cycle)}: a disconnected stream left its listener and heartbeat behind`,
      ).toBe(baseline)
    }
  }, 60_000)

  it('enforces both replay bounds, driven rather than asserted about (T-400-04)', () => {
    // THE BOUND IS DRIVEN, and the first draft of this cell is why. It asserted that the two cap
    // CONSTANTS existed in the source — and a mutation that deleted the enforcement while leaving
    // the constants in place kept every cell in this file green. A cap nothing applies is a comment.
    //
    // The recorder is exported for exactly this reason: it is the same function the router's one
    // subscription calls, pure over the map it is handed, so six hundred synthetic events cost a
    // millisecond and the eviction is observed rather than argued. The cap VALUES are read from the
    // published bounds instead of spelled here — an operations decision this cell must not pin.
    const { replayLimit, sessionLimit } = CHAT_STREAM_BOUNDS
    const event = (turnId: string): ChatSessionEvent =>
      ({ kind: 'user_message', at: '2026-08-21T00:00:00.000Z', turnId, text: 'x' })

    // Bound one: one session's window never exceeds the replay limit, and what it keeps is the
    // TAIL — a window that evicted the newest events would answer "what did I miss" with the
    // oldest thing it had.
    const oneSession = new Map<string, SessionStreamWindow>()
    for (let index = 0; index < replayLimit + 100; index += 1) {
      recordStreamedEvent(oneSession, 'chat-bounded', event(`t${String(index)}`))
    }
    const window = oneSession.get('chat-bounded')
    expect(window?.events.length, 'the replay window grew past its cap').toBe(replayLimit)
    expect(window?.events.at(-1)?.id, 'ids must keep counting past an eviction, or a reconnect id '
      + 'would address two different events').toBe(replayLimit + 100)
    expect(window?.events.at(0)?.id, 'the window kept the head instead of the tail')
      .toBe(101)

    // Bound two: the number of TRACKED SESSIONS is capped, and the one evicted is the least
    // recently APPENDED rather than the first created — the session somebody is watching right now
    // is the one that must survive.
    const manySessions = new Map<string, SessionStreamWindow>()
    for (let index = 0; index < sessionLimit; index += 1) {
      recordStreamedEvent(manySessions, `chat-${String(index)}`, event('t'))
    }
    // Touch the oldest, so eviction order and creation order disagree.
    recordStreamedEvent(manySessions, 'chat-0', event('t'))
    recordStreamedEvent(manySessions, 'chat-overflow', event('t'))
    expect(manySessions.size, 'the tracked-session set grew past its cap').toBe(sessionLimit)
    expect(manySessions.has('chat-0'), 'the recently appended session was evicted').toBe(true)
    expect(manySessions.has('chat-1'), 'the least recently appended session survived').toBe(false)
  })
})
