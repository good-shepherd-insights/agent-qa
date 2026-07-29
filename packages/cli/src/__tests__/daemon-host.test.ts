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
  LEASE_FILE,
  type WriterLease,
} from '@vostride/agent-qa-knowledge-local'
import { getActiveExecutionContext } from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
