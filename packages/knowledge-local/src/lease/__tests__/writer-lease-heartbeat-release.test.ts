import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadId, Worker } from 'node:worker_threads'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEASE_FILE,
  LEASE_GUARD_FILE,
  LEASE_GUARD_STALE_MS,
  MUTATION_LOCK_BUSY_TIMEOUT_MS,
  acquireWriterLease,
  heartbeatLease,
  readWriterLease,
  releaseLease,
} from '../writer-lease.js'

/**
 * 2026-10-02 (quick 261002-lse): a heartbeat must never resurrect a released lease.
 *
 * Phase 432 deferred items 432-19 #7 (with 432-13 #6, 432-14 #7, 432-17 #4): the beat read the
 * lease and then rewrote it without any exclusion against `releaseLease`, so a beat that read
 * before a release wrote after it. The released lease came back under the SAME id with a fresh
 * stamp and the current epoch, and the next acquire answered `held`.
 *
 * The interleaving is driven through the seam the 386-42 clobber cells already use: the beat's
 * only `Date.now()` is the stamp it takes between its last check and its only write. The release
 * runs on a REAL second thread loaded from this same source file, so the two sides contend the way
 * the daemon's heartbeat worker and its main thread do.
 */
const SOURCE_URL = new URL('../writer-lease.ts', import.meta.url).href

const GO = 0
const CONTENDED = 1
const RETURNED = 2
const SIGNAL_SLOTS = 3
const WINDOW_WAIT_MS = 15_000

const RELEASE_WORKER_SOURCE = String.raw`
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const { url, knowledgeRoot, leaseId, signals } = workerData
const flags = new Int32Array(signals)
import(url).then((lease) => {
  parentPort.postMessage({ kind: 'ready' })
  Atomics.wait(flags, ${GO}, 0)
  let outcome
  try {
    outcome = lease.releaseLease({ knowledgeRoot, leaseId }, {
      onLeaseGuardContended: () => {
        Atomics.store(flags, ${CONTENDED}, 1)
        Atomics.notify(flags, ${CONTENDED})
      },
    })
  } catch (error) {
    outcome = { kind: 'threw', name: error && error.name, message: error && error.message }
  }
  Atomics.store(flags, ${RETURNED}, 1)
  Atomics.notify(flags, ${RETURNED})
  parentPort.postMessage({ kind: 'released', outcome })
}, (error) => {
  parentPort.postMessage({ kind: 'load-failed', message: String(error && error.message) })
})
`

interface ReleaseWorker {
  readonly flags: Int32Array
  readonly released: Promise<unknown>
  terminate(): Promise<number>
}

async function startReleaseWorker(knowledgeRoot: string, leaseId: string): Promise<ReleaseWorker> {
  const signals = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SIGNAL_SLOTS)
  const worker = new Worker(RELEASE_WORKER_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: { url: SOURCE_URL, knowledgeRoot, leaseId, signals },
  })
  let resolveReleased: (value: unknown) => void = () => undefined
  const released = new Promise<unknown>((resolve) => {
    resolveReleased = resolve
  })
  await new Promise<void>((resolve, reject) => {
    worker.on('message', (message: { kind: string; outcome?: unknown; message?: string }) => {
      if (message.kind === 'ready') resolve()
      else if (message.kind === 'released') resolveReleased(message.outcome)
      else reject(new Error(`release worker failed to load the lease module: ${message.message}`))
    })
    worker.on('error', reject)
  })
  return { flags: new Int32Array(signals), released, terminate: () => worker.terminate() }
}

/** Block this thread until the release has either landed or been seen waiting on the beat. */
function waitForReleaseToLandOrContend(flags: Int32Array): void {
  const deadline = process.hrtime.bigint() + BigInt(WINDOW_WAIT_MS) * 1_000_000n
  while (Atomics.load(flags, CONTENDED) === 0 && Atomics.load(flags, RETURNED) === 0) {
    if (process.hrtime.bigint() >= deadline) return
    Atomics.wait(flags, RETURNED, 0, 5)
  }
}

describe('a release cannot land inside a heartbeat (261002-lse, 432-19 #7)', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-beat-release-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('waits a concurrent release out of the beat window: nothing resurrects, the next acquire is not held', async () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    const releaser = await startReleaseWorker(knowledgeRoot, acquired.leaseId)

    try {
      const realNow = Date.now.bind(Date)
      let windowEntered = false
      vi.spyOn(Date, 'now').mockImplementation(() => {
        if (!windowEntered) {
          windowEntered = true
          Atomics.store(releaser.flags, GO, 1)
          Atomics.notify(releaser.flags, GO)
          waitForReleaseToLandOrContend(releaser.flags)
        }
        return realNow()
      })

      const beat = heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })
      vi.restoreAllMocks()
      const released = await releaser.released

      expect(windowEntered).toBe(true)
      expect(beat).toMatchObject({ kind: 'heartbeated' })
      expect(released).toEqual({ kind: 'released' })

      // THE TRUTHS: once the release has returned, the lease is gone and stays gone.
      const afterRelease = readWriterLease(knowledgeRoot)
      const nextAcquire = acquireWriterLease(knowledgeRoot)
      expect({ afterRelease, nextAcquire }).toMatchObject({
        afterRelease: { kind: 'absent' },
        nextAcquire: { kind: 'acquired' },
      })

      // And the order is the guarded one: the release met the in-flight beat and waited for it.
      expect(Atomics.load(releaser.flags, CONTENDED)).toBe(1)
    } finally {
      await releaser.terminate()
    }
  }, 30_000)

  it('refuses a release attempted from inside the beat window on the same thread, without waiting', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')

    const realNow = Date.now.bind(Date)
    let inWindow: unknown
    let inWindowElapsedMs = Number.POSITIVE_INFINITY
    vi.spyOn(Date, 'now').mockImplementation(() => {
      if (inWindow === undefined) {
        const startedAtNs = process.hrtime.bigint()
        try {
          inWindow = releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })
        } catch (error) {
          inWindow = { kind: 'threw', name: (error as Error).name }
        }
        inWindowElapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6
      }
      return realNow()
    })

    const beat = heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })
    vi.restoreAllMocks()

    // A release nested inside the beat's own guarded window can never be let in by waiting, so it
    // fails fast by name instead of landing between the beat's read and its write.
    expect(inWindow).toEqual({ kind: 'threw', name: 'LeaseGuardBusyError' })
    expect(inWindowElapsedMs).toBeLessThan(1_000)
    expect(beat).toMatchObject({ kind: 'heartbeated' })

    expect(releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })).toEqual({
      kind: 'released',
    })
    expect(readWriterLease(knowledgeRoot)).toEqual({ kind: 'absent' })
    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({ kind: 'acquired' })
  })
})

describe('the lease-file guard itself (261002-lse)', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-lease-guard-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function guardFile(): string {
    return join(knowledgeRoot, LEASE_GUARD_FILE)
  }

  function plantGuard(owner: { pid: number; threadId: number; claimedAtNs: bigint }): void {
    writeFileSync(guardFile(), `${JSON.stringify({
      pid: owner.pid,
      threadId: owner.threadId,
      token: randomUUID(),
      claimedAtNs: String(owner.claimedAtNs),
    })}\n`, 'utf8')
  }

  function guardEntries(): string[] {
    return readdirSync(knowledgeRoot).filter((entry) => entry.startsWith(LEASE_GUARD_FILE))
  }

  function deadPid(): number {
    const exited = spawnSync(process.execPath, ['-e', ''])
    if (exited.pid === undefined) throw new Error('expected a spawned pid')
    return exited.pid
  }

  it('leaves nothing behind after a beat and a release', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')

    expect(heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })).toMatchObject({
      kind: 'heartbeated',
    })
    expect(guardEntries()).toEqual([])
    expect(releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })).toEqual({
      kind: 'released',
    })
    expect(guardEntries()).toEqual([])
  })

  it('answers an absent lease before staging any guard', () => {
    expect(heartbeatLease({
      knowledgeRoot,
      leaseId: '00000000-0000-4000-8000-000000000000',
    })).toEqual({ kind: 'refused', reason: 'lease-missing' })
  })

  it.each([
    [
      'a dead process',
      () => ({ pid: deadPid(), threadId: 0, claimedAtNs: process.hrtime.bigint() }),
    ],
    [
      'a live process past the age bound',
      () => ({
        pid: process.pid,
        threadId: threadId + 1_000,
        claimedAtNs: process.hrtime.bigint() - BigInt(LEASE_GUARD_STALE_MS + 1_000) * 1_000_000n,
      }),
    ],
    [
      'a claim stamped ahead of this clock (a previous boot)',
      () => ({
        pid: process.pid,
        threadId: threadId + 1_000,
        claimedAtNs: process.hrtime.bigint() + 3_600_000_000_000n,
      }),
    ],
  ])('reclaims a guard left by %s and beats', (_label, owner) => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    plantGuard(owner())

    expect(heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })).toMatchObject({
      kind: 'heartbeated',
    })
    expect(guardEntries()).toEqual([])
  })

  it('reclaims unattributable guard bytes and releases', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    writeFileSync(guardFile(), 'not a guard\n', 'utf8')

    expect(releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })).toEqual({
      kind: 'released',
    })
    expect(guardEntries()).toEqual([])
  })

  it('waits a live foreign section out for the busy window only, then refuses by name and writes nothing', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    plantGuard({
      pid: process.pid,
      threadId: threadId + 1_000,
      claimedAtNs: process.hrtime.bigint(),
    })
    const leaseBefore = readFileSync(join(knowledgeRoot, LEASE_FILE))
    let contentions = 0

    const startedAtNs = process.hrtime.bigint()
    const beat = (() => {
      try {
        return heartbeatLease(
          { knowledgeRoot, leaseId: acquired.leaseId },
          { onLeaseGuardContended: () => { contentions += 1 } },
        )
      } catch (error) {
        return { kind: 'threw', name: (error as Error).name }
      }
    })()
    const waitedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6

    expect(beat).toEqual({ kind: 'threw', name: 'LeaseGuardBusyError' })
    expect(contentions).toBe(1)
    expect(waitedMs).toBeGreaterThanOrEqual(MUTATION_LOCK_BUSY_TIMEOUT_MS)
    expect(waitedMs).toBeLessThan(LEASE_GUARD_STALE_MS)
    expect(readFileSync(join(knowledgeRoot, LEASE_FILE))).toEqual(leaseBefore)
    // The foreign section's guard is not the beat's to remove.
    expect(guardEntries()).toEqual([LEASE_GUARD_FILE])
  }, 15_000)
})
