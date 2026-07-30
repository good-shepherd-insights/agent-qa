import { request } from 'node:http'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigReaderPort, FunctionRegistry, JobModelCapability } from '@vostride/agent-qa-agent'
import type {
  ComposeJobRecoveryInput,
  ComposeLocalAgentInput,
  CuratorAuthor,
  JobRecoveryHost,
  LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  acquireWriterLease,
  LEASE_FILE,
  WriterAuthorityLostError,
} from '@vostride/agent-qa-knowledge-local'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'
import { RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import type { AuditSink } from '@vostride/agent-qa-safety'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CURATION_TAIL_RECEIPT_FILE,
  runCurationTail,
  type CurationTailReceipt,
} from '../curation/curation-tail.js'
import { nudgeDaemon } from '../daemon/client.js'
import {
  DRAIN_SESSION_RECEIPTS_FILE,
  readDrainSessionReceipts,
} from '../daemon/drain-receipts.js'
import { DAEMON_EVENTS_FILE } from '../daemon/events.js'
import { runDaemonHost, type DaemonHostOperations } from '../daemon/host.js'
import { DAEMON_REGISTRATION_FILE } from '../daemon/registration.js'

const MODEL: JobModelCapability = {
  modelId: 'test:daemon-drain',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/agent-qa.config.yaml',
    entries: [],
  }),
}

const CANDIDATE_ID = 'b'.repeat(64)
const SESSION_ID = '00000000-0000-4000-8000-000000000006'
const roots: string[] = []

function makeRoot(): { root: string; agentQaRoot: string; knowledgeRoot: string; runDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-daemon-drain-'))
  roots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch('run-daemon-drain'))
  mkdirSync(runDir, { recursive: true })
  return {
    root,
    agentQaRoot,
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    runDir,
  }
}

function fakeRecovery(): JobRecoveryHost {
  return {
    store: { adoptEpoch: () => Promise.resolve({ epoch: 1 }) },
    recoverAbandonedClaims: () => Promise.resolve({ recovered: 0 }),
    resumePending: () => Promise.resolve([]),
    close: vi.fn(),
  } as unknown as JobRecoveryHost
}

function fakeLocalAgent(): LocalAgentHost {
  return {
    registry: {} as FunctionRegistry,
    jobs: () => Promise.resolve({}),
    close: vi.fn(),
  } as unknown as LocalAgentHost
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function rawNudge(
  socketPath: string,
  body: unknown,
): Promise<{ statusCode: number; body: string }> {
  const encoded = JSON.stringify(body)
  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = request(
      {
        socketPath,
        path: '/nudge',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(encoded),
          connection: 'close',
        },
      },
      async (response) => {
        response.setEncoding('utf8')
        let text = ''
        for await (const chunk of response) text += String(chunk)
        resolveResponse({ statusCode: response.statusCode ?? 500, body: text })
      },
    )
    outgoing.once('error', rejectResponse)
    outgoing.end(encoded)
  })
}

interface ScheduledHostHarness {
  running: Promise<number>
  fire(intervalMs: number): void
  signal(signal: NodeJS.Signals): void
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

function startScheduledHost(options: {
  paths: ReturnType<typeof makeRoot>
  queued: Set<string>
  drainQueue: DaemonHostOperations['drainQueue']
  runMaintenanceTail?: (...args: unknown[]) => unknown
  acquireWriterLease?: DaemonHostOperations['acquireWriterLease']
}): ScheduledHostHarness {
  const signals = new Map<NodeJS.Signals, () => void>()
  const intervals = new Map<number, { callback: () => void; intervalMs: number }>()
  let nextTimerId = 1
  const operations = {
    composeJobRecovery: (_input: ComposeJobRecoveryInput) => fakeRecovery(),
    composeLocalAgent: (_input: ComposeLocalAgentInput) => fakeLocalAgent(),
    listQueuedCandidates: () => [...options.queued].sort(),
    drainQueue: options.drainQueue,
    ...(options.acquireWriterLease === undefined
      ? {}
      : { acquireWriterLease: options.acquireWriterLease }),
    ...(options.runMaintenanceTail === undefined
      ? {}
      : { runMaintenanceTail: options.runMaintenanceTail }),
    randomUUID: () => SESSION_ID,
    setInterval: (callback: () => void, intervalMs: number) => {
      const timerId = nextTimerId++
      intervals.set(timerId, { callback, intervalMs })
      return timerId as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: (timer: ReturnType<typeof setInterval>) => {
      intervals.delete(timer as unknown as number)
    },
    setTimeout: () => 99 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: vi.fn(),
    onSignal: (signal: NodeJS.Signals, listener: () => void) => signals.set(signal, listener),
    offSignal: (signal: NodeJS.Signals, listener: () => void) => {
      if (signals.get(signal) === listener) signals.delete(signal)
    },
    hardExit: vi.fn(),
    startInvokeServer: async ({ socketPath }: { socketPath: string }) => ({
      socketPath,
      close: () => Promise.resolve(),
    }),
  } as unknown as Partial<DaemonHostOperations>
  const running = runDaemonHost({
    agentQaRoot: options.paths.agentQaRoot,
    knowledgeRoot: options.paths.knowledgeRoot,
    config: CONFIG,
    model: () => MODEL,
    author: () => async () => ({ kind: 'fallback-required', reason: 'no-model' }),
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    operations,
    logger: { info: vi.fn(), error: vi.fn() },
  })
  return {
    running,
    fire(intervalMs) {
      const callbacks = [...intervals.values()]
        .filter((scheduled) => scheduled.intervalMs === intervalMs)
        .map((scheduled) => scheduled.callback)
      if (callbacks.length === 0) throw new Error(`interval ${intervalMs} was not scheduled`)
      for (const callback of callbacks) callback()
    },
    signal(signal) {
      const listener = signals.get(signal)
      if (listener === undefined) throw new Error(`${signal} listener was not installed`)
      listener()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('daemon curation serving tracer', () => {
  it('receipts a handed-off tail, nudges once, drains under standing authority, and receipts the session', async () => {
    const paths = makeRoot()
    const queued = new Set<string>()
    const signals = new Map<NodeJS.Signals, () => void>()
    const drainQueue = vi.fn<DaemonHostOperations['drainQueue']>(async (options) => {
      expect(options).toMatchObject({
        knowledgeRoot: paths.knowledgeRoot,
        auditBaseDir: paths.agentQaRoot,
        budgetMs: 'unbounded',
        executionContext: 'local-headless',
        maintenance: 'skip',
        lease: { epoch: 1 },
      })
      const jobsProcessed = queued.size
      queued.clear()
      return {
        kind: 'drained',
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
        writerPass: { kind: 'skipped', reason: 'daemon-cadence' },
        gc: { kind: 'skipped', reason: 'daemon-cadence' },
        remaining: 0,
      }
    })
    const hostOperations: Partial<DaemonHostOperations> = {
      composeJobRecovery: (_input: ComposeJobRecoveryInput) => fakeRecovery(),
      composeLocalAgent: (_input: ComposeLocalAgentInput) => fakeLocalAgent(),
      listQueuedCandidates: () => [...queued].sort(),
      drainQueue,
      randomUUID: () => SESSION_ID,
      setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearInterval: vi.fn(),
      setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: vi.fn(),
      onSignal: (signal, listener) => signals.set(signal, listener),
      offSignal: (signal, listener) => {
        if (signals.get(signal) === listener) signals.delete(signal)
      },
      hardExit: vi.fn(),
    }
    const author = vi.fn<CuratorAuthor>(async () => ({
      kind: 'fallback-required',
      reason: 'no-model',
    }))
    const running = runDaemonHost({
      agentQaRoot: paths.agentQaRoot,
      knowledgeRoot: paths.knowledgeRoot,
      config: CONFIG,
      model: () => MODEL,
      author: () => author,
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      operations: hostOperations,
      logger: { info: vi.fn(), error: vi.fn() },
    })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'daemon registration was not written',
    )
    const leaseBefore = readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8')

    const handoff = {
      executionContext: 'local-interactive',
      runId: 'run-daemon-drain',
    } as CompletedRunHandoff
    const order: string[] = []
    const nudge = vi.fn(async (agentQaRoot: string) => {
      order.push('nudge')
      await nudgeDaemon(agentQaRoot)
    })
    await runCurationTail({
      runId: String(handoff.runId),
      agentQaRoot: paths.agentQaRoot,
      knowledgeConfig: { dir: paths.knowledgeRoot },
      configDir: paths.root,
      auditSink: {} as AuditSink,
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      log: { warn: vi.fn(), info: vi.fn() },
      operations: {
        loadCompletedRunHandoff: () => handoff,
        resolveKnowledgeRoot: () => paths.knowledgeRoot,
        runSafetyScope: (_options, body) => body(),
        emitCurationCandidates: () => {
          queued.add(CANDIDATE_ID)
          return {
            enqueued: 1,
            coalesced: 0,
            capExceeded: 0,
            refused: 0,
            details: [{
              candidateId: CANDIDATE_ID,
              kind: 'fact',
              outcome: { kind: 'enqueued', candidateId: CANDIDATE_ID },
            }],
          }
        },
        openKnowledgeReader: () => ({
          emitCanaryOutcome: vi.fn(),
        }) as unknown as KnowledgeHintReader,
        emitCanaryOutcomes: () => ({
          emitted: 0,
          refused: 0,
          unresolved: 0,
          procedure: { emitted: 0, refused: 0, unresolved: 0 },
          details: [],
        }),
        foldRunOutcomes: () => ({ kind: 'applied', tests: 0 }),
        drainQueue: async () => ({
          kind: 'handed-off',
          holder: {
            leaseId: 'daemon-standing-lease',
            pid: process.pid,
            epoch: 1,
            heartbeatAtMs: Date.now(),
          },
          jobsProcessed: 0,
          committed: 0,
          downgraded: 0,
          withheld: 0,
          requeued: 0,
          failures: 0,
          failureDetails: [],
          noops: 0,
          noopDetails: [],
          reconcile: undefined,
          writerPass: { kind: 'skipped', reason: 'lease-held' },
          gc: { kind: 'skipped', reason: 'lease-held' },
          remaining: 1,
        }),
        listCompletedRunDirs: () => [paths.runDir],
        readCurationTailReceipt: () => undefined,
        writeCurationTailReceipt: (_runDir, receipt: CurationTailReceipt) => {
          order.push('receipt')
          writeFileSync(
            join(paths.runDir, CURATION_TAIL_RECEIPT_FILE),
            `${JSON.stringify(receipt)}\n`,
          )
        },
        nudgeDaemon: nudge,
      },
    })

    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE)),
      'daemon drain receipt was not written',
    )
    expect(order).toEqual(['receipt', 'nudge'])
    expect(nudge).toHaveBeenCalledOnce()
    expect(drainQueue).toHaveBeenCalledOnce()
    expect(readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8')).toBe(leaseBefore)

    const tailReceipt = JSON.parse(
      readFileSync(join(paths.runDir, CURATION_TAIL_RECEIPT_FILE), 'utf8'),
    ) as CurationTailReceipt
    expect(tailReceipt).toMatchObject({
      drainKind: 'handed-off',
      handoffHolderPid: process.pid,
      candidateIds: [CANDIDATE_ID],
    })
    expect(readDrainSessionReceipts(paths.agentQaRoot)).toEqual([{
      ts: expect.any(String),
      sessionId: SESSION_ID,
      holderPid: process.pid,
      epoch: 1,
      candidateIds: [CANDIDATE_ID],
      remainingAfter: 0,
    }])
    const events = readFileSync(join(paths.agentQaRoot, DAEMON_EVENTS_FILE), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string })
    expect(events.filter((event) => event.kind === 'drain-session-start')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'drain-session-end')).toHaveLength(1)

    const registration = JSON.parse(
      readFileSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE), 'utf8'),
    ) as { socketPath: string }
    const malformed = await rawNudge(registration.socketPath, {
      kind: 'candidates-enqueued',
      extra: true,
    })
    expect(malformed.statusCode).toBe(400)
    expect(JSON.parse(malformed.body)).toMatchObject({ name: 'NudgeEnvelopeError' })
    expect(drainQueue).toHaveBeenCalledOnce()

    signals.get('SIGTERM')?.()
    await expect(running).resolves.toBe(0)
  })

  it('treats a missing daemon registration as a successful best-effort no-op', async () => {
    const paths = makeRoot()
    await expect(nudgeDaemon(paths.agentQaRoot)).resolves.toBeUndefined()
    expect(existsSync(join(paths.agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE))).toBe(false)
  })
})

describe('daemon curation scheduling', () => {
  it('drains work on the 30 second poll backstop when no nudge arrives', async () => {
    const paths = makeRoot()
    const queued = new Set([CANDIDATE_ID])
    const drainQueue = vi.fn<DaemonHostOperations['drainQueue']>(async () => {
      const jobsProcessed = queued.size
      queued.clear()
      return drainReport(jobsProcessed, 0)
    })
    const host = startScheduledHost({ paths, queued, drainQueue })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'scheduled daemon did not register',
    )

    host.fire(30_000)
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE)),
      'poll tick did not drain the curation queue',
    )

    expect(drainQueue).toHaveBeenCalledOnce()
    expect(readDrainSessionReceipts(paths.agentQaRoot)).toHaveLength(1)
    host.signal('SIGTERM')
    await expect(host.running).resolves.toBe(0)
  })

  it('runs maintenance every 300 seconds under the standing lease epoch', async () => {
    const paths = makeRoot()
    const queued = new Set<string>()
    const runMaintenanceTail = vi.fn(async () => ({
      writerPass: { kind: 'not-requested' },
      gc: { kind: 'completed', summary: { trimmedRecordIds: [] } },
      failures: [],
    }))
    const host = startScheduledHost({
      paths,
      queued,
      drainQueue: vi.fn(async () => drainReport(0, 0)),
      runMaintenanceTail,
    })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'maintenance daemon did not register',
    )

    host.fire(300_000)
    await waitUntil(() => runMaintenanceTail.mock.calls.length === 1, 'maintenance did not run')
    expect(runMaintenanceTail).toHaveBeenCalledWith({
      knowledgeRoot: paths.knowledgeRoot,
      lease: expect.objectContaining({ epoch: 1 }),
    })

    host.signal('SIGTERM')
    await expect(host.running).resolves.toBe(0)
  })

  it('routes cadence authority loss through lease-lost teardown without reacquiring', async () => {
    const paths = makeRoot()
    const queued = new Set<string>()
    const acquire = vi.fn((knowledgeRoot: string) => acquireWriterLease(knowledgeRoot))
    const runMaintenanceTail = vi.fn(async () => {
      throw new WriterAuthorityLostError(
        { knowledgeRoot: paths.knowledgeRoot, leaseId: SESSION_ID, epoch: 1 },
        'stale-epoch',
        2,
      )
    })
    const host = startScheduledHost({
      paths,
      queued,
      drainQueue: vi.fn(async () => drainReport(0, 0)),
      runMaintenanceTail,
      acquireWriterLease: acquire,
    })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'authority-loss daemon did not register',
    )

    host.fire(300_000)
    await expect(host.running).resolves.toBe(1)
    expect(acquire).toHaveBeenCalledOnce()
    expect(existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE))).toBe(false)
    expect(readFileSync(join(paths.knowledgeRoot, LEASE_FILE), 'utf8')).not.toBe('')
  })

  it('finishes a multi-pass over-budget queue in one unbounded session', async () => {
    const paths = makeRoot()
    const candidateIds = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)]
    const queued = new Set(candidateIds)
    const drainQueue = vi.fn<DaemonHostOperations['drainQueue']>(async (options) => {
      expect(options.budgetMs).toBe('unbounded')
      const next = [...queued].sort()[0]
      if (next !== undefined) queued.delete(next)
      return drainReport(next === undefined ? 0 : 1, queued.size)
    })
    const host = startScheduledHost({ paths, queued, drainQueue })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'unbounded-session daemon did not register',
    )

    host.fire(30_000)
    await waitUntil(
      () => readDrainSessionReceipts(paths.agentQaRoot).length === 1,
      'unbounded session did not complete',
    )
    expect(drainQueue).toHaveBeenCalledTimes(3)
    expect(readDrainSessionReceipts(paths.agentQaRoot)[0]).toMatchObject({
      candidateIds,
      remainingAfter: 0,
    })

    host.signal('SIGTERM')
    await expect(host.running).resolves.toBe(0)
  })

  it('keeps an empty poll tick receipt- and event-free', async () => {
    const paths = makeRoot()
    const queued = new Set<string>()
    const drainQueue = vi.fn<DaemonHostOperations['drainQueue']>(async () => drainReport(0, 0))
    const host = startScheduledHost({ paths, queued, drainQueue })
    await waitUntil(
      () => existsSync(join(paths.agentQaRoot, DAEMON_REGISTRATION_FILE)),
      'idle daemon did not register',
    )

    host.fire(30_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drainQueue).not.toHaveBeenCalled()
    expect(readDrainSessionReceipts(paths.agentQaRoot)).toEqual([])
    const events = readFileSync(join(paths.agentQaRoot, DAEMON_EVENTS_FILE), 'utf8')
    expect(events).not.toContain('drain-session-')

    host.signal('SIGTERM')
    await expect(host.running).resolves.toBe(0)
  })
})
