// The shared post-run tail's postures (Phase 388 plan 02, D-03 / D-07).
//
// Every operation is injected, so what is under test here is the tail's DECISION TABLE — who
// drains, who hands off, when the pump stops, what a failure costs — rather than sqlite or a
// lease file. The durable half (one row for two tail runs) is proven against the real store in
// `post-run-enqueue-idempotency.test.ts`; splitting them keeps each proof about one thing.

import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { chainJobIdsForRun } from '@vostride/agent-qa-agent'
import { DIGEST_JOB_ID_SOURCE } from '@vostride/agent-qa-agent-local'
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
/**
 * The ids THIS run's chain addresses, derived the way the tail derives them.
 *
 * The fakes below claim jobs by id now, because the tail scopes what it emits and what it counts
 * as its own by id (388-07). A stand-in id invented here would model a job no run could enqueue,
 * and every own-chain assertion made against it would be measuring the fixture.
 */
const OWN_CHAIN = chainJobIdsForRun(runId, DIGEST_JOB_ID_SOURCE)

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
        // The real handle publishes the source its queue mints ids with, and the tail derives
        // this run's chain from it. A fake without one would let the tail's derivation pass on
        // a shape production never hands it.
        idSource: DIGEST_JOB_ID_SOURCE,
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
      { ran: true, disposition: 'completed', job: { id: String(OWN_CHAIN.analyzeRun) } },
      { ran: true, disposition: 'completed', job: { id: String(OWN_CHAIN.curateMemory) } },
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
      job: { id: String(OWN_CHAIN.analyzeRun) },
    }))
    const h = harness({ runNextJob })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    // Never sleep the run process on a backoff — one claim, then out.
    expect(runNextJob).toHaveBeenCalledTimes(1)
    expect(tail.report().drain).toBe('retry-scheduled')
  })

  it('reports backlog-exhausted when a foreign retry-scheduled row breaks the pump first (G-388-3)',
    async () => {
      // The DETECTOR, differential twin of the retry case above — same disposition, same single
      // claim, same fixture; the ONE input that differs is the claimed id, a FOREIGN one. A
      // foreign row's backoff broke the pump before this run's chain was ever reachable, which
      // is the same starvation as a spent bound with a different trigger — and the shipped
      // guard ranged past this exit, leaving a bare `pending` for starved work (T-388-18b).
      const runNextJob = vi.fn(async () => ({
        ran: true,
        disposition: 'retry-scheduled',
        reason: 'transient',
        retryDelayMs: 30_000,
        attemptsRemaining: 2,
        job: { id: 'job_some_other_run' },
      }))
      const h = harness({ runNextJob })
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()

      expect(runNextJob).toHaveBeenCalledTimes(1)
      expect(tail.report().drain).toBe('backlog-exhausted')
    })

  it('stops the pump at the one budget rather than following the chain forever', async () => {
    const h = harness({
      runNextJob: vi.fn(async () => ({
        ran: true,
        disposition: 'completed',
        // THIS run's own chain head, endlessly re-claimed: the budget ran out while the pump was
        // on this run's work, which is `budget-exhausted` and not a backlog.
        job: { id: String(OWN_CHAIN.analyzeRun) },
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

  it('reports backlog-exhausted when the budget went entirely to other runs\' jobs (WR-01)',
    async () => {
      // The differential twin of the test above: same clock, same dispositions, same bound. The
      // ONE thing that differs is the id the pump kept claiming — a foreign one — and that is the
      // only input the posture is allowed to turn on.
      const h = harness({
        runNextJob: vi.fn(async () => ({
          ran: true,
          disposition: 'completed',
          job: { id: 'job_some_other_run' },
        })),
      })
      let reads = 0
      ;(h.operations as { now: () => number }).now = () => 1_000 + (reads++) * 30_000
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()

      expect(tail.report().drain).toBe('backlog-exhausted')
    })

  it('reports backlog-exhausted at the pump bound when every claimed job was foreign (a CONTROL)',
    async () => {
      // CONTROL, not a detector: this case passed BEFORE the exit classification existed — the
      // shipped guard already covered the `bound` exit — and it passes after. It is here to pin
      // the table's `bound` member so the classification cannot silently flip, not as evidence
      // the G-388-3 fix works. Static clock, so the loop runs to its bound and falls out.
      const h = harness({
        runNextJob: vi.fn(async () => ({
          ran: true,
          disposition: 'completed',
          job: { id: 'job_some_other_run' },
        })),
      })
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()

      // CHAIN_PUMP_BOUND claims, none of them this run's.
      expect(h.runNextJob).toHaveBeenCalledTimes(16)
      expect(tail.report().drain).toBe('backlog-exhausted')
    })

  it('keeps `drained` at the pump bound when the pump was on this run\'s own chain (a CONTROL)',
    async () => {
      // CONTROL, differential twin of the case above — same static clock, same dispositions,
      // same bound; the one input that differs is the claimed id, this run's OWN. Passed before
      // AND after the change: it pins that observing the own chain suppresses the starvation
      // posture, whatever the exit.
      const h = harness({
        runNextJob: vi.fn(async () => ({
          ran: true,
          disposition: 'completed',
          job: { id: String(OWN_CHAIN.analyzeRun) },
        })),
      })
      const tail = runPostRunTail(options(h))
      await tail.enqueue()
      await tail.drain()

      expect(h.runNextJob).toHaveBeenCalledTimes(16)
      expect(tail.report().drain).toBe('drained')
    })

  it('keeps `drained` when the queue simply emptied, backlog or not', async () => {
    // An empty queue means this run's enqueued chain WAS reached — the rows are gone because
    // somebody ran them, so a starvation posture here would report a backlog that does not exist.
    const h = harness({ runNextJob: vi.fn(async () => ({ ran: false, reason: 'no-job' })) })
    const tail = runPostRunTail(options(h))
    await tail.enqueue()
    await tail.drain()

    expect(tail.report().drain).toBe('drained')
    expect(tail.report().jobsRun).toBe(0)
  })

  it('keeps `drained` when an abort ends the pump before this run\'s chain was reached',
    async () => {
      // An aborted drain is not a starved one. The user asked this process to stop; telling them
      // their work is queued behind a backlog would name a cause the run never observed.
      const controller = new AbortController()
      const h = harness({
        runNextJob: vi.fn(async () => {
          controller.abort()
          return { ran: true, disposition: 'completed', job: { id: 'job_some_other_run' } }
        }),
      })
      const tail = runPostRunTail({ ...options(h), signal: controller.signal })
      await tail.enqueue()
      await tail.drain()

      expect(h.runNextJob).toHaveBeenCalledTimes(1)
      expect(tail.report().drain).toBe('drained')
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
