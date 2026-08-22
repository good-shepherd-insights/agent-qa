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

// ---- BOTH axes at once: A watched AND in flight, while B asks (400-15, gap 3 round 2) ----------
//
// THE AXIS THE ROUND-1 CONTROL HELD CONSTANT. The cell above holds conversation A watched but
// IDLE, and B fails closed for a reason that has nothing to do with who else is watching: B's OWN
// conversation has no live channel, which is the question the door asks of every asker (400-17).
// Cross it — A watched AND with a turn in flight — and the round-1
// composition answered `local-interactive` for the WHOLE PROCESS: B's ask reached the gate's ask
// arm, `resolveTargetSession()` named A because A was the sole watched-and-in-flight conversation,
// B's question was written to A's socket, and B's audit row read `prompted-denied`. Had A's reader
// clicked accept on that second bubble, B's ask-tier op would have EXECUTED.
//
// THREE CELLS OVER ONE SCENE, AND THE SPLIT IS THE POINT. 400-13 measured an earlier assertion
// masking a later one under mutation: a cell aborts at its first red, so a second assertion behind
// it can only be REASONED about, never observed. The two halves of this fix fail independently —
// reverting the posture reds the audit row while the confirm target still holds, and reverting the
// target as well reds the transcript — so each half is asserted in its OWN named cell, and each
// cell's green is a thing that ran.
//
// EVERY CELL CARRIES THE ACCEPTS-CONTROL. A fix that answered `local-headless` everywhere, or a
// confirm port that refused everybody, would satisfy all three assertions above; so each cell then
// answers A's own outstanding question and requires A's turn to EXECUTE.

/** A's confirm must outlive the scene; a mutation that routes B's question to A pays this in wall clock. */
const DUAL_AXIS_CONFIRM_MS = 8_000

interface DualAxisScene {
  readonly sessionA: string
  readonly sessionB: string
  readonly streamA: LiveStream
  readonly confirmA: { readonly confirmId: string; readonly actionClass: string }
  readonly turnA: Promise<ChatTurnResponse>
  readonly answeredB: ChatTurnResponse
  readonly askRowsBefore: number
}

/**
 * The scene, driven — no assertion about the fix, only the setup and the facts that make it real.
 *
 * ORDER MATTERS AND IS ASSERTED AT EACH STEP: B is minted BEFORE A goes in flight (so B's own
 * session exists and the `:id` guard is not what refuses it), A's stream is registered by the
 * SERVER's own answer rather than a sleep, and A's confirm is on the wire before B is driven — an
 * "in flight" that had not yet reached the gate would make every cell below trivially green.
 */
async function driveDualAxis(door: DoorFixture): Promise<DualAxisScene> {
  const sessionA = await openSession(door.origin)
  const sessionB = await openSession(door.origin)
  expect(sessionB, 'both turns landed in one conversation, so no axis is varied').not.toBe(sessionA)

  const streamA = await openStream(door.origin, sessionA)
  const opened = Date.now()
  while (!door.confirms.liveSessionIds().includes(sessionA) && Date.now() - opened < 5_000) {
    await new Promise<void>((settled) => setTimeout(settled, 10))
  }
  expect(door.confirms.liveSessionIds(), 'A is not watched, or B is — either way this scene is not '
    + 'the one the defect lives in').toEqual([sessionA])

  // AXIS TWO. Floating deliberately: the turn does not return until its own confirm resolves, and
  // that outstanding confirm IS what "in flight" means to the door's per-asker
  // `watchedAndInFlight` predicate — a live channel on this conversation AND a turn active on it.
  const turnA = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId: sessionA })
  const confirmA = confirmRequestOf(
    await streamA.waitFor((frame) => frame.event === 'confirm_request'),
  )
  expect(
    streamA.frames.filter((frame) => frame.event === 'confirm_request'),
    'A holds something other than exactly its own one question, so the counts below measure nothing',
  ).toHaveLength(1)

  // THE MARK B'S ROWS ARE COUNTED FROM. Under the fix B fails closed the instant it is gated, so
  // A's confirm is still outstanding and the slice below is exactly B's one row. MEASURED AT HEAD,
  // the slice held TWO rows: B's question was parked on A's socket, so B's turn did not return
  // until B's confirm timed out — by which time A's had too, and both had written
  // `prompted-denied`. The mark is therefore taken rather than assumed, and the slice is read for
  // what is in it rather than for a row count somebody predicted.
  const askRowsBefore = askRowsFor(door.configRoot).length
  const answeredB = await postTurn(door.origin, { message: ASK_UTTERANCE, sessionId: sessionB })
  return { sessionA, sessionB, streamA, confirmA, turnA, answeredB, askRowsBefore }
}

/**
 * The embedded accepts-control: A asked, A is watched, A says yes — and A's op RUNS.
 *
 * Without this every cell in this block is satisfiable by a door that refuses everybody, which is
 * the overshoot a "make it fail closed" fix is one line away from.
 */
async function settleAcceptsControl(door: DoorFixture, scene: DualAxisScene): Promise<void> {
  expect((await postConfirm(door.origin, {
    sessionId: scene.sessionA,
    confirmId: scene.confirmA.confirmId,
    answer: 'accept',
  })).status).toBe(200)
  const answeredA = await scene.turnA
  expect(
    answeredA.result.receipts[0]?.outcome,
    'the watched conversation that asked its own question and answered yes was refused anyway',
  ).not.toBe('FunctionDeniedError')
  await scene.streamA.close()
}

describe('a watched, in-flight conversation cannot lend its reachability to another', () => {
  it('writes fail-closed-denied on the unwatched asker while A is watched AND in flight (dual axis, row)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveDualAxis(door)

      expect(scene.answeredB.result.receipts.map((receipt) => ({
        functionId: receipt.functionId,
        status: receipt.status,
        outcome: receipt.outcome,
      }))).toEqual([{
        functionId: 'knowledge.proposal.apply',
        status: 'failed',
        outcome: 'FunctionDeniedError',
      }])

      // THE ROW A PERSON READS AFTERWARDS. `prompted-denied` here is the door recording that it put
      // a question in front of somebody on B's behalf; nobody was watching B, and the person who
      // WAS watching never agreed to answer for them.
      expect(
        askRowsFor(door.configRoot).slice(scene.askRowsBefore).map((row) => row['outcome']),
        'the unwatched asker\'s denial was recorded as a prompt somebody was shown',
      ).toEqual(['fail-closed-denied'])

      await settleAcceptsControl(door, scene)
    }, 40_000)

  it('leaves the watched transcript carrying exactly its own one question (dual axis, transcript)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveDualAxis(door)

      // A SETTLE WINDOW FIRST, so a green cannot come from asserting in the tick B's turn returned
      // in: a confirm routed to A is written to A's socket before B's turn resolves, but the reader
      // that parses it is a separate task.
      const settleBy = Date.now() + 500
      const confirmFrames = (): readonly SseFrame[] =>
        scene.streamA.frames.filter((frame) => frame.event === 'confirm_request')
      while (Date.now() < settleBy && confirmFrames().length < 2) {
        await new Promise<void>((settled) => setTimeout(settled, 10))
      }

      // THE ID LIST, NOT A COUNT. A's own question is named, so a second bubble carrying a
      // different `confirmId` — the shape the verifier measured — is what this reds on.
      expect(
        confirmFrames().map((frame) => confirmRequestOf(frame).confirmId),
        'B\'s question was put in front of the person watching A',
      ).toEqual([scene.confirmA.confirmId])

      await settleAcceptsControl(door, scene)
    }, 40_000)

  it('publishes local-headless for the unwatched asker while A is watched AND in flight (dual axis, posture)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveDualAxis(door)

      // PRODUCTION'S OWN RULE, ASKED ABOUT A NAMED CONVERSATION — not a second copy of it written
      // here. This is the structural corroboration of the audit row above: the row is the
      // consequence, and this is the claim that produced it.
      expect(
        door.executionContext(scene.sessionB),
        'the door claims a person is reachable on a conversation nobody has open',
      ).toBe('local-headless')
      expect(
        door.executionContext(scene.sessionA),
        'the posture collapsed to headless everywhere, which closes this gap by breaking the door',
      ).toBe('local-interactive')

      await settleAcceptsControl(door, scene)
    }, 40_000)
})

// ---- WATCHED × WATCHED: two conversations, each watched AND in flight (400-17, gap round 3) -----
//
// THE AXIS EVERY PRIOR CONTROL HELD CONSTANT. The round-13 cell holds A watched but IDLE; the
// round-15 driver pins `liveSessionIds()` to `[sessionA]` — exactly ONE live channel — so in both
// of them B is unwatched, and B's fail-closed denial is the honest answer. This scene holds TWO
// live channels, both in flight, which is the scene 400-UAT.md Test 2 measured: B's own reader is
// watching B, B asks on B's own conversation, and B is entitled to its own bubble in its own
// transcript. D-05's honesty shape is one-directional — an UNWATCHED asker still denies fail-closed
// — and the cells above that assert it stay untouched and true.
//
// THREE CELLS OVER ONE SCENE, on 400-15's lesson: a cell aborts at its first red, so every
// independently-failable claim gets its OWN named cell and every "stays green" is a thing that ran.
//
// EVERY CELL CARRIES THE INDEPENDENCE TAIL. B is answered FIRST and A's question must still be
// parked (`pendingCount()` = 1) — answering B consumed nothing of A's — and then BOTH ops must
// EXECUTE. A door that widened the posture by refusing everybody, or one that let one answer settle
// both conversations, satisfies none of it.

interface WatchedPairScene {
  readonly sessionA: string
  readonly sessionB: string
  readonly streamA: LiveStream
  readonly streamB: LiveStream
  readonly confirmA: { readonly confirmId: string; readonly actionClass: string }
  readonly turnA: Promise<ChatTurnResponse>
  readonly turnB: Promise<ChatTurnResponse>
  readonly askRowsBefore: number
}

/** Wait on the SERVER's own answer that a channel is registered, never on a sleep. */
async function awaitLiveChannel(door: DoorFixture, sessionId: string): Promise<void> {
  const opened = Date.now()
  while (!door.confirms.hasLiveChannel(sessionId) && Date.now() - opened < 5_000) {
    await new Promise<void>((settled) => setTimeout(settled, 10))
  }
}

/**
 * The scene, driven — setup and the facts that make it real, no assertion about the fix.
 *
 * ORDER IS ASSERTED AT EACH STEP: both conversations are minted, BOTH hold their own live channel
 * before either ask is driven, and A's confirm is on the wire before B is driven — an "in flight"
 * that had not yet reached the gate would make every cell below trivially green.
 */
async function driveWatchedPair(door: DoorFixture): Promise<WatchedPairScene> {
  const sessionA = await openSession(door.origin)
  const sessionB = await openSession(door.origin)
  expect(sessionB, 'both turns landed in one conversation, so no axis is varied').not.toBe(sessionA)

  const streamA = await openStream(door.origin, sessionA)
  await awaitLiveChannel(door, sessionA)
  const streamB = await openStream(door.origin, sessionB)
  await awaitLiveChannel(door, sessionB)
  // THE CROSSED AXIS, NAMED. `driveDualAxis` pins this same list to `[sessionA]`; a scene that did
  // not hold TWO live channels would re-measure round 2 rather than the gap this block exists for.
  expect(
    [...door.confirms.liveSessionIds()].sort(),
    'both conversations must be watched at once — the sibling dual-axis driver pins this list to '
    + '[sessionA], and that is the axis this scene crosses',
  ).toEqual([sessionA, sessionB].sort())

  // AXIS TWO, ON A. Floating deliberately: the turn does not return until its own confirm resolves,
  // and that outstanding confirm is what puts A in flight.
  const turnA = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId: sessionA })
  const confirmA = confirmRequestOf(
    await streamA.waitFor((frame) => frame.event === 'confirm_request'),
  )
  expect(
    streamA.frames.filter((frame) => frame.event === 'confirm_request'),
    'A holds something other than exactly its own one question, so the counts below measure nothing',
  ).toHaveLength(1)

  // THE MARK B'S ROWS ARE COUNTED FROM, taken rather than assumed (400-15's own lesson).
  const askRowsBefore = askRowsFor(door.configRoot).length
  // AXIS TWO, ON B — and NOT awaited here: under the shipped rule it floats until B's own confirm
  // is answered; at HEAD it resolves denied on its own.
  const turnB = postTurn(door.origin, { message: ASK_UTTERANCE, sessionId: sessionB })
  return { sessionA, sessionB, streamA, streamB, confirmA, turnA, turnB, askRowsBefore }
}

/**
 * The independence tail: each conversation approves only its OWN op, and both ops RUN.
 *
 * B IS ANSWERED FIRST AND A MUST STILL BE PARKED. That ordering is what makes the two questions
 * measurably separate rather than one question two readers can see, and the accepts half is what
 * stops a "make it fail closed" overshoot from satisfying every assertion above.
 */
async function settleWatchedPair(
  door: DoorFixture,
  scene: WatchedPairScene,
  confirmBId: string,
): Promise<void> {
  expect((await postConfirm(door.origin, {
    sessionId: scene.sessionB,
    confirmId: confirmBId,
    answer: 'accept',
  })).status).toBe(200)
  expect(
    door.confirms.pendingCount(),
    'answering B settled something of A\'s — the two conversations are not independent',
  ).toBe(1)
  const answeredB = await scene.turnB
  expect(
    answeredB.result.receipts[0]?.outcome,
    'B asked on B\'s own watched conversation and answered yes, and was refused anyway',
  ).not.toBe('FunctionDeniedError')

  expect((await postConfirm(door.origin, {
    sessionId: scene.sessionA,
    confirmId: scene.confirmA.confirmId,
    answer: 'accept',
  })).status).toBe(200)
  const answeredA = await scene.turnA
  expect(
    answeredA.result.receipts[0]?.outcome,
    'the watched conversation that asked its own question and answered yes was refused anyway',
  ).not.toBe('FunctionDeniedError')

  await scene.streamA.close()
  await scene.streamB.close()
}

describe('two watched, in-flight conversations are each interactive for themselves', () => {
  it('raises B\'s own confirm and records a prompt on BOTH askers\' rows (watched pair, rows)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveWatchedPair(door)

      // B'S OWN BUBBLE, ON B'S OWN STREAM. A distinct `confirmId` is the two-sided half: B was not
      // handed A's question, and A's was not silently reused.
      const confirmB = confirmRequestOf(
        await scene.streamB.waitFor((frame) => frame.event === 'confirm_request'),
      )
      expect(confirmB.confirmId, 'B\'s stream carried a confirm frame with no id').toBeTruthy()
      expect(
        confirmB.confirmId,
        'B was shown A\'s question rather than its own',
      ).not.toBe(scene.confirmA.confirmId)

      await settleWatchedPair(door, scene, confirmB.confirmId)

      // THE ROWS A PERSON READS. B answered first, then A — deterministic because the tail awaits
      // between. `fail-closed-denied` on either row is the door refusing an asker whose own reader
      // was watching it.
      expect(
        askRowsFor(door.configRoot).slice(scene.askRowsBefore).map((row) => row['outcome']),
        'a watched asker\'s op was refused, or its approval was never recorded as one',
      ).toEqual(['prompted-approved', 'prompted-approved'])
    }, 40_000)

  it('leaves each transcript carrying exactly its own one question (watched pair, transcript)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveWatchedPair(door)

      const confirmFramesOf = (stream: LiveStream): readonly SseFrame[] =>
        stream.frames.filter((frame) => frame.event === 'confirm_request')
      // A SETTLE WINDOW FIRST, so a green cannot come from asserting in the tick a turn returned
      // in: a confirm routed to the wrong socket is written before the turn resolves, but the
      // reader that parses it is a separate task.
      const settleBy = Date.now() + 500
      while (
        Date.now() < settleBy
        && confirmFramesOf(scene.streamA).length < 2
        && confirmFramesOf(scene.streamB).length < 1
      ) {
        await new Promise<void>((settled) => setTimeout(settled, 10))
      }

      // THE A-SIDE FIRST: the id list in front of A's reader, named. A second bubble here is B's
      // question shown to A — what a widened approval target produces, and what a frame COUNT
      // could never distinguish from B's own bubble arriving.
      expect(
        confirmFramesOf(scene.streamA).map((frame) => confirmRequestOf(frame).confirmId),
        'a second conversation\'s question was put in front of the person watching A',
      ).toEqual([scene.confirmA.confirmId])

      // THE B-SIDE: B's reader is watching B, so B's own question belongs on B's own socket.
      await scene.streamB.waitFor((frame) => frame.event === 'confirm_request')
      const framesB = confirmFramesOf(scene.streamB)
      expect(
        framesB,
        'B\'s reader was watching B and saw something other than exactly one question',
      ).toHaveLength(1)
      const confirmB = confirmRequestOf(framesB[0]!)
      expect(
        confirmB.confirmId,
        'B\'s transcript carried A\'s question rather than B\'s own',
      ).not.toBe(scene.confirmA.confirmId)

      await settleWatchedPair(door, scene, confirmB.confirmId)
    }, 40_000)

  it('publishes local-interactive for BOTH watched, in-flight askers (watched pair, posture)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveWatchedPair(door)

      // B'S CONFIRM IS TAKEN FIRST — the proof B really is gated interactive and in flight at the
      // instant the postures below are read, rather than a claim read in some other moment.
      const confirmB = confirmRequestOf(
        await scene.streamB.waitFor((frame) => frame.event === 'confirm_request'),
      )

      // PRODUCTION'S OWN RULE, ASKED ABOUT EACH NAMED CONVERSATION, at the same instant.
      expect(
        door.executionContext(scene.sessionA),
        'A is watched and in flight and the door will not claim it can reach A',
      ).toBe('local-interactive')
      expect(
        door.executionContext(scene.sessionB),
        'B is watched and in flight, and the door still answers for B as if nobody were there',
      ).toBe('local-interactive')

      await settleWatchedPair(door, scene, confirmB.confirmId)
    }, 40_000)

  // ---- NEW-AUDIT-01: the approval a person gave, in the transcript they gave it in (401-01, D-13)
  //
  // THE ONLY INSTRUMENT THAT CAN SEE THE DEFECT. Every other cell pinning `approval_decision` is
  // single-conversation, and the writer drops the row only when MORE THAN ONE turn is in flight —
  // so a one-conversation cell is green under both the defect and its fix. This one drives the
  // shipped watched-pair scene above (the same `driveWatchedPair`/`settleWatchedPair` the three
  // cells beside it use, deliberately: a bespoke reconstruction would be measuring a scene nobody
  // ships).
  //
  // THE AUDIT ROWS ARE ASSERTED FIRST, AND THAT ORDER IS THE WHOLE OF THE RED-FOR-THE-RIGHT-REASON
  // claim. `execution_audit.jsonl` is a DIFFERENT mechanism (`gate.ts`) and it keeps its
  // `prompted-approved` pair either way, so a red on the audit line would mean the scene never ran;
  // a red on the transcript line below it means the scene ran and only the conversation record is
  // missing. That is the defect, and nothing else produces that pattern.
  //
  // A IS THE WITHIN-CELL CONTROL. `settleWatchedPair` answers B FIRST, while A's turn is still in
  // flight (two in flight ⇒ B's row dropped), and answers A second, after B's turn has returned
  // (one in flight ⇒ A's row written). So on the pre-fix build A passes and B fails in the same
  // run: the writer is reached, it works, and it discards exactly the row whose conversation had
  // company.
  it('records each conversation\'s own approval in its own transcript (watched pair, decision row)',
    async () => {
      const door = await openDoor({ timeoutMs: DUAL_AXIS_CONFIRM_MS })
      const scene = await driveWatchedPair(door)

      const confirmB = confirmRequestOf(
        await scene.streamB.waitFor((frame) => frame.event === 'confirm_request'),
      )
      await settleWatchedPair(door, scene, confirmB.confirmId)

      // THE RUN HAPPENED. Both askers were prompted and both said yes — the gate's own record,
      // written by a mechanism this fix does not touch.
      expect(
        askRowsFor(door.configRoot).slice(scene.askRowsBefore).map((row) => row['outcome']),
        'the scene did not reach two prompted approvals, so the transcript claim below measures '
        + 'nothing',
      ).toEqual(['prompted-approved', 'prompted-approved'])

      const decisionsIn = (sessionId: string): readonly Record<string, unknown>[] =>
        loggedEvents(door.configRoot, sessionId)
          .filter((event) => event['kind'] === 'approval_decision')

      // THE CONTROL SIDE, and it is a real one: A is answered when nothing else is in flight, so
      // this row is written by the pre-fix writer too. A fix that stopped writing rows entirely
      // fails here.
      expect(
        decisionsIn(scene.sessionA).map((event) => event['decision']),
        'A approved in A\'s own conversation and A\'s transcript has no record of it',
      ).toEqual(['accept'])

      // THE DEFECT. B answered its OWN question, on its OWN watched conversation, and the row is
      // dropped because a second conversation happened to have a turn in flight.
      expect(
        decisionsIn(scene.sessionB).map((event) => event['decision']),
        'B approved in B\'s own conversation and B\'s transcript has no record of it — the '
        + 'approval_decision row was dropped because another conversation had a turn in flight',
      ).toEqual(['accept'])
    }, 40_000)
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
