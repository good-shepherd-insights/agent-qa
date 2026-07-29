import { beforeEach, describe, expect, it } from 'vitest'

import type { ChainedJobRequest, JobId, JobKind } from '@vostride/agent-qa-schema'

import type { ClockPort } from '../../ports/clock.js'
import type { JobStoreFence } from '../../ports/job-store.js'
import {
  createAgentJobQueue,
  UndeclaredJobSuccessorError,
} from '../engine.js'
import type { AgentJobQueue, JobIdSource, RunNextJobOutcome } from '../engine.js'
import { createJobKindRegistry } from '../kind-registry.js'
import type { JobKindDeclaration, JobKindRegistry } from '../kind-registry.js'
import { createRealJobKindRegistry } from '../kinds.js'
import type { JobModelCapability } from '../record-llm-authorship.js'
import { createFakeJobStore } from './fake-job-store.js'
import type { FakeJobStore } from './fake-job-store.js'

/** Deterministic and arithmetic-free: the engine never parses a timestamp, so nor does this. */
function createSteppingClock(): ClockPort {
  let tick = 0
  return {
    now: () => {
      tick += 1
      return `2026-01-01T00:00:${String(tick).padStart(2, '0')}.000Z`
    },
  }
}

const idSource: JobIdSource = {
  jobIdFor: (kind, idempotencyKey) => `job_${kind}_${idempotencyKey}` as JobId,
}

/**
 * The queue needs a model bound (385 plan 05, D-10) and nothing in this file authors, so this
 * one refuses. A capability that answered would let a test in here start depending on model
 * output by accident; a capability that throws keeps the authorship proofs where they belong.
 */
const unusedModel: JobModelCapability = {
  modelId: 'test:unused',
  generate: async () => {
    throw new Error('engine-semantics tests never author; see record-llm-authorship.test.ts')
  },
}

function declaration(overrides: Partial<JobKindDeclaration> = {}): JobKindDeclaration {
  return {
    kind: 'analyze-run',
    checkpointed: true,
    checkpointSchedule: ['verdicts-authored'],
    allowedSuccessors: [],
    maxAttempts: 3,
    backoff: { kind: 'none' },
    onPermanentFailure: 'halt-chain',
    handler: async () => ({ status: 'complete', next: [] }),
    ...overrides,
  }
}

interface Harness {
  readonly store: FakeJobStore
  readonly queue: AgentJobQueue
  readonly fence: JobStoreFence
  readonly registry: JobKindRegistry
}

async function harnessFor(
  declarations: readonly JobKindDeclaration[] | JobKindRegistry,
): Promise<Harness> {
  const clock = createSteppingClock()
  const store = createFakeJobStore(clock)
  const registry = Array.isArray(declarations)
    ? createJobKindRegistry(declarations)
    : (declarations as JobKindRegistry)
  const queue = createAgentJobQueue({ store, registry, clock, idSource, model: unusedModel })
  const fence = await store.adoptEpoch(1)
  return { store, queue, fence, registry }
}

function statusOf(store: FakeJobStore, jobId: string): string | undefined {
  return store.rows().find((row) => row.id === jobId)?.status
}

describe('bounded retry (D-18)', () => {
  it('retries a retryable report until the bound is spent, then fails', async () => {
    const invocations: number[] = []
    const harness = await harnessFor([
      declaration({
        maxAttempts: 3,
        handler: async (context) => {
          invocations.push(context.job.attempts)
          return { status: 'retryable', reason: 'transient' }
        },
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    const first = await harness.queue.runNextJob({ fence: harness.fence })
    expect(first).toMatchObject({
      ran: true,
      disposition: 'retry-scheduled',
      reason: 'transient',
      attemptsRemaining: 2,
    })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('queued')

    const second = await harness.queue.runNextJob({ fence: harness.fence })
    expect(second).toMatchObject({ disposition: 'retry-scheduled', attemptsRemaining: 1 })

    // The third attempt is the last permitted one, so a retryable REPORT becomes a permanent
    // DECISION here — the distinction the two types exist to carry.
    const third = await harness.queue.runNextJob({ fence: harness.fence })
    expect(third).toMatchObject({ ran: true, disposition: 'failed', reason: 'transient' })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('failed')

    expect(invocations).toEqual([1, 2, 3])
    // Terminal: a failed job is never claimed again.
    expect(await harness.queue.runNextJob({ fence: harness.fence })).toEqual({
      ran: false,
      reason: 'no-job',
    })
    expect(invocations).toEqual([1, 2, 3])
  })

  // The negative control for the bound. Without it, an engine that failed EVERY retryable
  // report on its first attempt would satisfy the sequence above from its third assertion on.
  it('does not fail a job that succeeds within its bound', async () => {
    let calls = 0
    const harness = await harnessFor([
      declaration({
        maxAttempts: 3,
        handler: async () => {
          calls += 1
          return calls === 1
            ? { status: 'retryable', reason: 'first attempt' }
            : { status: 'complete', next: [] }
        },
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    await harness.queue.runNextJob({ fence: harness.fence })
    const second = await harness.queue.runNextJob({ fence: harness.fence })

    expect(second).toMatchObject({ ran: true, disposition: 'completed' })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('done')
  })

  it('fails a permanent report immediately, spending no further attempt', async () => {
    let calls = 0
    const harness = await harnessFor([
      declaration({
        maxAttempts: 5,
        handler: async () => {
          calls += 1
          return { status: 'permanent', reason: 'malformed input' }
        },
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'failed', reason: 'malformed input' })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('failed')
    expect(calls).toBe(1)
    expect(await harness.queue.runNextJob({ fence: harness.fence })).toEqual({
      ran: false,
      reason: 'no-job',
    })
  })

  // The control that distinguishes "reads the discriminant" from "fails on any report at
  // all": the SAME declaration, the same attempt, a retryable report instead.
  it('does not fail a retryable report on the same attempt a permanent one would', async () => {
    const harness = await harnessFor([
      declaration({
        maxAttempts: 5,
        handler: async () => ({ status: 'retryable', reason: 'transient' }),
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'retry-scheduled' })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('queued')
  })
})

describe('the poison job: a handler that never returns still exhausts its bound (D-18)', () => {
  // The whole point of counting the attempt at the CLAIM. A handler that kills its host never
  // reports anything, so an engine that consulted maxAttempts only while recording a failure
  // would never consult it at all for exactly the job the bound exists to stop. Here the
  // handler throws, which is the in-process shape of the same fact: control never reaches the
  // driver's failure branch, and nothing is recorded.
  it('lands failed without ever invoking the handler again, and terminates', async () => {
    let calls = 0
    const harness = await harnessFor([
      declaration({
        maxAttempts: 3,
        handler: async () => {
          calls += 1
          throw new Error('host died mid-handler')
        },
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcomes: RunNextJobOutcome[] = []
    // A bounded pump: if the bound were unenforceable on this path the loop would run out
    // rather than hang, and the assertions below would report which way it failed.
    for (let pump = 0; pump < 12; pump += 1) {
      if (statusOf(harness.store, String(enqueued.job.id)) !== 'queued') break
      try {
        outcomes.push(await harness.queue.runNextJob({ fence: harness.fence }))
      } catch {
        // The host died. A fresh host adopts authority and releases the abandoned claim.
        await harness.queue.recoverAbandonedClaims({ fence: harness.fence })
      }
    }

    expect(calls).toBe(3)
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('failed')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      ran: true,
      disposition: 'failed',
      handlerInvoked: false,
    })
    expect(String((outcomes[0] as { reason: string }).reason)).toContain('3')
  })

  it('runs the exhausted job to completion when the bound has NOT been spent', async () => {
    // Negative control for the claim-time guard: a job whose attempts sit below the bound is
    // still handed to its handler. A guard that refused every claim would satisfy the test
    // above perfectly.
    const harness = await harnessFor([declaration({ maxAttempts: 3 })])
    await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'completed', handlerInvoked: true })
  })
})

describe('abandoned claims', () => {
  it('releases a claim its host never finished, preserving the attempt it spent', async () => {
    const harness = await harnessFor([
      declaration({
        handler: async () => {
          throw new Error('host died mid-handler')
        },
      }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')
    await expect(harness.queue.runNextJob({ fence: harness.fence })).rejects.toThrowError()

    expect(harness.store.rows()[0]?.claimed).toBe(true)
    const recovered = await harness.queue.recoverAbandonedClaims({ fence: harness.fence })

    expect(recovered.released).toEqual([enqueued.job.id])
    expect(harness.store.rows()[0]?.claimed).toBe(false)
    // The attempt stays spent: that is what makes the bound hold across a crash.
    expect(harness.store.rows()[0]?.attempts).toBe(1)
  })

  it('releases nothing when no claim is outstanding', async () => {
    const harness = await harnessFor([declaration()])
    await harness.queue.enqueue('analyze-run', {}, 'key')

    expect(await harness.queue.recoverAbandonedClaims({ fence: harness.fence })).toEqual({
      released: [],
    })

    await harness.queue.runNextJob({ fence: harness.fence })
    expect(await harness.queue.recoverAbandonedClaims({ fence: harness.fence })).toEqual({
      released: [],
    })
  })
})

describe('backoff as data (D-18)', () => {
  it.each([
    { backoff: { kind: 'none' } as const, expected: [0, 0, 0] },
    { backoff: { kind: 'fixed', delayMs: 500 } as const, expected: [500, 500, 500] },
    {
      backoff: {
        kind: 'exponential',
        initialDelayMs: 100,
        factor: 2,
        maxDelayMs: 300,
      } as const,
      expected: [100, 200, 300],
    },
  ])('spaces the retries of $backoff.kind', async ({ backoff, expected }) => {
    const harness = await harnessFor([
      declaration({
        maxAttempts: 4,
        backoff,
        handler: async () => ({ status: 'retryable', reason: 'transient' }),
      }),
    ])
    await harness.queue.enqueue('analyze-run', {}, 'key')

    const delays: number[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await harness.queue.runNextJob({ fence: harness.fence })
      delays.push((outcome as { retryDelayMs: number }).retryDelayMs)
    }

    expect(delays).toEqual(expected)
  })
})

describe('declared-topology chaining (D-17)', () => {
  it('chains a declared successor and stores it', async () => {
    const harness = await harnessFor([
      declaration({
        kind: 'analyze-run',
        allowedSuccessors: ['curate-memory'],
        handler: async () => ({
          status: 'complete',
          next: [{ kind: 'curate-memory', payload: { n: 1 }, idempotencyKey: 'chained' }],
        }),
      }),
      declaration({ kind: 'curate-memory', checkpointSchedule: ['candidates-authored'] }),
    ])
    await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'completed' })
    expect(harness.store.rows().map((row) => row.kind).sort()).toEqual([
      'analyze-run',
      'curate-memory',
    ])
  })

  it('refuses an undeclared successor by name, before anything is written', async () => {
    const harness = await harnessFor([
      declaration({
        kind: 'analyze-run',
        allowedSuccessors: [],
        handler: async () => ({
          status: 'complete',
          next: [{ kind: 'curate-memory', payload: {}, idempotencyKey: 'smuggled' }],
        }),
      }),
      declaration({ kind: 'curate-memory', checkpointSchedule: ['candidates-authored'] }),
    ])
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    await expect(harness.queue.runNextJob({ fence: harness.fence })).rejects.toBeInstanceOf(
      UndeclaredJobSuccessorError,
    )

    expect(harness.store.rows()).toHaveLength(1)
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('queued')
  })
})

describe('the permanent-failure disposition (D-20)', () => {
  function producerHarness(
    next: readonly ChainedJobRequest[],
    allowedSuccessors: readonly JobKind[] = ['curate-memory'],
  ): { calls: () => number; harness: Promise<Harness> } {
    let calls = 0
    return {
      calls: () => calls,
      harness: harnessFor([
        declaration({
          kind: 'analyze-run',
          allowedSuccessors,
          maxAttempts: 1,
          onPermanentFailure: () => {
            calls += 1
            return next
          },
          handler: async () => ({ status: 'permanent', reason: 'dead head' }),
        }),
        declaration({ kind: 'curate-memory', checkpointSchedule: ['candidates-authored'] }),
      ]),
    }
  }

  it('invokes the producer exactly once and enqueues its continuation', async () => {
    const probe = producerHarness([
      { kind: 'curate-memory', payload: { verdicts: 'unknown' }, idempotencyKey: 'fallback' },
    ])
    const harness = await probe.harness
    const enqueued = await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(probe.calls()).toBe(1)
    expect(outcome).toMatchObject({ disposition: 'failed' })
    expect(statusOf(harness.store, String(enqueued.job.id))).toBe('failed')
    expect(harness.store.rows().filter((row) => row.kind === 'curate-memory')).toHaveLength(1)
  })

  it('does not invoke it a second time when the queue is pumped again', async () => {
    const probe = producerHarness([
      { kind: 'curate-memory', payload: {}, idempotencyKey: 'fallback' },
    ])
    const harness = await probe.harness
    await harness.queue.enqueue('analyze-run', {}, 'key')
    await harness.queue.runNextJob({ fence: harness.fence })

    // The continuation IS claimable, so the pump has work to do — this is not the empty-queue
    // case wearing a disguise.
    const next = await harness.queue.runNextJob({ fence: harness.fence })
    expect(next).toMatchObject({ ran: true, job: { kind: 'curate-memory' } })
    await harness.queue.runNextJob({ fence: harness.fence })

    expect(probe.calls()).toBe(1)
    expect(harness.store.rows().filter((row) => row.kind === 'curate-memory')).toHaveLength(1)
  })

  // The crash window: a host that died between enqueuing the continuation and recording the
  // failure re-runs the disposition on the next attempt. What makes that safe is not a flag
  // but the idempotency key — the second enqueue merges into the row already there.
  it('produces one continuation job even when the producer runs twice', async () => {
    const probe = producerHarness([
      { kind: 'curate-memory', payload: {}, idempotencyKey: 'fallback' },
    ])
    const harness = await probe.harness
    await harness.queue.enqueue('analyze-run', {}, 'key')
    // Stand in for the crashed host's half-finished disposition.
    await harness.queue.enqueue('curate-memory', {}, 'fallback')

    await harness.queue.runNextJob({ fence: harness.fence })

    expect(probe.calls()).toBe(1)
    expect(harness.store.rows().filter((row) => row.kind === 'curate-memory')).toHaveLength(1)
  })

  // The ORDER of the two writes, asserted rather than argued. A host that died between them
  // must leave the continuation already durable and the job still claimable, so the next
  // attempt re-runs the disposition and the dedupe merges it. Recording the failure first
  // would make the job terminal with nothing left to finish its chain.
  it('enqueues the continuation before it records the failure', async () => {
    const clock = createSteppingClock()
    const store = createFakeJobStore(clock)
    const crashing = {
      ...store,
      recordFailure: async () => {
        throw new Error('the host died between the two writes')
      },
    }
    const registry = createJobKindRegistry([
      declaration({
        kind: 'analyze-run',
        allowedSuccessors: ['curate-memory'],
        maxAttempts: 1,
        onPermanentFailure: () => [
          { kind: 'curate-memory', payload: {}, idempotencyKey: 'fallback' },
        ],
        handler: async () => ({ status: 'permanent', reason: 'dead head' }),
      }),
      declaration({ kind: 'curate-memory', checkpointSchedule: ['candidates-authored'] }),
    ])
    const queue = createAgentJobQueue({
      store: crashing,
      registry,
      clock,
      idSource,
      model: unusedModel,
    })
    const fence = await store.adoptEpoch(1)
    await queue.enqueue('analyze-run', {}, 'key')

    await expect(queue.runNextJob({ fence })).rejects.toThrowError('died between')

    expect(store.rows().filter((row) => row.kind === 'curate-memory')).toHaveLength(1)
    expect(store.rows().find((row) => row.kind === 'analyze-run')?.status).toBe('queued')
  })

  // Without this, "invoked exactly once" is satisfied by an engine that invokes it zero times.
  it('never invokes it for a job that does not permanently fail', async () => {
    let calls = 0
    const harness = await harnessFor([
      declaration({
        maxAttempts: 3,
        onPermanentFailure: () => {
          calls += 1
          return []
        },
        handler: async () => ({ status: 'complete', next: [] }),
      }),
    ])
    await harness.queue.enqueue('analyze-run', {}, 'key')
    await harness.queue.runNextJob({ fence: harness.fence })

    expect(calls).toBe(0)
  })

  it('enqueues nothing for a halt-chain kind', async () => {
    const harness = await harnessFor([
      declaration({
        maxAttempts: 1,
        allowedSuccessors: ['curate-memory'],
        onPermanentFailure: 'halt-chain',
        handler: async () => ({ status: 'permanent', reason: 'dead head' }),
      }),
      declaration({ kind: 'curate-memory', checkpointSchedule: ['candidates-authored'] }),
    ])
    await harness.queue.enqueue('analyze-run', {}, 'key')

    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'failed', continuation: [] })
    expect(harness.store.rows()).toHaveLength(1)
  })

  it('refuses a continuation outside the declared topology, before anything is written', async () => {
    const probe = producerHarness(
      [{ kind: 'curate-memory', payload: {}, idempotencyKey: 'smuggled' }],
      [],
    )
    const harness = await probe.harness
    await harness.queue.enqueue('analyze-run', {}, 'key')

    await expect(harness.queue.runNextJob({ fence: harness.fence })).rejects.toBeInstanceOf(
      UndeclaredJobSuccessorError,
    )
    expect(harness.store.rows()).toHaveLength(1)
    expect(harness.store.rows()[0]?.status).toBe('queued')
  })
})

describe('the six real kinds, driven through the engine', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await harnessFor(createRealJobKindRegistry())
  })

  it('publishes a chat turn with no checkpoint at all', async () => {
    await harness.queue.enqueue('chat', {}, 'turn-1')
    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'completed', checkpointsPublished: [] })
    expect(harness.store.checkpoints()).toEqual([])
  })

  it('publishes every declared checkpoint of a checkpointed kind', async () => {
    await harness.queue.enqueue('curate-memory', {}, 'run-1')
    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({
      disposition: 'completed',
      checkpointsPublished: ['candidates-authored', 'bundle-committed'],
    })
  })

  it('chains analyze-run into its declared successors', async () => {
    await harness.queue.enqueue('analyze-run', { chain: true }, 'run-1')
    await harness.queue.runNextJob({ fence: harness.fence })

    expect(harness.store.rows().map((row) => row.kind).sort()).toEqual([
      'analyze-run',
      'curate-memory',
      'triage-issues',
    ])
  })

  it('proceeds with unknown verdicts when analyze-run permanently fails', async () => {
    await harness.queue.enqueue('analyze-run', { fail: 'permanent', reason: 'no model' }, 'run-1')
    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'failed', reason: 'no model' })
    const continuation = harness.store.rows().filter((row) => row.kind !== 'analyze-run')
    expect(continuation.map((row) => row.kind).sort()).toEqual([
      'curate-memory',
      'triage-issues',
    ])
    for (const row of continuation) {
      expect(row.payload).toMatchObject({ verdicts: 'unknown' })
    }
  })

  it('halts the chain when a halt-chain kind permanently fails', async () => {
    await harness.queue.enqueue('curate-memory', { fail: 'permanent', reason: 'bad bundle' }, 'r')
    const outcome = await harness.queue.runNextJob({ fence: harness.fence })

    expect(outcome).toMatchObject({ disposition: 'failed', continuation: [] })
    expect(harness.store.rows()).toHaveLength(1)
  })

  it('spends the declared bound of a real kind and no more', async () => {
    await harness.queue.enqueue('triage-issues', { fail: 'retryable' }, 'run-1')
    const bound = harness.registry.require('triage-issues').maxAttempts

    const dispositions: string[] = []
    for (let pump = 0; pump < bound + 2; pump += 1) {
      const outcome = await harness.queue.runNextJob({ fence: harness.fence })
      dispositions.push(outcome.ran ? outcome.disposition : outcome.reason)
    }

    expect(dispositions).toEqual([
      ...Array.from({ length: bound - 1 }, () => 'retry-scheduled'),
      'failed',
      'no-job',
      'no-job',
    ])
  })
})
