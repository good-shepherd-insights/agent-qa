// The prose a BROWSER reader is handed when the gate refuses (Phase 400 gap round 1, D-15 / #191).
//
// WHY A DRIVEN CELL AND NOT A UNIT TEST OF THE GATE. `gate-remedies.test.ts` already asserts that
// `evaluate()` mints a surface-neutral reason. That is the producer. The finding was never about
// the producer: it was about what arrives at the far end of six hops — gate decision, thrown
// `FunctionDeniedError`, turn-engine `denials[]`, `AgentAskResultSchema`, the HTTP body, the
// browser's render. A required field added at one end and dropped at any of the others is exactly
// the one-sided contract this repo has paid for twice, and the only measurement that can see it is
// one that drives the whole path. So these cells post real bytes over a real socket to the shipped
// `composeDashboardDoor` + `createChatRouter`, and read the response a browser would read.
//
// BOTH CHANNELS ARE ASSERTED IN THE SAME CELL, on the two-sided-contract law's own argument. A cell
// that checked only `neutralReason` would stay green the day someone "fixed" the flag out of the
// canonical sentence — which would trip a published 399 acceptance pin on its way past, and this
// suite would have had nothing to say about it. A cell that checked only `reason` is the state
// before this plan. The claim is that BOTH exist and they DIFFER on the arms where the canonical
// sentence names an affordance a browser cannot take.
//
// A NEW FILE RATHER THAN A CELL IN `dashboard-chat-door.test.ts`: that file was being edited by a
// sibling plan in the same wave, and a driven denial arm is its own fixture posture anyway — the
// fail-closed cell composes the door with a HEADLESS execution context, which the door cell's
// shared `beforeAll` fixture deliberately does not.
//
// MODEL-FREE, and the execution context is INJECTED through the composition rather than pinned on
// the process — `setActiveExecutionContextResolver` is the global whose forgotten restore leaks a
// posture into every sibling cell.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { createChatRouter, type ChatTurnResponse } from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import type { ExecutionContext } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

/**
 * The CLI affordance the canonical sentence names, and the whole of the finding in one literal.
 *
 * It is declared on `agent-qa run` and on no other command — the 399 acceptance harness asserts
 * that number is one — so a browser reader handed these bytes has been told to do something their
 * surface cannot do.
 */
const CLI_FLAG = '--trust-session'

/** A well-formed proposal id that names nothing: the GATE is reached, the apply then finds none. */
const ABSENT_PROPOSAL = 'prop_400-11-absent'

/** The ask-tier utterance the fail-closed arm drives (`dashboard-confirm-bridge.test.ts`'s own). */
const ASK_UTTERANCE = `/fn knowledge.proposal.apply {"proposalId":"${ABSENT_PROPOSAL}"}`

/** The `surface-dispatch.ts` fixture project, verbatim in shape (see the door cell's note). */
function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-400-11-'))
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

const openDoors: DoorFixture[] = []

/** The door as `agent-qa dashboard` composes it, in the execution context this cell is about. */
async function openDoor(executionContext: ExecutionContext): Promise<DoorFixture> {
  const configPath = fixtureWorkspace()
  const configRoot = dirname(resolve(configPath))
  let boundOrigin: string | undefined
  const { host, agentHost } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    resolveExecutionContext: () => executionContext,
  })
  const server = createServer(createChatRouter(agentHost))
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new TypeError('the door bound no port')
  }
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  const fixture = { origin: boundOrigin, configRoot, host, server }
  openDoors.push(fixture)
  return fixture
}

afterEach(async () => {
  for (const door of openDoors.splice(0)) {
    await new Promise<void>((closed) => door.server.close(() => closed()))
    await door.host.close()
    rmSync(door.configRoot, { recursive: true, force: true })
  }
})

/** One turn, driven the way a browser drives it. */
async function postTurn(origin: string, body: unknown): Promise<ChatTurnResponse> {
  const response = await fetch(`${origin}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return await response.json() as ChatTurnResponse
}

describe('a denial reaching the browser carries prose that surface can read (D-15 prose half)', () => {
  it('carries a neutral reason free of the CLI flag on the session-pin arm', async () => {
    const door = await openDoor('local-interactive')

    const pinned = await postTurn(door.origin, { message: '/pin fn:config.get' })
    const sessionId = pinned.result.sessionId
    const turn = await postTurn(door.origin, { message: '/fn config.get {}', sessionId })

    const denial = turn.result.denials?.[0]
    expect(denial).toBeDefined()
    expect(denial?.neutralReason).toBeDefined()
    expect(denial?.neutralReason).not.toContain(CLI_FLAG)
    // 392 D-21's way out is the SESSION BOUNDARY — a property of the conversation this reader is
    // already in, not another surface's affordance — so this arm's neutral prose still says it.
    expect(denial?.neutralReason).toContain('a pin cannot be lifted')
    // And beside it, unmoved: the canonical sentence, the bytes the audit row stores.
    expect(denial?.reason).toContain('session-pin-denied')
  })

  it('carries a neutral reason free of the CLI flag on the fail-closed arm, beside the canonical one', async () => {
    // HEADLESS IS THE POSTURE THE FINDING WAS MEASURED IN. `knowledge.proposal.apply` is
    // `mutating-shared`, so `baseVerdict` answers `ask`; a context that requires fail-closed has
    // no confirm to reach, and the gate mints the sentence that names `--trust-session`.
    const door = await openDoor('local-headless')

    const turn = await postTurn(door.origin, { message: ASK_UTTERANCE })

    const denial = turn.result.denials?.[0]
    expect(denial).toBeDefined()
    expect(denial?.functionId).toBe('knowledge.proposal.apply')

    // THE CLAIM. What a browser reader is shown names no flag and no command.
    expect(denial?.neutralReason).toBeDefined()
    expect(denial?.neutralReason).not.toContain(CLI_FLAG)
    expect(denial?.neutralReason).not.toContain('re-run')
    expect(denial?.neutralReason).toContain('fail-closed')
    expect(denial?.neutralReason).toContain('local-headless')

    // THE SIBLING CHANNEL, in the same cell so the two cannot be conflated: the canonical sentence
    // still carries its published bytes, flag and all, for the surfaces that can take them.
    expect(denial?.reason).toContain(CLI_FLAG)
    expect(denial?.reason).toContain('fail-closed: ask in local-headless without trust')

    // The way out reaches this reader ONLY as typed remedies — which is the other half of D-15,
    // shipped by 400-02 and re-driven here because the prose fix must not have loosened it.
    expect(denial?.remedies.map((remedy) => remedy.kind)).toEqual([
      'answer-confirm',
      'trust-session-flag',
    ])
  })
})
