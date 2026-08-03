// The shared post-run tail's postures (Phase 388 plan 02, D-03 / D-07).
//
// Every operation is injected, so what is under test here is the tail's DECISION TABLE — who
// drains, who hands off, when the pump stops, what a failure costs — rather than sqlite or a
// lease file. The durable half (one row for two tail runs) is proven against the real store in
// `post-run-enqueue-idempotency.test.ts`; splitting them keeps each proof about one thing.

import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import type { AuditSink } from '@vostride/agent-qa-safety'
import type { GuardrailPolicy, MaskingContext } from '@vostride/agent-qa-schema'

import { runVerdictFirstCurationTail } from '../curation/curation-tail.js'
import {
  runPostRunTail,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../curation/post-run-tail.js'

const agentQaRoot = '/workspace/project/.agent-qa'
const configDir = '/workspace/project'
const configPath = '/workspace/project/agent-qa.config.yaml'
const knowledgeRoot = '/workspace/project/agent-qa-knowledge'
const runId = 'run-post-run-tail'

const handoff = {
  runId,
  schemaVersion: 5,
  executionContext: 'local-headless',
} as unknown as ReturnType<PostRunTailOperations['loadCompletedRunHandoff']>

interface Harness {
  operations: PostRunTailOperations
  enqueue: ReturnType<typeof vi.fn>
  runNextJob: ReturnType<typeof vi.fn>
  adoptEpoch: ReturnType<typeof vi.fn>
  recoverAbandonedClaims: ReturnType<typeof vi.fn>
  nudgeDaemon: ReturnType<typeof vi.fn>
  releaseLease: ReturnType<typeof vi.fn>
  runCurationTail: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  warn: Mock<(message: string) => void>
  clock: { value: number }
}

function harness(overrides: {
  lease?: ReturnType<PostRunTailOperations['acquireWriterLease']>
  enqueue?: ReturnType<typeof vi.fn>
  runNextJob?: ReturnType<typeof vi.fn>
} = {}): Harness {
  const clock = { value: 1_000 }
  const warn = vi.fn<(message: string) => void>()
  const enqueue = overrides.enqueue
    ?? vi.fn(async () => ({ job: { id: 'job_analyze' }, deduped: false }))
  const runNextJob = overrides.runNextJob
    ?? vi.fn(async () => ({ ran: false, reason: 'no-job' }))
  const adoptEpoch = vi.fn(async () => ({ epoch: 7 }))
  const recoverAbandonedClaims = vi.fn(async () => ({ recovered: 0 }))
  const nudgeDaemon = vi.fn(async () => undefined)
  const releaseLease = vi.fn(() => ({ kind: 'released' }))
  const runCurationTail = vi.fn(async () => undefined)
  const close = vi.fn(async () => undefined)

  const operations = {
    loadCompletedRunHandoff: vi.fn(() => handoff),
    resolveKnowledgeRoot: vi.fn(() => knowledgeRoot),
    composeHost: vi.fn(() => ({
      jobs: async () => ({
        queue: { enqueue, runNextJob, recoverAbandonedClaims },
        store: { adoptEpoch },
      }),
      close,
    })),
    acquireWriterLease: vi.fn(() => overrides.lease
      ?? { kind: 'acquired', leaseId: 'lease-1', epoch: 7 }),
    releaseLease,
    nudgeDaemon,
    curateCompletedRun: vi.fn(async () => ({
      curated: 0,
      deprecated: 0,
      complete: true,
      drainKind: 'drained' as const,
    })),
    runCurationTail,
    now: () => clock.value,
  } as unknown as PostRunTailOperations

  return {
    operations,
    enqueue,
    runNextJob,
    adoptEpoch,
    recoverAbandonedClaims,
    nudgeDaemon,
    releaseLease,
    runCurationTail,
    close,
    warn,
    clock,
  }
}

function options(h: Harness): RunPostRunTailOptions {
  return {
    runId,
    agentQaRoot,
    configPath,
    knowledgeConfig: { dir: 'agent-qa-knowledge' },
    configDir,
    auditSink: {} as AuditSink,
    maskingContext: {} as MaskingContext,
    policy: {} as GuardrailPolicy,
    log: { warn: (message: string) => h.warn(message) },
    operations: h.operations,
  }
}

describe('the shared post-run tail (ANLZ-01 / JOBQ-06, D-03/D-07)', () => {
  it('enqueues analyze-run with the run-tail digest and runId as the idempotency key', async () => {
    const h = harness()
    const tail = runPostRunTail(options(h))
    await tail.enqueue()

    expect(h.enqueue).toHaveBeenCalledTimes(1)
    const [kind, payload, key] = h.enqueue.mock.calls[0] as [string, Record<string, unknown>, string]
    expect(kind).toBe('analyze-run')
    expect(key).toBe(runId)
    expect(payload).toMatchObject({
      runId,
      handoffSchemaVersion: 5,
      executionContext: 'local-headless',
    })
    // D-06: the digest pins the BYTES, so it must be a sha256 of the handoff and not a path.
    expect(payload.handoffDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(tail.report().enqueue).toBe('enqueued')
  })

  it('reports a deduped enqueue as a success, never an error', async () => {
    const h = harness({
      enqueue: vi.fn(async () => ({ job: { id: 'job_analyze' }, deduped: true })),
    })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()

    expect(tail.report().enqueue).toBe('deduped')
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('hands off with a nudge and returns immediately when the lease is held', async () => {
    const h = harness({ lease: { kind: 'held', holder: { pid: 4242 } } as never })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    expect(h.nudgeDaemon).toHaveBeenCalledWith(agentQaRoot, { knowledgeRoot })
    expect(tail.report().drain).toBe('handed-off')
    // The run process NEVER waits on the daemon: no epoch adopted, no job claimed, no sweep.
    expect(h.adoptEpoch).not.toHaveBeenCalled()
    expect(h.runNextJob).not.toHaveBeenCalled()
    expect(h.runCurationTail).not.toHaveBeenCalled()
    expect(h.releaseLease).not.toHaveBeenCalled()
  })

  it('drains the chain in-process through the full authority dance when the lease is free', async () => {
    const ran = [
      { ran: true, disposition: 'completed', job: { id: 'job_analyze' } },
      { ran: true, disposition: 'completed', job: { id: 'job_curate' } },
      { ran: false, reason: 'no-job' },
    ]
    let call = 0
    const h = harness({ runNextJob: vi.fn(async () => ran[call++]) })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    // Pitfall 7, in order: adopt the epoch the lease minted, reclaim abandoned claims, then pump.
    expect(h.adoptEpoch).toHaveBeenCalledWith(7)
    expect(h.recoverAbandonedClaims).toHaveBeenCalledWith({ fence: { epoch: 7 } })
    expect(h.runNextJob).toHaveBeenCalledTimes(3)
    expect(tail.report()).toEqual({ enqueue: 'enqueued', drain: 'drained', jobsRun: 2 })
    expect(h.nudgeDaemon).not.toHaveBeenCalled()
    expect(h.releaseLease).toHaveBeenCalledWith({ knowledgeRoot, leaseId: 'lease-1' })
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('runs the prior-run sweep under the SAME lease and the remainder of the one budget', async () => {
    const h = harness()
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    expect(h.runCurationTail).toHaveBeenCalledTimes(1)
    const swept = h.runCurationTail.mock.calls[0]![0] as Record<string, unknown>
    expect(swept.authority).toEqual({ leaseId: 'lease-1', epoch: 7 })
    // D-03: one budget. The sweep's stop point is the tail's own deadline, not a second knob.
    expect(swept.deadlineMs).toBe(1_000 + 60_000)
  })

  it('stops the pump on retry-scheduled and leaves the job queued for whoever drains next', async () => {
    const runNextJob = vi.fn(async () => ({
      ran: true,
      disposition: 'retry-scheduled',
      reason: 'transient',
      retryDelayMs: 30_000,
      attemptsRemaining: 2,
      job: { id: 'job_analyze' },
    }))
    const h = harness({ runNextJob })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    // Never sleep the run process on a backoff — one claim, then out.
    expect(runNextJob).toHaveBeenCalledTimes(1)
    expect(tail.report().drain).toBe('retry-scheduled')
  })

  it('stops the pump at the one budget rather than following the chain forever', async () => {
    const h = harness({
      runNextJob: vi.fn(async () => ({
        ran: true,
        disposition: 'completed',
        job: { id: 'job_endless' },
      })),
    })
    // Every clock read advances by half the budget, so the third boundary check is past it.
    let reads = 0
    ;(h.operations as { now: () => number }).now = () => 1_000 + (reads++) * 30_000
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    expect(tail.report().drain).toBe('budget-exhausted')
    expect(h.runNextJob.mock.calls.length).toBeLessThan(4)
  })

  it('logs ONE warning and resolves when the enqueue fails, still reporting (JOBQ-06/D-07)', async () => {
    const h = harness({
      enqueue: vi.fn(async () => {
        throw new Error('SQLITE_BUSY: database is locked')
      }),
    })
    const tail = runPostRunTail(options(h))
    await expect(tail.enqueue()).resolves.toBeUndefined()

    expect(h.warn).toHaveBeenCalledTimes(1)
    const warning = String(h.warn.mock.calls[0]![0])
    expect(warning).toContain(runId)
    expect(warning).toContain('SQLITE_BUSY')
    // The whole point of the warning is that it says what was NOT affected.
    expect(warning).toContain('verdict and exit code are unaffected')
    expect(tail.report().enqueue).toBe('failed')
  })

  it('enqueues under --detach and skips only the drain (D-03, Pitfall 3)', async () => {
    const h = harness()
    const tail = runPostRunTail(options(h))

    const exitCode = await runVerdictFirstCurationTail({
      exitCode: 3,
      detach: true,
      enqueue: () => tail.enqueue(),
      runTail: () => tail.drain(),
    })

    expect(exitCode).toBe(3)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(
      h.operations.acquireWriterLease as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled()
    expect(h.runNextJob).not.toHaveBeenCalled()
    expect(tail.report()).toEqual({
      enqueue: 'enqueued',
      drain: 'not-attempted',
      jobsRun: 0,
    })
  })

  it('imports the one budget rather than declaring a second timing constant', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(
      fileURLToPath(new URL('../curation/post-run-tail.ts', import.meta.url)),
      'utf8',
    )

    expect(source).toContain('DRAIN_BUDGET_MS')
    // The prohibition, stated as a measurement: no literal 60s anywhere in the helper.
    expect(source).not.toMatch(/60_000|60000/u)
  })
})

describe('the tail can never reach the exit code (JOBQ-06)', () => {
  it('survives a tail whose own operation table cannot be resolved', async () => {
    // The environment `run.test.ts`'s mocked unit runs live in: a partially-stubbed
    // `runner-local` where merely BUILDING the operation table throws. Reproduced here as a
    // throwing accessor because the spread that assembles the table is what reads the export.
    // Discovered by that suite going to exit 2 the moment the tail moved to the call site —
    // a post-run concern reaching the process code is exactly what JOBQ-06 forbids, so
    // constructing the tail must cost nothing until a leg is awaited.
    const exploding = Object.defineProperty({}, 'now', {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error('[vitest] No "loadCompletedRunHandoff" export is defined')
      },
    }) as Partial<PostRunTailOperations>
    const warn = vi.fn<(message: string) => void>()
    const tail = runPostRunTail({
      runId,
      agentQaRoot,
      configPath,
      knowledgeConfig: { dir: 'agent-qa-knowledge' },
      configDir,
      auditSink: {} as AuditSink,
      policy: {} as GuardrailPolicy,
      log: { warn: (message: string) => warn(message) },
      operations: exploding,
    })

    const exitCode = await runVerdictFirstCurationTail({
      exitCode: 0,
      detach: false,
      enqueue: () => tail.enqueue(),
      runTail: () => tail.drain(),
    })

    expect(exitCode).toBe(0)
    expect(tail.report().enqueue).toBe('failed')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
