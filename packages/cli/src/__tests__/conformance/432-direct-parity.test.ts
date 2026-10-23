// THE DOOR MATRIX (Phase 432 plan 42; D-01/D-12/D-14/D-18, PXH-SAFE-01/02; 442 D-12/D-19).
//
// One run request, made the way a person or an agent makes it on EVERY door agent-qa ships:
//   `agent-qa run` (spawned binary), `agent-qa fn`, `agent-qa ask`, CLI chat, MCP over HTTP,
//   MCP over stdio (spawned binary), the dashboard's Run control, the run service, the
//   background worker (the daemon), the dashboard's co-hosted MCP endpoint and its enqueue
//   route — each in CI posture, with no terminal.
//
// 2026-10-16 (442-09, D-12/D-19): D-12's nine doors map onto these eleven rows. The CLI is
// `agent-qa run`; the standalone MCP server is MCP over stdio and MCP over HTTP; `fn`, `ask` and
// chat are their own rows; the daemon is the background worker; dashboard `POST /run` is the run
// service; the co-hosted MCP endpoint and enqueue are their own rows. The dashboard Run control is
// a door D-12 does not name, and it stays. Every project declares a marker auth plugin (D-10), and
// the dashboard rows compose `createDashboardRunDoor` without the command's host-start config read
// (D-18), so a marker can only come from the request.
// 2026-10-17 (443-10, D-02/D-05): every door writes one runs.db row for a run it starts, and a
// refused run leaves no runs.db file.
// Three postures per door, each in a fresh temporary project over a loopback counting target:
//   1. a NON-PRODUCTION test runs in its one call, nothing reads stdin and nothing is asked;
//   2. a declared PRODUCTION test is refused before any effect — no run directory, no request at
//      the target — with the one plain sentence naming the target and `allowProduction: true`,
//      on every door including CLI chat and `ask` (432-42 fixed chat's render, 432-40 deferred #1);
//   3. the SAME production test runs once the config — and only the config — opts in.
//
// THE INSTRUMENT FOR "NOTHING ASKS" IS STDIN ITSELF, as in `432-cli-one-call.test.ts`: every
// in-process door runs with `process.stdin` replaced by a stream whose reading members record the
// attempt and throw. The two spawned doors run with no terminal (`run` with stdin closed; MCP stdio
// owns its pipe as the protocol channel, so a prompt there would corrupt the framing).
//
// NOTHING IS MOCKED BETWEEN THE DOOR AND THE RUN CORE. Every door goes through its shipped
// composition (`composeCliLocalAgent`, `composeDashboardDoor`/`createDashboardRunDoor`,
// `composeRunServicePorts`, `runDaemonHost`, `mountCoHostedMcp`, the built `dist/cli.js`); the
// model points at a counting path on the target's origin that answers no model, so a started run
// probes the target, fails to plan and finishes.
//
// 2026-10-03 (quick-261003-tsr, WR-08): every door, in-process ones included, runs under the
// project's empty `no-browsers` pin, and every target hit records the pin in force when it arrived.
// A door returns only once each run it started has written `runFinished`, so no run outlives the
// cell that started it. `fn` and `ask` compose a host the command does not close (a CLI process
// exits with it); the settlement wait is what bounds their runs here.
//
// The last describe drives the operations every door reaches through the one function layer —
// the three knowledge changes and the six config changes — each in one call, with stdin spied.
//
// Every fixture lives in a temporary directory.

import { spawn } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { ConfigReaderPort, FunctionRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import { invokeFunction } from '@vostride/agent-qa-agent'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { DashboardDatabase, startServer } from '@vostride/agent-qa-dashboard'
import { generateTestId } from '@vostride/agent-qa-ids'
import { publishBundleForTest } from '@vostride/agent-qa-knowledge-local'
import { buildAgentQaMcpServer } from '@vostride/agent-qa-mcp'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createAskCommand } from '../../commands/ask.js'
import {
  composeDashboardDoor, composeRunServicePorts, createDashboardRunDoor, mountCoHostedMcp,
} from '../../commands/dashboard.js'
import { createFnCommand } from '../../commands/fn.js'
import { composeMcpMasking, createMcpHttpRequestListener, MCP_FUNCTION_CALLER } from '../../commands/mcp.js'
import { buildOrdinalsExist, CountingTarget } from '../../composition/__tests__/in-process-run-fixture.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../../composition/local-agent-host.js'
import { invokeViaDaemon } from '../../daemon/client.js'
import { runDaemonHost } from '../../daemon/host.js'
import type { DaemonHostOperations } from '../../daemon/host.js'
import { driveChatLines, genericFnClause } from './surface-dispatch.js'
import { pinProcessTmpdir, removeTempRoots } from '../temp-roots.js'
import type { PinnedTmpdir } from '../temp-roots.js'
import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'

let pinnedTmpdir: PinnedTmpdir | undefined
beforeAll(() => { pinnedTmpdir = pinProcessTmpdir() })
afterAll(() => {
  pinnedTmpdir?.restore()
  if (pinnedTmpdir !== undefined) removeTempRoots([pinnedTmpdir.root])
})

const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')
const OPT_IN_LINE = 'allowProduction: true'
const PRODUCTION_TARGET = 'prod-one'
const LOCAL_TARGET = 'local-one'
const MODEL_PATH = 'model-endpoint'
const PLUGIN_MARKER = 'plugin-loaded.marker'
/** The prompt wording a retired approval would print. None of it may reach anybody. */
const APPROVAL = /\[y\/N\]|\[y\/a\/N\]|needs your approval|Proceed\?|--trust-session/u

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {})
  removeTempRoots(roots.splice(0))
})

// ---- the project ------------------------------------------------------------------------------

interface MatrixProject {
  readonly root: string
  readonly configPath: string
  readonly agentQaRoot: string
  readonly localTest: string
  readonly productionTest: string
  readonly pluginMarker: string
}

// 2026-10-16 (442-09, D-10): a fresh directory per cell is a fresh plugin file URL, so neither
// Node's module cache nor a loader's declaration set can make a marker assertion vacuous.
function matrixProject(origin: string, optIn: boolean): MatrixProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-432-42-doors-')))
  roots.push(root)
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, 'no-browsers'), { recursive: true })
  writeFileSync(join(root, 'marker-auth-plugin.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    `writeFileSync(new URL('./${PLUGIN_MARKER}', import.meta.url), String(process.pid))`,
    'export const providers = []',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'agent-qa.config.yaml'), [
    ...(optIn ? [OPT_IN_LINE] : []),
    'workspace:',
    '  testMatch:',
    "    - 'tests/**/*.yaml'",
    '  suiteMatch:',
    "    - 'suites/**/*.suite.yaml'",
    '  hooksFile: hooks.yaml',
    '  envFile: .env',
    '  secretsFile: .env.secrets.local',
    'plugins:',
    '  auth:',
    '    - path: ./marker-auth-plugin.mjs',
    'services:',
    '  dashboard: {}',
    'registry:',
    '  targets:',
    `    ${LOCAL_TARGET}:`,
    '      platform: web',
    `      url: ${origin}/${LOCAL_TARGET}`,
    '      product: door-product',
    '      environment: local',
    `    ${PRODUCTION_TARGET}:`,
    '      platform: web',
    `      url: ${origin}/${PRODUCTION_TARGET}`,
    '      product: door-product',
    '      environment: production',
    '  llms:',
    '    - name: unreachable',
    '      provider: openai-compatible',
    '      model: gpt-4o-mini',
    `      baseURL: ${origin}/${MODEL_PATH}`,
    'use:',
    '  llm: unreachable',
    '  mobile:',
    '    appState: preserve',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(root, '.env'), '')
  writeFileSync(join(root, '.env.secrets.local'), '')
  const test = (file: string, target: string): string => {
    writeFileSync(join(root, 'tests', file), [
      `test-id: ${generateTestId()}`,
      `name: the ${file} test`,
      `target: ${target}`,
      'steps:',
      '  - Verify the page says "Example"',
      '',
    ].join('\n'))
    return `tests/${file}`
  }
  return {
    root,
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
    localTest: test('local.yaml', LOCAL_TARGET),
    productionTest: test('prod.yaml', PRODUCTION_TARGET),
    pluginMarker: join(root, PLUGIN_MARKER),
  }
}

/** The two places a door's run lands: the project root (for the pin) and its `.agent-qa`. */
type DoorScope = Pick<MatrixProject, 'root' | 'agentQaRoot'>

function runDirectories(project: DoorScope): string[] {
  const runs = join(project.agentQaRoot, 'runs')
  return existsSync(runs) ? readdirSync(runs) : []
}

function noBrowsers(project: DoorScope): string {
  return join(project.root, 'no-browsers')
}

/** The runs this project started that have not written `runFinished` yet. */
function unsettledRuns(project: DoorScope): string[] {
  return runDirectories(project).filter((runId) => {
    const events = join(project.agentQaRoot, 'runs', runId, 'events.jsonl')
    return !existsSync(events) || !readFileSync(events, 'utf8').includes('"type":"runFinished"')
  })
}

async function waitFor(check: () => boolean, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((settle) => setTimeout(settle, 50))
  }
  return check()
}

// ---- the stdin instrument ---------------------------------------------------------------------

/**
 * Run `body` in CI posture with `process.stdin` replaced by a stream that records and refuses
 * reads, under the project's no-browser pin, and wait for every run it started to settle.
 */
async function atDoor<T>(
  project: DoorScope,
  body: () => Promise<T>,
): Promise<{ value: T; stdinReads: string[]; unsettled: string[] }> {
  const stdinReads: string[] = []
  const forbidden = new Readable({ read() {} }) as Readable & { isTTY?: boolean }
  forbidden.isTTY = false
  for (const member of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener', 'resume', 'read', 'setRawMode']) {
    Object.defineProperty(forbidden, member, {
      configurable: true,
      value: (...args: unknown[]): never => {
        stdinReads.push(`${member}(${typeof args[0] === 'string' ? args[0] : ''})`)
        throw new Error(`432-42: a read reached stdin through ${member}`)
      },
    })
  }
  const savedCi = process.env.CI
  const savedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.CI = 'true'
  process.env.PLAYWRIGHT_BROWSERS_PATH = noBrowsers(project)
  const realStdin = process.stdin
  Object.defineProperty(process, 'stdin', { value: forbidden, configurable: true })
  try {
    const value = await body()
    await waitFor(() => unsettledRuns(project).length === 0, 90_000)
    return { value, stdinReads, unsettled: unsettledRuns(project) }
  } finally {
    Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true })
    if (savedCi === undefined) delete process.env.CI
    else process.env.CI = savedCi
    if (savedBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsers
  }
}

// ---- the doors ----------------------------------------------------------------------------------

/** What a door answered: everything a person or agent could read, and whether it refused. */
interface DoorAnswer {
  readonly refused: boolean
  readonly text: string
  /** The dashboard database a dashboard-hosted door wrote through, read for D-11's row effect. */
  readonly db?: DashboardDatabase
}

type Door = (project: MatrixProject, pattern: string, target: CountingTarget) => Promise<DoorAnswer>

/** The shipped command factories under one Commander program, as `agent-qa` registers them. */
async function commander(project: MatrixProject, args: readonly string[]): Promise<{ text: string; exitCode: unknown }> {
  const printed: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { printed.push(values.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { printed.push(values.map(String).join(' ')) })
  process.exitCode = undefined
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: (text) => { printed.push(text) }, writeOut: (text) => { printed.push(text) } })
    .option('--config <path>', 'config file path')
    .addCommand(createFnCommand())
    .addCommand(createAskCommand())
  try {
    await program.parseAsync(['node', 'agent-qa', '--config', project.configPath, ...args])
  } catch (error) {
    printed.push(String(error))
  }
  const exitCode = process.exitCode
  vi.mocked(console.log).mockRestore()
  vi.mocked(console.error).mockRestore()
  process.exitCode = undefined
  return { text: printed.join('\n'), exitCode }
}

async function spawnCli(project: MatrixProject, args: readonly string[]): Promise<{ status: number | null; text: string }> {
  expect(existsSync(CLI_DIST), `the built CLI is missing at ${CLI_DIST}; run pnpm build first`).toBe(true)
  // The browser pin is inherited from `atDoor`, the one place every door's pin is set.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', NO_COLOR: '1', DO_NOT_TRACK: '1' }
  delete env.AGENT_QA_RUN_ID
  const child = spawn(process.execPath, [CLI_DIST, ...args], { cwd: project.root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
  const status = await new Promise<number | null>((settle) => child.on('close', settle))
  return { status, text: Buffer.concat(chunks).toString('utf8') }
}

function toolText(result: unknown): DoorAnswer {
  const answer = result as { content?: readonly { text?: string }[]; isError?: boolean }
  return { refused: answer.isError === true, text: (answer.content ?? []).map((entry) => entry.text ?? '').join('\n') }
}

/** A scene: the dashboard as `agent-qa dashboard` composes it, with the run service mounted. */
async function openDashboard(project: MatrixProject): Promise<{
  origin: string
  db: DashboardDatabase
  registry: FunctionRegistry
  settled: Array<{ runId: string; status: string; details: Record<string, unknown> }>
}> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const runDoor = await createDashboardRunDoor({ db, configPath: project.configPath })
  let boundOrigin: string | undefined
  const door = composeDashboardDoor({
    agentQaRoot: project.agentQaRoot,
    configPath: project.configPath,
    boundOrigin: () => boundOrigin,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(door.host)
  const runService = composeRunServicePorts({ door: runDoor })
  const settled: Array<{ runId: string; status: string; details: Record<string, unknown> }> = []
  runDoor.backend.on('run-settled', (runId: string, status: string, details: Record<string, unknown>) => {
    settled.push({ runId, status, details })
  })
  const started = await startServer({
    declaredSecretMask: (text) => text,
    db,
    port: 0,
    configPath: project.configPath,
    workspacePaths: resolveWorkspacePaths({
      config: parseYaml(readFileSync(project.configPath, 'utf8')) as never,
      configPath: project.configPath,
    }),
    executionBackend: runDoor.backend,
    agentHost: door.agentHost,
    runService: runService.ports,
    runServiceReadiness: runService.readiness,
  })
  const address = started.server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the dashboard bound no port')
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  cleanups.push(async () => {
    started.close()
    runService.dispose()
    await door.host.close()
    db.close()
  })
  return { origin: boundOrigin, db, registry: door.host.registry as FunctionRegistry, settled }
}

/** A queued or triggered dashboard run, once settled, as the door's answer. */
async function settledAnswer(scene: Awaited<ReturnType<typeof openDashboard>>, answered: unknown): Promise<DoorAnswer> {
  expect(await waitFor(() => scene.settled.length > 0, 90_000), 'the dashboard run never settled').toBe(true)
  const settled = scene.settled[0]!
  const reason = typeof settled.details['neutralReason'] === 'string' ? settled.details['neutralReason'] : ''
  const text = `${reason}\n${JSON.stringify(answered)}\n${JSON.stringify(settled.details)}`
  return { refused: settled.details['refusedBeforeStart'] === true, text, db: scene.db }
}

const DOORS: ReadonlyArray<readonly [string, Door]> = [
  ['agent-qa run (spawned, CI, stdin closed)', async (project, pattern) => {
    // A run that starts and is skipped for want of a browser also exits non-zero, so a refusal is
    // exit 2 WITH the run core's production sentence on it.
    const { status, text } = await spawnCli(project, ['run', pattern])
    return { refused: status === 2 && text.includes('declared environment: production'), text }
  }],
  ['agent-qa fn', async (project, pattern) => {
    const { text, exitCode } = await commander(project, ['fn', 'runs.start', '--input', JSON.stringify({ patterns: [pattern] }), '--json'])
    return { refused: exitCode !== undefined && exitCode !== 0, text }
  }],
  ['agent-qa ask', async (project, pattern) => {
    const { text } = await commander(project, ['ask', genericFnClause('runs.start', { patterns: [pattern] })])
    return { refused: /\bfailed\b[^\n]*runs\.start|runs\.start[^\n]*\bfailed\b/u.test(text), text }
  }],
  ['CLI chat', async (project, pattern) => {
    const observed = await driveChatLines([genericFnClause('runs.start', { patterns: [pattern] })], 'ci', { configPath: project.configPath })
    const receipt = observed.receipts.find((candidate) => candidate.functionId === 'runs.start')
    return { refused: receipt?.status === 'failed', text: observed.stdout }
  }],
  ['MCP over HTTP', async (project, pattern) => {
    const host = composeCliLocalAgent({ agentQaRoot: project.agentQaRoot, configPath: project.configPath })
    const masking = composeMcpMasking({ configPath: project.configPath })
    const handler = createMcpHandler(() => buildAgentQaMcpServer({
      registry: host.registry, caller: MCP_FUNCTION_CALLER, maskText: (text: string) => masking.mask(text),
    }))
    const client = new Client({ name: 'agent-qa-432-42-doors', version: '0.0.0' })
    try {
      return await runSafetyScope({ executionContext: 'ci' }, async () => {
        await client.connect(new StreamableHTTPClientTransport(new URL('http://doors.local/mcp'), {
          fetch: ((url: URL | string, init?: RequestInit) => handler.fetch(new Request(url, init))) as typeof fetch,
        }))
        return toolText(await client.callTool({ name: 'agent_qa_start_run', arguments: { patterns: [pattern] } }))
      })
    } finally {
      await client.close().catch(() => {})
      await handler.close().catch(() => {})
      await host.close().catch(() => {})
    }
  }],
  ['MCP over stdio (spawned)', async (project, pattern) => {
    expect(existsSync(CLI_DIST), `the built CLI is missing at ${CLI_DIST}`).toBe(true)
    const env = Object.fromEntries(Object.entries({ ...process.env, CI: 'true' }).filter((entry): entry is [string, string] => entry[1] !== undefined && !/TOKEN/u.test(entry[0])))
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_DIST, 'mcp'], cwd: project.root, stderr: 'pipe', env })
    const client = new Client({ name: 'agent-qa-432-42-doors-stdio', version: '0.0.0' })
    try {
      await client.connect(transport)
      return toolText(await client.callTool({ name: 'agent_qa_start_run', arguments: { patterns: [pattern] } }))
    } finally {
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    }
  }],
  ['the dashboard Run control', async (project, pattern) => {
    const scene = await openDashboard(project)
    const response = await fetch(`${scene.origin}/api/runs/trigger`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: pattern }),
    })
    const body = await response.json() as { runId?: string; error?: string; neutralReason?: string }
    // 433-34 (G-433-10): the trigger refuses at the door, so the refusal is its answer and no row exists.
    if (response.status >= 400 && body.error === 'run_denied') {
      expect(scene.db.getRuns({}), 'a refused click minted a run row').toEqual([])
      return { refused: true, text: `${body.neutralReason ?? ''}\n${JSON.stringify(body)}`, db: scene.db }
    }
    expect(body.error, JSON.stringify(body)).toBeUndefined()
    return await settledAnswer(scene, body)
  }],
  ['the run service', async (project, pattern) => {
    const scene = await openDashboard(project)
    const response = await fetch(`${scene.origin}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patterns: [pattern] }),
    })
    const raw = await response.text()
    const body = (() => { try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} } })()
    const text = typeof body['neutralReason'] === 'string' ? `${body['neutralReason']}\n${raw}` : raw
    return { refused: response.status >= 400 && body['error'] === 'run_denied', text, db: scene.db }
  }],
  ['the background worker (daemon)', async (project, pattern) => {
    const listeners = new Map<NodeJS.Signals, () => void>()
    const operations: Partial<DaemonHostOperations> = {
      setInterval: (_callback, intervalMs) => intervalMs as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
      onSignal: (signal, listener) => listeners.set(signal, listener),
      offSignal: (signal, listener) => { if (listeners.get(signal) === listener) listeners.delete(signal) },
      hardExit: (code) => { throw new Error(`unexpected daemon hard exit ${code}`) },
    }
    const model: JobModelCapability = { modelId: 'test:432-42-doors', generate: () => Promise.resolve({ text: 'unused' }) }
    const config: ConfigReaderPort = {
      getMasked: () => Promise.resolve({ schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION, configPath: project.configPath, entries: [] }),
    }
    let started = false
    const running = runDaemonHost({
      agentQaRoot: project.agentQaRoot,
      knowledgeRoot: join(project.root, 'agent-qa-knowledge'),
      configPath: project.configPath,
      config,
      model: () => model,
      operations,
      logger: { info: () => { started = true }, error: () => undefined },
    })
    expect(await waitFor(() => started, 30_000), 'the daemon did not start').toBe(true)
    try {
      const answer = await invokeViaDaemon({ agentQaRoot: project.agentQaRoot, functionId: 'runs.start', input: { patterns: [pattern] } })
      return { refused: false, text: JSON.stringify(answer) }
    } catch (error) {
      return { refused: true, text: error instanceof Error ? error.message : String(error) }
    } finally {
      listeners.get('SIGTERM')?.()
      await running
    }
  }],
  ['the co-hosted MCP endpoint', async (project, pattern) => {
    // The listener `agent-qa dashboard` mounts, over the scene door's registry as the command builds it.
    const scene = await openDashboard(project)
    const masking = composeMcpMasking({ configPath: project.configPath })
    const warnings: string[] = []
    const mount = await mountCoHostedMcp({
      server: createServer(createMcpHttpRequestListener({
        registry: scene.registry,
        maskText: (text: string) => masking.mask(text),
        liveLink: { dashboardBaseUrl: () => scene.origin },
      })),
      port: 0,
      warn: (line) => warnings.push(line),
    })
    const server = mount.server
    expect(server, warnings.join('\n')).toBeDefined()
    cleanups.push(() => new Promise<void>((closed) => server!.close(() => closed())))
    const client = new Client({ name: 'agent-qa-442-09-cohost', version: '0.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(mount.boundPort)}/mcp`)))
      return { ...toolText(await client.callTool({ name: 'agent_qa_start_run', arguments: { patterns: [pattern] } })), db: scene.db }
    } finally {
      await client.close().catch(() => {})
    }
  }],
  ['the enqueue route', async (project, pattern) => {
    const scene = await openDashboard(project)
    const response = await fetch(`${scene.origin}/api/queue/enqueue`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'the matrix enqueue', file: pattern }),
    })
    const body = await response.json() as Record<string, unknown>
    if (response.status === 403 && body['error'] === 'run_denied') {
      return { refused: true, text: `${String(body['neutralReason'] ?? '')}\n${JSON.stringify(body)}`, db: scene.db }
    }
    expect(response.status, JSON.stringify(body)).toBe(202)
    return await settledAnswer(scene, body)
  }],
]

/** The browser pin this process held at each target hit, in arrival order. */
type PinsAtHit = Array<string | undefined>

async function withTarget<T>(body: (target: CountingTarget, pinsAtHit: PinsAtHit) => Promise<T>): Promise<T> {
  const pinsAtHit: PinsAtHit = []
  const target = new CountingTarget(() => { pinsAtHit.push(process.env.PLAYWRIGHT_BROWSERS_PATH) })
  await target.listen()
  try {
    return await body(target, pinsAtHit)
  } finally {
    await target.close()
  }
}

/** Every hit arrived while this process held the project's no-browser pin. */
function expectPinnedHits(project: MatrixProject, pinsAtHit: PinsAtHit): void {
  expect(pinsAtHit.length, 'the target was never hit').toBeGreaterThan(0)
  expect(new Set(pinsAtHit), 'the run reached the target without the no-browser pin')
    .toEqual(new Set([noBrowsers(project)]))
}

describe('C432-DOOR-NONPRODUCTION: every door runs, refuses production, and honours only the config opt-in', () => {
  it('C432-DOOR-NONPRODUCTION: the matrix covers every supported door', () => {
    expect(DOORS.map(([name]) => name)).toHaveLength(11)
  })

  it.each(DOORS)('C432-DOOR-NONPRODUCTION: %s starts a non-production run in its one call, reading no stdin and asking nothing', async (_name, door) => {
    await withTarget(async (target, pinsAtHit) => {
      const project = matrixProject(target.origin, false)
      const { value: answer, stdinReads, unsettled } = await atDoor(project, () => door(project, project.localTest, target))
      expect(stdinReads, 'an approval read reached stdin').toEqual([])
      expect(answer.refused, answer.text).toBe(false)
      expect(unsettled, 'a started run outlived its door').toEqual([])
      expect(await waitFor(() => target.hits.includes(`/${LOCAL_TARGET}`)), `the run never reached the target: ${answer.text}`).toBe(true)
      expect(target.hits).not.toContain(`/${PRODUCTION_TARGET}`)
      expectPinnedHits(project, pinsAtHit)
      expect(await waitFor(() => runDirectories(project).length > 0), 'no run directory was written').toBe(true)
      expect(answer.text).not.toMatch(APPROVAL)
      expect(answer.text).not.toContain(OPT_IN_LINE)
    })
  }, 180_000)

  it.each(DOORS)('C432-DOOR-NONPRODUCTION: %s refuses a declared production run before any effect, naming the target and the one config line', async (_name, door) => {
    await withTarget(async (target) => {
      const project = matrixProject(target.origin, false)
      const { value: answer, stdinReads, unsettled } = await atDoor(project, () => door(project, project.productionTest, target))
      expect(stdinReads).toEqual([])
      expect(unsettled, 'a refused run left a run behind').toEqual([])
      expect(answer.refused, answer.text).toBe(true)
      expect(answer.text, 'the refusal does not name the target').toContain(`"${PRODUCTION_TARGET}"`)
      expect(answer.text, 'the refusal does not name the one line to add').toContain(OPT_IN_LINE)
      expect(answer.text).not.toMatch(APPROVAL)
      expect(target.hits, 'a refused run reached the target').toEqual([])
      expect(runDirectories(project), 'a refused run left a run directory').toEqual([])
    })
  }, 180_000)

  it.each(DOORS)('C432-DOOR-NONPRODUCTION: %s runs the same production test once the config, and only the config, opts in', async (_name, door) => {
    await withTarget(async (target, pinsAtHit) => {
      const project = matrixProject(target.origin, true)
      const { value: answer, stdinReads, unsettled } = await atDoor(project, () => door(project, project.productionTest, target))
      expect(stdinReads).toEqual([])
      expect(answer.refused, answer.text).toBe(false)
      expect(unsettled, 'a started run outlived its door').toEqual([])
      expect(await waitFor(() => target.hits.includes(`/${PRODUCTION_TARGET}`)), `the opted-in run never reached the target: ${answer.text}`).toBe(true)
      expectPinnedHits(project, pinsAtHit)
      expect(answer.text).not.toContain(OPT_IN_LINE)
      expect(answer.text).not.toMatch(APPROVAL)
    })
  }, 180_000)
})

// ---- every door, every effect D-11 names (442 D-10/D-11/D-12) -----------------------------------

/** The ids a sqlite store holds in `table`; a store that was never created holds none. */
function storeRows(path: string, table: string): string[] {
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) === undefined) return []
    return (db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: unknown }>).map((row) => String(row.id))
  } finally {
    db.close()
  }
}

function doorEffects(project: MatrixProject, target: CountingTarget, db?: DashboardDatabase) {
  return {
    runDirectories: runDirectories(project),
    runsDbRows: [
      ...storeRows(join(project.agentQaRoot, 'runs.db'), 'runs'),
      ...(db?.getRuns({}).map((row) => row.id) ?? []),
    ],
    jobRows: storeRows(join(project.agentQaRoot, 'agent-jobs.db'), 'jobs'),
    runsDbFile: existsSync(join(project.agentQaRoot, 'runs.db')),
    buildOrdinal: buildOrdinalsExist({ project: project.root, suitePattern: '' }),
    targetHits: target.hits.filter((hit) => !hit.startsWith(`/${MODEL_PATH}`)),
    modelHits: target.hits.filter((hit) => hit.startsWith(`/${MODEL_PATH}`)),
    pluginMarker: existsSync(project.pluginMarker),
  }
}

const NO_EFFECTS: ReturnType<typeof doorEffects> = {
  runDirectories: [],
  runsDbRows: [],
  jobRows: [],
  runsDbFile: false,
  buildOrdinal: false,
  targetHits: [],
  modelHits: [],
  pluginMarker: false,
}

/** What a returned token, grant, proposal inbox or approval affordance would have to say. */
const RETIRED_AFFORDANCE = /\btokens?\b|\bbearer\b|\bgrant|\bpropos|\binbox\b|\bapprov|\bconsent|trust-session/iu
const RESOLVED_SCOPE = /"scope":\s*\{\s*"tier":\s*"product",\s*"key":\s*"door-product"\s*\}/gu
/** Canonical ids are generated words (`r_vine-…-stable-scope`), so they are read past, not matched. */
const CANONICAL_ID = /\b(?:obs|[tshr])_[a-z0-9]+(?:-[a-z0-9]+)*/gu

const WRITES_RUN_ROW = new Set(DOORS.map(([door]) => door))

describe('C442-DOOR-TABLE', () => {
  it.each(DOORS)('%s refuses a declared production run before any effect, plugin loading included', async (name, door) => {
    // The positive control first: the same door and instruments over an opted-in twin see each
    // effect, so the nothing below was measured. Every door writes its run's runs.db row.
    expect(DOORS.map(([door]) => door)).toEqual(expect.arrayContaining([...WRITES_RUN_ROW]))
    await withTarget(async (target) => {
      const twin = matrixProject(target.origin, true)
      const { value: allowed } = await atDoor(twin, () => door(twin, twin.productionTest, target))
      expect(allowed.refused, allowed.text).toBe(false)
      expect(await waitFor(() => target.hits.includes(`/${PRODUCTION_TARGET}`)), allowed.text).toBe(true)
      const seen = doorEffects(twin, target, allowed.db)
      expect(seen.pluginMarker, 'the instrument never saw the plugin load').toBe(true)
      expect(seen.runDirectories, 'the instrument never saw a run directory').toHaveLength(1)
      expect(seen.jobRows.length, 'the instrument never saw a job-store row').toBeGreaterThan(0)
      expect(seen.buildOrdinal, 'the instrument never saw a build ordinal').toBe(true)
      if (WRITES_RUN_ROW.has(name)) expect(seen.runsDbRows, 'the instrument never saw a runs.db row').toHaveLength(1)
    })
    await withTarget(async (target) => {
      const project = matrixProject(target.origin, false)
      const { value: answer, stdinReads, unsettled } = await atDoor(project, () => door(project, project.productionTest, target))
      expect(stdinReads).toEqual([])
      expect(unsettled).toEqual([])
      expect(answer.refused, answer.text).toBe(true)
      expect(answer.text, 'the refusal does not name the target').toContain(`"${PRODUCTION_TARGET}"`)
      expect(answer.text, 'the refusal does not name the one line to add').toContain(OPT_IN_LINE)
      expect(doorEffects(project, target, answer.db), answer.text).toEqual(NO_EFFECTS)
    })
  }, 180_000)

  it.each(DOORS)('%s runs a declared production target in one call and loads its plugin', async (_name, door) => {
    await withTarget(async (target) => {
      const project = matrixProject(target.origin, true)
      expect(existsSync(project.pluginMarker)).toBe(false)
      const { value: answer, stdinReads, unsettled } = await atDoor(project, () => door(project, project.productionTest, target))
      expect(stdinReads).toEqual([])
      expect(unsettled).toEqual([])
      expect(answer.refused, answer.text).toBe(false)
      expect(answer.text).not.toContain(OPT_IN_LINE)
      expect(await waitFor(() => target.hits.includes(`/${PRODUCTION_TARGET}`)), `the opted-in run never reached the target: ${answer.text}`).toBe(true)
      expect(runDirectories(project), 'the one call did not run once').toHaveLength(1)
      expect(existsSync(project.pluginMarker), 'the opted-in run did not load its plugin').toBe(true)
    })
  }, 180_000)
})

describe('C442-ABSENCE', () => {
  it('no door asks, requires a token or scope, or offers an inbox', async () => {
    const answers: Array<{ at: string; text: string; stdinReads: string[] }> = []
    for (const [name, door] of DOORS) {
      for (const allowed of [false, true]) {
        await withTarget(async (target) => {
          const project = matrixProject(target.origin, allowed)
          const { value, stdinReads } = await atDoor(project, () => door(project, project.productionTest, target))
          expect(value.refused, `${name}: ${value.text}`).toBe(!allowed)
          answers.push({ at: `${name} (${allowed ? 'allowed' : 'refused'})`, text: value.text, stdinReads })
        })
      }
    }
    expect(answers).toHaveLength(DOORS.length * 2)
    for (const { at, text: answered, stdinReads } of answers) {
      const text = answered.replaceAll(CANONICAL_ID, '<id>')
      expect(stdinReads, `${at} read stdin`).toEqual([])
      expect(text, at).not.toMatch(APPROVAL)
      expect(text, at).not.toMatch(RETIRED_AFFORDANCE)
      // A started run's acknowledgement names the scope it resolved from the config; that record
      // is a fact about the run, and no other mention of a scope may appear.
      expect(text.replaceAll(RESOLVED_SCOPE, ''), at).not.toMatch(/scope/iu)
    }

    // 442-01 decision 13: the retired `scope` field is refused at a door as a field it will not
    // honour, before any effect; that is refusal vocabulary, not a returned affordance.
    await withTarget(async (target) => {
      const project = matrixProject(target.origin, false)
      const input = { patterns: [project.localTest], scope: { tier: 'product', key: 'door-product' } }
      const { value: answer, stdinReads } = await atDoor(project, () => commander(project, ['fn', 'runs.start', '--input', JSON.stringify(input), '--json']))
      expect(stdinReads).toEqual([])
      expect(answer.exitCode, answer.text).toBe(1)
      expect(answer.text).toContain('RunRequestFieldRefusedError')
      expect(answer.text).toContain('agent-qa cannot start a run with: scope')
      expect(answer.text).not.toMatch(APPROVAL)
      expect(answer.text).not.toMatch(RETIRED_AFFORDANCE)
      expect(doorEffects(project, target), answer.text).toEqual(NO_EFFECTS)
    })
  }, 600_000)
})

// ---- the operations every door reaches through the one function layer ---------------------------

const SHOP_CONFIG = [
  'workspace:',
  '  testMatch:',
  "    - 'tests/**/*.yaml'",
  '  suiteMatch:',
  "    - 'suites/**/*.suite.yaml'",
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'registry:',
  '  targets:',
  '    shop:',
  '      platform: web',
  '      url: https://shop.example.com',
  'use:',
  '  timeout:',
  '    step: 30s',
  '    test: 90m',
  '    navigation: 2m',
  '  mobile:',
  '    appState: reset',
  '',
].join('\n')

function publishCandidate(knowledgeRoot: string, name: string): string {
  const outcome = publishBundleForTest(
    { knowledgeRoot, productKey: 'Door Matrix', commitArtifacts: 'none' },
    {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [{ t: 'el', role: 'Button', name }],
        scope: { tier: 'product', key: 'door-matrix' },
        summary: `${name.toLowerCase()} button`,
        body: `Selecting ${name} advances the flow.`,
        distilledEvidenceRef: { id: `evidence-${name.toLowerCase()}`, sha: 'd'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: { kind: 'fact', subtype: 'selector', elementRef: { role: 'Button', name } },
      originClass: 'agent-verified',
      createdAtOrdinal: 3,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'door-matrix', testId: 't', stepIndex: 0 },
      artifacts: [],
    },
  )
  if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
  return outcome.id
}

describe('C432-DOOR-NONPRODUCTION: the knowledge and config changes every door reaches apply in one call each', () => {
  it('C432-DOOR-NONPRODUCTION: knowledge.accept, knowledge.reject and knowledge.forget each answer in their one call, reading no stdin and filing nothing', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-432-42-ops-')))
    roots.push(root)
    writeFileSync(join(root, 'agent-qa.config.yaml'), SHOP_CONFIG)
    const agentQaRoot = join(root, '.agent-qa')
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const accepted = publishCandidate(knowledgeRoot, 'Accept')
    const rejected = publishCandidate(knowledgeRoot, 'Reject')
    const forgotten = publishCandidate(knowledgeRoot, 'Forget')
    const host = composeCliLocalAgent({ agentQaRoot, configPath: join(root, 'agent-qa.config.yaml') })
    try {
      const { value: answers, stdinReads } = await atDoor({ root, agentQaRoot }, async () => ({
        accept: await invokeFunction(host.registry, 'knowledge.accept', { target: { grain: 'record', recordId: accepted } }, CLI_FUNCTION_CALLER),
        reject: await invokeFunction(host.registry, 'knowledge.reject', { target: { grain: 'record', recordId: rejected }, reason: 'moved' }, CLI_FUNCTION_CALLER),
        forget: await invokeFunction(host.registry, 'knowledge.forget', { target: { grain: 'record', recordId: forgotten } }, CLI_FUNCTION_CALLER),
      }))
      expect(stdinReads).toEqual([])
      // Each answer is the change's own outcome in its one call — never a filed proposal awaiting anybody.
      expect(answers.reject).toMatchObject({ outcome: 'applied', verb: 'reject', recordIds: [rejected] })
      expect(answers.forget).toMatchObject({ outcome: 'applied', verb: 'forget', recordIds: [forgotten] })
      expect(answers.accept).toMatchObject({ outcome: 'applied', verb: 'accept', recordIds: [accepted] })
      for (const answer of Object.values(answers)) expect(answer).not.toHaveProperty('proposalId')
      // MEASURED 2026-10-02 (432-42): the forget receipt still carries a field NAMED `proposalId`
      // (minted `prop_<operationId>`), a persisted receipt shape from the proposal era. It names no
      // filed proposal — nothing is filed (asserted below) — and renaming a persisted receipt field
      // is outside this plan; recorded as 432-42 deferred #2. Every other byte is checked here.
      const { forgetReceipt: _receipt, ...forgetRest } = answers.forget as Record<string, unknown>
      expect(JSON.stringify({ ...answers, forget: forgetRest })).not.toMatch(/propos|\bpending\b|approv|confirm/iu)
      expect(existsSync(join(agentQaRoot, 'proposals')), 'a proposal store was created').toBe(false)
      expect(existsSync(join(knowledgeRoot, 'grants.jsonl')), 'a grant ledger was created').toBe(false)
    } finally {
      await host.close()
    }
  }, 120_000)

  it('C432-DOOR-NONPRODUCTION: the six config changes each write in their one call, reading no stdin and filing nothing', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-432-42-config-')))
    roots.push(root)
    const configPath = join(root, 'agent-qa.config.yaml')
    writeFileSync(configPath, SHOP_CONFIG)
    writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n')
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'seed.mjs'), 'export default async function seed() {}\n')
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-432-42-scaffold-')))
    roots.push(empty)
    const host = composeCliLocalAgent({ agentQaRoot: join(root, '.agent-qa'), configPath })
    const fresh = composeCliLocalAgent({ agentQaRoot: join(empty, '.agent-qa'), configPath: join(empty, 'agent-qa.config.yaml') })
    try {
      const call = (registry: typeof host.registry, id: string, input: unknown) =>
        invokeFunction(registry, id, input, CLI_FUNCTION_CALLER) as Promise<{ outcome: string; files?: readonly string[] }>
      const { value: answers, stdinReads } = await atDoor({ root, agentQaRoot: join(root, '.agent-qa') }, async () => ({
        field: await call(host.registry, 'config.field.set', { path: 'use.parallel', value: true }),
        create: await call(host.registry, 'config.target.create', { name: 'basket', platform: 'web', url: 'https://basket.example.com' }),
        edit: await call(host.registry, 'config.target.edit', { name: 'shop', changes: { url: 'https://shop.example.com/basket' } }),
        // The committed `use` block takes no `authState` (a per-test override only), so the auth op's
        // road through whole-config validation is the plugin declaration (config-ops-composed's note).
        auth: await call(host.registry, 'config.auth.set', { target: 'shop', pluginPackage: '@acme/agent-qa-auth' }),
        hook: await call(host.registry, 'config.hook.add', { name: 'Seed the cart', runtime: 'node', file: 'scripts/seed.mjs' }),
        scaffold: await call(fresh.registry, 'config.project.scaffold', { domain: 'booking.com' }),
      }))
      expect(stdinReads).toEqual([])
      for (const [name, answer] of Object.entries(answers)) expect(answer.outcome, `${name}: ${JSON.stringify(answer)}`).toBe('applied')
      const written = readFileSync(configPath, 'utf8')
      expect(written).toContain('parallel: true')
      expect(written).toContain('basket.example.com')
      expect(written).toContain('shop.example.com/basket')
      expect(written).toContain('@acme/agent-qa-auth')
      expect(readFileSync(join(root, 'hooks.yaml'), 'utf8')).toContain('Seed the cart')
      expect(existsSync(join(empty, 'agent-qa.config.yaml')), 'the scaffold wrote no config').toBe(true)
      expect(JSON.stringify(answers)).not.toMatch(/\bpropos|pending|approv|confirm/iu)
      expect(existsSync(join(root, '.agent-qa', 'proposals'))).toBe(false)
      expect(existsSync(join(empty, '.agent-qa', 'proposals'))).toBe(false)
    } finally {
      await host.close()
      await fresh.close()
    }
  }, 120_000)
})
