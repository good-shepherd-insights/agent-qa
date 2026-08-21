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

import {
  composeDashboardDoor,
  dashboardExecutionContext,
} from '../commands/dashboard.js'

/** A well-formed proposal id that names nothing — the gate is reached, the apply then finds none. */
const ABSENT_PROPOSAL = 'prop_400-03-absent'

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
  readonly executionContext: () => string
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
  // THE SHIPPED RESOLVER, not a constant written here: `dashboardExecutionContext` is the function
  // the command binds, so the honesty cell measures production's own predicate.
  const executionContext = dashboardExecutionContext(confirms)
  const { host, agentHost } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    resolveExecutionContext: executionContext,
    confirms,
  })
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
    const raised = confirmRequestOf(await stream.waitFor((frame) => frame.event === 'confirm_request'))
    expect(raised.actionClass).toBe(ASK_ACTION_CLASS)
    expect(raised.confirmId).toBeTruthy()

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

  it('is local-interactive only while a confirm channel can reach a human (D-05)', async () => {
    const door = await openDoor()
    // NO CHANNEL, NO CLAIM. A dashboard process with nobody watching is exactly as headless as a
    // piped CLI, and saying otherwise is the dishonesty this seam exists to prevent.
    expect(door.executionContext()).toBe('local-headless')

    const sessionId = await openSession(door.origin)
    const stream = await openStream(door.origin, sessionId)
    // The server decides when the channel is registered, so the cell waits on the server's own
    // answer rather than sleeping a number.
    const opened = Date.now()
    while (!door.confirms.hasLiveChannel() && Date.now() - opened < 5_000) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    expect(door.executionContext()).toBe('local-interactive')

    await stream.close()
    const closed = Date.now()
    while (door.confirms.hasLiveChannel() && Date.now() - closed < 5_000) {
      await new Promise<void>((settled) => setTimeout(settled, 10))
    }
    expect(door.executionContext()).toBe('local-headless')
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
