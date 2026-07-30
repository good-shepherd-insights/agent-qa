import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createJobKindRegistry } from '@vostride/agent-qa-agent'
import type {
  JobHandler,
  JobKindRegistry,
  JobModelCapability,
} from '@vostride/agent-qa-agent'
import {
  composeLocalAgent,
  type LocalAgentHost,
  type LocalAgentJobs,
} from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAEMON_EVENTS_FILE } from '../daemon/events.js'
import {
  runDaemonHost,
  type DaemonHostOperations,
} from '../daemon/host.js'
import type { NudgeEnvelope, StartInvokeServerOptions } from '../daemon/server.js'

const DISPATCH_POLL_MS = 5_000
const RETRY_DELAY_MS = 1_000
const FIXTURE_KIND = 'analyze-run' as const

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:daemon-dispatch',
  generate: async () => {
    throw new Error('daemon-dispatch tests never author')
  },
}

interface TimerRecord {
  readonly handle: ReturnType<typeof setTimeout>
  readonly callback: () => void
  readonly dueAtMs: number
  readonly delayMs: number
}

class ManualScheduler {
  #nowMs = 1_700_000_000_000
  #nextId = 1
  readonly #timeouts = new Map<ReturnType<typeof setTimeout>, TimerRecord>()

  readonly now = (): number => this.#nowMs

  readonly setTimeout = (
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> => {
    const handle = {
      id: this.#nextId,
      unref: () => undefined,
    } as unknown as ReturnType<typeof setTimeout>
    this.#nextId += 1
    this.#timeouts.set(handle, {
      handle,
      callback,
      dueAtMs: this.#nowMs + delayMs,
      delayMs,
    })
    return handle
  }

  readonly clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.#timeouts.delete(handle)
  }

  timeoutDelays(): readonly number[] {
    return [...this.#timeouts.values()].map((timer) => timer.delayMs).sort((a, b) => a - b)
  }

  async advanceBy(deltaMs: number): Promise<void> {
    const targetMs = this.#nowMs + deltaMs
    for (;;) {
      const next = [...this.#timeouts.values()]
        .filter((timer) => timer.dueAtMs <= targetMs)
        .sort((left, right) => left.dueAtMs - right.dueAtMs)[0]
      if (next === undefined) break
      this.#nowMs = next.dueAtMs
      this.#timeouts.delete(next.handle)
      next.callback()
      await flushMicrotasks()
    }
    this.#nowMs = targetMs
    await flushMicrotasks()
  }
}

interface RunningHost {
  readonly agentQaRoot: string
  readonly jobs: LocalAgentJobs
  readonly scheduler: ManualScheduler
  readonly running: Promise<number>
  nudge(): void
  signal(): void
  stop(): Promise<void>
}

const temporaryRoots: string[] = []
const runningHosts: RunningHost[] = []

function jobKinds(handler: JobHandler, maxAttempts = 3): JobKindRegistry {
  return createJobKindRegistry([
    {
      kind: FIXTURE_KIND,
      checkpointed: false,
      checkpointSchedule: [],
      allowedSuccessors: [],
      maxAttempts,
      backoff: { kind: 'fixed', delayMs: RETRY_DELAY_MS },
      onPermanentFailure: 'halt-chain',
      handler,
    },
  ])
}

async function flushMicrotasks(turns = 24): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function startHost(kinds: JobKindRegistry): Promise<RunningHost> {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-daemon-dispatch-'))
  temporaryRoots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const scheduler = new ManualScheduler()
  const signals = new Map<NodeJS.Signals, () => void>()
  let jobs: LocalAgentJobs | undefined
  let nudge: ((input: NudgeEnvelope) => void) | undefined
  let stopped = false

  const operations: Partial<DaemonHostOperations> = {
    now: scheduler.now,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    setInterval: (_callback, intervalMs) => (
      { intervalMs, unref: () => undefined } as unknown as ReturnType<typeof setInterval>
    ),
    clearInterval: () => undefined,
    onSignal: (signal, listener) => signals.set(signal, listener),
    offSignal: (signal, listener) => {
      if (signals.get(signal) === listener) signals.delete(signal)
    },
    hardExit: (code) => {
      throw new Error(`unexpected daemon hard exit ${code}`)
    },
    composeLocalAgent: (input) => {
      const host = composeLocalAgent({ ...input, jobKinds: kinds })
      const originalJobs = host.jobs.bind(host)
      const capturingHost: LocalAgentHost = {
        ...host,
        async jobs() {
          jobs = await originalJobs()
          return jobs
        },
      }
      return capturingHost
    },
    startInvokeServer: async (options: StartInvokeServerOptions) => {
      nudge = options.onNudge
      return {
        socketPath: options.socketPath,
        close: () => Promise.resolve(),
      }
    },
  }

  const running = runDaemonHost({
    agentQaRoot,
    knowledgeRoot,
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: join(root, 'agent-qa.config.yaml'),
        entries: [],
      }),
    },
    model: () => TEST_MODEL,
    operations,
    logger: { info: vi.fn(), error: vi.fn() },
  })

  await waitUntil(
    () => jobs !== undefined && nudge !== undefined,
    'daemon did not reach its ready state',
  )

  const host: RunningHost = {
    agentQaRoot,
    jobs: jobs!,
    scheduler,
    running,
    nudge: () => nudge?.({ kind: 'candidates-enqueued' }),
    signal: () => signals.get('SIGTERM')?.(),
    async stop() {
      if (stopped) return
      stopped = true
      signals.get('SIGTERM')?.()
      await running
    },
  }
  runningHosts.push(host)
  return host
}

function readEvents(agentQaRoot: string): readonly Record<string, unknown>[] {
  const path = join(agentQaRoot, DAEMON_EVENTS_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

afterEach(async () => {
  for (const host of runningHosts.splice(0)) {
    await host.stop().catch(() => undefined)
  }
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resident daemon agent-job dispatcher (CR-05)', () => {
  it('serves a post-start enqueue through the real composed store without a restart', async () => {
    const calls: string[] = []
    const host = await startHost(jobKinds(async (context) => {
      calls.push(String(context.job.id))
      return { status: 'complete', next: [] }
    }))

    const enqueued = await host.jobs.queue.enqueue(FIXTURE_KIND, { runRef: 'late' }, 'late-job')
    host.nudge()

    await waitUntil(() => calls.length === 1, 'post-start job was not dispatched')
    expect(calls).toEqual([String(enqueued.job.id)])
    expect((await host.jobs.store.dumpState()).jobs[0]).toMatchObject({
      status: 'done',
      attempts: 1,
      claimed: false,
    })
  })

  it('does not retry before retryDelayMs even when repeated wakeups arrive', async () => {
    const attempts: number[] = []
    const host = await startHost(jobKinds(async (context) => {
      attempts.push(context.job.attempts)
      return attempts.length === 1
        ? { status: 'retryable', reason: 'transient' }
        : { status: 'complete', next: [] }
    }))

    await host.jobs.queue.enqueue(FIXTURE_KIND, {}, 'retry-job')
    host.nudge()
    await waitUntil(() => attempts.length === 1, 'first retry attempt did not run')

    host.nudge()
    host.nudge()
    await flushMicrotasks()
    expect(attempts).toEqual([1])

    await host.scheduler.advanceBy(RETRY_DELAY_MS - 1)
    expect(attempts).toEqual([1])
    await host.scheduler.advanceBy(1)
    await waitUntil(() => attempts.length === 2, 'eligible retry did not run')

    expect(attempts).toEqual([1, 2])
    expect((await host.jobs.store.dumpState()).jobs[0]).toMatchObject({
      status: 'done',
      attempts: 2,
    })
  })

  it('survives a throwing handler and immediately serves the next job', async () => {
    const completed: string[] = []
    const host = await startHost(jobKinds(async (context) => {
      const payload = context.payload as { fail?: boolean }
      if (payload.fail === true) throw new Error('synthetic handler crash')
      completed.push(String(context.job.id))
      return { status: 'complete', next: [] }
    }))

    await host.jobs.queue.enqueue(FIXTURE_KIND, { fail: true }, 'a-failing-job')
    const survivor = await host.jobs.queue.enqueue(FIXTURE_KIND, {}, 'b-surviving-job')
    host.nudge()

    await waitUntil(() => completed.length === 1, 'dispatcher stopped after a handler threw')
    expect(completed).toEqual([String(survivor.job.id)])
    expect((await host.jobs.store.dumpState()).jobs.map((job) => ({
      id: job.id,
      status: job.status,
      claimed: job.claimed,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'queued', claimed: true }),
      expect.objectContaining({ id: String(survivor.job.id), status: 'done', claimed: false }),
    ]))
  })

  it('probes once beyond the safety bound and idles an empty queue without spinning', async () => {
    let completed = 0
    const host = await startHost(jobKinds(async () => {
      completed += 1
      return { status: 'complete', next: [] }
    }))

    for (let index = 0; index < 65; index += 1) {
      await host.jobs.queue.enqueue(FIXTURE_KIND, { index }, `job-${String(index).padStart(2, '0')}`)
    }
    host.nudge()
    await waitUntil(() => completed === 65, 'dispatcher did not perform the non-empty bound probe')

    expect(readEvents(host.agentQaRoot)).toContainEqual(expect.objectContaining({
      kind: 'job-completed',
      dispatchSafetyBoundExceeded: true,
    }))
    expect(host.scheduler.timeoutDelays()).toContain(DISPATCH_POLL_MS)

    const callsAtIdle = completed
    await flushMicrotasks()
    expect(completed).toBe(callsAtIdle)
    await host.scheduler.advanceBy(DISPATCH_POLL_MS)
    expect(completed).toBe(callsAtIdle)
    expect(host.scheduler.timeoutDelays()).toContain(DISPATCH_POLL_MS)
  })

  it('waits for an in-flight job before graceful teardown resolves', async () => {
    let entered = false
    let release = (): void => undefined
    const allowedToFinish = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = await startHost(jobKinds(async () => {
      entered = true
      await allowedToFinish
      return { status: 'complete', next: [] }
    }))

    await host.jobs.queue.enqueue(FIXTURE_KIND, {}, 'slow-job')
    host.nudge()
    await waitUntil(() => entered, 'slow job never entered its handler')

    let hostResolved = false
    void host.running.then(() => {
      hostResolved = true
    })
    host.signal()
    await flushMicrotasks()
    expect(hostResolved).toBe(false)

    release()
    await expect(host.running).resolves.toBe(0)
    expect(hostResolved).toBe(true)
  })

  it('pins the dispatcher poll interval in source with a retune-from-evidence comment', () => {
    const source = readFileSync(new URL('../daemon/job-dispatcher.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/export const AGENT_JOB_DISPATCH_POLL_MS = 5_000/u)
    expect(source).toMatch(/retune from .*evidence.*without adding config/iu)
  })
})
