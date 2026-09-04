// The five cells behind 413 D-04 / D-06 (RESEARCH F15, OQ-4 option (b)).
//
// What is under test is not "a pump works" — the engine's own suites cover that. It is the
// narrower claim the campaign rests on: a host can drain ONE kind and leave the successor that
// kind enqueues sitting queued and unclaimed. F15 measured that no shipped host could do this
// (global FIFO, no kind filter), so every assertion here is about what the pump did NOT touch as
// much as about what it ran.
//
// The harness composes `composeJobRecovery` with `createRealJobKindRegistry()` — no capabilities,
// so every kind gets the stand-in handler whose payload script decides completion, chaining and
// failure. That is deliberate: the D-06 guarantee must hold for a `curate-memory` row whose
// handler WOULD run if it were ever claimed, which is exactly what the stand-in is.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DIGEST_JOB_ID_SOURCE,
  LOCAL_CURATION_CAPABILITIES,
  composeJobRecovery,
} from '@vostride/agent-qa-agent-local'
import { createRealJobKindRegistry } from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_JOBS_PUMP_BOUND,
  cancelAgentJob,
  listAgentJobs,
  pumpAgentJobs,
} from '../agent-jobs-ops.js'
import type { AgentJobsOpsDeps } from '../agent-jobs-ops.js'

const { acquireWriterLease, releaseLease, refreshWriterLeaseAuthority }
  = LOCAL_CURATION_CAPABILITIES.maintenance

/**
 * The capability the queue is constructed with, shaped to `JobModelCapability` and unusable.
 *
 * A stand-in handler never reaches a model, so a model that REJECTS is the honest binding: if a
 * cell ever starts passing because a real handler authored something, this rejection is what turns
 * it red instead of quietly spending a token budget.
 */
const NEVER_AUTHORS: JobModelCapability = {
  modelId: 'test:none',
  generate: () => Promise.reject(new Error('the stand-in never authors')),
}

const clock = { now: (): string => new Date().toISOString() }

interface Harness {
  readonly deps: AgentJobsOpsDeps
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  enqueue(kind: 'analyze-run' | 'curate-memory', payload: unknown, key: string): Promise<void>
  dump(): Promise<
    readonly {
      id: string
      kind: string
      status: string
      attempts: number
      claimed: boolean
    }[]
  >
}

let roots: string[] = []

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-413-10-'))
  roots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'knowledge')
  mkdirSync(agentQaRoot, { recursive: true })
  mkdirSync(knowledgeRoot, { recursive: true })

  const open = (): ReturnType<typeof composeJobRecovery> =>
    composeJobRecovery({
      agentQaRoot,
      clock,
      idSource: DIGEST_JOB_ID_SOURCE,
      model: NEVER_AUTHORS,
      jobKinds: createRealJobKindRegistry(),
    })

  const deps: AgentJobsOpsDeps = {
    composeJobs: async () => {
      const host = open()
      return {
        jobs: {
          store: host.store,
          kinds: host.kinds,
          queue: host.queue,
          model: NEVER_AUTHORS,
          idSource: DIGEST_JOB_ID_SOURCE,
        },
        close: async () => {
          host.close()
        },
      }
    },
    knowledgeRoot: async () => knowledgeRoot,
    clock,
    acquireWriterLease,
    releaseLease,
    refreshWriterLeaseAuthority,
  }

  return {
    deps,
    agentQaRoot,
    knowledgeRoot,
    async enqueue(kind, payload, key) {
      const host = open()
      try {
        await host.queue.enqueue(kind, payload, key)
      } finally {
        host.close()
      }
    },
    async dump() {
      const host = open()
      try {
        const state = await host.store.dumpState()
        return state.jobs.map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          attempts: row.attempts,
          claimed: row.claimed,
        }))
      } finally {
        host.close()
      }
    },
  }
}

beforeEach(() => {
  roots = []
})

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('pumpAgentJobs — the kind-filtered, lease-holding drain (413 D-04/D-06)', () => {
  it('runs only analyze-run and leaves the curate-memory successor queued and unclaimed', async () => {
    const harness = makeHarness()
    await harness.enqueue('analyze-run', { runId: 'r_fixture', chain: true }, 'r_fixture')

    const outcome = await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)

    expect(outcome.kind).toBe('pumped')
    if (outcome.kind !== 'pumped') return
    expect(outcome.ran).toBe(1)
    expect(outcome.outcomes[0]).toMatchObject({
      kind: 'analyze-run',
      runId: 'r_fixture',
      disposition: 'completed',
    })
    expect(outcome.stoppedOn).toBe('empty')
    expect([...outcome.excludedKinds].sort()).toEqual(
      ['chat', 'consolidate', 'curate-memory', 'propose-improvements'],
    )

    const rows = await harness.dump()
    const analyze = rows.find((row) => row.kind === 'analyze-run')
    expect(analyze?.status).toBe('done')

    // THE D-06 CLAIM. The successor exists — the chain really did fire — and nothing touched it.
    const successor = rows.find((row) => row.kind === 'curate-memory')
    expect(successor).toBeDefined()
    expect(successor?.claimed).toBe(false)
    expect(successor?.attempts).toBe(0)
    expect(successor?.status).toBe('queued')
  })

  it('claims nothing at all when the only queued row is an excluded kind', async () => {
    const harness = makeHarness()
    await harness.enqueue('curate-memory', { runId: 'r_untouched' }, 'r_untouched->curate-memory')

    const outcome = await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)

    expect(outcome.kind).toBe('pumped')
    if (outcome.kind !== 'pumped') return
    expect(outcome.ran).toBe(0)
    expect(outcome.outcomes).toEqual([])
    expect(outcome.stoppedOn).toBe('empty')

    const rows = await harness.dump()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'curate-memory', claimed: false, attempts: 0, status: 'queued' })
  })

  it('refuses while the writer lease is held, and releases its own lease on the way out', async () => {
    const harness = makeHarness()
    await harness.enqueue('analyze-run', { runId: 'r_leased' }, 'r_leased')

    const holder = acquireWriterLease(harness.knowledgeRoot)
    expect(holder.kind).toBe('acquired')
    if (holder.kind !== 'acquired') return

    const refused = await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)
    expect(refused).toMatchObject({ kind: 'refused', reason: 'writer-lease-held' })
    if (refused.kind !== 'refused') return
    expect(refused.reason).toBe('writer-lease-held')
    expect(refused.holder).toMatchObject({ pid: process.pid, epoch: holder.epoch })
    expect(refused.holder?.leaseId).toBe(holder.leaseId)

    // Nothing was claimed under a refusal.
    expect((await harness.dump())[0]).toMatchObject({ claimed: false, attempts: 0 })

    expect(releaseLease({ knowledgeRoot: harness.knowledgeRoot, leaseId: holder.leaseId }).kind)
      .toBe('released')

    const pumped = await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)
    expect(pumped.kind).toBe('pumped')

    // The pump's own lease is gone: a third party can take it. A pump that leaked its lease
    // would answer `held` here and wedge every later leg of the campaign.
    const after = acquireWriterLease(harness.knowledgeRoot)
    expect(after.kind).toBe('acquired')
    if (after.kind === 'acquired') {
      releaseLease({ knowledgeRoot: harness.knowledgeRoot, leaseId: after.leaseId })
    }
  })

  it('ends the loop on a retry-scheduled outcome instead of sleeping on the backoff', async () => {
    const harness = makeHarness()
    await harness.enqueue('analyze-run', { runId: 'r_a', fail: 'retryable' }, 'r_a')
    await harness.enqueue('analyze-run', { runId: 'r_b' }, 'r_b')

    const outcome = await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)

    expect(outcome.kind).toBe('pumped')
    if (outcome.kind !== 'pumped') return
    expect(outcome.ran).toBe(1)
    expect(outcome.outcomes[0]?.disposition).toBe('retry-scheduled')
    expect(outcome.outcomes[0]?.runId).toBe('r_a')
    expect(outcome.stoppedOn).toBe('retry-scheduled')

    const rows = await harness.dump()
    const untouched = rows.filter((row) => row.id !== outcome.outcomes[0]?.jobId)
    expect(untouched).toHaveLength(1)
    expect(untouched[0]).toMatchObject({ claimed: false, attempts: 0, status: 'queued' })
  })

  it('lists every row without a payload and cancels one through the engine', async () => {
    const harness = makeHarness()
    await harness.enqueue('analyze-run', { runId: 'r_fixture', chain: true }, 'r_fixture')
    await pumpAgentJobs({ only: 'analyze-run' }, harness.deps)

    const listed = await listAgentJobs(harness.deps)
    expect(listed.jobs.length).toBe(2)
    for (const row of listed.jobs) {
      expect(Object.keys(row)).not.toContain('payload')
    }
    const analyze = listed.jobs.find((row) => row.kind === 'analyze-run')
    expect(analyze?.runId).toBe('r_fixture')

    const sortKey = (row: { status: string; kind: string; id: string }): string =>
      `${row.status} ${row.kind} ${row.id}`
    expect(listed.jobs.map(sortKey)).toEqual([...listed.jobs.map(sortKey)].sort())

    const successor = listed.jobs.find((row) => row.kind === 'curate-memory')
    expect(successor).toBeDefined()
    const cancelled = await cancelAgentJob(successor!.id, harness.deps)
    expect(cancelled).toEqual({ kind: 'cancelled' })

    const after = await listAgentJobs(harness.deps)
    expect(after.jobs.find((row) => row.id === successor!.id)?.status).toBe('cancelled')
  })

  it('bounds the loop rather than trusting the queue to empty', () => {
    expect(AGENT_JOBS_PUMP_BOUND).toBe(64)
  })
})
