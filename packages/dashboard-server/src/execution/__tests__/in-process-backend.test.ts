// THE IN-PROCESS BACKEND'S BRIDGE (Phase 401 plan 07 — D-04/D-09/D-12, INVK-01).
//
// WHAT IS UNDER TEST is the half of INVK-01 that lives in `packages/dashboard-server`: the bridge
// from a started run's `RunSession` bus to the per-run buffer + `execution-event` surface the db
// writes, the live SSE and the current step projection consume. The run-starter is injected here
// (it is the CLI's, and this package may not name it), so what these cells range is the bridge, the
// buffer, the lifecycle mapping and the completion vocabulary.
//
// THE PARITY CELL'S EXPECTED VALUE IS AN ANCHOR, NOT AN OPINION. `__fixtures__/envelope-parity-
// golden.json` was captured in commit `bc5e6c25` by driving the SHIPPED `TestRunner` — spawn, child,
// `AGENT_QA_EVENT:` scrape and all — over the same envelope sequence, before that class was deleted.
// A golden written by hand from this implementation would be this implementation agreeing with
// itself.
//
// THE FAKE SESSION MODELS THE BUS'S REFUSAL, DELIBERATELY. `RunEventBus.subscribe` resolves
// `fromSeq ?? 1` and raises `ReplayIncompleteError` for any `fromSeq` below the earliest seq it can
// serve — and since seq numbering starts at 1, `subscribe(0, …)` is unserveable on EVERY run. A fake
// that accepted 0 would let this suite pass while every dashboard run threw at the attach. So the
// fake throws exactly where the bus throws, which is what makes the attach seq a measured fact.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { RunEventEnvelope, RunSession } from '@vostride/agent-qa-schema'

import { createInProcessExecutionBackend } from '../in-process-backend.js'
import type {
  ExecuteOptions,
  LiveExecutionEvent,
  RunSettledDetails,
  RunSettledStatus,
} from '../execution-backend.js'
import {
  PARITY_ENVELOPES,
  PARITY_RUN_ID,
  scrubParityEvents,
} from './envelope-parity-fixture.js'

const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'envelope-parity-golden.json',
)

/** Raised where `RunEventBus` raises it, and with its own name, so a cell can recognise it. */
class ReplayIncompleteError extends Error {
  constructor(from: number, earliest: number) {
    super(`ReplayIncomplete: events before seq ${String(earliest)} are no longer available (replay requested from seq ${String(from)})`)
    this.name = 'ReplayIncompleteError'
  }
}

/**
 * A `RunSession` with the bus's OWN replay contract: `fromSeq ?? 1`, replay `seq >= from`, and a
 * refusal — never a silent late start — when `from` is below the earliest seq that exists.
 */
class FakeRunSession implements RunSession {
  readonly executionContext = 'local-headless' as RunSession['executionContext']
  status: RunSession['status'] = 'running'
  cancels = 0
  private readonly published: RunEventEnvelope[] = []
  private readonly live = new Set<(event: RunEventEnvelope) => void>()
  private resolveDone!: (value: never) => void
  readonly done: Promise<never>

  constructor(readonly id: RunSession['id']) {
    this.done = new Promise((resolve) => { this.resolveDone = resolve as (value: never) => void })
    void this.resolveDone
  }

  publish(envelope: RunEventEnvelope): void {
    this.published.push(envelope)
    for (const handler of [...this.live]) handler(envelope)
  }

  subscribe(fromSeq: number, handler: (event: RunEventEnvelope) => void): () => void {
    const from = fromSeq ?? 1
    const earliest = this.published.length > 0 ? this.published[0]!.seq : this.published.length + 1
    if (from < earliest) throw new ReplayIncompleteError(from, earliest)
    for (const envelope of this.published) {
      if (envelope.seq >= from) handler(envelope)
    }
    this.live.add(handler)
    return () => { this.live.delete(handler) }
  }

  cancel(): void {
    this.cancels += 1
  }
}

interface Settled {
  runId: string
  status: RunSettledStatus
  details: RunSettledDetails
}

/** Subscribe a settle recorder on the backend's own event, which is the host's only wire to it. */
function recordSettles(
  backend: ReturnType<typeof createInProcessExecutionBackend>,
  sink: Settled[],
): void {
  backend.on('run-settled', (runId: string, status: RunSettledStatus, details: RunSettledDetails) => {
    sink.push({ runId, status, details })
  })
}

interface Drive {
  buffered: LiveExecutionEvent[]
  emitted: { runId: string; event: LiveExecutionEvent }[]
  settled: Settled[]
  session?: FakeRunSession
}

const baseOpts = (runId: string): ExecuteOptions => ({
  runId,
  args: ['tests/parity.yaml'],
  source: 'dashboard',
})

/**
 * Drive one run to completion over a scripted session.
 *
 * `preAttach` is how many envelopes are published BEFORE the door names the session, so the replay
 * arm is exercised by every cell that uses this helper rather than by one cell that remembers to.
 */
async function driveOneRun(input: {
  runId?: string
  envelopes?: readonly RunEventEnvelope[]
  preAttach?: number
  opts?: Partial<ExecuteOptions>
  rejectWith?: Error
  startSession?: boolean
}): Promise<Drive> {
  const runId = input.runId ?? PARITY_RUN_ID
  const envelopes = input.envelopes ?? PARITY_ENVELOPES
  const preAttach = input.preAttach ?? 3
  const drive: Drive = { buffered: [], emitted: [], settled: [] }

  const backend = createInProcessExecutionBackend({
    startRun: async ({ opts, onSession }) => {
      if (input.startSession === false) {
        if (input.rejectWith) throw input.rejectWith
        return
      }
      const session = new FakeRunSession(opts.runId as RunSession['id'])
      drive.session = session
      for (const envelope of envelopes.slice(0, preAttach)) session.publish(envelope)
      onSession(session)
      for (const envelope of envelopes.slice(preAttach)) session.publish(envelope)
      await Promise.resolve()
      if (input.rejectWith) throw input.rejectWith
    },
  })
  recordSettles(backend, drive.settled)
  backend.on('execution-event', (eventRunId: string, event: LiveExecutionEvent) => {
    drive.emitted.push({ runId: eventRunId, event })
  })

  backend.execute({ ...baseOpts(runId), ...input.opts })
  await waitFor(() => { expect(drive.settled).toHaveLength(1) })
  drive.buffered = backend.getBufferedEvents(runId)
  return drive
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Timed out waiting for assertion')
}

describe('the bus bridge feeds the consumers exactly what the scrape fed them (401-07, D-09)', () => {
  it('ENVELOPE PARITY — the anchor captured from the RETIRED wire, reproduced by the new one', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as unknown[]
    // NON-VACUITY BEFORE ANY VERDICT: a truncated golden would make the comparison below pass
    // while ranging nothing.
    expect(golden.length).toBe(PARITY_ENVELOPES.length + 2)

    const drive = await driveOneRun({})
    expect(scrubParityEvents(drive.buffered)).toEqual(golden)
  })

  it('THE EMITTED STREAM IS THE BUFFER — one push, two surfaces, same order, run-scoped', async () => {
    const drive = await driveOneRun({})
    expect(scrubParityEvents(drive.emitted.map((entry) => entry.event)))
      .toEqual(scrubParityEvents(drive.buffered))
    expect(new Set(drive.emitted.map((entry) => entry.runId))).toEqual(new Set([PARITY_RUN_ID]))
  })

  it('REPLAY THEN LIVE — envelopes published before the attach arrive FIRST, in seq order', async () => {
    // Six of the eight are published before the door names the session, so a bridge that attached
    // live-only would deliver two envelopes and a bridge that replayed out of order would show it.
    const drive = await driveOneRun({ preAttach: 6 })
    const seqs = drive.buffered
      .filter((event) => typeof event.seq === 'number')
      .map((event) => event.seq as number)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('THE ATTACH SEQ IS SERVEABLE — the bus refuses a prefix it cannot produce, and the bridge asks for one it can', async () => {
    // The fake refuses below the earliest seq exactly as `RunEventBus` does. If the bridge asked
    // from seq 0 — which is what "subscribe from seq 0" reads as, and what the bus answers
    // `ReplayIncompleteError` to on every run — the starter would reject and this run would settle
    // `failed` carrying that name.
    const drive = await driveOneRun({})
    expect(drive.settled[0]!.status).toBe('completed')
    expect(JSON.stringify(drive.settled[0]!.details)).not.toContain('ReplayIncomplete')
  })

  it('ENVELOPES ARE CARRIED, NEVER RE-MINTED — the payload object survives the bridge intact', async () => {
    const drive = await driveOneRun({})
    const stepFinalized = drive.buffered.find((event) => event.type === 'stepFinalized')
    expect(stepFinalized?.payload).toEqual(PARITY_ENVELOPES[4]!.payload)
  })
})

describe('native lifecycle mapping — cancel, timeout, completion (401-07, D-12)', () => {
  it('KILL ABORTS THE SESSION — no signal, no grace timer, no process group', async () => {
    const drive: Drive = { buffered: [], emitted: [], settled: [] }
    let session: FakeRunSession | undefined
    let release: (() => void) | undefined
    const backend = createInProcessExecutionBackend({
      startRun: async ({ opts, onSession }) => {
        session = new FakeRunSession(opts.runId as RunSession['id'])
        onSession(session)
        await new Promise<void>((resolve) => { release = resolve })
      },
    })
    recordSettles(backend, drive.settled)

    backend.execute(baseOpts('cancel-me'))
    await waitFor(() => { expect(session).toBeDefined() })
    expect(backend.kill('cancel-me')).toBe(true)
    expect(session!.cancels).toBe(1)

    release?.()
    await waitFor(() => { expect(drive.settled).toHaveLength(1) })
    expect(drive.settled[0]!.status).toBe('cancelled')
    const complete = backend.getBufferedEvents('cancel-me').at(-1)
    expect(complete?.type).toBe('run-complete')
    expect(complete?.status).toBe('cancelled')
  })

  it('KILLING A RUN THAT IS NOT RUNNING IS FALSE, AND ABORTS NOTHING', async () => {
    const drive = await driveOneRun({})
    const backend = createInProcessExecutionBackend({ startRun: async () => { /* never used */ } })
    expect(backend.kill('a-run-nobody-started')).toBe(false)
    expect(drive.session!.cancels).toBe(0)
  })

  it('A TIMEOUT ABORTS THE SESSION AND THE RUN SETTLES `timeout`', async () => {
    const settled: Settled[] = []
    let session: FakeRunSession | undefined
    let release: (() => void) | undefined
    const backend = createInProcessExecutionBackend({
      startRun: async ({ opts, onSession }) => {
        session = new FakeRunSession(opts.runId as RunSession['id'])
        onSession(session)
        await new Promise<void>((resolve) => { release = resolve })
      },
    })
    recordSettles(backend, settled)

    backend.execute({ ...baseOpts('slow-run'), timeout: 20 })
    await waitFor(() => { expect(session!.cancels).toBe(1) })
    release?.()
    await waitFor(() => { expect(settled).toHaveLength(1) })
    expect(settled[0]!.status).toBe('timeout')
    expect(settled[0]!.details.reason).toContain('run timeout after 20ms')
  })

  it('A CANCEL THAT LANDS BEFORE THE SESSION EXISTS IS STILL HONOURED', async () => {
    let session: FakeRunSession | undefined
    let nameIt: (() => void) | undefined
    const settled: Settled[] = []
    const backend = createInProcessExecutionBackend({
      startRun: async ({ opts, onSession }) => {
        await new Promise<void>((resolve) => { nameIt = resolve })
        session = new FakeRunSession(opts.runId as RunSession['id'])
        onSession(session)
      },
    })
    recordSettles(backend, settled)

    backend.execute(baseOpts('cancel-during-start'))
    expect(backend.kill('cancel-during-start')).toBe(true)
    await waitFor(() => { expect(nameIt).toBeDefined() })
    nameIt!()
    await waitFor(() => { expect(settled).toHaveLength(1) })
    expect(session!.cancels).toBe(1)
    expect(settled[0]!.status).toBe('cancelled')
  })
})

describe('a refusal is not silence — the completion vocabulary (401-07, D-04/INVK-01)', () => {
  it('A DENIAL — the starter rejects with NO session, and the reason reaches the consumers', async () => {
    const drive = await driveOneRun({
      runId: 'denied-run',
      startSession: false,
      rejectWith: new Error('Run denied: fail-closed: ask in local-headless without trust (declared tier: mutating-shared)'),
    })

    expect(drive.settled[0]!.status).toBe('failed')
    // The gate's own words, carried to the surface a person reads — where the retiring wire lost
    // them in a child's stderr.
    expect(drive.settled[0]!.details.reason).toContain('mutating-shared')
    expect(drive.settled[0]!.details.output.join('\n')).toContain('Run denied')
    const complete = drive.buffered.at(-1)
    expect(complete?.type).toBe('run-complete')
    expect(complete?.reason).toContain('Run denied')
    // No run happened: the bookends are the ONLY two events.
    expect(drive.buffered.map((event) => event.type)).toEqual(['run-start', 'run-complete'])
  })

  it('A POST-START FAILURE IS A RUN THAT HAPPENED — the reason says so, and the envelopes survive', async () => {
    const drive = await driveOneRun({
      runId: 'framework-error-run',
      rejectWith: new Error('agent-qa browser support is not installed for Chromium'),
    })
    expect(drive.settled[0]!.details.reason).toContain('Run failed after start')
    expect(drive.buffered.map((event) => event.type)).toContain('runStarted')
  })

  it('A RUN THAT ENDS WITH NO TERMINAL ENVELOPE IS `failed`, NOT `completed`', async () => {
    const drive = await driveOneRun({
      runId: 'no-verdict-run',
      envelopes: PARITY_ENVELOPES.slice(0, 2),
      preAttach: 0,
    })
    expect(drive.settled[0]!.status).toBe('failed')
    expect(drive.settled[0]!.details.reason).toBe('Run ended before a verdict was reached')
  })
})

describe('two concurrent runs are isolated at the consumer surface (401-07, INVK-01 concurrency edge)', () => {
  it('EACH BUFFER HOLDS ONLY ITS OWN RUN, AND KILLING ONE ABORTS ONLY THAT SESSION', async () => {
    const sessions = new Map<string, FakeRunSession>()
    const settled: Settled[] = []
    const releases = new Map<string, () => void>()
    const emitted: { runId: string; event: LiveExecutionEvent }[] = []

    const backend = createInProcessExecutionBackend({
      startRun: async ({ opts, onSession }) => {
        const session = new FakeRunSession(opts.runId as RunSession['id'])
        sessions.set(opts.runId, session)
        onSession(session)
        await new Promise<void>((resolve) => { releases.set(opts.runId, resolve) })
      },
    })
    recordSettles(backend, settled)
    backend.on('execution-event', (runId: string, event: LiveExecutionEvent) => {
      emitted.push({ runId, event })
    })

    backend.execute(baseOpts('run-A'))
    backend.execute(baseOpts('run-B'))
    await waitFor(() => { expect(sessions.size).toBe(2) })

    // Interleaved deliberately: a bridge with one shared buffer would pass a cell that published
    // one run's envelopes and then the other's.
    for (const envelope of PARITY_ENVELOPES.slice(0, 4)) {
      sessions.get('run-A')!.publish({ ...envelope, runId: 'run-A' } as RunEventEnvelope)
      sessions.get('run-B')!.publish({ ...envelope, runId: 'run-B' } as RunEventEnvelope)
    }

    const runIdsIn = (runId: string): Set<unknown> =>
      new Set(backend.getBufferedEvents(runId).map((event) => event.runId))
    expect(runIdsIn('run-A')).toEqual(new Set(['run-A']))
    expect(runIdsIn('run-B')).toEqual(new Set(['run-B']))
    expect(backend.getBufferedEvents('run-A')).toHaveLength(5)
    expect(backend.getBufferedEvents('run-B')).toHaveLength(5)

    // Each surface's `id` sequence is its OWN, starting at 1 — the SSE `Last-Event-ID` contract is
    // per run, so a shared counter would hand a reconnecting client somebody else's cursor.
    expect(backend.getBufferedEvents('run-A').map((event) => event.id)).toEqual([1, 2, 3, 4, 5])
    expect(backend.getBufferedEvents('run-B').map((event) => event.id)).toEqual([1, 2, 3, 4, 5])
    for (const entry of emitted) expect(entry.event.runId).toBe(entry.runId)

    expect(backend.getActiveExecutions().map((execution) => execution.runId).sort())
      .toEqual(['run-A', 'run-B'])
    // The Rule-1 fix: the retiring class looked for a `test-start` event the frozen vocabulary
    // never emits, so this field was `undefined` for every run.
    expect(backend.getActiveExecutions().find((execution) => execution.runId === 'run-A')?.testName)
      .toBe('the parity test')

    expect(backend.kill('run-A')).toBe(true)
    expect(sessions.get('run-A')!.cancels).toBe(1)
    expect(sessions.get('run-B')!.cancels).toBe(0)

    releases.get('run-A')!()
    await waitFor(() => { expect(settled).toHaveLength(1) })
    expect(settled[0]!.runId).toBe('run-A')
    expect(settled[0]!.status).toBe('cancelled')
    // B is still going: a cancel that took the other run with it would have settled it too.
    expect(backend.getActiveExecutions().map((execution) => execution.runId)).toEqual(['run-B'])

    releases.get('run-B')!()
    await waitFor(() => { expect(settled).toHaveLength(2) })
    expect(settled[1]!.runId).toBe('run-B')
  })

  it('killAll ABORTS EVERY LIVE SESSION AND NOTHING ELSE', async () => {
    const sessions: FakeRunSession[] = []
    const releases: (() => void)[] = []
    const backend = createInProcessExecutionBackend({
      startRun: async ({ opts, onSession }) => {
        const session = new FakeRunSession(opts.runId as RunSession['id'])
        sessions.push(session)
        onSession(session)
        await new Promise<void>((resolve) => { releases.push(resolve) })
      },
    })
    backend.execute(baseOpts('run-1'))
    backend.execute(baseOpts('run-2'))
    await waitFor(() => { expect(sessions).toHaveLength(2) })
    backend.killAll()
    expect(sessions.map((session) => session.cancels)).toEqual([1, 1])
    for (const release of releases) release()
  })
})

describe('the spawn vocabulary is gone from this module (401-07, INVK-01 source assertion)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'in-process-backend.ts'),
    'utf8',
  )
  /** Comment-filtered, so the header may NAME what it retired without satisfying the grep itself. */
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n')

  it('THE SCANNER SEES WHAT IT FORBIDS — before any verdict about the module', () => {
    // Non-vacuity: the same filter over a line that DOES carry each forbidden token must find it.
    const probe = ["import { spawn } from 'node:child_process'", "const P = 'AGENT_QA_EVENT:'", "treeKill(pid)"].join('\n')
    expect(probe).toContain('node:child_process')
    expect(probe).toContain('AGENT_QA_EVENT:')
    expect(probe).toContain('treeKill')
    // And the filter does not strip a code line.
    expect(code).toContain('createInProcessExecutionBackend')
  })

  it('NO CHILD PROCESS, NO SCRAPE PREFIX, NO TREE-KILL', () => {
    expect(code).not.toContain('node:child_process')
    expect(code).not.toContain('AGENT_QA_EVENT:')
    expect(code).not.toContain('treeKill')
    expect(code).not.toContain('tree-kill')
    expect(code).not.toContain('SIGKILL')
  })
})
