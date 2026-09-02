// The adversarial kill-matrix legs (Phase 385 plan 07 — JOBQ-03, D-07 / D-18 / D-19 / D-20).
//
// Plan 06's twelve legs interrupt the HAPPY path: a job doing its work, killed beside a checkpoint
// publish, resumed. Every guarantee they prove is about a job that was going to succeed. These four
// leg families interrupt the paths a job takes when something has gone wrong, and each one exists
// because the corresponding guarantee has a shape that passes vacuously if it is asserted lazily:
//
//   POISON (D-18)          "the queue cannot crash-loop" is satisfied by a queue that got STUCK.
//                          A job whose claim nobody ever released also stops crashing, and looks
//                          identical from the outside. So the leg asserts the REASON it stopped:
//                          the bound was spent, the row is `failed`, and the terminal host — still
//                          configured to crash — never reaches its crash point.
//   FAILURE PATH (D-20)    "the disposition ran exactly once" is satisfied by a disposition that
//                          ran ZERO times, because the kill landed before it was reached. So both
//                          legs assert the POSITIVE evidence first: the continuation rows the
//                          producer already wrote are durable at the instant of the kill.
//   CANCEL (D-19)          "the cancel was honoured" is satisfied by a job that failed for some
//                          other reason. So the leg asserts the terminal status is `cancelled`
//                          specifically, which checkpoint boundary honoured it, and that the
//                          checkpoint after that boundary was never entered at all.
//   STALE EPOCH (D-07)     "a stale epoch is refused" is satisfied by a store that refuses
//                          everything. So the refused hosts are paired with a correct-epoch host
//                          that succeeds, and the store is asserted byte-identical across both
//                          refusals.
//
// THE LEASE IS FAKE, DELIBERATELY. D-07 splits the work: 385 proves the store refuses a stale token
// and 386 binds v51's writer lease as the source of that token. `fakeWriterLease` is that seam, and
// reaching for the real lease here would couple the two phases at exactly the point their ordering
// exists to keep apart.
//
// SPAWN BUDGET: 14 children across 6 legs, on top of plan 06's 26. Nothing is sampled — every leg
// family described above runs in full, and every host in each family is a real OS process.
// 2026-09-02 (Phase 412): 26 rather than 32 — the retired kind's legs left with the Issue-slot
// cleanup; the legs here are untouched — see `DELETION-INVENTORY.md`.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createRealJobKindRegistry } from '@vostride/agent-qa-agent'
import type { JobKindDeclaration } from '@vostride/agent-qa-agent'
import type { JobKind } from '@vostride/agent-qa-schema'
import { afterAll, describe, expect, it } from 'vitest'

import { checkpointIdOfPrompt, readConsumptions, readInvocations } from './counting-model.js'
import {
  JOB_CRASH_SIDES,
  JOB_STORE_VERBS,
  crashPointSelector,
  instrumentJobStore,
  parseVerbCrashPoint,
  verbCrashHook,
  verbCrashSelector,
} from './crash-points.js'
import type { JobStoreCall } from './crash-points.js'
import {
  KILL_MATRIX_ENV,
  KILL_MATRIX_EPOCH,
  KILL_MATRIX_ID_SOURCE,
  fakeWriterLease,
  jobIdFor,
  openKillMatrixStore,
  readStoreSnapshot,
  seedJob,
} from './harness.js'
import type { KillMatrixSnapshot } from './harness.js'
import {
  LEG_TIMEOUT_MS,
  cleanupKillMatrixRoots,
  killIfRunning,
  makeRoot,
  runChildExpectingRefusal,
  runChildToCompletion,
  sendRealSigkill,
  startChild,
  waitForCrashMarker,
} from './spawn-control.js'
import type { KillMatrixPaths } from './spawn-control.js'

const registry = createRealJobKindRegistry()

afterAll(cleanupKillMatrixRoots)

function declarationFor(kind: JobKind): JobKindDeclaration {
  return registry.require(kind)
}

/**
 * The kinds a permanent failure of `kind` actually CONTINUES INTO, asked of the producer.
 *
 * Read from the fallback rather than from `allowedSuccessors`, because the producer is what
 * the engine actually runs. Since 2026-09-01 (Phase 409) declared equals produced — analyze-run
 * declares and produces `['curate-memory']`, the reserved sixth kind having left with the
 * Issue-slot cleanup (see `DELETION-INVENTORY.md`; 388 D-04 introduced the split this collapsed).
 * Asking the producer is therefore a choice of instrument rather than a correction: it keeps the
 * matrix measuring the chain the product builds even if the two lists ever diverge again.
 *
 * MEASURED CONSEQUENCE, recorded rather than papered over: with one continuation, the "a
 * PARTIAL continuation set is never visible" arm of the atomicity claim below is no longer
 * reachable through any real kind — analyze-run was the only kind with a fallback producer at
 * all, and every other kind halts its chain. What still has teeth, and is what `failAndChain`
 * exists for, is the other arm: a terminal parent with NO continuation is never visible. The
 * multi-continuation arm returns by itself the day a second successor is produced, because
 * this is asked of the producer rather than restated here.
 */
function continuationKindsFor(kind: JobKind, jobId: string, payload: unknown): readonly JobKind[] {
  const disposition = declarationFor(kind).onPermanentFailure
  if (disposition === 'halt-chain') return []
  return disposition({
    job: { id: jobId, kind } as unknown as Parameters<typeof disposition>[0]['job'],
    payload,
    // Only the KINDS are read here, and no producer's kind set depends on the reason text.
    reason: 'asking the producer which continuations it makes',
  }).map((request) => request.kind)
}

function jobRows(snapshot: KillMatrixSnapshot): readonly Record<string, unknown>[] {
  return snapshot.outcome.tables.find((table) => table.table === 'jobs')?.rows ?? []
}

function jobRow(snapshot: KillMatrixSnapshot, jobId: string): Record<string, unknown> {
  const row = jobRows(snapshot).find((candidate) => candidate.id === jobId)
  expect(row, `no jobs row for ${jobId}; rows: ${JSON.stringify(jobRows(snapshot))}`).toBeDefined()
  return row!
}

function jobHistory(snapshot: KillMatrixSnapshot, jobId: string): Record<string, unknown> {
  const row = snapshot.history.jobs.find((candidate) => candidate.id === jobId)
  expect(row, `no history row for ${jobId}`).toBeDefined()
  return row!
}

function checkpointPath(jobId: string, checkpointId: string): string {
  return `${jobId}/${checkpointId}.json`
}

function checkpointFileNames(snapshot: KillMatrixSnapshot): readonly string[] {
  return Object.keys(snapshot.checkpointBytes).sort()
}

function authoredCheckpointIds(invocationsPath: string, from = 0): readonly string[] {
  return readInvocations(invocationsPath)
    .slice(from)
    .map((invocation) => checkpointIdOfPrompt(invocation.prompt))
}

function consumedCheckpointIds(consumptionPath: string, from = 0): readonly string[] {
  return readConsumptions(consumptionPath)
    .slice(from)
    .map((entry) => entry.checkpointId)
}

/** The base environment every adversarial child shares. Roles and points are layered on top. */
function childEnv(
  paths: KillMatrixPaths,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    [KILL_MATRIX_ENV.root]: paths.agentQaRoot,
    [KILL_MATRIX_ENV.invocations]: paths.invocations,
    [KILL_MATRIX_ENV.consumption]: paths.consumption,
    [KILL_MATRIX_ENV.epoch]: String(KILL_MATRIX_EPOCH),
    ...extra,
  }
}

/**
 * Spawn a crash host, wait for its marker, and kill it for real.
 *
 * Returns the marker so a leg can assert the point it reached and that the pid was another OS
 * process. Every guard plan 06 built is used unchanged: the wait aborts on early child exit, the
 * child must be alive when the signal goes out, and the death must be BY the signal.
 */
async function crashAt(
  paths: KillMatrixPaths,
  markerPath: string,
  selector: string,
  env: Record<string, string>,
): Promise<Record<string, unknown>> {
  const running = startChild(
    childEnv(paths, {
      [KILL_MATRIX_ENV.role]: 'crash',
      [KILL_MATRIX_ENV.marker]: markerPath,
      ...env,
    }),
  )
  try {
    const marker = await waitForCrashMarker(running, markerPath, selector)
    expect(marker.selector).toBe(selector)
    expect(marker.pid, 'the worker must be a second OS process').not.toBe(process.pid)
    await sendRealSigkill(running.child)
    return marker
  } finally {
    await killIfRunning(running.child)
  }
}

// ---- the new selector vocabulary ------------------------------------------------------------------

describe('verb crash points (the seam plan 07 adds beside the checkpoint points)', () => {
  // A hook that can never fire is a leg that proves nothing while reporting success, so every
  // component of a selector is refused by name before a store is opened.
  it('refuses an unknown verb, an unknown side, and a missing selector — by name', () => {
    expect(() => parseVerbCrashPoint('drainEverything:before')).toThrow('verb: drainEverything')
    expect(() => parseVerbCrashPoint('recordFailure:during')).toThrow('side: during')
    expect(() => parseVerbCrashPoint(undefined)).toThrow('undefined')
    expect(() => parseVerbCrashPoint('')).toThrow('AGENT_QA_JOB_KILL_VERB_POINT')
    expect(() => parseVerbCrashPoint('recordFailure:before:a:b')).toThrow('recordFailure:before:a:b')
  })

  it('accepts every verb the decorator actually intercepts, on both sides', () => {
    expect(JOB_STORE_VERBS.length).toBeGreaterThan(0)
    for (const verb of JOB_STORE_VERBS) {
      for (const side of JOB_CRASH_SIDES) {
        expect(parseVerbCrashPoint(verbCrashSelector(verb, side))).toMatchObject({ verb, side })
      }
    }
  })

  // The narrowing is load-bearing: the failure path enqueues rows the leg never seeded, so a hook
  // that ignored the id would fire on the wrong call and the leg would name a point it never hit.
  it('fires only on the named verb, side and row', () => {
    const fired: JobStoreCall[] = []
    const hook = verbCrashHook(
      parseVerbCrashPoint(verbCrashSelector('recordFailure', 'before', 'job_wanted')),
      (call): never => {
        fired.push(call)
        throw new Error('reached')
      },
    )
    hook('before', { verb: 'enqueue', jobId: 'job_wanted' })
    hook('after', { verb: 'recordFailure', jobId: 'job_wanted' })
    hook('before', { verb: 'recordFailure', jobId: 'job_other' })
    expect(fired).toEqual([])
    expect(() => hook('before', { verb: 'recordFailure', jobId: 'job_wanted' })).toThrow('reached')
    expect(fired).toEqual([{ verb: 'recordFailure', jobId: 'job_wanted' }])
  })

  it('leaves an un-narrowed selector free to fire on any row of its verb', () => {
    const seen: string[] = []
    const hook = verbCrashHook(
      parseVerbCrashPoint(verbCrashSelector('enqueue', 'after')),
      (call): never => {
        seen.push(String(call.jobId))
        throw new Error('reached')
      },
    )
    expect(() => hook('after', { verb: 'enqueue', jobId: 'job_any' })).toThrow('reached')
    expect(seen).toEqual(['job_any'])
  })

  it('stands beside every verb of the real store, not a subset', async () => {
    const paths = makeRoot('verb-seam')
    const store = openKillMatrixStore(paths.agentQaRoot)
    const observed: string[] = []
    try {
      const instrumented = instrumentJobStore(store, (side, call) => {
        observed.push(`${call.verb}:${side}`)
      })
      await instrumented.adoptEpoch(KILL_MATRIX_EPOCH)
      await instrumented.dumpState()
      expect(observed).toEqual([
        'adoptEpoch:before',
        'adoptEpoch:after',
        'dumpState:before',
        'dumpState:after',
      ])
    } finally {
      store.close()
    }
  })
})

// ---- LEG FAMILY 1: the poison job (D-18, T-385-03) -------------------------------------------------

describe('a poison job that SIGKILLs its host on every attempt (D-18, JOBQ-03)', () => {
  // `consolidate` declares maxAttempts 2, which is the cheapest bound that is still a bound.
  //
  // THE BOUND IS SPENT AT THE CLAIM, so the arithmetic is: claims 1..maxAttempts run the handler,
  // and the claim that arrives as maxAttempts+1 is refused before the handler ever sees the job.
  // The terminal row therefore reads `attempts = maxAttempts + 1` — the extra claim is the one that
  // DETECTS the exhaustion, and asserting `attempts === maxAttempts` would be asserting a state the
  // engine never reaches. What equals maxAttempts is the number of times the handler ran, and that
  // is asserted separately from the durable artifacts.
  it('exhausts its declared bound through claim-time counting and lands failed, never looping', async () => {
    const kind: JobKind = 'consolidate'
    const declaration = declarationFor(kind)
    const maxAttempts = declaration.maxAttempts
    // Every expectation below is arithmetic over `maxAttempts`, which would re-derive itself
    // through a changed bound. These two literals are what make a bound change RED here.
    expect(maxAttempts).toBe(2)
    expect(declaration.backoff).toEqual({ kind: 'fixed', delayMs: 5_000 })
    const checkpointId = declaration.checkpointSchedule[0]!
    const selector = crashPointSelector(kind, checkpointId, 'before-publish')

    const paths = makeRoot('poison')
    const jobId = String(await seedJob(paths.agentQaRoot, kind))
    expect(jobId).toBe(String(jobIdFor(kind)))

    const markerFor = (attempt: number): string => join(paths.root, `crash-${attempt}.marker`)

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const marker = await crashAt(paths, markerFor(attempt), selector, {
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.point]: selector,
        // Every host after the first must reclaim the row its predecessor died holding: `claimNext`
        // never re-offers a claimed row, so without this the job would be STUCK rather than
        // looping — the failure mode this whole leg exists to distinguish from termination.
        [KILL_MATRIX_ENV.recover]: attempt === 1 ? '0' : '1',
      })
      expect(marker.checkpointId).toBe(checkpointId)

      const crashed = await readStoreSnapshot(paths.agentQaRoot)
      expect(jobRow(crashed, jobId)).toMatchObject({ id: jobId, status: 'queued' })
      expect(
        jobRow(crashed, jobId).claimed_at,
        'a killed host leaves its claim behind, which is why recovery must release it',
      ).not.toBeNull()
      // THE COUNTER MOVED. This is the whole mechanism: the attempt was spent by the claim, and a
      // host that never returned recorded no failure of its own.
      expect(jobHistory(crashed, jobId).attempts).toBe(attempt)
      expect(authoredCheckpointIds(paths.invocations)).toHaveLength(attempt)
      expect(existsSync(join(paths.agentQaRoot, 'agent-jobs', 'checkpoints', jobId))).toBe(false)
    }

    // THE TERMINAL HOST. Configured to crash at exactly the same point as its two predecessors, and
    // told that the point is expected to be unreachable — so the child asserts from the inside that
    // its marker was never written, rather than the parent inferring termination from silence.
    const terminalMarker = markerFor(maxAttempts + 1)
    const terminal = await runChildToCompletion(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'crash',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.point]: selector,
        [KILL_MATRIX_ENV.marker]: terminalMarker,
        [KILL_MATRIX_ENV.recover]: '1',
        [KILL_MATRIX_ENV.unreached]: '1',
        [KILL_MATRIX_ENV.report]: paths.report,
      }),
      paths.report,
    )
    expect(existsSync(terminalMarker), 'the crash point must be unreachable once the bound is spent').toBe(false)
    // AND IT WAS STILL ARMED. An absent marker is equally consistent with a host that was never
    // given a crash point at all, so the host reports the selector it installed and it is required
    // to be the same one its two predecessors died at.
    expect(terminal.armedAt).toBe(selector)
    // It DID reclaim the row — so it stopped because the bound was spent, not because nothing was
    // ever offered to it. This is the assertion that separates "exhausted" from "stuck".
    expect(terminal.released).toEqual([jobId])
    expect(terminal.outcomes).toMatchObject([
      {
        ran: true,
        disposition: 'failed',
        jobId,
        attempts: maxAttempts + 1,
        checkpointsPublished: [],
        // The handler was NEVER HANDED THE JOB. That is the mechanism: the bound is consulted
        // between the claim and the handler, which is the one point a job that kills its host
        // cannot skip.
        handlerInvoked: false,
        continuation: [],
      },
      { ran: false, reason: 'no-job' },
    ])
    expect(terminal.outcomes).toHaveLength(2)

    const settled = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRow(settled, jobId)).toMatchObject({ id: jobId, status: 'failed', claimed_at: null })
    const history = jobHistory(settled, jobId)
    expect(history.attempts).toBe(maxAttempts + 1)
    expect(history.last_failure_kind).toBe('permanent')
    expect(String(history.last_failure_reason)).toContain(`the attempt bound of ${maxAttempts} is spent`)
    expect(String(history.last_failure_reason)).toContain(`attempt ${maxAttempts + 1}`)

    // The handler ran exactly maxAttempts times and the model was invoked exactly as often — the
    // positive half. A poison job that had been silently skipped would show zero of both.
    expect(authoredCheckpointIds(paths.invocations)).toEqual(
      Array.from({ length: maxAttempts }, () => checkpointId),
    )
    expect(consumedCheckpointIds(paths.consumption)).toEqual(
      Array.from({ length: maxAttempts }, () => checkpointId),
    )
    expect(new Set(readInvocations(paths.invocations).map((entry) => entry.pid)).size).toBe(maxAttempts)
    // Nothing durable was ever produced: every host died before its first publish.
    expect(checkpointFileNames(settled)).toEqual([])
    expect(jobRows(settled)).toHaveLength(1)
  }, LEG_TIMEOUT_MS)
})

// ---- LEG FAMILY 2: a kill around the atomic failure path (D-20 / CR-07) -----------------------------

describe('SIGKILL inside the permanent-failure disposition (D-20, JOBQ-03)', () => {
  const kind: JobKind = 'analyze-run'
  const REASON = 'analyze-run kill-matrix adversarial permanent failure'
  const PAYLOAD = { fail: 'permanent', reason: REASON } as const

  function continuationIdFor(jobId: string, successor: JobKind): string {
    return String(KILL_MATRIX_ID_SOURCE.jobIdFor(successor, `${jobId}->${successor}`))
  }

  it('leaves no continuation before failAndChain, then resumes into one complete set', async () => {
    const declaration = declarationFor(kind)
    const checkpointId = declaration.checkpointSchedule[0]!
    const paths = makeRoot('failure-path-record')
    const jobId = String(await seedJob(paths.agentQaRoot, kind, PAYLOAD))
    const successors = continuationKindsFor(kind, jobId, PAYLOAD)
    // Non-vacuity: a failure that continued into nothing would satisfy every assertion below
    // by having nothing to satisfy. The bound is 1 rather than 2 since 388 D-04 — see
    // continuationKindsFor for what that costs and what it does not.
    expect(successors.length).toBeGreaterThan(0)
    const selector = verbCrashSelector('failAndChain', 'before', jobId)

    const marker = await crashAt(paths, paths.marker, selector, {
      [KILL_MATRIX_ENV.kind]: kind,
      [KILL_MATRIX_ENV.verbPoint]: selector,
      [KILL_MATRIX_ENV.payload]: JSON.stringify(PAYLOAD),
    })
    expect(marker).toMatchObject({ verb: 'failAndChain', side: 'before', jobId })

    const crashed = await readStoreSnapshot(paths.agentQaRoot)
    // The producer ran, but the single durable boundary has not: no partial successor may escape.
    for (const successor of successors) {
      expect(jobRows(crashed).some((row) => row.kind === successor)).toBe(false)
    }
    expect(jobRow(crashed, jobId)).toMatchObject({ id: jobId, status: 'queued' })
    expect(jobRow(crashed, jobId).claimed_at).not.toBeNull()
    expect(jobHistory(crashed, jobId)).toEqual({
      id: jobId,
      attempts: 1,
      last_failure_kind: null,
      last_failure_reason: null,
    })
    expect(jobRows(crashed)).toHaveLength(1)
    expect(checkpointFileNames(crashed)).toEqual([checkpointPath(jobId, checkpointId)])
    const authoredPreCrash = authoredCheckpointIds(paths.invocations)
    expect(authoredPreCrash).toEqual([checkpointId])

    const resumed = await runChildToCompletion(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: paths.report,
      }),
      paths.report,
    )
    expect(resumed.released).toEqual([jobId])
    // The resume DRAINS: it finishes the failed head and then runs the continuations that head's
    // disposition had already enqueued. That is the point of the disposition — a permanently failed
    // analysis must not leave its downstream jobs waiting on a dead head — so the drain is asserted
    // rather than avoided. Matched by id, because with a frozen clock the claim order is id order.
    const outcomes = resumed.outcomes as Record<string, unknown>[]
    expect(outcomes).toHaveLength(1 + successors.length)
    const failedOutcome = outcomes.find((entry) => entry.jobId === jobId)
    expect(failedOutcome).toMatchObject({
      ran: true,
      disposition: 'failed',
      attempts: 2,
      handlerInvoked: true,
      // The recorded checkpoint was NOT republished on the way through.
      checkpointsPublished: [],
      reason: REASON,
      continuationDeduped: successors.map(() => false),
      continuation: successors.map((successor) => continuationIdFor(jobId, successor)),
    })
    for (const successor of successors) {
      expect(
        outcomes.find((entry) => entry.jobId === continuationIdFor(jobId, successor)),
      ).toMatchObject({ ran: true, disposition: 'completed' })
    }

    const settled = await readStoreSnapshot(paths.agentQaRoot)
    // EXACTLY ONE of each continuation, whatever the replay did.
    expect(jobRows(settled)).toHaveLength(1 + successors.length)
    for (const successor of successors) {
      expect(jobRows(settled).filter((row) => row.kind === successor)).toHaveLength(1)
      expect(jobRow(settled, continuationIdFor(jobId, successor))).toMatchObject({
        idempotency_key: `${jobId}->${successor}`,
        status: 'done',
      })
    }
    expect(jobRow(settled, jobId)).toMatchObject({ id: jobId, status: 'failed', claimed_at: null })
    expect(jobHistory(settled, jobId)).toEqual({
      id: jobId,
      attempts: 2,
      last_failure_kind: 'permanent',
      last_failure_reason: REASON,
    })
    // The recorded checkpoint was never re-authored across the crash: same bytes, and the resume's
    // authorship delta names the continuations' OWN checkpoints and nothing this job had recorded.
    expect(settled.checkpointBytes[checkpointPath(jobId, checkpointId)]).toBe(
      crashed.checkpointBytes[checkpointPath(jobId, checkpointId)],
    )
    const authoredOnResume = authoredCheckpointIds(paths.invocations, authoredPreCrash.length)
    expect(authoredOnResume, 'a recorded checkpoint must never be authored again (JOBQ-03)').not.toContain(
      checkpointId,
    )
    expect([...authoredOnResume].sort()).toEqual(
      successors.flatMap((successor) => [...declarationFor(successor).checkpointSchedule]).sort(),
    )
  }, LEG_TIMEOUT_MS)

  it('makes the terminal parent and every continuation visible before failAndChain returns', async () => {
    const declaration = declarationFor(kind)
    const checkpointId = declaration.checkpointSchedule[0]!
    const paths = makeRoot('failure-path-atomic')
    const jobId = String(await seedJob(paths.agentQaRoot, kind, PAYLOAD))
    const successors = continuationKindsFor(kind, jobId, PAYLOAD)
    // Non-vacuity: a failure that continued into nothing would satisfy every assertion below
    // by having nothing to satisfy. The bound is 1 rather than 2 since 388 D-04 — see
    // continuationKindsFor for what that costs and what it does not.
    expect(successors.length).toBeGreaterThan(0)
    const selector = verbCrashSelector('failAndChain', 'after', jobId)

    const marker = await crashAt(paths, paths.marker, selector, {
      [KILL_MATRIX_ENV.kind]: kind,
      [KILL_MATRIX_ENV.verbPoint]: selector,
      [KILL_MATRIX_ENV.payload]: JSON.stringify(PAYLOAD),
    })
    expect(marker).toMatchObject({ verb: 'failAndChain', side: 'after', jobId })

    const crashed = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRow(crashed, jobId)).toMatchObject({ status: 'failed', claimed_at: null })
    expect(jobHistory(crashed, jobId)).toMatchObject({
      attempts: 1,
      last_failure_kind: 'permanent',
      last_failure_reason: REASON,
    })
    for (const successor of successors) {
      expect(jobRow(crashed, continuationIdFor(jobId, successor))).toMatchObject({
        kind: successor,
        status: 'queued',
      })
    }
    expect(jobRows(crashed)).toHaveLength(1 + successors.length)
    expect(checkpointFileNames(crashed)).toEqual([checkpointPath(jobId, checkpointId)])
    const authoredPreCrash = authoredCheckpointIds(paths.invocations)
    expect(authoredPreCrash).toEqual([checkpointId])

    const resumed = await runChildToCompletion(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: paths.report,
      }),
      paths.report,
    )
    expect(resumed.released).toEqual([])
    const outcomes = resumed.outcomes as Record<string, unknown>[]
    expect(outcomes).toHaveLength(successors.length)
    expect(outcomes.some((entry) => entry.jobId === jobId)).toBe(false)
    for (const successor of successors) {
      expect(outcomes.find((entry) => entry.jobId === continuationIdFor(jobId, successor))).toMatchObject({
        ran: true,
        disposition: 'completed',
      })
    }

    const settled = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRows(settled)).toHaveLength(1 + successors.length)
    for (const successor of successors) {
      expect(jobRows(settled).filter((row) => row.kind === successor)).toHaveLength(1)
      expect(jobRow(settled, continuationIdFor(jobId, successor))).toMatchObject({ status: 'done' })
    }
    expect(jobRow(settled, jobId)).toMatchObject({ status: 'failed', claimed_at: null })
    expect(jobHistory(settled, jobId)).toMatchObject({
      attempts: 1,
      last_failure_kind: 'permanent',
      last_failure_reason: REASON,
    })
    expect(settled.checkpointBytes[checkpointPath(jobId, checkpointId)]).toBe(
      crashed.checkpointBytes[checkpointPath(jobId, checkpointId)],
    )
    const authoredOnResume = authoredCheckpointIds(paths.invocations, authoredPreCrash.length)
    expect(authoredOnResume).not.toContain(checkpointId)
    expect([...authoredOnResume].sort()).toEqual(
      successors.flatMap((successor) => [...declarationFor(successor).checkpointSchedule]).sort(),
    )
  }, LEG_TIMEOUT_MS)
})

// ---- LEG FAMILY 3: a cancel that crosses a crash (D-19) --------------------------------------------

describe('a cancel requested mid-run, honoured across a crash (D-19, JOBQ-03)', () => {
  // `curate-memory` is the only two-checkpoint kind, so it is the only one where "the boundary
  // after the crash" and "the boundary the job never reached" are different places.
  it('survives the kill with the request intact and lands cancelled at the next boundary', async () => {
    const kind: JobKind = 'curate-memory'
    const [firstCheckpoint, secondCheckpoint] = declarationFor(kind).checkpointSchedule
    expect(firstCheckpoint).toBeDefined()
    expect(secondCheckpoint).toBeDefined()
    const selector = crashPointSelector(kind, firstCheckpoint!, 'after-publish')

    const paths = makeRoot('cancel-across-crash')
    const jobId = String(await seedJob(paths.agentQaRoot, kind))

    const running = startChild(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'crash',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.point]: selector,
        [KILL_MATRIX_ENV.marker]: paths.marker,
      }),
    )
    try {
      const marker = await waitForCrashMarker(running, paths.marker, selector)
      expect(marker.pid).not.toBe(process.pid)

      // THE CANCEL ARRIVES FROM ANOTHER PROCESS, while the host that holds the claim is parked.
      // The row is claimed, so the store must only RECORD the request — cancelling it outright
      // here is the collapse plan 05's controls exist to catch, and this is that control across a
      // real process boundary.
      const lease = fakeWriterLease(KILL_MATRIX_EPOCH)
      const store = openKillMatrixStore(paths.agentQaRoot)
      try {
        expect(await store.requestCancel(jobIdFor(kind), lease.fence())).toEqual({
          outcome: 'cancel-requested',
        })
      } finally {
        store.close()
      }

      await sendRealSigkill(running.child)
    } finally {
      await killIfRunning(running.child)
    }

    const crashed = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRow(crashed, jobId)).toMatchObject({ id: jobId, status: 'queued' })
    expect(jobRow(crashed, jobId).claimed_at).not.toBeNull()
    expect(jobRow(crashed, jobId).cancel_requested_at).not.toBeNull()
    expect(checkpointFileNames(crashed)).toEqual([checkpointPath(jobId, firstCheckpoint!)])
    const authoredPreCrash = authoredCheckpointIds(paths.invocations)
    expect(authoredPreCrash).toEqual([firstCheckpoint!])
    const consumedPreCrash = consumedCheckpointIds(paths.consumption)
    expect(consumedPreCrash).toEqual([firstCheckpoint!])

    const resumed = await runChildToCompletion(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: paths.report,
      }),
      paths.report,
    )
    // Recovery returns the row to the queue WITH the request still on it — if it cleared the
    // request as part of "cleaning up", the resumed job would run to completion instead.
    expect(resumed.released).toEqual([jobId])
    expect(resumed.outcomes).toMatchObject([
      {
        ran: true,
        disposition: 'cancelled',
        jobId,
        attempts: 2,
        handlerInvoked: true,
        honoredAtCheckpoint: firstCheckpoint!,
        checkpointsPublished: [],
      },
    ])

    const settled = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRow(settled, jobId)).toMatchObject({
      id: jobId,
      status: 'cancelled',
      claimed_at: null,
    })
    // The step already durable stays durable, byte for byte; the step after the boundary never
    // existed and never will.
    expect(settled.checkpointBytes[checkpointPath(jobId, firstCheckpoint!)]).toBe(
      crashed.checkpointBytes[checkpointPath(jobId, firstCheckpoint!)],
    )
    expect(checkpointFileNames(settled)).toEqual([checkpointPath(jobId, firstCheckpoint!)])
    expect(
      existsSync(
        join(paths.agentQaRoot, 'agent-jobs', 'checkpoints', jobId, `${secondCheckpoint!}.json`),
      ),
    ).toBe(false)

    // CHECKPOINT TWO WAS NEVER ENTERED. The consumption log records a boundary before the
    // authorship call, so the resumed run naming only the first is the statement that the handler
    // was unwound at that boundary rather than after the second one.
    expect(consumedCheckpointIds(paths.consumption, consumedPreCrash.length)).toEqual([
      firstCheckpoint!,
    ])
    // And the boundary sits on the READ, so the cancel was honoured BEFORE any model call: zero
    // further invocations, beside a pre-crash count that is deliberately non-zero.
    expect(authoredCheckpointIds(paths.invocations, authoredPreCrash.length)).toEqual([])
    expect(authoredPreCrash.length).toBeGreaterThan(0)
  }, LEG_TIMEOUT_MS)
})

// ---- LEG FAMILY 4: fencing, with a fake lease (D-07, T-385-02) -------------------------------------

describe('a resume carrying a stale epoch, proven with a fake lease (D-07, JOBQ-03)', () => {
  it('refuses both the re-adoption and the stale fence, changes nothing, and lets the holder finish', async () => {
    const kind: JobKind = 'consolidate'
    const checkpointId = declarationFor(kind).checkpointSchedule[0]!
    const selector = crashPointSelector(kind, checkpointId, 'after-publish')

    const paths = makeRoot('stale-epoch')
    const jobId = String(await seedJob(paths.agentQaRoot, kind))

    const held = fakeWriterLease(KILL_MATRIX_EPOCH)
    const successor = fakeWriterLease(KILL_MATRIX_EPOCH + 1)

    const running = startChild(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'crash',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.point]: selector,
        [KILL_MATRIX_ENV.marker]: paths.marker,
        [KILL_MATRIX_ENV.epoch]: String(held.epoch),
      }),
    )
    let markerPid: unknown
    try {
      const marker = await waitForCrashMarker(running, paths.marker, selector)
      markerPid = marker.pid
      // AUTHORITY MOVES while the old host is parked — the fake lease's successor adopts.
      const store = openKillMatrixStore(paths.agentQaRoot)
      try {
        expect(await store.adoptEpoch(successor.epoch)).toEqual({ epoch: successor.epoch })
      } finally {
        store.close()
      }
      await sendRealSigkill(running.child)
    } finally {
      await killIfRunning(running.child)
    }

    const crashed = await readStoreSnapshot(paths.agentQaRoot)
    expect(checkpointFileNames(crashed)).toEqual([checkpointPath(jobId, checkpointId)])
    expect(jobRow(crashed, jobId)).toMatchObject({ id: jobId, status: 'queued' })

    // (a) THE RETURNING HOST tries to re-arm at the epoch it still believes it holds. Refused
    //     before it touches a row: authority only ever moves forward.
    const staleAdopt = await runChildExpectingRefusal(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: join(paths.root, 'stale-adopt.report.json'),
        [KILL_MATRIX_ENV.epoch]: String(held.epoch),
      }),
      join(paths.root, 'stale-adopt.report.json'),
    )
    expect(staleAdopt.errorName).toBe('StaleJobStoreEpochError')
    expect(String(staleAdopt.errorMessage)).toContain(`held epoch ${held.epoch}`)
    expect(String(staleAdopt.errorMessage)).toContain(`observed ${successor.epoch}`)
    expect((await readStoreSnapshot(paths.agentQaRoot)).logicalDump).toBe(crashed.logicalDump)

    // (b) THE SPLIT-BRAIN HOST does not re-adopt at all: it still holds its old token and only
    //     discovers otherwise at the commit boundary, which is the refusal 386's adversarial test
    //     lands on. Different guard, same named error, and nothing is mutated on the way out.
    const staleFence = await runChildExpectingRefusal(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: join(paths.root, 'stale-fence.report.json'),
        [KILL_MATRIX_ENV.epoch]: String(held.epoch),
        [KILL_MATRIX_ENV.adopt]: '0',
      }),
      join(paths.root, 'stale-fence.report.json'),
    )
    expect(staleFence.errorName).toBe('StaleJobStoreEpochError')
    expect((await readStoreSnapshot(paths.agentQaRoot)).logicalDump).toBe(crashed.logicalDump)

    // (c) THE NEGATIVE CONTROL, without which "a stale epoch is refused" is satisfied by a store
    //     that refuses everything: the current holder resumes the very same job and finishes it.
    const holder = await runChildToCompletion(
      childEnv(paths, {
        [KILL_MATRIX_ENV.role]: 'resume',
        [KILL_MATRIX_ENV.kind]: kind,
        [KILL_MATRIX_ENV.report]: paths.report,
        [KILL_MATRIX_ENV.epoch]: String(successor.epoch),
      }),
      paths.report,
    )
    expect(holder.released).toEqual([jobId])
    expect(holder.outcomes).toMatchObject([
      { ran: true, disposition: 'completed', jobId, attempts: 2, checkpointsPublished: [] },
    ])

    // EXACTLY ONE EXECUTION RECORD across four hosts: one row, one checkpoint file with the bytes
    // the dead host wrote, and one model invocation — made by that host, not by either refused one.
    const settled = await readStoreSnapshot(paths.agentQaRoot)
    expect(jobRows(settled)).toHaveLength(1)
    expect(jobRow(settled, jobId)).toMatchObject({ id: jobId, status: 'done', claimed_at: null })
    expect(checkpointFileNames(settled)).toEqual([checkpointPath(jobId, checkpointId)])
    expect(settled.checkpointBytes[checkpointPath(jobId, checkpointId)]).toBe(
      crashed.checkpointBytes[checkpointPath(jobId, checkpointId)],
    )
    const invocations = readInvocations(paths.invocations)
    expect(invocations).toHaveLength(1)
    expect(invocations[0]!.pid).toBe(markerPid)
    expect(authoredCheckpointIds(paths.invocations)).toEqual([checkpointId])
  }, LEG_TIMEOUT_MS)
})
