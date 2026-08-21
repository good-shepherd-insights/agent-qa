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

import { createChatRouter, type ChatTurnResponse } from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  composeDashboardDoor,
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
  const server = createServer(createChatRouter(agentHost))
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new TypeError('the door bound no port')
  }
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  return { origin: boundOrigin, configRoot, host, server }
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
