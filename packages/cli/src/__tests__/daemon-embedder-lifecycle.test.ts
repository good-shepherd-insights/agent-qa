import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import type { ConfigReaderPort, FunctionRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  JobRecoveryHost,
  LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CURATION_QUEUE_POLL_MS, MAINTENANCE_CADENCE_MS } from '../daemon/host.js'
import {
  EMBEDDER_WORKER_IDLE_MS,
  runDaemonHost,
  type DaemonHostOperations,
  type EmbedderWorkerSpawnOptions,
} from '../daemon/host.js'

const MODEL: JobModelCapability = {
  modelId: 'test:daemon-embedder-lifecycle',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/agent-qa.config.yaml',
    entries: [],
  }),
}

const SESSION_IDS = [
  '00000000-0000-4000-8000-000000000071',
  '00000000-0000-4000-8000-000000000072',
  '00000000-0000-4000-8000-000000000073',
]
const roots: string[] = []

function fakeRecovery(): JobRecoveryHost {
  return {
    store: { adoptEpoch: () => Promise.resolve({ epoch: 17 }) },
    recoverAbandonedClaims: () => Promise.resolve({ recovered: 0 }),
    resumePending: () => Promise.resolve([]),
    close: vi.fn(),
  } as unknown as JobRecoveryHost
}

function fakeLocalAgent(): LocalAgentHost {
  return {
    registry: {} as FunctionRegistry,
    jobs: () => Promise.resolve({
      queue: { runNextJob: () => Promise.resolve({ ran: false, reason: 'no-job' }) },
    }),
    close: vi.fn(),
  } as unknown as LocalAgentHost
}

function drainReport(jobsProcessed: number, remaining: number) {
  return {
    kind: 'drained' as const,
    jobsProcessed,
    committed: jobsProcessed,
    downgraded: 0,
    withheld: 0,
    requeued: 0,
    failures: 0,
    failureDetails: [],
    noops: 0,
    noopDetails: [],
    reconcile: undefined,
    writerPass: { kind: 'skipped' as const, reason: 'daemon-cadence' as const },
    gc: { kind: 'skipped' as const, reason: 'daemon-cadence' as const },
    remaining,
  }
}

class StubWorker extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid: number
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.finish(0, signal)
    return true
  })

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  crash(code = 1): void {
    this.finish(code, null)
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }

  private finish(code: number, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    queueMicrotask(() => this.emit('close', code, signal))
  }
}

interface ScheduledTimeout {
  readonly callback: () => void
  readonly delayMs: number
}

interface LifecycleHarness {
  readonly running: Promise<number>
  readonly workers: StubWorker[]
  readonly spawnRequests: EmbedderWorkerSpawnOptions[]
  readonly resetCapability: ReturnType<typeof vi.fn>
  readonly events: Array<Record<string, unknown>>
  readonly order: string[]
  readonly drainQueue: ReturnType<typeof vi.fn>
  readonly acquireEmbedder: ReturnType<typeof vi.fn>
  readonly runMaintenanceTail: ReturnType<typeof vi.fn>
  readonly workerRegistrationPath: string
  isStarted(): boolean
  fireInterval(intervalMs: number): void
  timeoutIds(delayMs: number): number[]
  fireTimeout(timerId: number): boolean
  queue(candidateId: string, report: ReturnType<typeof drainReport>): void
  signal(signal: NodeJS.Signals): void
}

function startHarness(
  label: string,
  initialReports: Array<ReturnType<typeof drainReport>>,
  overrides: Partial<{
    waitForEmbedderWorkerReady: () => Promise<void>
  }> = {},
): LifecycleHarness {
  const root = mkdtempSync(join(tmpdir(), `agent-qa-daemon-embedder-${label}-`))
  roots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const workerRegistrationPath = join(agentQaRoot, 'embedder-worker.json')
  const queued = new Set(['a'.repeat(64)])
  const reports = [...initialReports]
  const signals = new Map<NodeJS.Signals, () => void>()
  const intervals = new Map<number, { callback: () => void; intervalMs: number }>()
  const timeouts = new Map<number, ScheduledTimeout>()
  const workers: StubWorker[] = []
  const spawnRequests: EmbedderWorkerSpawnOptions[] = []
  const events: Array<Record<string, unknown>> = []
  const order: string[] = []
  const resetCapability = vi.fn()
  let nextTimerId = 1
  let nextSessionId = 0

  const drainQueue = vi.fn(async (_options: unknown) => {
    const report = reports.shift()
    if (report === undefined) throw new Error('No drain report queued')
    if (report.remaining === 0) queued.clear()
    return report
  })
  const acquireEmbedder = vi.fn(async () => ({
    kind: 'deferred' as const,
    reason: 'worker-unavailable' as const,
  }))
  const runMaintenanceTail = vi.fn(async (_options: unknown) => ({
    writerPass: { kind: 'not-requested' as const },
    gc: { kind: 'completed' as const, summary: { trimmedRecordIds: [] } },
    failures: [],
  }))

  const operations = {
    composeJobRecovery: (_input: ComposeJobRecoveryInput) => fakeRecovery(),
    composeLocalAgent: (_input: ComposeLocalAgentInput) => fakeLocalAgent(),
    acquireWriterLease: () => ({
      kind: 'acquired' as const,
      leaseId: '00000000-0000-4000-8000-000000000017',
      epoch: 17,
    }),
    heartbeatLease: () => ({
      kind: 'heartbeated' as const,
      holder: { pid: process.pid, epoch: 17, heartbeatAtMs: Date.now() },
    }),
    releaseLease: () => {
      order.push('lease-release')
      return { kind: 'released' as const }
    },
    inspectDrainableCurationWork: () => ({
      queuedCandidateIds: [...queued].sort(),
      recoverableClaimedCandidateIds: [],
    }),
    listQueuedCandidates: () => [...queued].sort(),
    drainQueue,
    acquireEmbedder,
    runMaintenanceTail,
    randomUUID: () => SESSION_IDS[nextSessionId++] ?? SESSION_IDS.at(-1)!,
    setInterval: (callback: () => void, intervalMs: number) => {
      const timerId = nextTimerId++
      intervals.set(timerId, { callback, intervalMs })
      return timerId as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: (timer: ReturnType<typeof setInterval>) => {
      intervals.delete(timer as unknown as number)
    },
    setTimeout: (callback: () => void, delayMs: number) => {
      const timerId = nextTimerId++
      timeouts.set(timerId, { callback, delayMs })
      return timerId as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timeouts.delete(timer as unknown as number)
    },
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals, listener: () => void) => {
      if (signals.get(signal) === listener) signals.delete(signal)
    },
    hardExit: (code: number) => {
      throw new Error(`Unexpected hard exit ${code}`)
    },
    startInvokeServer: async ({ socketPath }: { socketPath: string }) => ({
      socketPath,
      close: () => Promise.resolve(),
    }),
    writeDaemonRegistration: vi.fn(),
    removeDaemonRegistration: vi.fn(),
    appendDrainSessionReceipt: vi.fn(),
    appendDaemonEvent: (_agentQaRoot: string, event: Record<string, unknown>) => {
      events.push(event)
    },
    resolveEmbedderWorkerEntryPath: () => '/fixture/dist/embedder-worker/worker-entry.js',
    spawnEmbedderWorker: (request: EmbedderWorkerSpawnOptions) => {
      spawnRequests.push(request)
      const worker = new StubWorker(7_100 + workers.length)
      workers.push(worker)
      mkdirSync(agentQaRoot, { recursive: true })
      writeFileSync(workerRegistrationPath, '{}\n')
      return worker.asChildProcess()
    },
    waitForEmbedderWorkerReady:
      overrides.waitForEmbedderWorkerReady ?? (() => Promise.resolve()),
    removeEmbedderWorkerRegistration: () => {
      rmSync(workerRegistrationPath, { force: true })
    },
    resetEmbedderCapability: resetCapability,
  } as unknown as Partial<DaemonHostOperations>

  const running = runDaemonHost({
    agentQaRoot,
    knowledgeRoot,
    config: CONFIG,
    model: () => MODEL,
    author: () => async () => ({ kind: 'fallback-required', reason: 'no-model' }),
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations,
    logger: { info: vi.fn(), error: vi.fn() },
  })

  return {
    running,
    workers,
    spawnRequests,
    resetCapability,
    events,
    order,
    drainQueue,
    acquireEmbedder,
    runMaintenanceTail,
    workerRegistrationPath,
    isStarted() {
      return signals.has('SIGTERM')
        && [...intervals.values()].some(
          (scheduled) => scheduled.intervalMs === CURATION_QUEUE_POLL_MS,
        )
    },
    fireInterval(intervalMs) {
      const callbacks = [...intervals.values()]
        .filter((scheduled) => scheduled.intervalMs === intervalMs)
        .map((scheduled) => scheduled.callback)
      if (callbacks.length === 0) throw new Error(`Interval ${intervalMs} was not scheduled`)
      for (const callback of callbacks) callback()
    },
    timeoutIds(delayMs) {
      return [...timeouts.entries()]
        .filter(([, timeout]) => timeout.delayMs === delayMs)
        .map(([timerId]) => timerId)
    },
    fireTimeout(timerId) {
      const timeout = timeouts.get(timerId)
      if (timeout === undefined) return false
      timeouts.delete(timerId)
      timeout.callback()
      return true
    },
    queue(candidateId, report) {
      queued.add(candidateId)
      reports.push(report)
    },
    signal(signal) {
      const listener = signals.get(signal)
      if (listener === undefined) throw new Error(`${signal} listener was not installed`)
      listener()
    },
  }
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('daemon embedder-worker lifecycle', () => {
  it('defers a drain when worker startup fails without regaining in-process embedding', async () => {
    const harness = startHarness(
      'worker-required-start-failure',
      [drainReport(1, 0)],
      {
        waitForEmbedderWorkerReady: () => Promise.reject(new Error('forced start failure')),
      },
    )
    await waitUntil(() => harness.isStarted(), 'daemon did not start')

    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.drainQueue.mock.calls.length === 1, 'drain did not finish')

    expect(harness.acquireEmbedder).toHaveBeenCalledWith({
      allowDownload: false,
      workerPolicy: 'required',
      agentQaRoot: expect.any(String),
    })
    expect(harness.drainQueue).toHaveBeenCalledWith(expect.objectContaining({
      embeddingCapability: { kind: 'deferred', reason: 'worker-unavailable' },
    }))
    expect(harness.events).toContainEqual(expect.objectContaining({
      kind: 'embedder-worker-exit',
      reason: 'start-error',
    }))

    harness.signal('SIGTERM')
    await expect(harness.running).resolves.toBe(0)
  })

  it('ensures the worker and threads worker-required capability into scheduled maintenance', async () => {
    const harness = startHarness('maintenance-worker-required', [])
    await waitUntil(() => harness.isStarted(), 'daemon did not start')

    harness.fireInterval(MAINTENANCE_CADENCE_MS)
    await waitUntil(
      () => harness.runMaintenanceTail.mock.calls.length === 1,
      'maintenance did not finish',
    )

    expect(harness.workers).toHaveLength(1)
    expect(harness.acquireEmbedder).toHaveBeenCalledWith({
      allowDownload: false,
      workerPolicy: 'required',
      agentQaRoot: expect.any(String),
    })
    expect(harness.runMaintenanceTail).toHaveBeenCalledWith(expect.objectContaining({
      embeddingCapability: { kind: 'deferred', reason: 'worker-unavailable' },
    }))

    harness.signal('SIGTERM')
    await expect(harness.running).resolves.toBe(0)
  })

  it('spawns once for repeated session demands and attributes captured output on idle exit', async () => {
    const harness = startHarness('reuse', [drainReport(1, 1), drainReport(1, 0)])
    await waitUntil(() => harness.isStarted(), 'daemon did not start')

    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.drainQueue.mock.calls.length === 2, 'drain did not finish')
    expect(harness.workers).toHaveLength(1)
    expect(harness.spawnRequests).toEqual([
      expect.objectContaining({
        command: process.execPath,
        cwd: expect.any(String),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ])

    harness.workers[0]!.stdout.write('worker-out')
    harness.workers[0]!.stderr.write('worker-err')
    const [idleTimer] = harness.timeoutIds(EMBEDDER_WORKER_IDLE_MS)
    expect(idleTimer).toBeDefined()
    expect(harness.fireTimeout(idleTimer!)).toBe(true)
    await waitUntil(() => harness.resetCapability.mock.calls.length === 1, 'idle exit not handled')

    const lifecycleEvents = harness.events.filter((event) =>
      event.kind === 'embedder-worker-start' || event.kind === 'embedder-worker-exit')
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({ kind: 'embedder-worker-start' }),
      expect.objectContaining({
        kind: 'embedder-worker-exit',
        reason: 'idle',
        stdout: 'worker-out',
        stderr: 'worker-err',
      }),
    ])

    harness.signal('SIGTERM')
    await expect(harness.running).resolves.toBe(0)
  })

  it('cancels the old deadline when a demand arrives just before it and grants a full new window', async () => {
    const harness = startHarness('boundary', [drainReport(1, 0)])
    await waitUntil(() => harness.isStarted(), 'daemon did not start')
    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.drainQueue.mock.calls.length === 1, 'first drain did not finish')
    const [firstDeadline] = harness.timeoutIds(EMBEDDER_WORKER_IDLE_MS)
    expect(firstDeadline).toBeDefined()

    harness.queue('b'.repeat(64), drainReport(1, 0))
    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.drainQueue.mock.calls.length === 2, 'second drain did not finish')
    expect(harness.workers).toHaveLength(1)
    expect(harness.fireTimeout(firstDeadline!)).toBe(false)
    expect(harness.workers[0]!.kill).not.toHaveBeenCalled()

    const [secondDeadline] = harness.timeoutIds(EMBEDDER_WORKER_IDLE_MS)
    expect(secondDeadline).toBeDefined()
    expect(secondDeadline).not.toBe(firstDeadline)
    expect(harness.fireTimeout(secondDeadline!)).toBe(true)
    await waitUntil(() => harness.workers[0]!.kill.mock.calls.length === 1, 'idle kill missing')

    harness.signal('SIGTERM')
    await expect(harness.running).resolves.toBe(0)
  })

  it('invalidates on crash and graceful stop, removing the worker before lease release', async () => {
    const harness = startHarness('exit-paths', [drainReport(1, 0)])
    await waitUntil(() => harness.isStarted(), 'daemon did not start')
    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.workers.length === 1, 'first worker did not spawn')

    harness.workers[0]!.crash()
    await waitUntil(() => harness.resetCapability.mock.calls.length === 1, 'crash not handled')
    expect(existsSync(harness.workerRegistrationPath)).toBe(false)

    harness.queue('c'.repeat(64), drainReport(1, 0))
    harness.fireInterval(CURATION_QUEUE_POLL_MS)
    await waitUntil(() => harness.workers.length === 2, 'replacement worker did not spawn')
    harness.workers[1]!.once('close', () => harness.order.push('worker-close'))

    harness.signal('SIGTERM')
    await expect(harness.running).resolves.toBe(0)
    expect(harness.resetCapability).toHaveBeenCalledTimes(2)
    expect(harness.workers[1]!.kill).toHaveBeenCalledWith('SIGTERM')
    expect(existsSync(harness.workerRegistrationPath)).toBe(false)
    expect(harness.order.indexOf('worker-close')).toBeLessThan(
      harness.order.indexOf('lease-release'),
    )
    expect(
      harness.events
        .filter((event) => event.kind === 'embedder-worker-exit')
        .map((event) => event.reason),
    ).toEqual(['crash', 'daemon-stop'])
  })
})
