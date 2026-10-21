// C447 (447-08, D-16, D-17, D-21): run outcomes from every door that composes analytics, allowlisted, never changing a verdict

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type { AnalyticsCapturePayload } from '@vostride/agent-qa-analytics'
import type { RunStartAcknowledgement } from '@vostride/agent-qa-schema'

import { composeAnalyticsHost } from '../../composition/analytics-host.js'
import type { CliAnalyticsHost, CliAnalyticsSurface } from '../../composition/analytics-host.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../../composition/local-agent-host.js'
import {
  CountingTarget,
  createInProcessFixture,
  removeInProcessFixtures,
} from '../../composition/__tests__/in-process-run-fixture.js'
import { pinProcessTmpdir, removeTempRoots } from '../temp-roots.js'
import type { PinnedTmpdir } from '../temp-roots.js'

let pinnedTmpdir: PinnedTmpdir | undefined
beforeAll(() => { pinnedTmpdir = pinProcessTmpdir() })
afterAll(() => {
  pinnedTmpdir?.restore()
  if (pinnedTmpdir !== undefined) removeTempRoots([pinnedTmpdir.root])
})

type Fixture = ReturnType<typeof createInProcessFixture>

const RUN_BUDGET_MS = 180_000

const target = new CountingTarget()
const priorBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
const opened: Array<() => Promise<void> | void> = []

beforeAll(async () => { await target.listen() })
afterAll(async () => {
  await target.close()
  if (priorBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = priorBrowsersPath
  removeInProcessFixtures()
})
afterEach(async () => {
  for (const close of opened.splice(0).reverse()) await close()
})

function fixture(input: { readonly stepText?: string } = {}): Fixture {
  const created = createInProcessFixture({ origin: target.origin, environment: 'local', ...input })
  const browsersRoot = join(created.project, 'no-browsers')
  mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot
  return created
}

async function recordingHost(surface: CliAnalyticsSurface): Promise<{
  readonly analytics: CliAnalyticsHost
  readonly sent: AnalyticsCapturePayload[]
}> {
  const sent: AnalyticsCapturePayload[] = []
  const analytics = await composeAnalyticsHost({
    surface,
    env: {},
    transportOverride: {
      capture: (payload) => { sent.push(payload) },
      flush: () => {},
      shutdown: () => {},
    },
    resolveIdentity: async () => ({ distinctId: 'u_door-cell', runtimeContext: 'user' }),
  })
  return { analytics, sent }
}

async function startRun(
  project: Fixture,
  input: { readonly analytics?: CliAnalyticsHost; readonly runTrigger?: 'mcp' },
): Promise<RunStartAcknowledgement> {
  const host = composeCliLocalAgent({
    agentQaRoot: project.agentQaRoot,
    configPath: project.configPath,
    ...input,
  })
  opened.push(() => host.close())
  return await invokeFunction(
    host.registry,
    'runs.start',
    { patterns: [project.testPattern] },
    CLI_FUNCTION_CALLER,
  ) as RunStartAcknowledgement
}

function runOutcomes(sent: readonly AnalyticsCapturePayload[]): Record<string, unknown>[] {
  return sent
    .filter((payload) => payload.event.name === 'agent-qa.test_run.completed')
    .map((payload) => payload.event.properties as Record<string, unknown>)
}

describe('C447-DOOR-OUTCOME', () => {
  it('a run started through the MCP and chat host compositions emits its run outcome', async () => {
    const mcp = await recordingHost('mcp')
    const viaMcp = await startRun(fixture(), { analytics: mcp.analytics, runTrigger: 'mcp' })
    expect(runOutcomes(mcp.sent), 'the MCP run outcome').toEqual([
      expect.objectContaining({ run_id: viaMcp.runId, surface: 'mcp', trigger_source: 'mcp' }),
    ])

    const chat = await recordingHost('chat')
    const viaChat = await startRun(fixture(), { analytics: chat.analytics })
    expect(runOutcomes(chat.sent), 'the chat run outcome').toEqual([
      expect.objectContaining({ run_id: viaChat.runId, surface: 'chat', trigger_source: 'cli' }),
    ])
  }, RUN_BUDGET_MS * 2)
})
