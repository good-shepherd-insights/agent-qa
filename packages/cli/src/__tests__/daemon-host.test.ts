import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  acquireWriterLease,
  LEASE_FILE,
  type WriterLease,
} from '@vostride/agent-qa-knowledge-local'
import { getActiveExecutionContext } from '@vostride/agent-qa-safety'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDaemonCommand,
  type DaemonCommandDeps,
} from '../commands/daemon.js'
import {
  LEASE_HEARTBEAT_INTERVAL_MS,
  runDaemonHost,
  type DaemonHostOperations,
  type DaemonHostTraceStep,
} from '../daemon/host.js'
import { DAEMON_EVENTS_FILE } from '../daemon/events.js'
import {
  DAEMON_REGISTRATION_FILE,
  readDaemonRegistration,
  removeDaemonRegistration,
  writeDaemonRegistration,
} from '../daemon/registration.js'

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
  fireHeartbeat(): void
  signal(signal: NodeJS.Signals): void
}

interface PlannedDaemonCommandDeps extends DaemonCommandDeps {
  resolvePaths(configPath: string): Promise<{
    agentQaRoot: string
    knowledgeRoot: string
  }>
  readRegistration: typeof readDaemonRegistration
  processIsAlive(pid: number): boolean
  readWriterLease(knowledgeRoot: string):
    | { kind: 'absent' | 'malformed' }
    | { kind: 'parsed'; lease: WriterLease }
  countPendingCurationJobs(knowledgeRoot: string): number
  signalProcess(pid: number, signal: NodeJS.Signals): void
  now(): number
}

interface DaemonInvocation {
  stdout: string
  stderr: string
  exitCode: number
}

async function invokeDaemon(
  deps: PlannedDaemonCommandDeps,
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
    signalProcess?: PlannedDaemonCommandDeps['signalProcess']
  } = {},
): PlannedDaemonCommandDeps {
  const startedAtMs = 1_700_000_000_000
  return {
    runHost: vi.fn(() => Promise.resolve(0)),
    resolvePaths: () => Promise.resolve(paths),
    readRegistration: readDaemonRegistration,
    processIsAlive: () => options.alive ?? true,
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
  let heartbeat: (() => void) | undefined

  return {
    traces,
    signals,
    operations: {
      now: () => nowMs,
      trace: (step) => traces.push(step),
      setInterval: (callback, intervalMs) => {
        expect(intervalMs).toBe(LEASE_HEARTBEAT_INTERVAL_MS)
        heartbeat = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: () => {
        heartbeat = undefined
      },
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
    },
    fireHeartbeat: () => {
      if (heartbeat === undefined) throw new Error('heartbeat timer was not installed')
      heartbeat()
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

function readEvents(agentQaRoot: string): Array<Record<string, unknown>> {
  return readFileSync(join(agentQaRoot, DAEMON_EVENTS_FILE), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
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
      'recovery-composed',
      'epoch-adopted',
      'claims-recovered',
      'pending-resumed',
      'local-agent-composed',
      'jobs-opened',
      'registration-written',
      'heartbeat-started',
    ])

    const registration = readDaemonRegistration(paths.agentQaRoot)
    expect(registration.kind).toBe('parsed')
    if (registration.kind !== 'parsed') throw new Error('expected parsed daemon registration')
    expect(registration.registration).toMatchObject({
      schemaVersion: 1,
      pid: process.pid,
      startedAtMs: 1_700_000_000_000,
    })
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
    expect(errors[0]).toContain('lease heartbeat since ')
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
    expect(stale.stdout).toContain('nothing to stop')
    expect(staleSignal).not.toHaveBeenCalled()
  })
})

describe('daemon registration recovery at boot', () => {
  it('removes a dead-pid registration before acquiring and proceeds', async () => {
    const paths = makePaths('boot-stale')
    writeDaemonRegistration(paths.agentQaRoot, {
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      operations: { acquireWriterLease: acquire },
      logger: { info: vi.fn(), error: (message) => errors.push(message) },
    })).resolves.toBe(1)

    expect(acquire).not.toHaveBeenCalled()
    expect(errors[0]).toContain(`pid ${process.pid}`)
    expect(readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toEqual(before)
  })
})
