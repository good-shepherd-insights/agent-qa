// The browser confirm bridge (Phase 400 plan 03, DASH-01 / D-05 / D-06 / D-07).
//
// WHAT THESE CELLS DRIVE. A real `node:http` server on an ephemeral port, the shipped
// `createChatRouter`, the shipped `composeDashboardDoor`, a real SSE connection held open by a real
// socket, `invokeFunction(agent.ask, …)`, the v48 gate's ask arm, and the shipped confirm registry
// parked between them. Nothing below calls a route handler with a fake request or resolves a
// promise the product would not have resolved.
//
// THE ASK-TIER OP IS `knowledge.proposal.apply`, and the choice is load-bearing three times over:
// it is `declaredTier: 'mutating-shared'` so `baseVerdict` answers `ask` (the only tier that
// reaches a confirm at all); it is NOT one of the two protected classes, so `accept-always` reaches
// 391's real mint rather than its protected-class refusal; and its input schema accepts a
// well-formed proposal id that names nothing, so the GATE is reached (input parse is pre-gate,
// binding is post-gate) without the cell staging a knowledge tree.
//
// THE CONFIRM IS ASSERTED ON THE WIRE BEFORE ITS RESOLUTION IS ASSERTED. A "resolved to DENY" cell
// that never raised a confirm is trivially green — the gate denies by default with no port bound at
// all — so every cell here waits for the `confirm_request` frame to arrive over the socket first.
// The `prompted-approved` audit outcome in the accept cells is the other half: nothing but a
// confirm port answering yes can produce it.
//
// MODEL-FREE, and the execution context is INJECTED through the composition (never
// `setActiveExecutionContextResolver`, the process global whose forgotten restore leaks into
// sibling cells — Pitfall 5).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  createChatRouter,
  createConfirmRegistry,
  type ChatTurnResponse,
  type ConfirmRegistry,
} from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

/** A well-formed proposal id that names nothing — the gate is reached, the apply then finds none. */
const ABSENT_PROPOSAL = 'prop_400-03-absent'

/**
 * A second, non-protected class the lease arm writes — never reached through an op.
 *
 * Its name carries this plan's number so a later mutation sweep can tell a deliberate fixture from
 * a planted stray, and it is deliberately NOT the class the arms above contend on: the held arm
 * must fail on the LEASE, and reusing an already-granted class would let it pass on the
 * already-granted fold instead.
 */
const CONTROL_ACTION_CLASS = 'fn:control.400.03.lease-arm'

/** The ask-tier utterance every confirm cell drives. */
const ASK_UTTERANCE = `/fn knowledge.proposal.apply {"proposalId":"${ABSENT_PROPOSAL}"}`

/** The action class the gate classifies it as — the `fn:`-prefixed op id, verbatim. */
const ASK_ACTION_CLASS = 'fn:knowledge.proposal.apply'

/** The `surface-dispatch.ts` fixture project, verbatim in shape (see the door cell's own note). */
function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-400-03-'))
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
  readonly confirms: ConfirmRegistry
  readonly executionContext: (sessionId: string) => string
}

const openDoors: DoorFixture[] = []

/**
 * The door as `agent-qa dashboard` composes it, with a confirm registry bound.
 *
 * `timeoutMs` is the ONE thing a cell tunes, and each cell states why: the timeout cell shortens it
 * so the wait is a test cost rather than a policy, and the disconnect cell LENGTHENS it far past
 * the cell's own budget so a pass cannot come from the timer that the disconnect reaper is supposed
 * to pre-empt.
 */
async function openDoor(options: { readonly timeoutMs?: number } = {}): Promise<DoorFixture> {
  const configPath = fixtureWorkspace()
  const configRoot = dirname(resolve(configPath))
  let boundOrigin: string | undefined
  const confirms = createConfirmRegistry(
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  )
  // NO `resolveExecutionContext` (400-13), for the reason the command passes none: the honest
  // posture is a per-conversation fact only the composition can compute, so the door DERIVES it and
  // publishes what it derived. The honesty cell then measures production's own predicate rather
  // than a second copy of the rule written here.
  //
  // WHAT THE PUBLISHED HANDLE TAKES IS A CONVERSATION (400-15). The gate-facing resolver reads the
  // AMBIENT asking session — the one the door scopes around each turn — which no cell is inside, so
  // a zero-arg read from out here could only ever answer `local-headless`. The measurement API
  // therefore names the conversation it is asking about, and resolves it through the same
  // `postureFor` the gate does.
  const { host, agentHost, resolveExecutionContext } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    confirms,
  })
  const executionContext = resolveExecutionContext
  const router = createChatRouter(agentHost)
  const server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the door bound no port')
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  const fixture: DoorFixture = {
    origin: boundOrigin,
    configRoot,
    host,
    server,
    confirms,
    executionContext,
  }
  openDoors.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openDoors.length > 0) {
    const door = openDoors.pop()!
    await new Promise<void>((closed) => door.server.close(() => closed()))
    await door.host.close()
    rmSync(door.configRoot, { recursive: true, force: true })
  }
})

async function postTurn(origin: string, body: unknown): Promise<ChatTurnResponse> {
  const response = await fetch(`${origin}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await response.json() as ChatTurnResponse
}

async function postConfirm(
  origin: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${origin}/api/chat/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

interface SseFrame {
  readonly id: string | undefined
  readonly event: string | undefined
  readonly data: string
}

/**
 * A stream a cell HOLDS OPEN while it does other things.
 *
 * The door cell's `readFrames` aborts as soon as its predicate is satisfied, which is the wrong
 * shape here: a confirm is answered over a SECOND request while the first is still connected, and
 * closing the stream is itself the subject of one of these cells.
 */
interface LiveStream {
  readonly frames: readonly SseFrame[]
  waitFor(predicate: (frame: SseFrame) => boolean, budgetMs?: number): Promise<SseFrame>
  close(): Promise<void>
}

async function openStream(origin: string, sessionId: string): Promise<LiveStream> {
  const controller = new AbortController()
  const response = await fetch(`${origin}/api/chat/sessions/${sessionId}/events`, {
    signal: controller.signal,
  })
  if (response.body === null) throw new TypeError('the stream carried no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  let raw = ''
  const pump = (async () => {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        raw += decoder.decode(chunk.value, { stream: true })
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
    } catch {
      // An aborted read is how this stream ends; it is the cell's own doing, never a failure.
    }
  })()
  return {
    frames,
    async waitFor(predicate, budgetMs = 10_000) {
      const deadline = Date.now() + budgetMs
      while (Date.now() < deadline) {
        const hit = frames.find((frame) => predicate(frame))
        if (hit !== undefined) return hit
        await new Promise<void>((settled) => setTimeout(settled, 10))
      }
      throw new Error(
        `no frame satisfied the predicate within ${String(budgetMs)}ms; saw `
        + JSON.stringify(frames.map((frame) => frame.event)),
      )
    },
    async close() {
      controller.abort()
      await pump
    },
  }
}

/** Open a conversation and return its id — one cheap read-only turn, before any confirm exists. */
async function openSession(origin: string): Promise<string> {
  const opened = await postTurn(origin, { message: '/fn config.get {}' })
  const sessionId = opened.result.sessionId
  expect(sessionId, 'the door opened no session, so every cell below would address nothing')
    .toBeTruthy()
  return sessionId
}

/** Every execution-audit row this door has written, in file order. */
function auditRows(configRoot: string): readonly Record<string, unknown>[] {
  const path = join(configRoot, '.agent-qa', 'execution_audit.jsonl')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function askRowsFor(configRoot: string): readonly Record<string, unknown>[] {
  return auditRows(configRoot).filter((row) => row['action'] === ASK_ACTION_CLASS)
}

/** The session log's own events — the durable truth a `approval_decision` row must appear on. */
function loggedEvents(configRoot: string, sessionId: string): readonly Record<string, unknown>[] {
  const path = join(configRoot, '.agent-qa', 'sessions', `${sessionId}.jsonl`)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => typeof record['kind'] === 'string')
}

function confirmRequestOf(frame: SseFrame): { confirmId: string; actionClass: string; preview?: string } {
  return JSON.parse(frame.data) as { confirmId: string; actionClass: string; preview?: string }
}

describe('an ask-tier op raises a confirm the browser can answer', () => {
  it('denies a confirm nobody answers before its window closes (D-06)', async () => {
    // The window is SHORT here because the cell pays for it in wall clock; the disconnect cell
    // below does the opposite, for the opposite reason.
    const door = await openDoor({ timeoutMs: 300 })
    const sessionId = await openSession(door.origin)
    const stream = await openStream(door.origin, sessionId)

    // FLOATING deliberately: the turn does not return until the confirm resolves, and the confirm
    // is what this cell is watching for.
    const turn = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })

    // THE CONFIRM REACHED THE WIRE. Asserted BEFORE anything about how it resolved, because
    // "resolved to deny" is trivially true of a confirm that was never raised.
    const raisedFrame = await stream.waitFor((frame) => frame.event === 'confirm_request')
    const raised = confirmRequestOf(raisedFrame)
    expect(raised.actionClass).toBe(ASK_ACTION_CLASS)
    expect(raised.confirmId).toBeTruthy()
    // NO STREAM ID ON A CONFIRM FRAME. The ids on this connection are the replay currency for the
    // session log's projection; numbering a transient question into that sequence would make a
    // reconnect ask for an event no window could ever hold.
    expect(raisedFrame.id).toBeUndefined()

    const answered = await turn
    expect(answered.result.receipts.map((receipt) => ({
      functionId: receipt.functionId,
      status: receipt.status,
      outcome: receipt.outcome,
    }))).toEqual([{
      functionId: 'knowledge.proposal.apply',
      status: 'failed',
      outcome: 'FunctionDeniedError',
    }])

    // THE GATE'S OWN WORD FOR WHAT HAPPENED. `prompted-denied` is what a consulted confirm saying
    // no produces; `fail-closed-denied` is what a headless context produces without asking anybody.
    // The difference is the whole of D-05's honesty claim, so it is asserted rather than implied.
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['prompted-denied'])

    // The registry parks nothing forever: the timed-out confirm was reaped, not leaked.
    expect(door.confirms.pendingCount()).toBe(0)
    await stream.close()
  })

  it('denies immediately when the browser disconnects while a confirm is pending (D-06)', async () => {
    // A SIXTY-SECOND window, far past this cell's own budget. If the disconnect reaper were removed
    // the cell could only pass by waiting out the timer, which it does not have time to do — so a
    // green here is the reaper and cannot be the timeout.
    const door = await openDoor({ timeoutMs: 60_000 })
    const sessionId = await openSession(door.origin)
    const stream = await openStream(door.origin, sessionId)

    const turn = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    await stream.waitFor((frame) => frame.event === 'confirm_request')
    expect(door.confirms.pendingCount()).toBe(1)

    // The tab closes.
    await stream.close()

    const answered = await turn
    expect(answered.result.receipts[0]?.outcome).toBe('FunctionDeniedError')
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['prompted-denied'])
    expect(door.confirms.pendingCount()).toBe(0)
  }, 20_000)

  it('routes an accept to the exact parked confirm, and refuses replays and unknown ids (T-400-09)', async () => {
    const door = await openDoor({ timeoutMs: 60_000 })
    const sessionId = await openSession(door.origin)
    const stream = await openStream(door.origin, sessionId)

    const turn = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    const raised = confirmRequestOf(await stream.waitFor((frame) => frame.event === 'confirm_request'))

    // An id nobody minted answers nothing.
    const unknown = await postConfirm(door.origin, {
      sessionId,
      confirmId: 'confirm-400-03-never-minted',
      answer: 'accept',
    })
    expect(unknown.status).toBe(404)
    expect(door.confirms.pendingCount(), 'the unknown id resolved somebody else\'s confirm').toBe(1)

    // Another session cannot answer this one's question, even holding the right id.
    const crossSession = await postConfirm(door.origin, {
      sessionId: 'chat-20260101-000000-0000',
      confirmId: raised.confirmId,
      answer: 'accept',
    })
    expect(crossSession.status).toBe(404)
    expect(door.confirms.pendingCount()).toBe(1)

    const accepted = await postConfirm(door.origin, {
      sessionId,
      confirmId: raised.confirmId,
      answer: 'accept',
    })
    expect(accepted.status).toBe(200)

    // SINGLE USE: the id is consumed by the answer that spent it.
    const replayed = await postConfirm(door.origin, {
      sessionId,
      confirmId: raised.confirmId,
      answer: 'accept',
    })
    expect(replayed.status).toBe(404)

    const answered = await turn
    // The op ran and then failed on its own terms — the proposal does not exist — which is what an
    // APPROVED ask looks like from here. A denial would have carried `FunctionDeniedError`.
    expect(answered.result.receipts[0]?.outcome).not.toBe('FunctionDeniedError')
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['prompted-approved'])

    // The decision is on the session's own log, through the composition's `onDecision` binding.
    const decisions = loggedEvents(door.configRoot, sessionId)
      .filter((event) => event['kind'] === 'approval_decision')
    expect(decisions.map((event) => [event['actionClass'], event['decision'], event['source']]))
      .toEqual([[ASK_ACTION_CLASS, 'accept', 'gate']])

    await stream.close()
  }, 20_000)

  it('mints an accept-always through 391\'s grant machinery, never a dashboard-side write (D-07)', async () => {
    const door = await openDoor({ timeoutMs: 60_000 })
    const sessionId = await openSession(door.origin)
    const stream = await openStream(door.origin, sessionId)

    const turn = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    const raised = confirmRequestOf(await stream.waitFor((frame) => frame.event === 'confirm_request'))
    const answered = await postConfirm(door.origin, {
      sessionId,
      confirmId: raised.confirmId,
      answer: 'accept-always',
    })
    expect(answered.status).toBe(200)
    await turn

    // THE GRANT IS OBSERVED THROUGH THE DOOR'S OWN `grants.list`, which reads 391's committed
    // ledger — not by this cell opening a file the dashboard might have written. A dashboard-side
    // write would produce a file that looked right and carried none of the mint's protections.
    const listed = await postTurn(door.origin, { message: '/fn grants.list {}', sessionId })
    const payload = listed.result.results[0]?.payload as {
      grants?: readonly { actionClass?: string }[]
    }
    expect(payload.grants?.map((grant) => grant.actionClass)).toContain(ASK_ACTION_CLASS)

    // The log records the EFFECT (392-05's law): `accept-always` is written only where a standing
    // approval actually exists.
    const decisions = loggedEvents(door.configRoot, sessionId)
      .filter((event) => event['kind'] === 'approval_decision')
    expect(decisions.map((event) => event['decision'])).toEqual(['accept-always'])

    // AND THE GRANT IS IN FORCE: the same op, asked again, is satisfied by the standing approval
    // rather than by a second confirm. This is the assertion a ledger line alone cannot make.
    const again = await postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    expect(again.result.receipts[0]?.outcome).not.toBe('FunctionDeniedError')
    const askOutcomes = askRowsFor(door.configRoot).map((row) => row['trustSource'])
    expect(askOutcomes.at(-1)).toBe('standing-approval')

    await stream.close()
  }, 30_000)

  it('is local-interactive only while a confirm channel can reach THIS conversation (D-05)', async () => {
    // THE POSITIVE CONTROL for 400-13's tightening, and it has to be one: a fix that answered
    // `local-headless` everywhere would close gap 3 and break the door. This cell drives the
    // watched, in-flight, same-conversation case all the way to `prompted-approved`.
    const door = await openDoor({ timeoutMs: 60_000 })

    const sessionId = await openSession(door.origin)
    // NO CHANNEL, NO CLAIM. A dashboard process with nobody watching is exactly as headless as a
    // piped CLI, and saying otherwise is the dishonesty this seam exists to prevent. Asked ABOUT A
    // CONVERSATION since 400-15: the claim was always meant to be per-conversation, and now the
    // question can be spelled that way.
    expect(door.executionContext(sessionId)).toBe('local-headless')
    const stream = await openStream(door.origin, sessionId)
    // The server decides when the channel is registered, so the cell waits on the server's own
    // answer rather than sleeping a number.
    const opened = Date.now()
    while (!door.confirms.hasLiveChannel(sessionId) && Date.now() - opened < 5_000) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    // WATCHED IS NOT YET REACHABLE, and this line is the one a live-only candidate rule reds on. A
    // browser with no question outstanding is a person reading their transcript; the claim this
    // door makes is that it can hand THIS TURN's question to whoever asked it.
    expect(door.executionContext(sessionId)).toBe('local-headless')

    // A real ask-tier turn on the watched conversation. FLOATING: it does not return until the
    // confirm resolves, and the confirm is what proves the gate took its ask arm.
    const turn = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    const raised = confirmRequestOf(
      await stream.waitFor((frame) => frame.event === 'confirm_request'),
    )
    expect(door.executionContext(sessionId)).toBe('local-interactive')

    expect((await postConfirm(door.origin, {
      sessionId,
      confirmId: raised.confirmId,
      answer: 'accept',
    })).status).toBe(200)
    const answered = await turn
    expect(answered.result.receipts[0]?.outcome).not.toBe('FunctionDeniedError')
    // THE ROW A PERSON READS: an ask that really was put in front of somebody, and answered.
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['prompted-approved'])

    await stream.close()
    const closed = Date.now()
    while (door.confirms.hasLiveChannel(sessionId) && Date.now() - closed < 5_000) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    expect(door.executionContext(sessionId)).toBe('local-headless')
  }, 30_000)

  it('denies an ask with no channel open, fail-closed and without hanging (D-05/D-06)', async () => {
    // THE TWO MECHANISMS COMPOSED. No stream is opened, so the context predicate answers
    // `local-headless`, so the gate never reaches its ask arm at all — and even if it did, the
    // registry would refuse to park a question for a session nobody is watching. The audit row is
    // what tells the two apart, and it must be the fail-closed one: a `prompted-denied` here would
    // mean the door claimed a prompt it never showed anybody.
    const door = await openDoor({ timeoutMs: 300 })
    const sessionId = await openSession(door.origin)
    expect(door.confirms.hasLiveChannel(sessionId)).toBe(false)

    const answered = await postTurn(door.origin, { message: ASK_UTTERANCE, sessionId })
    expect(answered.result.receipts[0]?.outcome).toBe('FunctionDeniedError')
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['fail-closed-denied'])
    expect(door.confirms.pendingCount()).toBe(0)
  })

  it('withholds every cross-origin grant on the answer route, including its preflight (T-400-03)', async () => {
    // THE ROUTE THIS CELL GUARDS IS A CLICK-YES-ON-SOMEBODY'S-BEHALF PRIMITIVE. It is inside the
    // `/api/chat/` prefix, which is mounted ahead of the shared `cors()` arm precisely so no page a
    // person has open can preflight it — 400-01 found that hole on the turn route and this route is
    // the same class, one step worse.
    const door = await openDoor()
    const preflight = await fetch(`${door.origin}/api/chat/confirm`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    const answered = await fetch(`${door.origin}/api/chat/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'chat-x', confirmId: 'confirm-x', answer: 'accept' }),
    })
    expect(answered.status).toBe(404)
    expect(answered.headers.get('access-control-allow-origin')).toBeNull()

    // And the door refuses bytes that are not the contract before it touches the registry.
    const malformed = await postConfirm(door.origin, { sessionId: 'chat-x', answer: 'maybe' })
    expect(malformed.status).toBe(400)
  })

  it('tags the session it opened with its own surface, on the header only (D-04)', async () => {
    const door = await openDoor()
    const sessionId = await openSession(door.origin)
    const path = join(door.configRoot, '.agent-qa', 'sessions', `${sessionId}.jsonl`)
    const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '')
    const header = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(header['surface']).toBe('dashboard')
    // AND NOWHERE ELSE: not one event line carries the tag, which is what keeps every pre-400
    // session file readable by this build.
    for (const line of lines.slice(1)) {
      expect(Object.keys(JSON.parse(line) as Record<string, unknown>)).not.toContain('surface')
    }
  })
})

// ---- The axis the shipped honesty cell held constant (400-13, gap 3 / D-05) ---------------------
//
// WHAT THE VERIFIER MEASURED, REPRODUCED AS A CELL. Every cell above varies ONE conversation: its
// stream, its turn, its confirm. The defect gap 3 names lives in the space between two — a stream
// open on conversation A made the whole PROCESS claim `local-interactive`, so conversation B, which
// nobody was watching, had its ask-tier denial written to the audit ledger as `prompted-denied`. A
// prompt nobody was shown. The sibling cell above (`denies an ask with no channel open`) says in
// its own words what that means: "a `prompted-denied` here would mean the door claimed a prompt it
// never showed anybody."
//
// THE ASSERTION IS THE AUDIT ROW'S OWN BYTES, not a predicate's return value — the row is what a
// person reads afterwards when they ask what this door did, and it is the artifact the sibling cell
// pins for the single-session shape of exactly this op.
//
// AND THE OTHER HALF OF THE SAME DEFECT: nothing may be asked in the WRONG transcript either, so
// A's held stream is read for confirm frames it must never have carried.

describe('a second conversation\'s stream cannot flip an unwatched conversation\'s posture', () => {
  it('writes fail-closed-denied on B while A holds an open, idle stream (gap 3, axis A)', async () => {
    // The window is short because a mutation that routes the confirm to A pays for it in wall
    // clock here — the timer is the only way that mutation's confirm ever resolves.
    const door = await openDoor({ timeoutMs: 300 })

    // Conversation A: minted by a real turn, then WATCHED — a stream held open, and idle.
    const sessionA = await openSession(door.origin)
    const streamA = await openStream(door.origin, sessionA)
    // The server decides when the channel is registered, so the cell waits on the server's own
    // answer rather than sleeping a number.
    const opened = Date.now()
    while (!door.confirms.liveSessionIds().includes(sessionA) && Date.now() - opened < 5_000) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    expect(door.confirms.liveSessionIds(), 'A is not watched, so this cell would be a second copy '
      + 'of the no-channel cell above').toEqual([sessionA])

    // Conversation B: minted by its own turn, and nobody is watching it.
    const sessionB = await openSession(door.origin)
    expect(sessionB, 'both turns landed in one conversation, so no axis is varied')
      .not.toBe(sessionA)

    // THE ASK-TIER OP, ON THE UNWATCHED CONVERSATION.
    const answered = await postTurn(door.origin, { message: ASK_UTTERANCE, sessionId: sessionB })
    expect(answered.result.receipts.map((receipt) => ({
      functionId: receipt.functionId,
      status: receipt.status,
      outcome: receipt.outcome,
    }))).toEqual([{
      functionId: 'knowledge.proposal.apply',
      status: 'failed',
      outcome: 'FunctionDeniedError',
    }])

    // THE WHOLE OF GAP 3, IN ONE STRING. `prompted-denied` here is the door claiming it showed
    // somebody a question; the only conversation with a watcher was never asked anything.
    expect(askRowsFor(door.configRoot).map((row) => row['outcome'])).toEqual(['fail-closed-denied'])

    // THE WRONG-TRANSCRIPT HALF. A settle window first, so a green cannot come from asserting in
    // the same tick the turn returned in: a confirm routed to A would already have been written to
    // A's socket by the time the turn resolved, but the reader is a separate task.
    const settleBy = Date.now() + 500
    while (
      Date.now() < settleBy
      && !streamA.frames.some((frame) => frame.event === 'confirm_request')
    ) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    expect(
      streamA.frames.filter((frame) => frame.event === 'confirm_request'),
      'B\'s question was put in front of the person watching A',
    ).toEqual([])

    expect(door.confirms.pendingCount()).toBe(0)
    await streamA.close()
  }, 20_000)
})

// ---- The `:id` this process never minted (400-13, gap 3 leg 2) ----------------------------------
//
// THE ROUTE IS THE POSTURE'S INPUT, so the route is where an unowned id has to be refused. The
// verifier reached `local-interactive` by opening a stream on `chat-verifier-probe-unowned` — a
// string, typed at a URL, that no session in this process ever minted — and the route registered a
// confirm channel for it without asking anything.
//
// REFUSED ON THE RESPONSE, NEVER BY SILENT ABSENCE. A cell that asserted only "no channel appeared"
// would pass against a route that had quietly stopped serving anybody; the 404 bytes are what tells
// the two apart, and the driven accepts-control beside it is what stops the fix from being
// "refuse everything".

describe('the turn-events route serves only sessions this process minted', () => {
  it('refuses an unminted :id with 404 before any channel opens, and serves a minted one (axis B)',
    async () => {
      const door = await openDoor()

      const refused = await fetch(
        `${door.origin}/api/chat/sessions/chat-400-13-never-minted/events`,
      )
      expect(refused.status).toBe(404)
      expect(await refused.json()).toEqual({ error: 'Not found' })
      // No channel, and therefore no posture input, was created by naming an id.
      expect(door.confirms.liveSessionIds()).toEqual([])

      // THE ACCEPTS-CONTROL, DRIVEN: a session a real turn minted streams normally — 200, the
      // `:ok` prelude, and that turn's own events replayed.
      const sessionId = await openSession(door.origin)
      const controller = new AbortController()
      const reaper = setTimeout(() => { controller.abort() }, 8_000)
      let served = ''
      try {
        const accepted = await fetch(
          `${door.origin}/api/chat/sessions/${sessionId}/events`,
          { signal: controller.signal },
        )
        expect(accepted.status).toBe(200)
        expect(accepted.headers.get('content-type')).toBe('text/event-stream')
        const reader = accepted.body!.getReader()
        const decoder = new TextDecoder()
        while (!served.includes('event: turn_complete')) {
          const chunk = await reader.read()
          if (chunk.done) break
          served += decoder.decode(chunk.value, { stream: true })
        }
      } finally {
        clearTimeout(reaper)
        controller.abort()
      }
      expect(served.startsWith(':ok\n\n'), `the served stream carried no prelude: ${served.slice(0, 40)}`)
        .toBe(true)
      expect(served, 'the minted session replayed none of its own turn').toContain('event: turn_complete')
    }, 20_000)
})

// ---- The dual-host lease differential (Phase 400 plan 03 task 3, RESEARCH A3) -----------------
//
// WHAT IS BEING MEASURED, AND WHY IT IS NOT ALREADY KNOWN. CONTEXT's D-01 asserts that "the 386
// lease machinery arbitrates writer conflicts between hosts (the dual-host proof extends to this
// pair)". That is an assertion about a pair nothing had ever run: the earlier proof was taken over
// a daemon and a CLI, and this phase puts a SECOND interactive host — one that mints standing
// grants from a browser click — beside the CLI chat door on the same workspace. RESEARCH A3 names
// the cost of the assertion being wrong: two interactive hosts appending to one committed ledger,
// corrupting it. So the pair is driven rather than trusted.
//
// THE CONTENDED ARTIFACT IS THE STANDING-GRANT LEDGER, reached through each host's OWN
// `recordStandingApproval` binding — the closure `composeLocalAgent` hands its surface, which is
// the only route either door has to a grant. Neither side writes a ledger line itself, which is
// D-07's rule and also what makes this a test of the machinery rather than of two callers.
//
// THE VOCABULARY IS IMPORTED, NEVER TYPED HERE. `GrantRecordOutcomeSchema` validates the outcome
// shape, `foldActiveGrants` over `readGrantLedger` is the machinery's own reading of its own file,
// and the refusal is asserted as `instanceof GrantLeaseHeldError`. A hand-written status string
// would be this cell's idea of an arbitration contract.

import {
  GrantLeaseHeldError,
  acquireWriterLease,
  foldActiveGrants,
  readGrantLedger,
  releaseLease,
} from '@vostride/agent-qa-knowledge-local'
import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import { GrantRecordOutcomeSchema, type GrantRecordOutcome } from '@vostride/agent-qa-schema'

import { resolveConfig } from '../config.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'

/** The two hosts' shared knowledge root, resolved the way the composition resolves it. */
async function knowledgeRootFor(configPath: string): Promise<string> {
  const config = await resolveConfig({ configPath, loadAuthPlugins: false })
  return resolveKnowledgeRoot(config.knowledge, dirname(resolve(configPath)))
}

/** One CLI-chat-shaped host over an existing workspace, with its confirm bindings captured. */
function composeCliShapedHost(configRoot: string): {
  readonly host: LocalAgentHost
  readonly recordStandingApproval: (actionClass: string) => Promise<unknown>
} {
  const configPath = join(configRoot, 'agent-qa.config.yaml')
  let captured:
    | { recordStandingApproval: (actionClass: string) => Promise<unknown> }
    | undefined
  // `chatConfirm` is the seam a SURFACE is handed its bindings through — the TTY wrapper is handed
  // exactly these — and returning `undefined` binds no confirm port, which is what a CLI with no
  // terminal does. Nothing here constructs a grants port: the binding is the composition's own.
  const host = composeCliLocalAgent({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    chatConfirm: (bindings) => {
      captured = bindings
      return undefined
    },
  })
  if (captured === undefined) {
    throw new TypeError('the CLI-shaped host bound no confirm bindings')
  }
  const bindings = captured
  return { host, recordStandingApproval: (cls) => bindings.recordStandingApproval(cls) }
}

/** Every active standing grant for one class, as the machinery reads its own committed file. */
function activeGrantsFor(knowledgeRoot: string, actionClass: string): readonly { grantId: string }[] {
  const ledger = readGrantLedger(knowledgeRoot)
  expect(ledger.refusedLines, 'the contended ledger carries a line its own reader cannot read')
    .toEqual([])
  return foldActiveGrants(ledger.events).filter((grant) => grant.actionClass === actionClass)
}

/**
 * The two mint outcomes this cell names, TYPED AGAINST THE SHIPPED UNION.
 *
 * The criterion is that no arbitration status is hand-typed here, and this is what honouring it
 * mechanically looks like: the annotation makes a misspelling — or a member the schema renames — a
 * compile error at this line rather than a cell that quietly stops matching anything. Every
 * load-bearing assertion below is additionally vocabulary-free: a grant ID identity, a line count,
 * and an error CLASS imported from the module that throws it.
 */
const RECORDED: GrantRecordOutcome['kind'] = 'recorded'
const ALREADY_GRANTED: GrantRecordOutcome['kind'] = 'already-granted'

describe('two interactive hosts on one workspace', () => {
  it('dual-host: the lease arbitrates contending standing-grant writes (A3)', async () => {
    // ---- Arm 1: ORDERED — the dashboard mints, and the CLI host folds ITS committed line ------
    //
    // The strongest of the three, because both hosts' outcomes are observable. The dashboard's
    // write goes the whole shipped way (a person clicks "always" in a browser); the CLI host's
    // binding is then called and MUST come back `already-granted` naming the dashboard's own grant
    // id. That single assertion is what a one-host cell cannot fake: with no dashboard write there
    // is nothing to already-grant, and with a write to some other class there is no shared id.
    const doorA = await openDoor({ timeoutMs: 60_000 })
    const cliA = composeCliShapedHost(doorA.configRoot)
    try {
      const knowledgeRootA = await knowledgeRootFor(join(doorA.configRoot, 'agent-qa.config.yaml'))
      const sessionA = await openSession(doorA.origin)
      const streamA = await openStream(doorA.origin, sessionA)
      const turnA = postTurn(doorA.origin, { message: ASK_UTTERANCE, sessionId: sessionA })
      const raisedA = confirmRequestOf(
        await streamA.waitFor((frame) => frame.event === 'confirm_request'),
      )
      expect((await postConfirm(doorA.origin, {
        sessionId: sessionA,
        confirmId: raisedA.confirmId,
        answer: 'accept-always',
      })).status).toBe(200)
      await turnA
      await streamA.close()

      const dashboardGrants = activeGrantsFor(knowledgeRootA, ASK_ACTION_CLASS)
      expect(dashboardGrants, 'the dashboard host minted no grant, so the CLI host below would be '
        + 'the only writer and this cell would measure one host').toHaveLength(1)

      const cliOutcome = GrantRecordOutcomeSchema.parse(
        await cliA.recordStandingApproval(ASK_ACTION_CLASS),
      )
      // ONE ARBITRATED STATE, TWO HOSTS. `already-granted` is the machinery's no-accretion arm, and
      // reaching it means this host's read-fold-decide cycle saw a line the OTHER host committed.
      expect(cliOutcome.kind).toBe(ALREADY_GRANTED)
      if (cliOutcome.kind !== 'already-granted') throw new TypeError('unreachable')
      expect(cliOutcome.grant.grantId).toBe(dashboardGrants[0]!.grantId)
      expect(activeGrantsFor(knowledgeRootA, ASK_ACTION_CLASS)).toHaveLength(1)
    } finally {
      await cliA.host.close()
    }

    // ---- Arm 2: CONCURRENT — both writes on one class, issued in the same tick ---------------
    //
    // A FRESH WORKSPACE, because arm 1's class is now granted and a second ask would be satisfied
    // by the standing approval without ever raising a confirm. Neither write is ordered by this
    // cell: both are issued before either is awaited. The outcome that discriminates is the grant
    // ID — whichever host lost, the id it reports is the one on the file, so a write that went to
    // a different class or never happened cannot satisfy it.
    const doorB = await openDoor({ timeoutMs: 60_000 })
    const cliB = composeCliShapedHost(doorB.configRoot)
    try {
      const knowledgeRootB = await knowledgeRootFor(join(doorB.configRoot, 'agent-qa.config.yaml'))
      const sessionB = await openSession(doorB.origin)
      const streamB = await openStream(doorB.origin, sessionB)
      const turnB = postTurn(doorB.origin, { message: ASK_UTTERANCE, sessionId: sessionB })
      const raisedB = confirmRequestOf(
        await streamB.waitFor((frame) => frame.event === 'confirm_request'),
      )

      const cliWrite = cliB.recordStandingApproval(ASK_ACTION_CLASS)
      const dashboardAnswer = postConfirm(doorB.origin, {
        sessionId: sessionB,
        confirmId: raisedB.confirmId,
        answer: 'accept-always',
      })
      const [contended, answered] = await Promise.all([cliWrite, dashboardAnswer, turnB])
      expect(answered.status).toBe(200)
      await streamB.close()

      const contendedOutcome = GrantRecordOutcomeSchema.parse(contended)
      const active = activeGrantsFor(knowledgeRootB, ASK_ACTION_CLASS)
      // NO ACCRETION UNDER CONTENTION. Two lines here is the A3 defect by name: two revokes needed
      // to undo one approval, and the second is the one nobody remembers to issue.
      expect(active).toHaveLength(1)
      const contendedGrantId = contendedOutcome.kind === RECORDED
        ? contendedOutcome.grant.grantId
        : contendedOutcome.kind === ALREADY_GRANTED
          ? contendedOutcome.grant.grantId
          : undefined
      expect(contendedGrantId, 'the CLI host\'s contending write named no grant at all')
        .toBe(active[0]!.grantId)
      // The dashboard's half landed too: the session log records the EFFECT of an answer (392-05),
      // so this line exists only where a standing approval is actually in force.
      expect(
        loggedEvents(doorB.configRoot, sessionB)
          .filter((event) => event['kind'] === 'approval_decision')
          .map((event) => event['decision']),
      ).toEqual(['accept-always'])

      // ---- Arm 3: the HELD arm, in the lease's own vocabulary --------------------------------
      //
      // Neither arm above can reach `held`: the acquire/decide/release cycle has no await point, so
      // two writers in one event loop always serialize rather than collide. The lease is therefore
      // OCCUPIED here through the machinery's own primitive — which is what the other host's
      // process holds while it is mid-write — and a real host is driven against it.
      const occupied = acquireWriterLease(knowledgeRootB)
      expect(occupied.kind, 'the lease was not free, so this arm would measure the wrong refusal')
        .toBe('acquired')
      if (occupied.kind !== 'acquired') throw new TypeError('unreachable')
      let refusal: unknown
      try {
        await cliB.recordStandingApproval(CONTROL_ACTION_CLASS)
      } catch (error) {
        refusal = error
      } finally {
        releaseLease({ knowledgeRoot: knowledgeRootB, leaseId: occupied.leaseId })
      }
      // THE TYPE IS THE ASSERTION. `GrantLeaseHeldError` is the refusal the grant verbs' own
      // `onLeaseHeld` factory mints, naming the committed artifact the caller was refused on.
      expect(refusal).toBeInstanceOf(GrantLeaseHeldError)
      expect(activeGrantsFor(knowledgeRootB, CONTROL_ACTION_CLASS), 'the refused write landed a '
        + 'line anyway').toEqual([])

      // THE ACCEPT DIRECTION, so the refusal is a fact about contention and not about this host:
      // with the lease released, the same write through the same binding proceeds.
      const afterRelease = GrantRecordOutcomeSchema.parse(
        await cliB.recordStandingApproval(CONTROL_ACTION_CLASS),
      )
      expect(afterRelease.kind).toBe(RECORDED)
    } finally {
      await cliB.host.close()
    }
  }, 60_000)
})
