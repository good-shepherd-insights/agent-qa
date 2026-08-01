import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  acquireWriterLease,
  EPOCH_FILE,
  heartbeatLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  releaseLease,
  WRITER_AUTHORITY_DB_FILE,
  type WriterLease,
} from '@vostride/agent-qa-knowledge-local'
import type { CuratorAuthor } from '@vostride/agent-qa-agent-local'
import {
  defaultGuardrailPolicyInput,
  getActiveExecutionContext,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDaemonCommand,
  type DaemonCommandDeps,
} from '../commands/daemon.js'
import type { DrainSessionReceipt } from '../daemon/drain-receipts.js'
import {
  DAEMON_SHUTDOWN_GRACE_MS,
  LEASE_HEARTBEAT_INTERVAL_MS,
  runDaemonHost,
  type DaemonHostOperations,
  type DaemonHostTraceStep,
} from '../daemon/host.js'
import type { HeartbeatSupervisorMessage } from '../daemon/heartbeat-supervisor.js'
import {
  appendDaemonEvent,
  DAEMON_EVENTS_FILE,
  readDaemonEventLedger,
} from '../daemon/events.js'
import {
  DAEMON_SOCKET_PATH_BUDGET_BYTES,
  daemonSocketPath,
  startInvokeServer,
  unlinkDaemonSocket,
} from '../daemon/server.js'
import {
  DAEMON_REGISTRATION_FILE,
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  classifyDaemonRegistration,
  inspectDaemonRegistration,
  readDaemonRegistration,
  removeDaemonRegistration,
  removeRegistrationIfOwned,
  writeDaemonRegistration,
} from '../daemon/registration.js'
import type { DaemonRegistration } from '../daemon/registration.js'

const CHILD_ROOT_ENV = 'AGENT_QA_DAEMON_HOST_ROOT'
const CHILD_HOST_URL_ENV = 'AGENT_QA_DAEMON_HOST_URL'
const CHILD_SCRIPT = `
const root = process.env.${CHILD_ROOT_ENV}
const hostUrl = process.env.${CHILD_HOST_URL_ENV}
if (root === undefined || hostUrl === undefined) throw new Error('daemon child environment missing')
const { runDaemonHost } = await import(hostUrl)
const exitCode = await runDaemonHost({
  agentQaRoot: root + '/.agent-qa',
  knowledgeRoot: root + '/agent-qa-knowledge',
  config: { getMasked: async () => ({ schemaVersion: 1, configPath: root + '/agent-qa.config.yaml', entries: [] }) },
  model: () => ({ modelId: 'test:daemon-child', generate: async () => ({ text: 'unused' }) }),
})
process.exitCode = exitCode
`
const TYPESCRIPT_LOADER = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
    throw error
  }
}
`

const temporaryRoots: string[] = []
const HOST_INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const SUCCESSOR_INSTANCE_ID = '22222222-2222-4222-8222-222222222222'

function makePaths(label: string): {
  root: string
  agentQaRoot: string
  knowledgeRoot: string
  configPath: string
} {
  const root = mkdtempSync(join(tmpdir(), `agent-qa-daemon-${label}-`))
  temporaryRoots.push(root)
  return {
    root,
    agentQaRoot: join(root, '.agent-qa'),
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    configPath: join(root, 'agent-qa.config.yaml'),
  }
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/agent-qa.config.yaml',
    entries: [],
  }),
}

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:daemon-host',
  generate: () => Promise.resolve({ text: 'unused' }),
}

interface HostHarness {
  operations: Partial<DaemonHostOperations>
  traces: DaemonHostTraceStep[]
  signals: Map<NodeJS.Signals, () => void>
  fireHeartbeat(message?: HeartbeatSupervisorMessage): void
  crashHeartbeat(error?: Error): void
  signal(signal: NodeJS.Signals): void
}

interface DaemonInvocation {
  stdout: string
  stderr: string
  exitCode: number
}

async function invokeDaemon(
  deps: DaemonCommandDeps,
  args: readonly string[],
): Promise<DaemonInvocation> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.join(' '))
  })
  const previousExitCode = process.exitCode
  process.exitCode = undefined

  try {
    const program = new Command()
      .name('agent-qa')
      .option('--config <path>')
      .exitOverride()
    const daemon = createDaemonCommand(deps)
    daemon.exitOverride()
    program.addCommand(daemon)
    await program.parseAsync(
      ['node', 'agent-qa', '--config', '/project/agent-qa.config.yaml', 'daemon', ...args],
    )
    return {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exitCode: process.exitCode ?? 0,
    }
  } finally {
    process.exitCode = previousExitCode
    log.mockRestore()
    error.mockRestore()
  }
}

function daemonCommandDeps(
  paths: ReturnType<typeof makePaths>,
  options: {
    alive?: boolean
    curationQueueDepth?: number
    nowMs?: number
    signalProcess?: DaemonCommandDeps['signalProcess']
  } = {},
): DaemonCommandDeps {
  const startedAtMs = 1_700_000_000_000
  return {
    runHost: vi.fn(() => Promise.resolve(0)),
    resolvePaths: () => Promise.resolve(paths),
    readRegistration: readDaemonRegistration,
    processIsAlive: () => options.alive ?? true,
    readIdentity: (registration) => Promise.resolve({
      schemaVersion: 1,
      instanceId: registration.instanceId,
      pid: registration.pid,
    }),
    readWriterLease: () => ({
      kind: 'parsed',
      lease: {
        leaseId: '8d88b667-747f-4129-93f3-20ac5149bf57',
        pid: 4321,
        epoch: 7,
        heartbeatAtMs: startedAtMs + 4_000,
      },
    }),
    countPendingCurationJobs: () => options.curationQueueDepth ?? 3,
    signalProcess: options.signalProcess ?? vi.fn(),
    now: () => options.nowMs ?? startedAtMs + 5_000,
  }
}

function hostHarness(nowMs = 1_700_000_000_000): HostHarness {
  const traces: DaemonHostTraceStep[] = []
  const signals = new Map<NodeJS.Signals, () => void>()
  let heartbeat: Parameters<DaemonHostOperations['startHeartbeatSupervisor']>[0] | undefined

  return {
    traces,
    signals,
    operations: {
      now: () => nowMs,
      trace: (step) => traces.push(step),
      setInterval: (_callback, intervalMs) =>
        intervalMs as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
      setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => undefined,
      onSignal: (signal, listener) => {
        signals.set(signal, listener)
      },
      offSignal: (signal, listener) => {
        if (signals.get(signal) === listener) signals.delete(signal)
      },
      hardExit: (code) => {
        throw new Error(`unexpected hard exit ${code}`)
      },
      startHeartbeatSupervisor: async (options) => {
        heartbeat = options
        return {
          exited: Promise.resolve(),
          stop: async () => {
            heartbeat = undefined
          },
        }
      },
    },
    fireHeartbeat: (message) => {
      if (heartbeat === undefined) throw new Error('heartbeat supervisor was not installed')
      heartbeat.onMessage(message ?? heartbeatLease({
        knowledgeRoot: heartbeat.knowledgeRoot,
        leaseId: heartbeat.leaseId,
      }))
    },
    crashHeartbeat: (error = new Error('heartbeat worker crashed')) => {
      if (heartbeat === undefined) throw new Error('heartbeat supervisor was not installed')
      heartbeat.onUnexpectedExit(error)
    },
    signal: (signal) => {
      const listener = signals.get(signal)
      if (listener === undefined) throw new Error(`${signal} listener was not installed`)
      listener()
    },
  }
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * Leave a real socket inode behind with no listener, exactly as a SIGKILLed daemon does.
 *
 * An in-process server cannot produce this: Node unlinks the path on close. Only a listener that
 * never got to clean up leaves the artifact stale-socket recovery actually meets.
 */
async function abandonSocketFile(socketPath: string): Promise<void> {
  const child = spawn(
    process.execPath,
    ['-e', "require('node:net').createServer().listen(process.argv[1])", socketPath],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  try {
    await waitUntil(
      () => existsSync(socketPath),
      `abandoned socket ${socketPath} was never bound`,
      10_000,
    )
    if (!lstatSync(socketPath).isSocket()) throw new Error(`${socketPath} is not a socket`)
  } finally {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
}

/** Record-level reading goes through the shipped torn-tail-tolerant reader (WR-02). */
function readEvents(agentQaRoot: string): Array<Record<string, unknown>> {
  const ledger = readDaemonEventLedger(agentQaRoot)
  expect(ledger.warnings).toEqual([])
  return [...ledger.events]
}

const LATE_CANDIDATE_ID = 'c'.repeat(64)

function drainQueueReport(
  jobsProcessed: number,
  remaining: number,
): Awaited<ReturnType<DaemonHostOperations['drainQueue']>> {
  return {
    kind: 'drained' as const,
    jobsProcessed,
    committed: jobsProcessed,
    downgraded: 0,
    withheld: 0,
    quarantined: 0,
    requeued: 0,
    failures: 0,
    failureDetails: [],
    noops: 0,
    noopDetails: [],
    reconcile: undefined,
    writerPass: { kind: 'skipped' as const, reason: 'daemon-cadence' as const },
    gc: { kind: 'skipped' as const, reason: 'daemon-cadence' as const },
    remaining,
    remainingWork: { queued: remaining, claimedNonterminal: 0, quarantined: 0 },
  } as unknown as Awaited<ReturnType<DaemonHostOperations['drainQueue']>>
}

interface DrainHostHarness {
  readonly drainCalls: Array<Parameters<DaemonHostOperations['drainQueue']>[0]>
  readonly receipts: DrainSessionReceipt[]
  readonly errors: string[]
  nudge(requireReceipt: boolean): Promise<void>
  stop(): Promise<void>
}

/**
 * A daemon host whose curation inspection, counting, and drain are scripted.
 *
 * The nudge path is driven through the server's own `onNudge` handler rather than a socket, so the
 * receipt-required session under test is the production one and nothing about the transport is
 * part of the measurement.
 */
function drainHostHarness(options: {
  paths: ReturnType<typeof makePaths>
  author?: () => CuratorAuthor | Promise<CuratorAuthor>
  inspect: () => { queuedCandidateIds: string[]; recoverableClaimedCandidateIds: string[] }
  countRemaining: () => { queued: number; claimedNonterminal: number; quarantined: number }
  drainQueue: DaemonHostOperations['drainQueue']
}): DrainHostHarness {
  const signals = new Map<NodeJS.Signals, () => void>()
  const drainCalls: Array<Parameters<DaemonHostOperations['drainQueue']>[0]> = []
  const receipts: DrainSessionReceipt[] = []
  const errors: string[] = []
  let onNudge: ((nudge: { kind: 'candidates-enqueued'; requireReceipt: boolean }) => unknown)
    | undefined
  let drainSessions = 0

  const operations = {
    composeJobRecovery: () => ({
      store: { adoptEpoch: () => Promise.resolve({ epoch: 1 }) },
      recoverAbandonedClaims: () => Promise.resolve({ recovered: 0 }),
      resumePending: () => Promise.resolve([]),
      close: vi.fn(),
    }),
    composeLocalAgent: () => ({
      registry: {},
      jobs: () => Promise.resolve({
        queue: { runNextJob: () => Promise.resolve({ ran: false, reason: 'no-job' }) },
      }),
      close: vi.fn(),
    }),
    inspectDrainableCurationWork: () => options.inspect(),
    countRemainingCurationWork: () => options.countRemaining(),
    listQueuedCandidates: () => [],
    drainQueue: async (drainOptions: Parameters<DaemonHostOperations['drainQueue']>[0]) => {
      drainCalls.push(drainOptions)
      return await options.drainQueue(drainOptions)
    },
    appendDrainSessionReceipt: (_agentQaRoot: string, receipt: DrainSessionReceipt) => {
      receipts.push(receipt)
      drainSessions += 1
    },
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
    setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => {
      signals.set(signal, listener)
    },
    offSignal: (signal: NodeJS.Signals, listener: () => void) => {
      if (signals.get(signal) === listener) signals.delete(signal)
    },
    hardExit: (code: number) => {
      throw new Error(`unexpected hard exit ${code}`)
    },
    startHeartbeatSupervisor: () => Promise.resolve({
      exited: Promise.resolve(),
      stop: () => Promise.resolve(),
    }),
    startInvokeServer: (
      started: { socketPath: string; onNudge?: typeof onNudge },
    ) => {
      onNudge = started.onNudge
      return Promise.resolve({
        socketPath: started.socketPath,
        close: () => Promise.resolve(),
      })
    },
  } as unknown as Partial<DaemonHostOperations>

  const running = runDaemonHost({
    agentQaRoot: options.paths.agentQaRoot,
    knowledgeRoot: options.paths.knowledgeRoot,
    config: TEST_CONFIG,
    model: () => TEST_MODEL,
    ...(options.author === undefined ? {} : { author: options.author }),
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations,
    logger: { info: vi.fn(), error: (message) => errors.push(message) },
  })

  return {
    drainCalls,
    receipts,
    errors,
    async nudge(requireReceipt) {
      await waitUntil(() => onNudge !== undefined, 'invoke server was never started')
      const settled = drainCalls.length + drainSessions + errors.length
      onNudge!({ kind: 'candidates-enqueued', requireReceipt })
      await waitUntil(
        () => drainCalls.length + drainSessions + errors.length > settled,
        'the nudged drain session never settled',
      )
    },
    async stop() {
      const listener = signals.get('SIGTERM')
      if (listener === undefined) throw new Error('SIGTERM listener was not installed')
      listener()
      await expect(running).resolves.toBe(0)
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('runDaemonHost — standing leaseholder tracer', () => {
  it('pins posture, recovers under the minted epoch, composes once, beats, and stops cleanly', async () => {
    const paths = makePaths('tracer')
    const harness = hostHarness()
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'daemon registration was not written',
    )

    expect(getActiveExecutionContext()).toBe('local-headless')
    expect(harness.traces.slice(0, 10)).toEqual([
      'posture-pinned',
      'lease-acquired',
      'heartbeat-started',
      'recovery-composed',
      'epoch-adopted',
      'claims-recovered',
      'local-agent-composed',
      'jobs-opened',
      'registration-written',
    ])

    const registration = readDaemonRegistration(paths.agentQaRoot)
    expect(registration.kind).toBe('parsed')
    if (registration.kind !== 'parsed') throw new Error('expected parsed daemon registration')
    expect(registration.registration).toMatchObject({
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      pid: process.pid,
      startedAtMs: 1_700_000_000_000,
    })
    expect(registration.registration.instanceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isInteger(registration.registration.startedAtMs)).toBe(true)

    const beforeHeartbeat = JSON.parse(
      readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    expect(beforeHeartbeat).toMatchObject({ pid: process.pid, epoch: 1 })
    expect(Number.isInteger(beforeHeartbeat.heartbeatAtMs)).toBe(true)

    dateNow.mockReturnValue(1_700_000_005_000)
    harness.fireHeartbeat()
    const afterHeartbeat = JSON.parse(
      readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    expect(afterHeartbeat).toEqual({
      ...beforeHeartbeat,
      heartbeatAtMs: 1_700_000_005_000,
    })
    expect(readEvents(paths.agentQaRoot).map((event) => event.kind)).toEqual([
      'lease-acquired',
      'epoch-bump',
      'lease-heartbeated',
      'lease-heartbeated',
    ])

    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
    expect(existsSync(join(paths.knowledgeRoot, LEASE_FILE))).toBe(false)
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    expect(readEvents(paths.agentQaRoot).at(-1)).toMatchObject({
      kind: 'daemon-stopped',
      exitCode: 0,
      reason: 'signal',
    })
  })

  it('refuses a second host without changing lease, registration, or queue-store bytes', async () => {
    const paths = makePaths('double-start')
    const harness = hostHarness()
    const first = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'first daemon registration was not written',
    )

    const leasePath = join(paths.knowledgeRoot, LEASE_FILE)
    const registrationPath = join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)
    const storePath = join(paths.agentQaRoot, 'agent-jobs.db')
    const before = {
      lease: readFileSync(leasePath),
      registration: readFileSync(registrationPath),
      store: readFileSync(storePath),
    }
    const errors: string[] = []
    const secondModel = vi.fn(() => TEST_MODEL)

    await expect(runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: secondModel,
      logger: { info: vi.fn(), error: (message) => errors.push(message) },
    })).resolves.toBe(1)

    expect(secondModel).not.toHaveBeenCalled()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`pid ${process.pid}`)
    expect(errors[0]).toContain('daemon registration since ')
    expect(readFileSync(leasePath)).toEqual(before.lease)
    expect(readFileSync(registrationPath)).toEqual(before.registration)
    expect(readFileSync(storePath)).toEqual(before.store)

    harness.signal('SIGTERM')
    await expect(first).resolves.toBe(0)
  })

  it('tears down real child-process artifacts on SIGTERM and exits zero', async () => {
    const paths = makePaths('child')
    const loaderPath = join(paths.root, 'typescript-loader.mjs')
    writeFileSync(loaderPath, TYPESCRIPT_LOADER, 'utf8')
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--experimental-loader',
        pathToFileURL(loaderPath).href,
        '--input-type=module',
        '--eval',
        CHILD_SCRIPT,
      ],
      {
        env: {
          ...process.env,
          [CHILD_ROOT_ENV]: paths.root,
          [CHILD_HOST_URL_ENV]: new URL('../daemon/host.ts', import.meta.url).href,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })

    try {
      await waitUntil(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`daemon child exited before registration:\n${output}`)
        }
        return existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
      }, `daemon child never registered:\n${output}`)
      expect(child.kill('SIGTERM')).toBe(true)
      const [code, signal] = (await once(child, 'exit')) as [number | null, string | null]
      expect({ code, signal, output: code === 0 ? '' : output }).toEqual({
        code: 0,
        signal: null,
        output: '',
      })
      expect(existsSync(join(paths.knowledgeRoot, LEASE_FILE))).toBe(false)
      expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 60_000)
})

describe('daemon status and stop operator controls', () => {
  it('reports live holder, uptime, and curation depth in human and JSON forms', async () => {
    const paths = makePaths('status-live')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 4321,
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const deps = daemonCommandDeps(paths, { curationQueueDepth: 3 })

    const human = await invokeDaemon(deps, ['status'])
    expect(human).toMatchObject({ exitCode: 0, stderr: '' })
    expect(human.stdout).toContain('pid 4321')
    expect(human.stdout).toContain('uptime 5s')
    expect(human.stdout).toContain('curation queue depth 3')

    const json = await invokeDaemon(deps, ['status', '--json'])
    expect(json).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(json.stdout)).toMatchObject({
      state: 'running',
      pid: 4321,
      startedAtMs: 1_700_000_000_000,
      uptimeMs: 5_000,
      curationQueueDepth: 3,
      lease: { pid: 4321, epoch: 7, heartbeatAtMs: 1_700_000_004_000 },
    })
  })

  it('reports absent and stale registrations as stopped states without failing status', async () => {
    const absentPaths = makePaths('status-absent')
    const absent = await invokeDaemon(daemonCommandDeps(absentPaths), ['status'])
    expect(absent).toMatchObject({ exitCode: 0, stderr: '' })
    expect(absent.stdout).toContain('not running')

    const stalePaths = makePaths('status-stale')
    writeDaemonRegistration(stalePaths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 8765,
      socketPath: join(stalePaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const stale = await invokeDaemon(daemonCommandDeps(stalePaths, { alive: false }), ['status'])
    expect(stale).toMatchObject({ exitCode: 0, stderr: '' })
    expect(stale.stdout).toContain('stale')
    expect(stale.stdout).toContain('pid 8765')
  })

  it('signals only a live registered pid and fails closed for absent or stale registrations', async () => {
    const livePaths = makePaths('stop-live')
    writeDaemonRegistration(livePaths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 5432,
      socketPath: join(livePaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const signalProcess = vi.fn()
    const live = await invokeDaemon(daemonCommandDeps(livePaths, { signalProcess }), ['stop'])
    expect(live).toMatchObject({ exitCode: 0, stderr: '' })
    expect(signalProcess).toHaveBeenCalledWith(5432, 'SIGTERM')

    const absentPaths = makePaths('stop-absent')
    const absentSignal = vi.fn()
    const absent = await invokeDaemon(
      daemonCommandDeps(absentPaths, { signalProcess: absentSignal }),
      ['stop'],
    )
    expect(absent.exitCode).toBe(1)
    expect(absent.stdout).toContain('nothing to stop')
    expect(absentSignal).not.toHaveBeenCalled()

    const stalePaths = makePaths('stop-stale')
    writeDaemonRegistration(stalePaths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 6543,
      socketPath: join(stalePaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const staleSignal = vi.fn()
    const stale = await invokeDaemon(
      daemonCommandDeps(stalePaths, { alive: false, signalProcess: staleSignal }),
      ['stop'],
    )
    expect(stale.exitCode).toBe(1)
    expect(stale.stdout).toContain('stale registration')
    expect(staleSignal).not.toHaveBeenCalled()
  })

  it('refuses to signal a reused live pid whose socket reports a foreign instance nonce', async () => {
    const paths = makePaths('stop-pid-reuse')
    const signalProcess = vi.fn()
    const registration: DaemonRegistration = {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 5432,
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    }
    const readIdentity = vi.fn(() => Promise.resolve({
      schemaVersion: 1 as const,
      instanceId: SUCCESSOR_INSTANCE_ID,
      pid: 5432,
    }))
    const deps: DaemonCommandDeps = {
      ...daemonCommandDeps(paths, { signalProcess }),
      readRegistration: () => ({ kind: 'parsed' as const, registration }),
      readIdentity,
    }

    const stopped = await invokeDaemon(deps, ['stop'])

    expect(stopped.exitCode).toBe(1)
    expect(stopped.stdout).toContain('stale')
    expect(readIdentity).toHaveBeenCalledTimes(1)
    expect(signalProcess).not.toHaveBeenCalled()
  })

  it('classifies an unreachable registered instance as stale instead of running', async () => {
    const paths = makePaths('status-unreachable-instance')
    const registration: DaemonRegistration = {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 4321,
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    }
    const deps: DaemonCommandDeps = {
      ...daemonCommandDeps(paths),
      readRegistration: () => ({ kind: 'parsed' as const, registration }),
      readIdentity: vi.fn(() => Promise.reject(new Error('socket refused'))),
    }

    const status = await invokeDaemon(deps, ['status', '--json'])

    expect(status.exitCode).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ state: 'stale', pid: 4321 })
  })
})

describe('daemon registration instance ownership and readiness', () => {
  it('requires an instance nonce and treats the previous schema version as stale', () => {
    const currentPaths = makePaths('registration-current-version')
    expect(() => writeDaemonRegistration(currentPaths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(currentPaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })).not.toThrow()
    expect(readDaemonRegistration(currentPaths.agentQaRoot)).toMatchObject({
      kind: 'parsed',
      registration: { instanceId: HOST_INSTANCE_ID },
    })

    const legacyPaths = makePaths('registration-legacy-version')
    mkdirSync(legacyPaths.agentQaRoot, { recursive: true })
    writeFileSync(join(legacyPaths.agentQaRoot, DAEMON_REGISTRATION_FILE), JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      socketPath: join(legacyPaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    }), { encoding: 'utf8', flag: 'w' })
    expect(inspectDaemonRegistration(legacyPaths.agentQaRoot, () => true).kind).toBe('stale')
  })

  it('preserves successor bytes when replacement wins the quarantine barrier', () => {
    const paths = makePaths('registration-two-generations')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(paths.agentQaRoot, 'host.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    expect(readDaemonRegistration(paths.agentQaRoot)).toMatchObject({
      kind: 'parsed',
      registration: { instanceId: HOST_INSTANCE_ID },
    })
    const successor: DaemonRegistration = {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: SUCCESSOR_INSTANCE_ID,
      pid: process.pid + 1,
      socketPath: join(paths.agentQaRoot, 'successor.sock'),
      startedAtMs: 1_700_000_001_000,
    }
    let successorBytes: Buffer | undefined

    expect(removeRegistrationIfOwned(paths.agentQaRoot, HOST_INSTANCE_ID, {
      beforeQuarantineRename: () => {
        writeDaemonRegistration(paths.agentQaRoot, successor)
        successorBytes = readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
      },
    })).toBe(false)
    expect(readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toEqual(
      successorBytes,
    )
  })

  it('removes an owned registration and fsyncs its parent after quarantine transitions', () => {
    const paths = makePaths('registration-owned-remove')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(paths.agentQaRoot, 'host.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const fsyncDirectory = vi.fn()

    expect(removeRegistrationIfOwned(paths.agentQaRoot, HOST_INSTANCE_ID, {
      fsyncDirectory,
    })).toBe(true)
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    expect(fsyncDirectory).toHaveBeenCalledWith(paths.agentQaRoot)
    expect(fsyncDirectory.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('drops a mismatched quarantine when a third registration already occupies the path', () => {
    const paths = makePaths('registration-mismatch-restore')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: SUCCESSOR_INSTANCE_ID,
      pid: process.pid + 1,
      socketPath: join(paths.agentQaRoot, 'successor.sock'),
      startedAtMs: 1_700_000_001_000,
    })
    const third: DaemonRegistration = {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: '33333333-3333-4333-8333-333333333333',
      pid: process.pid + 2,
      socketPath: join(paths.agentQaRoot, 'third.sock'),
      startedAtMs: 1_700_000_002_000,
    }
    let thirdBytes: Buffer | undefined

    expect(removeRegistrationIfOwned(paths.agentQaRoot, HOST_INSTANCE_ID, {
      afterQuarantine: () => {
        writeDaemonRegistration(paths.agentQaRoot, third)
        thirdBytes = readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
      },
    })).toBe(false)
    expect(readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toEqual(thirdBytes)
    expect(
      readdirSync(paths.agentQaRoot).filter((name) => name.includes('.remove-')),
    ).toEqual([])
  })

  it('publishes registration only after the invoke socket has finished listening', async () => {
    const paths = makePaths('registration-after-listen')
    const harness = hostHarness()
    let listening = false
    let resolveListen: ((handle: { socketPath: string; close(): Promise<void> }) => void) | undefined
    const startServer = vi.fn(() => new Promise<{
      socketPath: string
      close(): Promise<void>
    }>((resolve) => {
      resolveListen = resolve
    }))
    let registrationPublishedBeforeListen = false
    const writeRegistration = vi.fn((...args: Parameters<typeof writeDaemonRegistration>) => {
      if (!listening) registrationPublishedBeforeListen = true
      writeDaemonRegistration(...args)
    })

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        startInvokeServer: startServer,
        writeDaemonRegistration: writeRegistration,
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(() => startServer.mock.calls.length === 1, 'invoke server was not started')
    const presentWhileListenPending = existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
    listening = true
    resolveListen?.({
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      close: () => Promise.resolve(),
    })
    await waitUntil(
      () => writeRegistration.mock.calls.length === 1,
      'registration was not published after listen',
    )
    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)

    expect(presentWhileListenPending).toBe(false)
    expect(registrationPublishedBeforeListen).toBe(false)
  })

  it('leaves no registration publication when invoke socket binding fails', async () => {
    const paths = makePaths('registration-bind-failure')
    const harness = hostHarness()
    const writeRegistration = vi.fn(writeDaemonRegistration)

    await expect(runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        writeDaemonRegistration: writeRegistration,
        startInvokeServer: () => Promise.reject(new Error('bind failed')),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })).rejects.toThrow('bind failed')

    expect(writeRegistration).not.toHaveBeenCalled()
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
  })
})

describe('daemon socket addressing per generation', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  it('discriminates every socket arm by instance while keeping the byte budget', () => {
    const projectRoot = '/tmp/p'
    const agentQaRoot = `${projectRoot}/.agent-qa`

    const projectLocal = daemonSocketPath(agentQaRoot, projectRoot, HOST_INSTANCE_ID)
    const projectLocalSuccessor = daemonSocketPath(
      agentQaRoot,
      projectRoot,
      SUCCESSOR_INSTANCE_ID,
    )
    expect(projectLocal.startsWith(`${agentQaRoot}/daemon-`)).toBe(true)
    expect(projectLocal.endsWith('.sock')).toBe(true)
    expect(projectLocal).not.toBe(projectLocalSuccessor)
    expect(daemonSocketPath(agentQaRoot, projectRoot, HOST_INSTANCE_ID)).toBe(projectLocal)
    expect(Buffer.byteLength(projectLocal))
      .toBeLessThanOrEqual(DAEMON_SOCKET_PATH_BUDGET_BYTES)

    // A project-local path that no longer fits must still discriminate in the fallback arm.
    const deepAgentQaRoot = `/tmp/${'d'.repeat(120)}/.agent-qa`
    const fallback = daemonSocketPath(deepAgentQaRoot, projectRoot, HOST_INSTANCE_ID)
    const fallbackSuccessor = daemonSocketPath(
      deepAgentQaRoot,
      projectRoot,
      SUCCESSOR_INSTANCE_ID,
    )
    expect(fallback.startsWith(deepAgentQaRoot)).toBe(false)
    expect(fallback).not.toBe(fallbackSuccessor)
    expect(fallback).not.toBe(projectLocal)
    expect(Buffer.byteLength(fallback)).toBeLessThanOrEqual(DAEMON_SOCKET_PATH_BUDGET_BYTES)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const pipe = daemonSocketPath(agentQaRoot, projectRoot, HOST_INSTANCE_ID)
    const pipeSuccessor = daemonSocketPath(agentQaRoot, projectRoot, SUCCESSOR_INSTANCE_ID)
    expect(pipe.startsWith('\\\\.\\pipe\\agent-qa-')).toBe(true)
    expect(pipe).not.toBe(pipeSuccessor)
  })

  it('refuses an instance discriminator that is not a daemon instance nonce', () => {
    expect(() => daemonSocketPath('/tmp/p/.agent-qa', '/tmp/p', 'not-a-uuid')).toThrow()
  })
})

describe('daemon registration recovery at boot', () => {
  it('recovers an alive-pid registration with no listener once its writer lease is stale', async () => {
    const paths = makePaths('boot-alive-no-listener-stale-lease')
    const nowMs = Date.now()
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), `${JSON.stringify({
      leaseId: '6bcefd58-bc64-4d9d-a491-324658b125ca',
      pid: process.pid,
      epoch: 1,
      heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })}\n`)
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: daemonSocketPath(paths.agentQaRoot, paths.root, HOST_INSTANCE_ID),
      startedAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })
    const harness = hostHarness(nowMs)

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })

    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'alive-pid stale registration was not recovered',
      3_000,
    )
    expect(harness.traces).toContain('lease-acquired')
    expect(readEvents(paths.agentQaRoot)).toContainEqual(expect.objectContaining({
      kind: 'registration-recovered',
      instanceId: HOST_INSTANCE_ID,
    }))
    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
  })

  it('recovers a foreign identity for an alive pid once its writer lease is stale', async () => {
    const paths = makePaths('boot-foreign-identity-stale-lease')
    const nowMs = Date.now()
    const socketPath = daemonSocketPath(paths.agentQaRoot, paths.root, HOST_INSTANCE_ID)
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), `${JSON.stringify({
      leaseId: 'f48afbd4-d67c-48aa-a488-e1890133542c',
      pid: process.pid,
      epoch: 1,
      heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })}\n`)
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath,
      startedAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })
    const foreign = await startInvokeServer({
      socketPath,
      registry: {} as never,
      identity: {
        schemaVersion: 1,
        instanceId: SUCCESSOR_INSTANCE_ID,
        pid: process.pid,
      },
    })
    const harness = hostHarness(nowMs)

    try {
      const running = runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        config: TEST_CONFIG,
        model: () => TEST_MODEL,
        operations: {
          ...harness.operations,
          startInvokeServer: () => Promise.resolve({
            socketPath: join(paths.agentQaRoot, 'successor.sock'),
            close: () => Promise.resolve(),
          }),
        },
        logger: { info: vi.fn(), error: vi.fn() },
      })

      await waitUntil(
        () => harness.signals.has('SIGTERM'),
        'foreign identity registration was not recovered',
        3_000,
      )
      expect(harness.traces).toContain('lease-acquired')
      harness.signal('SIGTERM')
      await expect(running).resolves.toBe(0)
    } finally {
      await foreign.close()
    }
  })

  it('refuses an unreachable registration while a different writer lease is fresh', async () => {
    const paths = makePaths('boot-unreachable-fresh-lease')
    const nowMs = Date.now()
    const leaseHolderPid = process.pid + 10_000
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    // The epoch file is published BEFORE the lease by every real acquisition, and after 386-36
    // composite freshness reads it: a lease naming an epoch the disk does not agree with is
    // recovery input, not a fresh holder. Writing only the lease described a root no acquisition
    // can produce, which made this leg assert freshness it was not actually demonstrating.
    writeFileSync(join(paths.knowledgeRoot, EPOCH_FILE), '4\n')
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), `${JSON.stringify({
      leaseId: 'd97c6375-c7b5-4581-aae8-bc0f20926bcf',
      pid: leaseHolderPid,
      epoch: 4,
      heartbeatAtMs: nowMs - 1,
    })}\n`)
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: daemonSocketPath(paths.agentQaRoot, paths.root, HOST_INSTANCE_ID),
      startedAtMs: nowMs - 5_000,
    })
    const acquire = vi.fn()
    const errors: string[] = []

    await expect(runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: { acquireWriterLease: acquire as never },
      logger: { info: vi.fn(), error: (message) => errors.push(message) },
    })).resolves.toBe(1)

    expect(acquire).not.toHaveBeenCalled()
    expect(errors).toEqual([
      expect.stringContaining(`pid ${leaseHolderPid}`),
    ])
    expect(readDaemonRegistration(paths.agentQaRoot).kind).toBe('parsed')
  })

  it('bounds a never-resolving identity handshake by the pinned timeout', async () => {
    const paths = makePaths('classification-timeout')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(paths.agentQaRoot, 'never.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const registrationModule = await import('../daemon/registration.js') as unknown as {
      DAEMON_IDENTITY_HANDSHAKE_TIMEOUT_MS: number
      classifyDaemonRegistration(input: {
        agentQaRoot: string
        knowledgeRoot: string
        operations: {
          fetchIdentity(): Promise<never>
        }
      }): Promise<{ kind: string }>
    }
    const startedAt = Date.now()

    const outcome = await registrationModule.classifyDaemonRegistration({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      operations: { fetchIdentity: () => new Promise<never>(() => undefined) },
    })

    expect(outcome.kind).toBe('unreachable-lease-stale')
    expect(Date.now() - startedAt).toBeLessThanOrEqual(
      registrationModule.DAEMON_IDENTITY_HANDSHAKE_TIMEOUT_MS + 500,
    )
  })

  it('removes a dead-pid registration before acquiring and proceeds', async () => {
    const paths = makePaths('boot-stale')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: 2_147_483_647,
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const harness = hostHarness()
    let registrationPresentAtAcquire: boolean | undefined
    const acquire = vi.fn((knowledgeRoot: string) => {
      registrationPresentAtAcquire = existsSync(
        join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE),
      )
      return acquireWriterLease(knowledgeRoot)
    })
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        acquireWriterLease: acquire,
        removeDaemonRegistration,
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not replace the stale registration',
    )
    expect(acquire).toHaveBeenCalledTimes(1)
    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
    expect(registrationPresentAtAcquire).toBe(false)
  })

  it('fails before lease acquisition when a registration names a live pid', async () => {
    const paths = makePaths('boot-live')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    })
    const before = readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
    const acquire = vi.fn(() => ({
      kind: 'held' as const,
      holder: {
        leaseId: '8d88b667-747f-4129-93f3-20ac5149bf57',
        pid: process.pid,
        epoch: 1,
        heartbeatAtMs: 1_700_000_000_000,
      },
    }))
    const errors: string[] = []

    await expect(runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        acquireWriterLease: acquire,
        classifyDaemonRegistration: async () => {
          const outcome = readDaemonRegistration(paths.agentQaRoot)
          if (outcome.kind !== 'parsed') throw new Error('expected parsed registration')
          return { kind: 'live-confirmed', registration: outcome.registration }
        },
      },
      logger: { info: vi.fn(), error: (message) => errors.push(message) },
    })).resolves.toBe(1)

    expect(acquire).not.toHaveBeenCalled()
    expect(errors[0]).toContain(`pid ${process.pid}`)
    expect(readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toEqual(before)
  })

  it('exits non-zero naming the refusal when the writer lease is unreclaimable (V-02)', async () => {
    const paths = makePaths('boot-unreclaimable')
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    const dbPath = join(paths.knowledgeRoot, WRITER_AUTHORITY_DB_FILE)

    // The verifier's Probe A shape reached through the real daemon entry point: an unattributable
    // mutation-lock row (escalation can never fire) plus a genuinely held write transaction.
    const seed = new DatabaseSync(dbPath)
    try {
      seed.exec('PRAGMA journal_mode = WAL')
      seed.exec(`
        CREATE TABLE IF NOT EXISTS mutation_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          generation_token TEXT NOT NULL,
          pid INTEGER NOT NULL CHECK (pid > 0),
          acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
          incarnation TEXT
        ) STRICT
      `)
      seed.prepare(`
        INSERT OR REPLACE INTO mutation_lock
          (id, generation_token, pid, acquired_at_ms, incarnation)
        VALUES (1, 'wedged-generation', ?, ?, NULL)
      `).run(process.pid, Date.now())
    } finally {
      seed.close()
    }

    const blocker = new DatabaseSync(dbPath)
    blocker.exec('PRAGMA busy_timeout = 250')
    blocker.exec('BEGIN IMMEDIATE')
    const errors: string[] = []
    try {
      await expect(runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        config: TEST_CONFIG,
        model: () => TEST_MODEL,
        operations: {
          acquireWriterLease: (knowledgeRoot) => acquireWriterLease(knowledgeRoot, {
            acquireDeadlineMs: 1_500,
          }),
        },
        logger: { info: vi.fn(), error: (message) => errors.push(message) },
      })).resolves.toBe(1)
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
    }

    expect(errors.join('\n')).toContain('mutation-lock-unreclaimable')
    expect(errors.join('\n')).toContain(`pid ${process.pid}`)
    expect(errors.join('\n')).toContain('unattributed')
  }, 30_000)

  it('keeps a successor registration published between classification and cleanup', async () => {
    // Short label: the successor's socket path is explicit here and must stay inside the
    // platform's sun_path limit without the daemonSocketPath fallback's help.
    const paths = makePaths('toctou')
    const nowMs = Date.now()
    const successorSocket = join(paths.root, 's.sock')
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), `${JSON.stringify({
      leaseId: '0a1cf5b4-64a5-4d31-9d2a-95c1c4c72b52',
      pid: process.pid,
      epoch: 1,
      heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })}\n`)
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: join(paths.agentQaRoot, 'never.sock'),
      startedAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })
    const successorRegistration: DaemonRegistration = {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: SUCCESSOR_INSTANCE_ID,
      pid: process.pid,
      socketPath: successorSocket,
      startedAtMs: nowMs,
    }
    const successorServer = await startInvokeServer({
      socketPath: successorSocket,
      registry: {} as never,
      identity: {
        schemaVersion: 1,
        instanceId: SUCCESSOR_INSTANCE_ID,
        pid: process.pid,
      },
    })
    let successorBytes: Buffer | undefined
    let barrierFired = false
    // The barrier IS the schedule under test: a successor publishes in the window between the
    // late starter's classification and its cleanup.
    const classify = vi.fn(async (
      input: Parameters<DaemonHostOperations['classifyDaemonRegistration']>[0],
    ) => {
      const outcome = await classifyDaemonRegistration(input)
      if (!barrierFired) {
        barrierFired = true
        writeDaemonRegistration(paths.agentQaRoot, successorRegistration)
        successorBytes = readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))
      }
      return outcome
    })
    const acquire = vi.fn(() => {
      throw new Error('startup contended for authority against a live successor')
    })
    const unconditionalRemove = vi.fn(removeDaemonRegistration)
    const errors: string[] = []
    let outcome: unknown

    try {
      outcome = await runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        config: TEST_CONFIG,
        model: () => TEST_MODEL,
        operations: {
          classifyDaemonRegistration: classify,
          acquireWriterLease: acquire as never,
          removeDaemonRegistration: unconditionalRemove,
        },
        logger: { info: vi.fn(), error: (message) => errors.push(message) },
      }).catch((error: unknown) => error)
    } finally {
      await successorServer.close()
    }

    const registrationFile = join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)
    expect(barrierFired).toBe(true)
    expect(
      existsSync(registrationFile),
      'the late starter deleted a registration it never classified',
    ).toBe(true)
    expect(readFileSync(registrationFile)).toEqual(successorBytes)
    expect(unconditionalRemove).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(classify.mock.calls.length).toBe(2)
    expect(errors).toEqual([expect.stringContaining('daemon registration since')])
    expect(outcome).toBe(1)
  })

  it('classifies a registration whose recorded socket path is a plain file', async () => {
    const paths = makePaths('non-socket')
    mkdirSync(paths.agentQaRoot, { recursive: true })
    const plainFile = join(paths.agentQaRoot, 'not-really.sock')
    writeFileSync(plainFile, '')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: plainFile,
      startedAtMs: 1_700_000_000_000,
    })

    // Registration bytes select a connect() target, so a non-socket path is attacker-shaped input
    // and must classify as unreachable rather than escape as an unhandled EINVAL.
    await expect(classifyDaemonRegistration({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
    })).resolves.toMatchObject({ kind: 'unreachable-lease-stale' })
  })

  it('unlinks only the socket recorded in the registration it exactly removed', async () => {
    const paths = makePaths('sock-exact')
    const nowMs = Date.now()
    mkdirSync(paths.knowledgeRoot, { recursive: true })
    mkdirSync(paths.agentQaRoot, { recursive: true })
    // Real, abandoned socket inodes under paths.root: an unlink target must be a socket, and the
    // explicit paths have to fit inside sun_path without daemonSocketPath's fallback.
    const recordedSocket = join(paths.root, 'r.sock')
    const bystanderSocket = join(paths.root, 'b.sock')
    const plainFile = join(paths.root, 'p.file')
    await abandonSocketFile(recordedSocket)
    await abandonSocketFile(bystanderSocket)
    writeFileSync(plainFile, '')
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), `${JSON.stringify({
      leaseId: '9d1a9e07-3fd5-4a3f-b0da-7c1a9b6bb3f8',
      pid: process.pid,
      epoch: 1,
      heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })}\n`)
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: HOST_INSTANCE_ID,
      pid: process.pid,
      socketPath: recordedSocket,
      startedAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS,
    })
    const harness = hostHarness(nowMs)
    const removeOwned = vi.fn(removeRegistrationIfOwned)
    const unconditionalRemove = vi.fn(removeDaemonRegistration)

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        removeRegistrationIfOwned: removeOwned,
        removeDaemonRegistration: unconditionalRemove,
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'stale registration recovery never reached readiness',
      5_000,
    )

    expect(
      { recorded: existsSync(recordedSocket), bystander: existsSync(bystanderSocket) },
      'cleanup must unlink the recorded socket and only the recorded socket',
    ).toEqual({ recorded: false, bystander: true })
    expect(unconditionalRemove).not.toHaveBeenCalled()
    expect(removeOwned).toHaveBeenCalledWith(paths.agentQaRoot, HOST_INSTANCE_ID)
    expect(readEvents(paths.agentQaRoot)).toContainEqual(expect.objectContaining({
      kind: 'registration-recovered',
      instanceId: HOST_INSTANCE_ID,
      socketPath: recordedSocket,
      socketRemoved: true,
    }))

    // A recorded path that is not a socket selects no deletion at all.
    expect(unlinkDaemonSocket(plainFile)).toBe(false)
    expect(existsSync(plainFile)).toBe(true)
    expect(unlinkDaemonSocket(join(paths.root, 'absent.sock'))).toBe(false)

    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
  })

  it('removes an obsolete registration only when its quarantined bytes still match', async () => {
    const registrationModule = await import('../daemon/registration.js') as unknown as {
      removeObsoleteDaemonRegistrationIfExpected(
        agentQaRoot: string,
        expected: {
          schemaVersion: 1
          pid: number
          socketPath: string
          startedAtMs: number
        },
        options?: { beforeQuarantineRename?: () => void },
      ): boolean
    }
    expect(typeof registrationModule.removeObsoleteDaemonRegistrationIfExpected).toBe('function')

    const matchPaths = makePaths('obsolete-match')
    mkdirSync(matchPaths.agentQaRoot, { recursive: true })
    const legacy = {
      schemaVersion: 1 as const,
      pid: process.pid,
      socketPath: join(matchPaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    }
    writeFileSync(
      join(matchPaths.agentQaRoot, DAEMON_REGISTRATION_FILE),
      `${JSON.stringify(legacy)}\n`,
      'utf8',
    )
    expect(registrationModule.removeObsoleteDaemonRegistrationIfExpected(
      matchPaths.agentQaRoot,
      legacy,
    )).toBe(true)
    expect(existsSync(join(matchPaths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)

    const mismatchPaths = makePaths('obsolete-mismatch')
    mkdirSync(mismatchPaths.agentQaRoot, { recursive: true })
    const predecessor = {
      schemaVersion: 1 as const,
      pid: process.pid,
      socketPath: join(mismatchPaths.agentQaRoot, 'daemon.sock'),
      startedAtMs: 1_700_000_000_000,
    }
    writeFileSync(
      join(mismatchPaths.agentQaRoot, DAEMON_REGISTRATION_FILE),
      `${JSON.stringify(predecessor)}\n`,
      'utf8',
    )
    let successorBytes: Buffer | undefined

    expect(registrationModule.removeObsoleteDaemonRegistrationIfExpected(
      mismatchPaths.agentQaRoot,
      predecessor,
      {
        beforeQuarantineRename: () => {
          writeDaemonRegistration(mismatchPaths.agentQaRoot, {
            schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
            instanceId: SUCCESSOR_INSTANCE_ID,
            pid: process.pid + 1,
            socketPath: join(mismatchPaths.agentQaRoot, 'successor.sock'),
            startedAtMs: 1_700_000_005_000,
          })
          successorBytes = readFileSync(
            join(mismatchPaths.agentQaRoot, DAEMON_REGISTRATION_FILE),
          )
        },
      },
    )).toBe(false)
    expect(readFileSync(join(mismatchPaths.agentQaRoot, DAEMON_REGISTRATION_FILE)))
      .toEqual(successorBytes)
    expect(
      readdirSync(mismatchPaths.agentQaRoot).filter((name) => name.includes('.remove-')),
    ).toEqual([])
  })
})

describe('daemon heartbeat authority and cadence', () => {
  it('protects the same lease throughout startup work that outlives the heartbeat TTL', async () => {
    const paths = makePaths('heartbeat-slow-startup')
    const harness = hostHarness()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const heartbeats = vi.fn(heartbeatLease)
    let resolveModel: ((model: JobModelCapability) => void) | undefined
    const model = vi.fn(() => new Promise<JobModelCapability>((resolve) => {
      resolveModel = resolve
    }))

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model,
      operations: { ...harness.operations, heartbeatLease: heartbeats },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await Promise.resolve()

    const acquiredLease = JSON.parse(
      readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    now.mockReturnValue(1_700_000_000_000 + LEASE_HEARTBEAT_TTL_MS + 1)
    let heartbeatError: unknown
    try {
      harness.fireHeartbeat(heartbeats({
        knowledgeRoot: paths.knowledgeRoot,
        leaseId: acquiredLease.leaseId,
      }))
    } catch (error) {
      heartbeatError = error
    }
    const contender = acquireWriterLease(paths.knowledgeRoot)

    resolveModel?.(TEST_MODEL)
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not finish slow startup',
    )
    const readyLease = JSON.parse(
      readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    harness.signal('SIGTERM')
    const exitCode = await running

    expect(model).toHaveBeenCalledTimes(1)
    expect(heartbeatError).toBeUndefined()
    expect(heartbeats).toHaveBeenCalledTimes(2)
    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: acquiredLease.leaseId, epoch: acquiredLease.epoch },
    })
    expect(readyLease).toMatchObject({
      leaseId: acquiredLease.leaseId,
      epoch: acquiredLease.epoch,
      heartbeatAtMs: 1_700_000_000_000 + LEASE_HEARTBEAT_TTL_MS + 1,
    })
    expect(exitCode).toBe(0)
  })

  it('aborts an initially refused heartbeat before publishing any service state', async () => {
    const paths = makePaths('heartbeat-startup-refusal')
    const harness = hostHarness()
    const replacement: WriterLease = {
      leaseId: '551a9f42-7862-43ac-a6bf-236b53c51b24',
      pid: process.pid + 1,
      epoch: 2,
      heartbeatAtMs: 1_700_000_010_000,
    }
    const replacementBytes = `${JSON.stringify(replacement)}\n`
    const refusedHeartbeat = vi.fn(() => {
      writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), replacementBytes, 'utf8')
      return {
        kind: 'refused' as const,
        reason: 'lease-id-mismatch' as const,
        holder: replacement,
      }
    })
    const release = vi.fn(releaseLease)
    const model = vi.fn(() => TEST_MODEL)
    const writeRegistration = vi.fn(writeDaemonRegistration)
    const startServer = vi.fn(() => Promise.resolve({
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      close: () => Promise.resolve(),
    }))

    const exitCode = await runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model,
      operations: {
        ...harness.operations,
        heartbeatLease: refusedHeartbeat,
        releaseLease: release,
        writeDaemonRegistration: writeRegistration,
        startInvokeServer: startServer,
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })

    expect(exitCode).toBe(1)
    expect(refusedHeartbeat).toHaveBeenCalledTimes(1)
    expect(model).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    expect(writeRegistration).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    expect(existsSync(join(paths.agentQaRoot, 'daemon.sock'))).toBe(false)
    expect(readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8')).toBe(replacementBytes)
  })

  it('settles and releases authority when lifecycle event appends throw', async () => {
    const paths = makePaths('event-append-failure')
    const harness = hostHarness()
    const errors: string[] = []
    const appendEvent = vi.fn(() => {
      throw new Error('event sink unavailable')
    })
    const startServer = vi.fn(() => Promise.resolve({
      socketPath: join(paths.agentQaRoot, 'daemon.sock'),
      close: () => Promise.resolve(),
    }))
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        appendDaemonEvent: appendEvent,
        startInvokeServer: startServer,
      },
      logger: { info: vi.fn(), error: (message) => errors.push(message) },
    })
    const outcome = running.then(
      (code) => ({ kind: 'resolved' as const, code }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    const first = await Promise.race([
      waitUntil(
        () => harness.signals.has('SIGTERM'),
        'daemon did not reach its signalable state',
      ).then(() => 'ready' as const),
      outcome.then(() => 'settled' as const),
    ])
    if (first === 'ready') harness.signal('SIGTERM')
    const settled = await outcome

    expect(settled).toEqual({ kind: 'resolved', code: 0 })
    expect(appendEvent).toHaveBeenCalled()
    expect(errors.some((message) => message.includes('event sink unavailable'))).toBe(true)
    expect(existsSync(join(paths.knowledgeRoot, LEASE_FILE))).toBe(false)
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
  })

  it('logs authority loss and exits without reacquiring or disturbing the replacement holder', async () => {
    const paths = makePaths('heartbeat-refusal')
    const harness = hostHarness()
    const acquire = vi.fn((knowledgeRoot: string) => acquireWriterLease(knowledgeRoot))
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: { ...harness.operations, acquireWriterLease: acquire },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not finish heartbeat startup',
    )

    const replacement: WriterLease = {
      leaseId: '551a9f42-7862-43ac-a6bf-236b53c51b24',
      pid: process.pid + 1,
      epoch: 2,
      heartbeatAtMs: 1_700_000_010_000,
    }
    const replacementBytes = `${JSON.stringify(replacement)}\n`
    writeFileSync(join(paths.knowledgeRoot, LEASE_FILE), replacementBytes, 'utf8')

    harness.fireHeartbeat()
    await expect(running).resolves.toBe(1)

    expect(acquire).toHaveBeenCalledTimes(1)
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    expect(readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8')).toBe(replacementBytes)
    const events = readEvents(paths.agentQaRoot)
    const leaseLostIndex = events.findIndex((event) => event.kind === 'lease-lost')
    expect(events[leaseLostIndex]).toMatchObject({
      kind: 'lease-lost',
      reason: 'lease-id-mismatch',
      observedEpoch: 2,
    })
    expect(events.filter((event) => event.kind === 'lease-lost')).toHaveLength(1)
    expect(
      events.slice(leaseLostIndex + 1).filter((event) => event.kind === 'lease-acquired'),
    ).toHaveLength(0)
    expect(events.filter((event) => event.kind === 'daemon-stopped')).toEqual([
      expect.objectContaining({ exitCode: 1, reason: 'lease-lost' }),
    ])
  })

  it('treats an unexpected supervisor crash as one authority-loss shutdown', async () => {
    const paths = makePaths('heartbeat-worker-crash')
    const harness = hostHarness()
    const acquire = vi.fn((knowledgeRoot: string) => acquireWriterLease(knowledgeRoot))
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: { ...harness.operations, acquireWriterLease: acquire },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not finish crash-fixture startup',
    )

    harness.crashHeartbeat(new Error('worker exited with code 17'))
    harness.crashHeartbeat(new Error('duplicate worker exit notification'))
    await expect(running).resolves.toBe(1)

    const events = readEvents(paths.agentQaRoot)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(events.filter((event) => event.kind === 'lease-lost')).toEqual([
      expect.objectContaining({
        kind: 'lease-lost',
        reason: 'heartbeat-error',
        detail: 'worker exited with code 17',
      }),
    ])
    expect(events.filter((event) => event.kind === 'daemon-stopped')).toEqual([
      expect.objectContaining({ exitCode: 1, reason: 'lease-lost' }),
    ])
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
  })

  it('retains and stops a supervisor that crashes while its start promise resolves', async () => {
    const paths = makePaths('heartbeat-worker-start-race')
    const harness = hostHarness()
    const stopSupervisor = vi.fn(() => Promise.resolve())
    const model = vi.fn(() => {
      throw new Error('protected startup ran after supervisor crash')
    })

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model,
      operations: {
        ...harness.operations,
        startHeartbeatSupervisor: async (options) => {
          options.onUnexpectedExit(new Error('worker crashed during readiness handoff'))
          return { exited: Promise.resolve(), stop: stopSupervisor }
        },
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })

    await expect(running).resolves.toBe(1)
    expect(model).not.toHaveBeenCalled()
    expect(stopSupervisor).toHaveBeenCalledTimes(1)
    expect(
      readEvents(paths.agentQaRoot).filter((event) => event.kind === 'lease-lost'),
    ).toEqual([
      expect.objectContaining({
        reason: 'heartbeat-error',
        detail: 'worker crashed during readiness handoff',
      }),
    ])
    expect(
      readEvents(paths.agentQaRoot).filter((event) => event.kind === 'daemon-stopped'),
    ).toHaveLength(1)
  })

  it('keeps three scheduled opportunities inside the writer-lease TTL', () => {
    expect(LEASE_HEARTBEAT_INTERVAL_MS * 3).toBeLessThanOrEqual(
      LEASE_HEARTBEAT_TTL_MS,
    )
  })

  it('continues heartbeats while a synthetic long job remains unsettled', async () => {
    const paths = makePaths('heartbeat-long-job')
    const harness = hostHarness()
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not finish heartbeat startup',
    )

    let settleLongJob: (() => void) | undefined
    let jobSettled = false
    const longJob = new Promise<void>((resolve) => {
      settleLongJob = resolve
    }).then(() => {
      jobSettled = true
    })

    for (let tick = 0; tick < 4; tick += 1) {
      harness.fireHeartbeat()
      expect(jobSettled).toBe(false)
    }
    expect(
      readEvents(paths.agentQaRoot).filter((event) => event.kind === 'lease-heartbeated'),
    ).toHaveLength(5)

    settleLongJob?.()
    await longJob
    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
  })
})

describe('daemon shutdown and reclaim post-mortem', () => {
  const awaitedStages = [
    'heartbeatSupervisor.stop',
    'invokeServer.close',
    'drainWorker',
    'maintenanceWorker',
    'stopEmbedderWorker',
    'jobDispatcher.stop',
    'localAgent.close',
    'releaseLease',
  ] as const

  it.each([
    { trigger: 'graceful signal', expectedCode: 0 },
    { trigger: 'lease-loss crash', expectedCode: 1 },
  ] as const)(
    'tears the supervisor down before the server on $trigger',
    async ({ trigger, expectedCode }) => {
      const paths = makePaths(`shutdown-supervisor-order-${expectedCode}`)
      const harness = hostHarness()
      const stages: string[] = []
      const running = runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        config: TEST_CONFIG,
        model: () => TEST_MODEL,
        operations: {
          ...harness.operations,
          runShutdownStage: async (stage, action) => {
            stages.push(stage)
            await action()
          },
          startInvokeServer: ({ socketPath }) => Promise.resolve({
            socketPath,
            close: () => Promise.resolve(),
          }),
        },
        logger: { info: vi.fn(), error: vi.fn() },
      })
      await waitUntil(
        () => harness.signals.has('SIGTERM'),
        `daemon did not become signalable for ${trigger}`,
      )

      if (expectedCode === 0) harness.signal('SIGTERM')
      else harness.crashHeartbeat()
      await expect(running).resolves.toBe(expectedCode)

      expect(stages[0]).toBe('heartbeatSupervisor.stop')
      expect(stages.indexOf('heartbeatSupervisor.stop')).toBeLessThan(
        stages.indexOf('invokeServer.close'),
      )
    },
  )

  it.each(awaitedStages)(
    'converges through final cleanup when the %s shutdown stage fails',
    async (failedStage) => {
      const paths = makePaths(`shutdown-failure-${failedStage.replaceAll('.', '-')}`)
      const harness = hostHarness()
      const errors: string[] = []
      const clearGrace = vi.fn()
      const runShutdownStage = vi.fn(async (
        stage: typeof awaitedStages[number],
        action: () => void | Promise<void>,
      ) => {
        if (stage === failedStage) throw new Error(`injected ${stage} failure`)
        await action()
      })

      const running = runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        config: TEST_CONFIG,
        model: () => TEST_MODEL,
        operations: {
          ...harness.operations,
          runShutdownStage,
          clearTimeout: (timer) => {
            clearGrace(timer)
            harness.operations.clearTimeout?.(timer)
          },
          startInvokeServer: ({ socketPath }) => Promise.resolve({
            socketPath,
            close: () => Promise.resolve(),
          }),
        } as Partial<DaemonHostOperations>,
        logger: { info: vi.fn(), error: (message) => errors.push(message) },
      })
      await waitUntil(
        () => harness.signals.has('SIGTERM'),
        `daemon did not become signalable for ${failedStage}`,
      )
      expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(true)

      harness.signal('SIGTERM')
      await expect(running).resolves.toBe(1)

      expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
      expect(harness.signals.size).toBe(0)
      expect(clearGrace).toHaveBeenCalled()
      expect(errors).toContain(`Daemon shutdown stage ${failedStage} failed: injected ${failedStage} failure`)
      expect(readEvents(paths.agentQaRoot)).toContainEqual(expect.objectContaining({
        kind: 'shutdown-stage-failed',
        stage: failedStage,
        message: `injected ${failedStage} failure`,
      }))
      expect(readEvents(paths.agentQaRoot)).toContainEqual(expect.objectContaining({
        kind: 'daemon-stopped',
        exitCode: 1,
        failureCount: 1,
        failedStages: [failedStage],
      }))
    },
  )

  it('arms the hard-exit grace path when lease loss wedges cleanup', async () => {
    const paths = makePaths('shutdown-lease-lost-grace')
    const harness = hostHarness()
    const hardExit = vi.fn()
    const runShutdownStage = vi.fn((
      stage: typeof awaitedStages[number],
      action: () => void | Promise<void>,
    ): Promise<void> => stage === 'invokeServer.close'
      ? new Promise(() => undefined)
      : Promise.resolve(action()))
    let graceCallback: (() => void) | undefined

    void runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        runShutdownStage,
        setTimeout: (callback, delayMs) => {
          if (delayMs === DAEMON_SHUTDOWN_GRACE_MS) graceCallback = callback
          return delayMs as unknown as ReturnType<typeof setTimeout>
        },
        hardExit,
        startInvokeServer: ({ socketPath }) => Promise.resolve({
          socketPath,
          close: () => Promise.resolve(),
        }),
      } as Partial<DaemonHostOperations>,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'lease-loss grace daemon did not become signalable',
    )
    const replacement: WriterLease = {
      leaseId: '551a9f42-7862-43ac-a6bf-236b53c51b24',
      pid: process.pid + 1,
      epoch: 2,
      heartbeatAtMs: 1_700_000_010_000,
    }
    writeFileSync(
      join(paths.knowledgeRoot, LEASE_FILE),
      `${JSON.stringify(replacement)}\n`,
      'utf8',
    )

    harness.fireHeartbeat()
    await waitUntil(
      () => graceCallback !== undefined,
      'lease-loss shutdown did not arm its grace timer',
      500,
    )
    graceCallback?.()

    expect(runShutdownStage).toHaveBeenCalledWith(
      'invokeServer.close',
      expect.any(Function),
    )
    expect(hardExit).toHaveBeenCalledWith(130)
  })

  it('memoizes one lease-loss shutdown while its first cleanup is still pending', async () => {
    const paths = makePaths('shutdown-once-only')
    const harness = hostHarness()
    let releaseClose: (() => void) | undefined
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const removeOwned = vi.fn(removeRegistrationIfOwned)
    const runShutdownStage = vi.fn(async (
      stage: typeof awaitedStages[number],
      action: () => void | Promise<void>,
    ) => {
      if (stage === 'invokeServer.close') await closeGate
      await action()
    })

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        runShutdownStage,
        removeRegistrationIfOwned: removeOwned,
        startInvokeServer: ({ socketPath }) => Promise.resolve({
          socketPath,
          close: () => Promise.resolve(),
        }),
      } as Partial<DaemonHostOperations>,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'once-only daemon did not become signalable',
    )
    const replacement: WriterLease = {
      leaseId: '551a9f42-7862-43ac-a6bf-236b53c51b24',
      pid: process.pid + 1,
      epoch: 2,
      heartbeatAtMs: 1_700_000_010_000,
    }
    writeFileSync(
      join(paths.knowledgeRoot, LEASE_FILE),
      `${JSON.stringify(replacement)}\n`,
      'utf8',
    )

    harness.fireHeartbeat()
    harness.fireHeartbeat()
    await waitUntil(
      () => runShutdownStage.mock.calls.some(([stage]) => stage === 'invokeServer.close'),
      'once-only shutdown did not reach its blocked close',
    )
    releaseClose?.()

    await expect(running).resolves.toBe(1)
    expect(
      runShutdownStage.mock.calls.filter(([stage]) => stage === 'invokeServer.close'),
    ).toHaveLength(1)
    expect(removeOwned).toHaveBeenCalledTimes(1)
    expect(
      readEvents(paths.agentQaRoot).filter((event) => event.kind === 'daemon-stopped'),
    ).toHaveLength(1)
  })

  it('records a wedged renewing daemon distinguishably from a healthy busy one', async () => {
    const paths = makePaths('renewal-stalled')
    const harness = hostHarness()
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(() => harness.signals.has('SIGTERM'), 'daemon did not start')

    // Healthy: renewal rode the sidecar, but the mutation behind it is inside the deadline.
    harness.fireHeartbeat({
      kind: 'deferred',
      reason: 'mutation-lock-busy',
      mutationGeneration: 'generation-a',
      deferredSinceMs: 1_700_000_000_000,
      stalled: false,
    })
    // Wedged: one unchanged generation, stuck past the takeover deadline.
    harness.fireHeartbeat({
      kind: 'deferred',
      reason: 'mutation-lock-busy',
      mutationGeneration: 'generation-b',
      deferredSinceMs: 1_699_999_900_000,
      stalled: true,
    })

    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)

    const events = readEvents(paths.agentQaRoot)
    const deferred = events.filter((event) => event.kind === 'lease-renewal-deferred')
    const stalled = events.filter((event) => event.kind === 'lease-renewal-stalled')

    // The rejecting direction matters as much as the admitting one: a mapping that records the
    // stalled kind for every deferral would satisfy the assertion below on its own.
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({
      reason: 'mutation-lock-busy',
      mutationGeneration: 'generation-a',
    })
    expect(stalled).toHaveLength(1)
    expect(stalled[0]).toMatchObject({
      mutationGeneration: 'generation-b',
      deferredSinceMs: 1_699_999_900_000,
    })
  })

  it('clears the armed grace timer so clean shutdown cannot hard-exit afterward', async () => {
    const paths = makePaths('shutdown-grace-clear')
    const harness = hostHarness()
    const hardExit = vi.fn()
    const clearGrace = vi.fn()
    let graceCallback: (() => void) | undefined
    let graceActive = false
    const graceTimer = 99 as unknown as ReturnType<typeof setTimeout>

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: {
        ...harness.operations,
        setTimeout: (callback) => {
          graceCallback = callback
          graceActive = true
          return graceTimer
        },
        clearTimeout: (timer) => {
          if (timer === graceTimer) graceActive = false
          clearGrace(timer)
        },
        hardExit,
        startInvokeServer: ({ socketPath }) => Promise.resolve({
          socketPath,
          close: () => Promise.resolve(),
        }),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'daemon did not become signalable',
    )

    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
    if (graceActive) graceCallback?.()

    expect(clearGrace).toHaveBeenCalledWith(graceTimer)
    expect(hardExit).not.toHaveBeenCalled()
  })

  it('records a stale lease reclaim before the successor epoch bump', async () => {
    const paths = makePaths('lease-reclaimed-event')
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const prior = acquireWriterLease(paths.knowledgeRoot)
    expect(prior.kind).toBe('acquired')
    if (prior.kind !== 'acquired') throw new Error('expected prior writer lease')
    now.mockReturnValue(1_000_000 + LEASE_HEARTBEAT_TTL_MS)
    const harness = hostHarness()

    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => harness.signals.has('SIGTERM'),
      'reclaiming daemon did not become signalable',
    )
    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)

    const events = readEvents(paths.agentQaRoot)
    const acquiredIndex = events.findIndex((event) => event.kind === 'lease-acquired')
    const reclaimedIndex = events.findIndex((event) => event.kind === 'lease-reclaimed')
    const epochIndex = events.findIndex((event) => event.kind === 'epoch-bump')
    expect(events[reclaimedIndex]).toMatchObject({
      kind: 'lease-reclaimed',
      priorHolderPid: process.pid,
      priorLeaseId: prior.leaseId,
      priorEpoch: prior.epoch,
      newEpoch: 2,
    })
    expect(acquiredIndex).toBeGreaterThanOrEqual(0)
    expect(reclaimedIndex).toBeGreaterThan(acquiredIndex)
    expect(epochIndex).toBeGreaterThan(reclaimedIndex)
  })
})

/**
 * WR-01: a receipt-required session may start empty, and work may arrive before the loop looks.
 *
 * The barrier is scheduled through the inspection seam itself: the FIRST inspection returns the
 * empty root the session was started for and enqueues the candidate as it returns, so the arrival
 * lands after the initial inspection and before the loop's observation — the exact window the
 * review describes and the only one where the eager author assignment is observable.
 */
describe('drain session authorship at every arrival time', () => {
  it('authors a candidate that arrives between the initial inspection and the loop observation', async () => {
    const paths = makePaths('late-candidate')
    const queued = new Set<string>()
    let inspections = 0
    const author: CuratorAuthor = () => Promise.resolve({
      kind: 'fallback-required',
      reason: 'no-model',
    })
    const authorFactory = vi.fn(() => author)
    const harness = drainHostHarness({
      paths,
      author: authorFactory,
      inspect: () => {
        inspections += 1
        const observed = [...queued].sort()
        // The arrival: after the initial inspection has decided the session is empty.
        if (inspections === 1) queued.add(LATE_CANDIDATE_ID)
        return { queuedCandidateIds: observed, recoverableClaimedCandidateIds: [] }
      },
      countRemaining: () => ({
        queued: queued.size,
        claimedNonterminal: 0,
        quarantined: 0,
      }),
      drainQueue: () => {
        queued.clear()
        return Promise.resolve(drainQueueReport(1, 0))
      },
    })

    await harness.nudge(true)
    await harness.stop()

    expect(harness.errors).toEqual([])
    expect(authorFactory).toHaveBeenCalledTimes(1)
    expect(harness.drainCalls).toHaveLength(1)
    expect(harness.drainCalls[0]?.author).toBe(author)
    expect(harness.drainCalls[0]?.policy).toBeDefined()
    expect(harness.receipts).toHaveLength(1)
    expect(harness.receipts[0]).toMatchObject({
      candidateIds: [LATE_CANDIDATE_ID],
      remainingAfter: 0,
      outcome: 'completed',
    })
  })

  it('raises the named configuration refusal when the late candidate has no author factory', async () => {
    const paths = makePaths('late-candidate-no-factory')
    const queued = new Set<string>()
    let inspections = 0
    const harness = drainHostHarness({
      paths,
      inspect: () => {
        inspections += 1
        const observed = [...queued].sort()
        if (inspections === 1) queued.add(LATE_CANDIDATE_ID)
        return { queuedCandidateIds: observed, recoverableClaimedCandidateIds: [] }
      },
      countRemaining: () => ({
        queued: queued.size,
        claimedNonterminal: 0,
        quarantined: 0,
      }),
      drainQueue: () => {
        queued.clear()
        return Promise.resolve(drainQueueReport(1, 0))
      },
    })

    await harness.nudge(true)
    await harness.stop()

    expect(harness.drainCalls).toEqual([])
    expect(harness.receipts).toEqual([])
    expect(harness.errors.join('\n')).toContain(
      'Daemon curation requires an author factory and guardrail policy',
    )
  })

  it('completes a receipt-only empty session with no factory and no arrivals', async () => {
    const paths = makePaths('receipt-only-empty')
    const harness = drainHostHarness({
      paths,
      inspect: () => ({ queuedCandidateIds: [], recoverableClaimedCandidateIds: [] }),
      countRemaining: () => ({ queued: 0, claimedNonterminal: 0, quarantined: 0 }),
      drainQueue: () => Promise.resolve(drainQueueReport(0, 0)),
    })

    await harness.nudge(true)
    await harness.stop()

    expect(harness.errors).toEqual([])
    expect(harness.drainCalls).toEqual([])
    expect(harness.receipts).toHaveLength(1)
    expect(harness.receipts[0]).toMatchObject({
      candidateIds: [],
      remainingAfter: 0,
      outcome: 'completed',
    })
  })
})

/**
 * WR-02: the lifecycle ledger is D-04's fencing post-mortem and a `daemon status` source, so a
 * crash must not lose an acknowledged fact and a torn final append must not break its readers.
 */
describe('daemon lifecycle event durability and torn-tail reading', () => {
  it('fsyncs every accepted event through an owned owner-only descriptor', () => {
    const paths = makePaths('event-durability')
    const fsyncedSizes: number[] = []
    const fsyncedDirectories: string[] = []
    const seam = {
      fsyncFile: (descriptor: number) => fsyncedSizes.push(fstatSync(descriptor).size),
      fsyncDirectory: (directory: string) => fsyncedDirectories.push(directory),
    }

    const clock = () => new Date('2026-08-01T00:00:00.000Z')
    appendDaemonEvent(paths.agentQaRoot, { kind: 'lease-acquired' }, clock, seam)
    appendDaemonEvent(paths.agentQaRoot, { kind: 'lease-heartbeated' }, clock, seam)
    appendDaemonEvent(paths.agentQaRoot, { kind: 'daemon-stopped' }, clock, seam)

    const file = join(paths.agentQaRoot, DAEMON_EVENTS_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    // Each fsync must carry the ledger's OWN descriptor, already holding the bytes it makes
    // durable — a fsync of anything else, or before the write, would not match these sizes.
    let cumulative = 0
    const expectedSizes = readFileSync(file, 'utf8')
      .split(/(?<=\n)/)
      .filter((line) => line.length > 0)
      .map((line) => (cumulative += Buffer.byteLength(line)))
    expect(expectedSizes).toHaveLength(3)
    expect(fsyncedSizes).toEqual(expectedSizes)
    expect(fsyncedDirectories).toEqual([paths.agentQaRoot])
  })

  it('isolates a torn final append while keeping every complete record', () => {
    const paths = makePaths('event-torn-tail')
    mkdirSync(paths.agentQaRoot, { recursive: true })
    const file = join(paths.agentQaRoot, DAEMON_EVENTS_FILE)
    writeFileSync(
      file,
      `${JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', kind: 'lease-acquired', epoch: 1 })}\n`
      + `${JSON.stringify({ ts: '2026-08-01T00:00:01.000Z', kind: 'lease-heartbeated' })}\n`
      + '{"ts":"2026-08-01T00:00:02.000Z","kind":"daemon-sto',
      'utf8',
    )
    const ledger = readDaemonEventLedger(paths.agentQaRoot)
    expect(ledger.events.map((event) => event.kind)).toEqual([
      'lease-acquired',
      'lease-heartbeated',
    ])
    expect(ledger.events[0]).toMatchObject({ epoch: 1 })
    expect(ledger.warnings).toEqual([
      { kind: 'torn-final-line', line: 3, message: expect.stringContaining('line 3') },
    ])
  })

  it('reports a complete malformed row as malformed and keeps reading past it', () => {
    const paths = makePaths('event-malformed-row')
    mkdirSync(paths.agentQaRoot, { recursive: true })
    const file = join(paths.agentQaRoot, DAEMON_EVENTS_FILE)
    writeFileSync(
      file,
      `${JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', kind: 'lease-acquired' })}\n`
      + `${JSON.stringify({ ts: '2026-08-01T00:00:01.000Z', kind: 'not-a-daemon-event-kind' })}\n`
      + '{"ts":"2026-08-01T00:00:02.000Z","kind":}\n'
      + `${JSON.stringify({ ts: '2026-08-01T00:00:03.000Z', kind: 'daemon-stopped' })}\n`,
      'utf8',
    )
    const ledger = readDaemonEventLedger(paths.agentQaRoot)
    // The records AFTER the bad rows survive: a malformed row is not a tear, so nothing truncates.
    expect(ledger.events.map((event) => event.kind)).toEqual([
      'lease-acquired',
      'daemon-stopped',
    ])
    expect(ledger.warnings.map((warning) => warning.kind)).toEqual([
      'malformed-row',
      'malformed-row',
    ])
    expect(ledger.warnings.map((warning) => warning.line)).toEqual([2, 3])
  })

  it('reads an absent ledger as empty rather than failing', () => {
    const paths = makePaths('event-absent-ledger')
    expect(readDaemonEventLedger(paths.agentQaRoot)).toEqual({
      events: [],
      warnings: [],
    })
  })
})
