// The kill-matrix worker child (Phase 385 plan 06, D-12).
//
// A `.test.ts` that doubles as a child entry point, in v51's `sigkill-drain-child` idiom and plan
// 03's generalization of it: gated by an env flag, every input a required environment variable,
// every result an atomically published JSON report. What plan 03's fixture did with ROLES over one
// store, this does with roles over one JOB — and the roles are the three processes a crash proof
// needs, which is why they live together rather than in three files:
//
//   crash    run the job for real and park forever at a named crash point, awaiting SIGKILL
//   control  run the same job to completion, uninterrupted — the independent expected value
//   resume   adopt authority over a store somebody else died holding, and finish the work
//
// `crash` and `control` differ by exactly one argument: the hook the store decorator fires. That is
// deliberate, because the control is the thing every equality assertion is measured against, and a
// control that reached its state by a different route would be measuring the route.
//
// `resume` is the only role that composes through `composeJobRecovery`, which is the point: the
// resume path in this proof is the same entry a host would use, not an assembly the test improvised.
//
// Plan 07 adds legs here by adding a SELECTOR and, where its crash point is not a checkpoint
// publish, a hook factory beside `checkpointCrashHook` — the store decorator already stands beside
// every verb. Nothing in the parent's spawn plumbing has to change for that.

import { existsSync, renameSync, writeFileSync } from 'node:fs'

import { createAgentJobQueue, createJobKindRegistry } from '@vostride/agent-qa-agent'
import type { JobStorePort, RunNextJobOutcome } from '@vostride/agent-qa-agent'
import type { JobId, JobKind } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { composeJobRecovery } from '../../../composition/compose-job-recovery.js'
import {
  checkpointCrashHook,
  crashPointsForRegistry,
  instrumentJobStore,
  parseCrashPoint,
} from '../crash-points.js'
import type { JobStoreCall, JobStoreCrashHook } from '../crash-points.js'
import { createCountingModel } from '../counting-model.js'
import {
  KILL_MATRIX_CLOCK,
  KILL_MATRIX_ENV,
  KILL_MATRIX_ID_SOURCE,
  authoringDeclarations,
  fenceFor,
  openKillMatrixStore,
} from '../harness.js'

const childMode = process.env[KILL_MATRIX_ENV.child] === '1'

export type KillMatrixRole = 'crash' | 'control' | 'resume'

export function parseKillMatrixRole(value: string | undefined): KillMatrixRole {
  if (value === 'crash' || value === 'control' || value === 'resume') return value
  throw new Error(`unsupported ${KILL_MATRIX_ENV.role}: ${String(value)}`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

/** Publish in one step a poller can never observe half of. */
function publishAtomically(path: string, body: string): void {
  const staging = `${path}.${process.pid}.tmp`
  writeFileSync(staging, body, 'utf8')
  renameSync(staging, path)
}

/**
 * Announce the crash point and then stop existing, as far as the rest of the run is concerned.
 *
 * `Atomics.wait` on a fresh, never-notified buffer parks the thread with no timer, no polling and
 * no wakeup path, so the process dies exactly where the parent's signal finds it rather than
 * somewhere a timeout raced it to.
 */
function markerAndBlock(path: string, details: Record<string, unknown>): never {
  publishAtomically(path, `${JSON.stringify(details)}\n`)
  const parked = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(parked, 0, 0)
  throw new Error('kill-matrix child resumed from its crash point, which cannot happen')
}

function outcomeReport(outcome: RunNextJobOutcome): Record<string, unknown> {
  if (!outcome.ran) return { ran: false, reason: outcome.reason }
  return {
    ran: true,
    disposition: outcome.disposition,
    jobId: String(outcome.job.id),
    attempts: outcome.job.attempts,
    checkpointsPublished: outcome.checkpointsPublished,
    handlerInvoked: outcome.handlerInvoked,
  }
}

async function runWorkerRole(role: 'crash' | 'control'): Promise<Record<string, unknown>> {
  const root = requiredEnv(KILL_MATRIX_ENV.root)
  const kind = requiredEnv(KILL_MATRIX_ENV.kind) as JobKind
  const invocationsPath = requiredEnv(KILL_MATRIX_ENV.invocations)
  const consumptionPath = requiredEnv(KILL_MATRIX_ENV.consumption)
  const epoch = Number(requiredEnv(KILL_MATRIX_ENV.epoch))

  const registry = createJobKindRegistry(
    authoringDeclarations({ invocationsPath, consumptionPath }),
  )

  let hook: JobStoreCrashHook = () => undefined
  if (role === 'crash') {
    const markerPath = requiredEnv(KILL_MATRIX_ENV.marker)
    const point = parseCrashPoint(
      process.env[KILL_MATRIX_ENV.point],
      crashPointsForRegistry(registry),
    )
    if (point.kind !== kind) {
      throw new Error(`crash point ${point.selector} does not belong to kind ${kind}`)
    }
    hook = checkpointCrashHook(point, (call: JobStoreCall): never =>
      markerAndBlock(markerPath, {
        selector: point.selector,
        kind: point.kind,
        checkpointId: point.checkpointId,
        phase: point.phase,
        jobId: call.jobId,
        pid: process.pid,
      }),
    )
  }

  const store = openKillMatrixStore(root)
  try {
    const instrumented: JobStorePort = instrumentJobStore(store, hook)
    const queue = createAgentJobQueue({
      store: instrumented,
      registry,
      clock: KILL_MATRIX_CLOCK,
      idSource: KILL_MATRIX_ID_SOURCE,
      model: createCountingModel(invocationsPath),
    })
    await store.adoptEpoch(epoch)

    const outcomes: Record<string, unknown>[] = []
    for (let pumped = 0; pumped < 8; pumped += 1) {
      const outcome = await queue.runNextJob({ fence: fenceFor(epoch) })
      outcomes.push(outcomeReport(outcome))
      if (!outcome.ran) break
    }
    return { role, pid: process.pid, kind, outcomes, failed: false }
  } finally {
    store.close()
  }
}

async function runResumeRole(): Promise<Record<string, unknown>> {
  const root = requiredEnv(KILL_MATRIX_ENV.root)
  const invocationsPath = requiredEnv(KILL_MATRIX_ENV.invocations)
  const consumptionPath = requiredEnv(KILL_MATRIX_ENV.consumption)
  const epoch = Number(requiredEnv(KILL_MATRIX_ENV.epoch))

  const host = composeJobRecovery({
    agentQaRoot: root,
    clock: KILL_MATRIX_CLOCK,
    idSource: KILL_MATRIX_ID_SOURCE,
    model: createCountingModel(invocationsPath),
    jobKinds: createJobKindRegistry(authoringDeclarations({ invocationsPath, consumptionPath })),
  })
  try {
    await host.store.adoptEpoch(epoch)
    const fence = fenceFor(epoch)
    // Recovery FIRST. `claimNext` never re-offers a row whose claim is still set, so a resume that
    // pumped before releasing would report an empty queue over a job nobody is running.
    const recovered = await host.recoverAbandonedClaims(fence)
    const outcomes = await host.resumePending(fence)
    return {
      role: 'resume',
      pid: process.pid,
      released: recovered.released.map((jobId: JobId) => String(jobId)),
      outcomes: outcomes.map(outcomeReport),
      failed: false,
    }
  } finally {
    host.close()
  }
}

describe('kill-matrix child role selector', () => {
  it.each(['crash', 'control', 'resume'] as const)('accepts %s', (role) => {
    expect(parseKillMatrixRole(role)).toBe(role)
  })

  it('refuses an unknown role before any store is opened', () => {
    expect(() => parseKillMatrixRole('drain')).toThrow(
      `unsupported ${KILL_MATRIX_ENV.role}: drain`,
    )
  })

  it('refuses a missing role rather than defaulting to one', () => {
    expect(() => parseKillMatrixRole(undefined)).toThrow('undefined')
  })
})

describe.skipIf(!childMode)('kill-matrix worker child', () => {
  it('runs the role it was asked for', async () => {
    const role = parseKillMatrixRole(process.env[KILL_MATRIX_ENV.role])
    const reportPath = process.env[KILL_MATRIX_ENV.report]
    try {
      const report = role === 'resume' ? await runResumeRole() : await runWorkerRole(role)
      if (reportPath !== undefined && reportPath !== '') {
        publishAtomically(reportPath, `${JSON.stringify(report)}\n`)
      }
    } catch (error) {
      // Reported on the failure path too, so a child that threw is visible to the parent as a
      // report rather than as a bare non-zero exit with its stack buried in captured output.
      if (reportPath !== undefined && reportPath !== '') {
        publishAtomically(
          reportPath,
          `${JSON.stringify({ role, pid: process.pid, failed: true, message: String(error) })}\n`,
        )
      }
      throw error
    }
    // The crash role never reaches here: it parks at its crash point and is killed. If a run ever
    // does, the point was not reached and every downstream assertion would be vacuous.
    if (role === 'crash') {
      expect(existsSync(requiredEnv(KILL_MATRIX_ENV.marker))).toBe(true)
      throw new Error('the crash role completed without being killed at its crash point')
    }
  }, 120_000)
})
