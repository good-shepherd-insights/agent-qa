import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as publicWriterSurface from '../index.js'
import type { WriterLeaseAuthority as PublicWriterLeaseAuthority } from '../index.js'
import {
  acquireWriterLease,
  assertEpochCurrent,
  CorruptEpochStateError,
  deriveWriterLeaseFreshness,
  EPOCH_FILE,
  heartbeatLease,
  isLeaseStale,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  MUTATION_LOCK_TAKEOVER_MS,
  readCurrentEpoch,
  refreshWriterLeaseAuthority,
  releaseLease,
  WRITER_AUTHORITY_DB_FILE,
  WriterAuthorityLostError,
  type WriterAuthorityLostReason,
  type WriterLease,
} from '../lease/writer-lease.js'

const WRITER_LEASE_MODULE_URL = new URL('../lease/writer-lease.ts', import.meta.url).href

/** WR-04 crash seam: the acquired path publishes the epoch before it publishes the lease. */
type AcquireWithEpochSeam = (
  knowledgeRoot: string,
  hooks: {
    afterEpochRewrite?: () => void
    mutationLockTakeoverMs?: number
  },
) => ReturnType<typeof acquireWriterLease>

const acquireWithEpochSeam = acquireWriterLease as AcquireWithEpochSeam

/**
 * W-05 observation seam: report every process-incarnation resolution the escalation path performs.
 *
 * Mirrors the `mutationLockTakeoverMs` / `acquireDeadlineMs` idiom — a test-only observer that
 * never replaces the production resolver, so the count being asserted is the count production pays.
 */
type AcquireWithIncarnationObserver = (
  knowledgeRoot: string,
  hooks: {
    acquireDeadlineMs?: number
    mutationLockTakeoverMs?: number
    onProcessIncarnationResolved?: (pid: number) => void
  },
) => ReturnType<typeof acquireWriterLease>

const acquireWithIncarnationObserver = acquireWriterLease as AcquireWithIncarnationObserver

function elapsedMs(startedAtNs: bigint): number {
  return Number(process.hrtime.bigint() - startedAtNs) / 1e6
}

/** The kernel's own view of a pid's state, read without going through the module under test. */
function processState(pid: number): string {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'state='], {
      encoding: 'utf8',
    }).trim().charAt(0)
  } catch {
    return ''
  }
}

async function waitForConditionInTest(
  predicate: () => boolean,
  timeoutMs: number,
  describeWhat = 'condition',
): Promise<void> {
  const startedAtNs = process.hrtime.bigint()
  while (!predicate()) {
    if (elapsedMs(startedAtNs) >= timeoutMs) {
      throw new Error(`${describeWhat} not reached within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function waitForFileInTest(file: string, timeoutMs: number): Promise<void> {
  return waitForConditionInTest(() => existsSync(file), timeoutMs, `file ${file}`)
}

function spawnLeaseAcquirer(
  knowledgeRoot: string,
  stallInsideLockMs: number,
  mutationLockTakeoverMs = MUTATION_LOCK_TAKEOVER_MS,
): ChildProcessWithoutNullStreams {
  const source = `
    const { acquireWriterLease } = await import(${JSON.stringify(WRITER_LEASE_MODULE_URL)});
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const outcome = acquireWriterLease(process.env.AGENT_QA_LEASE_TEST_ROOT, {
      afterMutationLockAcquired: () => {
        process.stdout.write('locked\\n');
        Atomics.wait(wait, 0, 0, Number(process.env.AGENT_QA_LEASE_TEST_STALL_MS));
      },
      mutationLockTakeoverMs: Number(process.env.AGENT_QA_LEASE_TEST_TAKEOVER_MS),
    });
    process.stdout.write(JSON.stringify(outcome) + '\\n');
  `
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    {
      env: {
        ...process.env,
        AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot,
        AGENT_QA_LEASE_TEST_STALL_MS: String(stallInsideLockMs),
        AGENT_QA_LEASE_TEST_TAKEOVER_MS: String(mutationLockTakeoverMs),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

function spawnAuthorityHolder(
  knowledgeRoot: string,
  permitFile: string,
): ChildProcessWithoutNullStreams {
  const source = `
    const { existsSync } = await import('node:fs');
    const {
      acquireWriterLease,
      releaseLease,
      withCurrentWriterAuthority,
    } = await import(${JSON.stringify(WRITER_LEASE_MODULE_URL)});
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const acquired = acquireWriterLease(process.env.AGENT_QA_LEASE_TEST_ROOT);
    if (acquired.kind !== 'acquired') throw new Error('holder did not acquire');
    withCurrentWriterAuthority(
      process.env.AGENT_QA_LEASE_TEST_ROOT,
      { leaseId: acquired.leaseId, epoch: acquired.epoch },
      () => process.stdout.write('mutated\\n'),
      {
        afterFinalAuthorityCompare: () => {
          process.stdout.write('inside\\n');
          while (!existsSync(process.env.AGENT_QA_LEASE_TEST_PERMIT)) {
            Atomics.wait(wait, 0, 0, 10);
          }
        },
      },
    );
    releaseLease({
      knowledgeRoot: process.env.AGENT_QA_LEASE_TEST_ROOT,
      leaseId: acquired.leaseId,
    });
    process.stdout.write('done\\n');
  `
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    {
      env: {
        ...process.env,
        AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot,
        AGENT_QA_LEASE_TEST_PERMIT: permitFile,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

function spawnClaimedLeaseAcquirer(
  knowledgeRoot: string,
  permitFile: string,
): ChildProcessWithoutNullStreams {
  const source = `
    const { existsSync } = await import('node:fs');
    const { acquireWriterLease } = await import(${JSON.stringify(WRITER_LEASE_MODULE_URL)});
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const outcome = acquireWriterLease(process.env.AGENT_QA_LEASE_TEST_ROOT, {
      afterMutationLockClaimed: () => {
        process.stdout.write('claimed\\n');
        while (!existsSync(process.env.AGENT_QA_LEASE_TEST_PERMIT)) {
          Atomics.wait(wait, 0, 0, 10);
        }
      },
    });
    process.stdout.write(JSON.stringify(outcome) + '\\n');
  `
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    {
      env: {
        ...process.env,
        AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot,
        AGENT_QA_LEASE_TEST_PERMIT: permitFile,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

/**
 * An unrelated process that merely occupies a pid.
 *
 * CR-04's threat is a crashed owner whose pid is later handed to a stranger. This child never
 * touches the authority store, so anything that reaches it arrived purely because a durable row
 * still names its pid.
 */
function spawnIdleSurrogate(exitPermitFile: string): ChildProcessWithoutNullStreams {
  const source = `
    const { existsSync } = await import('node:fs');
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    process.stdout.write('surrogate-alive\\n');
    while (!existsSync(process.env.AGENT_QA_LEASE_TEST_EXIT_PERMIT)) {
      Atomics.wait(wait, 0, 0, 10);
    }
  `
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    {
      env: { ...process.env, AGENT_QA_LEASE_TEST_EXIT_PERMIT: exitPermitFile },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

/**
 * Occupy the authority store's write transaction without claiming the lock through the module.
 *
 * The start permit exists so the test can seed a row naming THIS child's pid before the child
 * takes the write lock; the release permit ends the transaction and the child then exits.
 */
function spawnAuthorityDbBlocker(
  dbPath: string,
  startPermitFile: string,
  releasePermitFile: string,
): ChildProcessWithoutNullStreams {
  const source = `
    const { existsSync } = await import('node:fs');
    const { DatabaseSync } = await import('node:sqlite');
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    while (!existsSync(process.env.AGENT_QA_LEASE_TEST_START_PERMIT)) {
      Atomics.wait(wait, 0, 0, 10);
    }
    const db = new DatabaseSync(process.env.AGENT_QA_LEASE_TEST_DB);
    db.exec('PRAGMA busy_timeout = 250');
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('blocking\\n');
    while (!existsSync(process.env.AGENT_QA_LEASE_TEST_RELEASE_PERMIT)) {
      Atomics.wait(wait, 0, 0, 10);
    }
    db.exec('ROLLBACK');
    db.close();
  `
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    {
      env: {
        ...process.env,
        AGENT_QA_LEASE_TEST_DB: dbPath,
        AGENT_QA_LEASE_TEST_START_PERMIT: startPermitFile,
        AGENT_QA_LEASE_TEST_RELEASE_PERMIT: releasePermitFile,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

function collectStdout(child: ChildProcessWithoutNullStreams): () => string {
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  return () => output
}

function lastJsonLine(text: string): unknown {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return JSON.parse(lines[lines.length - 1] ?? '')
}

function processIsAliveInTest(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read the OS-reported start time of a pid WITHOUT going through the module under test.
 *
 * The incarnation guard must be anchored outside the lock module's own vocabulary, so these cases
 * compare the recorded token against an independently observed kernel fact rather than against the
 * module's own helper.
 */
function observedProcessStartToken(pid: number): string {
  if (process.platform === 'linux') {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/)
    const starttime = fields[19]
    if (starttime === undefined) throw new Error(`no starttime field for pid ${pid}`)
    return starttime
  }
  const observed = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8',
  }).trim()
  if (observed === '') throw new Error(`no start time reported for pid ${pid}`)
  return observed
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (!output.includes(expected)) return
      child.stdout.off('data', onData)
      resolve()
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.once('exit', (code) => {
      if (!output.includes(expected)) reject(new Error(`lease child exited ${code}: ${output}`))
    })
  })
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`lease child exited ${code}: ${stderr}`))
    })
  })
}

function observeExit(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stderr }))
  })
}

describe('writer lease acquire, heartbeat, release, and stale self-heal (CUR-03/CUR-04)', () => {
  let root: string
  let knowledgeRoot: string
  let now: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-lease-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  afterEach(() => {
    now.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  function leaseOnDisk(): WriterLease {
    return JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')) as WriterLease
  }

  it('acquires a clean root at epoch one and returns the fresh holder on a second acquire', () => {
    const acquired = acquireWriterLease(knowledgeRoot)

    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired writer lease')
    expect(acquired.epoch).toBe(1)
    expect(acquired.leaseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8').trim()).toBe('1')
    expect(leaseOnDisk()).toEqual({
      leaseId: acquired.leaseId,
      pid: process.pid,
      epoch: 1,
      heartbeatAtMs: 1_000_000,
    })

    const held = acquireWriterLease(knowledgeRoot)

    expect(held).toEqual({ kind: 'held', holder: leaseOnDisk() })
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8').trim()).toBe('1')
  })

  it('reclaims a fresh-looking holder whose recorded epoch no longer matches disk (WR-04)', () => {
    const first = acquireWriterLease(knowledgeRoot)
    expect(first.kind).toBe('acquired')
    if (first.kind !== 'acquired') throw new Error('expected first acquired writer lease')
    const phantom = leaseOnDisk()
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), '2\n', 'utf8')

    const outcome = acquireWriterLease(knowledgeRoot)

    expect(outcome.kind).toBe('acquired')
    if (outcome.kind !== 'acquired') throw new Error('expected epoch-invalid holder reclaim')
    expect(outcome.epoch).toBe(3)
    expect(outcome.reclaimed).toEqual(phantom)
    expect(leaseOnDisk()).toMatchObject({ leaseId: outcome.leaseId, epoch: 3 })
  })

  it('recovers promptly from a crash between the epoch rewrite and the lease publication', () => {
    const first = acquireWriterLease(knowledgeRoot)
    expect(first.kind).toBe('acquired')
    if (first.kind !== 'acquired') throw new Error('expected first acquired writer lease')
    const outgoing = leaseOnDisk()
    now.mockReturnValue(1_000_000 + LEASE_HEARTBEAT_TTL_MS)

    expect(() => acquireWithEpochSeam(knowledgeRoot, {
      afterEpochRewrite: () => {
        /**
         * The epoch is already durable at 2 while the lease still names epoch 1. The outgoing
         * holder's bytes are re-stamped fresh to model the worst reachable torn state: a
         * phantom holder that no TTL sweep will ever classify as stale.
         */
        writeFileSync(
          join(knowledgeRoot, LEASE_FILE),
          `${JSON.stringify({ ...outgoing, heartbeatAtMs: Date.now() })}\n`,
          'utf8',
        )
        throw new Error('crash between epoch and lease publication')
      },
    })).toThrow(/crash between epoch and lease publication/)

    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8').trim()).toBe('2')
    expect(leaseOnDisk()).toMatchObject({ leaseId: first.leaseId, epoch: 1 })
    const startedAtNs = process.hrtime.bigint()

    const contender = acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 })

    expect(contender).toMatchObject({ kind: 'acquired', epoch: 3 })
    expect(elapsedMs(startedAtNs)).toBeLessThan(1_000)
  })

  it('still returns a fresh epoch-matching holder immediately under a zero takeover bound', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired writer lease')
    const startedAtNs = process.hrtime.bigint()

    const held = acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 })

    expect(held).toEqual({ kind: 'held', holder: leaseOnDisk() })
    expect(elapsedMs(startedAtNs)).toBeLessThan(250)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8').trim()).toBe('1')
  })

  it('reclaims a stale holder with a new lease id and a bumped epoch', () => {
    const first = acquireWriterLease(knowledgeRoot)
    expect(first.kind).toBe('acquired')
    if (first.kind !== 'acquired') throw new Error('expected first acquired writer lease')
    const staleLease = {
      ...leaseOnDisk(),
      heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
    }
    writeFileSync(join(knowledgeRoot, LEASE_FILE), `${JSON.stringify(staleLease)}\n`, 'utf8')

    const reclaimed = acquireWriterLease(knowledgeRoot)

    expect(reclaimed.kind).toBe('acquired')
    if (reclaimed.kind !== 'acquired') throw new Error('expected reclaimed writer lease')
    expect(reclaimed.epoch).toBe(2)
    expect(reclaimed.leaseId).not.toBe(first.leaseId)
    expect(reclaimed.reclaimed).toEqual(staleLease)
    expect(leaseOnDisk()).toMatchObject({
      leaseId: reclaimed.leaseId,
      pid: process.pid,
      epoch: 2,
      heartbeatAtMs: 1_000_000,
    })
  })

  it('refreshes only the matching holder and releases only its lease file', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired writer lease')

    expect(
      heartbeatLease({ knowledgeRoot, leaseId: '00000000-0000-4000-8000-000000000000' }),
    ).toEqual({ kind: 'refused', reason: 'lease-id-mismatch', holder: leaseOnDisk() })

    now.mockReturnValue(1_005_000)
    const heartbeat = heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })

    expect(heartbeat).toEqual({ kind: 'heartbeated', holder: leaseOnDisk() })
    expect(leaseOnDisk()).toEqual({
      leaseId: acquired.leaseId,
      pid: process.pid,
      epoch: acquired.epoch,
      heartbeatAtMs: 1_005_000,
    })
    expect(
      releaseLease({
        knowledgeRoot,
        leaseId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual({ kind: 'refused', reason: 'lease-id-mismatch', holder: leaseOnDisk() })
    expect(releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })).toEqual({
      kind: 'released',
    })
    expect(existsSync(join(knowledgeRoot, LEASE_FILE))).toBe(false)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8').trim()).toBe('1')
  })

  it('classifies malformed lease bytes as stale and self-heals over them', () => {
    mkdirSync(knowledgeRoot, { recursive: true })
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), '7\n', 'utf8')
    writeFileSync(join(knowledgeRoot, LEASE_FILE), 'not-json\n', 'utf8')

    expect(isLeaseStale(undefined, Date.now())).toBe(true)
    expect(isLeaseStale({ heartbeatAtMs: 'not-a-number' }, Date.now())).toBe(true)

    const acquired = acquireWriterLease(knowledgeRoot)

    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected self-healed writer lease')
    expect(acquired.epoch).toBe(8)
    expect(leaseOnDisk()).toMatchObject({ leaseId: acquired.leaseId, epoch: 8 })
  })

  it('treats the heartbeat TTL boundary as stale and rejects relative roots', () => {
    const lease: WriterLease = {
      leaseId: '00000000-0000-4000-8000-000000000000',
      pid: 1,
      epoch: 1,
      heartbeatAtMs: 10_000,
    }

    expect(isLeaseStale(lease, 10_000 + LEASE_HEARTBEAT_TTL_MS - 1)).toBe(false)
    expect(isLeaseStale(lease, 10_000 + LEASE_HEARTBEAT_TTL_MS)).toBe(true)
    expect(() => acquireWriterLease('relative/agent-qa-knowledge')).toThrow(
      /knowledgeRoot must be absolute/,
    )
  })

  it('reads only missing epoch state as zero and fails closed on malformed bytes', () => {
    expect(readCurrentEpoch(knowledgeRoot)).toBe(0)

    mkdirSync(knowledgeRoot, { recursive: true })
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), 'not-an-integer\n', 'utf8')

    expect(() => readCurrentEpoch(knowledgeRoot)).toThrow(CorruptEpochStateError)
  })

  it('accepts the current holder epoch at the mutation boundary', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired writer lease')

    expect(assertEpochCurrent({ knowledgeRoot, epoch: acquired.epoch })).toEqual({
      current: true,
    })
  })

  it('fresh-reads a competing reclaim and refuses the original holder without throwing', () => {
    const original = acquireWriterLease(knowledgeRoot)
    expect(original.kind).toBe('acquired')
    if (original.kind !== 'acquired') throw new Error('expected original writer lease')
    writeFileSync(
      join(knowledgeRoot, LEASE_FILE),
      `${JSON.stringify({
        ...leaseOnDisk(),
        heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
      })}\n`,
      'utf8',
    )

    const competitor = acquireWriterLease(knowledgeRoot)

    expect(competitor.kind).toBe('acquired')
    if (competitor.kind !== 'acquired') throw new Error('expected competing writer lease')
    expect(competitor.epoch).toBe(2)
    expect(assertEpochCurrent({ knowledgeRoot, epoch: original.epoch })).toEqual({
      current: false,
      observedEpoch: 2,
    })
    expect(assertEpochCurrent({ knowledgeRoot, epoch: competitor.epoch })).toEqual({
      current: true,
    })
  })
})

describe('fresh writer authority heartbeat and epoch fencing', () => {
  let root: string
  let knowledgeRoot: string
  let now: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-authority-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
  })

  afterEach(() => {
    now.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  function acquireAuthority(): PublicWriterLeaseAuthority {
    const acquired = acquireWriterLease(knowledgeRoot)
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired writer lease')
    return { knowledgeRoot, leaseId: acquired.leaseId, epoch: acquired.epoch }
  }

  function expectAuthorityLoss(
    invoke: () => unknown,
    reason: WriterAuthorityLostReason,
    observedEpoch: number,
  ): void {
    try {
      invoke()
      throw new Error('expected writer authority loss')
    } catch (error) {
      expect(error).toBeInstanceOf(WriterAuthorityLostError)
      expect(error).toMatchObject({
        name: 'WriterAuthorityLostError',
        reason,
        observedEpoch,
      })
    }
  }

  it('exports the authority guard only from the main writer surface', () => {
    expect(refreshWriterLeaseAuthority).toBeTypeOf('function')
    expect(WriterAuthorityLostError).toBeTypeOf('function')
    expect(publicWriterSurface).toHaveProperty('refreshWriterLeaseAuthority')
    expect(publicWriterSurface).toHaveProperty('WriterAuthorityLostError')
  })

  it('heartbeats the exact current holder and returns the same authority', () => {
    const authority = acquireAuthority()
    now.mockReturnValue(2_005_000)

    expect(refreshWriterLeaseAuthority(authority)).toEqual(authority)
    expect(
      JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')),
    ).toMatchObject({
      leaseId: authority.leaseId,
      epoch: authority.epoch,
      heartbeatAtMs: 2_005_000,
    })
  })

  it('rejects a reclaimed epoch before heartbeat', () => {
    const authority = acquireAuthority()
    const staleLease = {
      ...JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')),
      heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
    }
    writeFileSync(join(knowledgeRoot, LEASE_FILE), `${JSON.stringify(staleLease)}\n`, 'utf8')
    const competitor = acquireWriterLease(knowledgeRoot)
    expect(competitor.kind).toBe('acquired')

    expectAuthorityLoss(
      () => refreshWriterLeaseAuthority(authority),
      'epoch-mismatch-before-heartbeat',
      2,
    )
  })

  it.each([
    {
      name: 'mismatched lease id',
      prepare: (authority: PublicWriterLeaseAuthority) => ({
        ...authority,
        leaseId: '00000000-0000-4000-8000-000000000000',
      }),
      reason: 'lease-id-mismatch' as const,
    },
    {
      name: 'missing lease',
      prepare: (authority: PublicWriterLeaseAuthority) => {
        expect(releaseLease(authority)).toEqual({ kind: 'released' })
        return authority
      },
      reason: 'lease-missing' as const,
    },
    {
      name: 'malformed lease',
      prepare: (authority: PublicWriterLeaseAuthority) => {
        writeFileSync(join(knowledgeRoot, LEASE_FILE), 'not-json\n', 'utf8')
        return authority
      },
      reason: 'lease-malformed' as const,
    },
  ])('normalizes a $name refusal into the typed authority-lost error', ({ prepare, reason }) => {
    const authority = prepare(acquireAuthority())

    expectAuthorityLoss(
      () => refreshWriterLeaseAuthority(authority),
      reason,
      authority.epoch,
    )
  })

  it('rechecks the epoch after heartbeat and catches a reclaim race', () => {
    const authority = acquireAuthority()
    now.mockImplementationOnce(() => {
      writeFileSync(join(knowledgeRoot, EPOCH_FILE), '2\n', 'utf8')
      return 2_005_000
    })

    expectAuthorityLoss(
      () => refreshWriterLeaseAuthority(authority),
      'epoch-mismatch-after-heartbeat',
      2,
    )
  })
})

describe('writer lease mutation lock ownership', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-lock-owner-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('waits behind a live held transaction until the original acquisition completes', async () => {
    const first = spawnLeaseAcquirer(knowledgeRoot, 6_500)
    await waitForOutput(first, 'locked\n')

    const second = spawnLeaseAcquirer(knowledgeRoot, 0)
    let secondExited = false
    second.once('exit', () => { secondExited = true })
    await new Promise((resolve) => setTimeout(resolve, 5_500))

    expect(secondExited).toBe(false)
    await Promise.all([waitForExit(first), waitForExit(second)])
    const authorityDb = new DatabaseSync(
      join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE),
      { readOnly: true },
    )
    try {
      expect(
        authorityDb.prepare('SELECT * FROM mutation_lock WHERE id = 1').get(),
      ).toBeUndefined()
    } finally {
      authorityDb.close()
    }
    expect(JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'))).toMatchObject({
      pid: first.pid,
      epoch: 1,
    })
  }, 10_000)

  it('short-circuits a fresh lease without killing its held-section owner', async () => {
    const permitFile = join(root, 'fresh-holder.permit')
    const holder = spawnAuthorityHolder(knowledgeRoot, permitFile)
    const holderExit = observeExit(holder)
    await waitForOutput(holder, 'inside\n')

    const startedAtMs = Date.now()
    const contender = acquireWriterLease(knowledgeRoot, {
      mutationLockTakeoverMs: 0,
    })

    expect(contender).toMatchObject({
      kind: 'held',
      holder: { pid: holder.pid, epoch: 1 },
    })
    expect(Date.now() - startedAtMs).toBeLessThan(250)
    expect(holder.exitCode).toBeNull()
    expect(holder.signalCode).toBeNull()

    writeFileSync(permitFile, 'resume\n', 'utf8')
    expect(await holderExit).toMatchObject({ code: 0, signal: null })
    expect(existsSync(join(knowledgeRoot, LEASE_FILE))).toBe(false)
  }, 10_000)

  it('kills and verifies the exact stale held-section owner before takeover', async () => {
    const permitFile = join(root, 'stale-holder.permit')
    const holder = spawnAuthorityHolder(knowledgeRoot, permitFile)
    const holderExit = observeExit(holder)
    await waitForOutput(holder, 'inside\n')
    const staleLease = JSON.parse(
      readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    writeFileSync(
      join(knowledgeRoot, LEASE_FILE),
      `${JSON.stringify({
        ...staleLease,
        heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
      })}\n`,
      'utf8',
    )

    const contender = spawnLeaseAcquirer(knowledgeRoot, 0, 0)
    const contenderExit = waitForExit(contender)
    expect(await holderExit).toMatchObject({ code: null, signal: 'SIGKILL' })
    await contenderExit

    expect(JSON.parse(
      readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'),
    )).toMatchObject({
      pid: contender.pid,
      epoch: 2,
    })
  }, 15_000)

  it('CAS-takes a live crash row after its deadline and rejects the late original', async () => {
    const permitFile = join(root, 'claimed-holder.permit')
    const original = spawnClaimedLeaseAcquirer(knowledgeRoot, permitFile)
    const originalExit = observeExit(original)
    await waitForOutput(original, 'claimed\n')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const replacement = spawnLeaseAcquirer(knowledgeRoot, 0, 25)
    await waitForExit(replacement)
    writeFileSync(permitFile, 'resume\n', 'utf8')
    const refused = await originalExit

    expect(refused.code).not.toBe(0)
    expect(refused.signal).toBeNull()
    expect(refused.stderr).toContain('MutationLockGenerationLostError')
    expect(JSON.parse(
      readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'),
    )).toMatchObject({
      pid: replacement.pid,
      epoch: 1,
    })
  }, 10_000)
})

/**
 * CR-01 + CR-03: one three-valued freshness derivation, and a beat the mutation lock cannot starve.
 *
 * The two live together because they are the same mechanism change: freshness is derived from the
 * disk epoch and the lease TTL alone, and the heartbeat writes `.lease` directly. There is no
 * second freshness channel for an unreadable epoch to be laundered through, and no contention
 * state for the beat to diverge into.
 */
describe('three-valued freshness and the lock-free heartbeat (CR-01/CR-03)', () => {
  let root: string
  let knowledgeRoot: string

  /** chmod is advisory for uid 0, so the unreadable-epoch input domain cannot be produced there. */
  const canMakeFilesUnreadable = process.platform !== 'win32' && process.getuid?.() !== 0

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-tristate-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    try {
      chmodSync(join(knowledgeRoot, EPOCH_FILE), 0o600)
    } catch {
      // The leg either never made it unreadable or already restored it.
    }
    rmSync(root, { recursive: true, force: true })
  })

  function leaseFile(): string {
    return join(knowledgeRoot, LEASE_FILE)
  }

  function leaseOnDisk(): WriterLease {
    return JSON.parse(readFileSync(leaseFile(), 'utf8')) as WriterLease
  }

  function ageLeaseOnDisk(ageMs: number): WriterLease {
    const aged = { ...leaseOnDisk(), heartbeatAtMs: Date.now() - ageMs }
    writeFileSync(leaseFile(), `${JSON.stringify(aged)}\n`, 'utf8')
    return aged
  }

  /** Occupy the authority database exactly as a long governed mutation does. */
  function holdAuthorityTransaction(): () => void {
    const db = new DatabaseSync(join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE))
    db.exec('PRAGMA busy_timeout = 250')
    db.exec('BEGIN IMMEDIATE')
    return () => {
      try {
        db.exec('ROLLBACK')
      } finally {
        db.close()
      }
    }
  }

  /**
   * The CR-01 rejecting corpus, drawn from OUTSIDE the guard's own assumption.
   *
   * The previous derivation only ever answered a boolean, so an unreadable `.epoch` — EACCES, EIO,
   * EMFILE, not corrupt bytes — produced the same value a genuinely expired lease produces. Both
   * directions of that collapse are asserted here: over a fresh lease AND over a TTL-stale one the
   * answer is `unknown`, so nothing inside the derivation resolves it toward either boolean.
   */
  it.runIf(canMakeFilesUnreadable)(
    'answers unknown for an unreadable epoch over both a fresh and a stale lease (CR-01)',
    () => {
      const acquired = acquireWriterLease(knowledgeRoot)
      if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
      const lease = leaseOnDisk()
      const nowMs = Date.now()

      // Accepting control: the same lease, the same clock, a readable epoch.
      expect(deriveWriterLeaseFreshness(knowledgeRoot, lease, nowMs)).toMatchObject({
        kind: 'fresh',
      })

      chmodSync(join(knowledgeRoot, EPOCH_FILE), 0o000)

      const overFresh = deriveWriterLeaseFreshness(knowledgeRoot, lease, nowMs)
      expect(overFresh.kind).toBe('unknown')
      expect(overFresh.kind).not.toBe('fresh')
      expect(overFresh.kind).not.toBe('reclaimable')
      if (overFresh.kind !== 'unknown') throw new Error('expected an unknown verdict')
      expect(overFresh.error).toBeInstanceOf(CorruptEpochStateError)
      expect(overFresh.error.reason).toBe('unreadable')

      // The immortal-phantom-holder shape the falsification table rejects: an unreadable epoch
      // must not fall through to the TTL rule in EITHER direction.
      const stale = { ...lease, heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS - 1 }
      const overStale = deriveWriterLeaseFreshness(knowledgeRoot, stale, nowMs)
      expect(overStale.kind).toBe('unknown')
      expect(overStale.kind).not.toBe('fresh')
      expect(overStale.kind).not.toBe('reclaimable')
    },
  )

  it('names a superseded epoch and an aged-out lease reclaimable, and neither of them fresh', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    const lease = leaseOnDisk()
    const nowMs = Date.now()

    expect(deriveWriterLeaseFreshness(knowledgeRoot, lease, nowMs)).toEqual({ kind: 'fresh' })
    expect(deriveWriterLeaseFreshness(
      knowledgeRoot,
      { ...lease, heartbeatAtMs: nowMs - LEASE_HEARTBEAT_TTL_MS },
      nowMs,
    )).toEqual({ kind: 'reclaimable' })

    writeFileSync(join(knowledgeRoot, EPOCH_FILE), `${lease.epoch + 1}\n`, 'utf8')
    expect(deriveWriterLeaseFreshness(knowledgeRoot, lease, nowMs)).toEqual({
      kind: 'reclaimable',
    })
  })

  /**
   * The beat is independent of hosted work BY CONSTRUCTION, and the evidence is file bytes.
   *
   * The old renewal path answered a third outcome here and published freshness somewhere else, so
   * a contender reading `.lease` saw a holder ageing out while the module reported it healthy.
   * Asserting the on-disk heartbeat rules that divergence out: there is one place freshness lives.
   */
  it('heartbeats a held-transaction root without entering the mutation lock (CR-03)', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    const before = ageLeaseOnDisk(5_000)

    const release = holdAuthorityTransaction()
    try {
      expect(heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })).toMatchObject({
        kind: 'heartbeated',
      })
    } finally {
      release()
    }

    expect(leaseOnDisk().heartbeatAtMs).toBeGreaterThan(before.heartbeatAtMs)
  }, 15_000)

  it('refuses a foreign lease id under a held transaction and writes nothing (CR-03)', () => {
    const superseded = acquireWriterLease(knowledgeRoot)
    if (superseded.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    expect(releaseLease({ knowledgeRoot, leaseId: superseded.leaseId })).toEqual({
      kind: 'released',
    })
    const replacement = acquireWriterLease(knowledgeRoot)
    if (replacement.kind !== 'acquired') throw new Error('expected a replacement writer lease')
    const bytesBefore = readFileSync(leaseFile())

    const release = holdAuthorityTransaction()
    try {
      expect(heartbeatLease({ knowledgeRoot, leaseId: superseded.leaseId })).toMatchObject({
        kind: 'refused',
        reason: 'lease-id-mismatch',
      })
    } finally {
      release()
    }

    expect(readFileSync(leaseFile())).toEqual(bytesBefore)
  }, 15_000)

  it('refuses a superseded-epoch holder under a held transaction and writes nothing (W-01)', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    const lease = leaseOnDisk()
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), `${lease.epoch + 1}\n`, 'utf8')
    const bytesBefore = readFileSync(leaseFile())

    const release = holdAuthorityTransaction()
    try {
      expect(heartbeatLease({ knowledgeRoot, leaseId: lease.leaseId })).toMatchObject({
        kind: 'refused',
        reason: 'stale-epoch',
        observedEpoch: lease.epoch + 1,
      })
    } finally {
      release()
    }

    expect(readFileSync(leaseFile())).toEqual(bytesBefore)
  }, 15_000)

  it.runIf(canMakeFilesUnreadable)(
    'refuses an unreadable-epoch beat by name and writes nothing (CR-01)',
    () => {
      const acquired = acquireWriterLease(knowledgeRoot)
      if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
      const bytesBefore = readFileSync(leaseFile())
      chmodSync(join(knowledgeRoot, EPOCH_FILE), 0o000)

      expect(heartbeatLease({ knowledgeRoot, leaseId: acquired.leaseId })).toMatchObject({
        kind: 'refused',
        reason: 'corrupt-epoch-state',
        error: { reason: 'unreadable' },
      })
      expect(readFileSync(leaseFile())).toEqual(bytesBefore)
    },
  )

  /**
   * The decisive CR-01 direction at the escalation gate, driven at the process level.
   *
   * An unreadable `.epoch` used to collapse to "not fresh", which is the same value a genuinely
   * expired lease produces, so a healthy holder inside its own governed mutation became a SIGKILL
   * target on a read error. The refusal must be typed and the holder must be untouched: no signal,
   * no lease rewrite, no epoch rewrite.
   */
  it.runIf(canMakeFilesUnreadable)(
    'refuses instead of escalating when the epoch turns unreadable over a live holder (CR-01)',
    async () => {
      const permitFile = join(root, 'unreadable-epoch-holder.permit')
      const holder = spawnAuthorityHolder(knowledgeRoot, permitFile)
      const holderExit = observeExit(holder)
      await waitForOutput(holder, 'inside\n')
      if (holder.pid === undefined) throw new Error('holder never started')
      const leaseBytesBefore = readFileSync(leaseFile())
      chmodSync(join(knowledgeRoot, EPOCH_FILE), 0o000)

      try {
        expect(acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 })).toMatchObject({
          kind: 'refused',
          reason: 'corrupt-epoch-state',
        })
        expect(holder.exitCode).toBeNull()
        expect(holder.signalCode).toBeNull()
        expect(processIsAliveInTest(holder.pid)).toBe(true)
        expect(readFileSync(leaseFile())).toEqual(leaseBytesBefore)
      } finally {
        chmodSync(join(knowledgeRoot, EPOCH_FILE), 0o600)
      }

      writeFileSync(permitFile, 'resume\n', 'utf8')
      expect(await holderExit).toMatchObject({ code: 0, signal: null })
    },
    25_000,
  )

  /**
   * The accepting control for the leg above: the same escalation schedule, minus the one fact that
   * makes the epoch unreadable. A guard that refused every contender would satisfy the rejecting
   * direction on its own.
   */
  it('still reclaims a TTL-stale epoch-valid holder with no lock contention (accepting control)', () => {
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired writer lease')
    const stale = ageLeaseOnDisk(LEASE_HEARTBEAT_TTL_MS + 5_000)

    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: stale.epoch + 1,
      reclaimed: stale,
    })
  })
})

/**
 * CR-04: the mutation-lock row's generation token authenticates the ROW, not the process that
 * currently occupies the recorded pid. After a crash plus pid reuse, escalation would otherwise be
 * a local arbitrary-process-termination primitive.
 *
 * The lock table's shape is written out literally here on purpose: these cases pin the durable
 * contract a contender reads, independently of whatever the module names its own column.
 */
const LEGACY_MUTATION_LOCK_TABLE = `
  CREATE TABLE IF NOT EXISTS mutation_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation_token TEXT NOT NULL,
    pid INTEGER NOT NULL CHECK (pid > 0),
    acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0)
  ) STRICT
`

/** A token no live process can ever report: the recorded owner is provably not this pid's tenant. */
const DEAD_OWNER_INCARNATION = 'incarnation-of-a-process-that-already-died'

describe('mutation-lock owner process incarnation (CR-04)', () => {
  let root: string
  let knowledgeRoot: string
  const spawned: ChildProcessWithoutNullStreams[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-incarnation-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    for (const child of spawned.splice(0)) {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Already gone; the leg's own assertions own the outcome.
        }
      }
    }
    rmSync(root, { recursive: true, force: true })
  })

  function track(child: ChildProcessWithoutNullStreams): ChildProcessWithoutNullStreams {
    spawned.push(child)
    return child
  }

  function authorityDbPath(): string {
    return join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE)
  }

  function mutationLockColumnNames(): string[] {
    const db = new DatabaseSync(authorityDbPath(), { readOnly: true })
    try {
      return (
        db.prepare("SELECT name FROM pragma_table_info('mutation_lock')").all() as {
          name: string
        }[]
      ).map((column) => column.name)
    } finally {
      db.close()
    }
  }

  function readMutationLockRow(): Record<string, unknown> | undefined {
    const db = new DatabaseSync(authorityDbPath(), { readOnly: true })
    try {
      return db.prepare('SELECT * FROM mutation_lock WHERE id = 1').get() as
        | Record<string, unknown>
        | undefined
    } finally {
      db.close()
    }
  }

  function seedMutationLockRow(row: {
    pid: number
    acquiredAtMs: number
    generationToken: string
    incarnation?: string | null
    legacyShape?: boolean
  }): void {
    mkdirSync(knowledgeRoot, { recursive: true })
    const db = new DatabaseSync(authorityDbPath())
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(LEGACY_MUTATION_LOCK_TABLE)
      const columns = (
        db.prepare("SELECT name FROM pragma_table_info('mutation_lock')").all() as {
          name: string
        }[]
      ).map((column) => column.name)
      if (row.legacyShape === true) {
        db.prepare(`
          INSERT OR REPLACE INTO mutation_lock (id, generation_token, pid, acquired_at_ms)
          VALUES (1, ?, ?, ?)
        `).run(row.generationToken, row.pid, row.acquiredAtMs)
        return
      }
      if (!columns.includes('incarnation')) {
        db.exec('ALTER TABLE mutation_lock ADD COLUMN incarnation TEXT')
      }
      db.prepare(`
        INSERT OR REPLACE INTO mutation_lock (id, generation_token, pid, acquired_at_ms, incarnation)
        VALUES (1, ?, ?, ?, ?)
      `).run(row.generationToken, row.pid, row.acquiredAtMs, row.incarnation ?? null)
    } finally {
      db.close()
    }
  }

  /** Occupy the authority store exactly as a long governed mutation does, from this process. */
  function holdAuthorityTransaction(): () => void {
    const db = new DatabaseSync(authorityDbPath())
    db.exec('PRAGMA busy_timeout = 250')
    db.exec('BEGIN IMMEDIATE')
    let open = true
    return () => {
      if (!open) return
      open = false
      try {
        db.exec('ROLLBACK')
      } finally {
        db.close()
      }
    }
  }

  function leaseOnDisk(): WriterLease {
    return JSON.parse(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')) as WriterLease
  }

  it('exports a process-incarnation helper anchored on the OS-reported start time', () => {
    const surface = publicWriterSurface as unknown as Record<string, unknown>
    expect(surface.resolveProcessIncarnation).toBeTypeOf('function')
    const resolve = surface.resolveProcessIncarnation as (pid: number) => string | undefined

    const own = resolve(process.pid)
    expect(own).toBeTypeOf('string')
    expect(own).toContain(observedProcessStartToken(process.pid))
    expect(resolve(-1)).toBeUndefined()
    expect(resolve(0)).toBeUndefined()
    expect(resolve(2 ** 30)).toBeUndefined()
  })

  it('leaves an unrelated process occupying a reused pid unsignaled while the row is reclaimed', async () => {
    const exitPermit = join(root, 'surrogate.exit')
    const surrogate = track(spawnIdleSurrogate(exitPermit))
    const surrogateExit = observeExit(surrogate)
    await waitForOutput(surrogate, 'surrogate-alive\n')
    if (surrogate.pid === undefined) throw new Error('surrogate never started')

    seedMutationLockRow({
      pid: surrogate.pid,
      acquiredAtMs: Date.now() - 60_000,
      generationToken: 'crashed-original-generation',
      incarnation: DEAD_OWNER_INCARNATION,
    })

    // A transient third-party writer is what pushes the contender onto the escalation path at all.
    const releaseBlockingWrite = holdAuthorityTransaction()
    const contender = track(spawnLeaseAcquirer(knowledgeRoot, 0, 0))
    const contenderStdout = collectStdout(contender)
    const contenderExit = observeExit(contender)
    try {
      await new Promise((resolve) => setTimeout(resolve, 3_000))

      expect(surrogate.signalCode).toBeNull()
      expect(surrogate.exitCode).toBeNull()
      expect(processIsAliveInTest(surrogate.pid)).toBe(true)
    } finally {
      releaseBlockingWrite()
    }

    expect(await contenderExit).toMatchObject({ code: 0, signal: null })
    expect(lastJsonLine(contenderStdout())).toMatchObject({ kind: 'acquired', epoch: 1 })
    expect(processIsAliveInTest(surrogate.pid)).toBe(true)
    expect(surrogate.signalCode).toBeNull()

    writeFileSync(exitPermit, 'exit\n', 'utf8')
    expect(await surrogateExit).toMatchObject({ code: 0, signal: null })
  }, 40_000)

  it('refuses to escalate against an unattributed lock row and never signals its live owner', async () => {
    const startPermit = join(root, 'blocker.start')
    const releasePermit = join(root, 'blocker.release')
    mkdirSync(knowledgeRoot, { recursive: true })
    const blocker = track(
      spawnAuthorityDbBlocker(authorityDbPath(), startPermit, releasePermit),
    )
    const blockerExit = observeExit(blocker)
    if (blocker.pid === undefined) throw new Error('blocker never started')

    seedMutationLockRow({
      pid: blocker.pid,
      acquiredAtMs: Date.now() - 60_000,
      generationToken: 'unattributed-generation',
      incarnation: null,
    })
    writeFileSync(startPermit, 'start\n', 'utf8')
    await waitForOutput(blocker, 'blocking\n')

    const contender = track(spawnLeaseAcquirer(knowledgeRoot, 0, 0))
    const contenderStdout = collectStdout(contender)
    const contenderExit = observeExit(contender)
    await new Promise((resolve) => setTimeout(resolve, 4_000))

    expect(blocker.signalCode).toBeNull()
    expect(blocker.exitCode).toBeNull()
    expect(contender.exitCode).toBeNull()

    writeFileSync(releasePermit, 'release\n', 'utf8')
    expect(await blockerExit).toMatchObject({ code: 0, signal: null })
    expect(await contenderExit).toMatchObject({ code: 0, signal: null })
    expect(lastJsonLine(contenderStdout())).toMatchObject({ kind: 'acquired', epoch: 1 })
  }, 40_000)

  it('records the claimant own start-time token and still kills the exact stale held-section owner', async () => {
    const permitFile = join(root, 'incarnation-control.permit')
    const holder = track(spawnAuthorityHolder(knowledgeRoot, permitFile))
    const holderExit = observeExit(holder)
    await waitForOutput(holder, 'inside\n')
    if (holder.pid === undefined) throw new Error('holder never started')

    const claimed = readMutationLockRow()
    expect(claimed).toMatchObject({ pid: holder.pid })
    expect(String(claimed?.incarnation ?? '')).toContain(observedProcessStartToken(holder.pid))

    writeFileSync(
      join(knowledgeRoot, LEASE_FILE),
      `${JSON.stringify({
        ...leaseOnDisk(),
        heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
      })}\n`,
      'utf8',
    )

    const contender = track(spawnLeaseAcquirer(knowledgeRoot, 0, 0))
    const contenderExit = observeExit(contender)
    expect(await holderExit).toMatchObject({ code: null, signal: 'SIGKILL' })
    expect(await contenderExit).toMatchObject({ code: 0, signal: null })
    expect(leaseOnDisk()).toMatchObject({ pid: contender.pid, epoch: 2 })
  }, 25_000)

  it('fires no takeover one clock step before the deadline and reclaims exactly at it', async () => {
    const bound = 12_000
    const frozenMs = 4_000_000
    const exitPermit = join(root, 'boundary.exit')
    const surrogate = track(spawnIdleSurrogate(exitPermit))
    const surrogateExit = observeExit(surrogate)
    await waitForOutput(surrogate, 'surrogate-alive\n')
    if (surrogate.pid === undefined) throw new Error('surrogate never started')

    mkdirSync(knowledgeRoot, { recursive: true })
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), '1\n', 'utf8')
    const staleLease: WriterLease = {
      leaseId: '11111111-1111-4111-8111-111111111111',
      pid: surrogate.pid,
      epoch: 1,
      heartbeatAtMs: frozenMs - LEASE_HEARTBEAT_TTL_MS,
    }
    writeFileSync(join(knowledgeRoot, LEASE_FILE), `${JSON.stringify(staleLease)}\n`, 'utf8')

    // Both clocks are pinned so the deadline comparison is exact rather than drift-tolerant.
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(frozenMs)
    const lockClock = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(frozenMs)
    try {
      seedMutationLockRow({
        pid: surrogate.pid,
        acquiredAtMs: frozenMs - bound + 1,
        generationToken: 'boundary-generation',
        incarnation: DEAD_OWNER_INCARNATION,
      })

      expect(acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: bound })).toEqual({
        kind: 'held',
        holder: staleLease,
      })

      seedMutationLockRow({
        pid: surrogate.pid,
        acquiredAtMs: frozenMs - bound,
        generationToken: 'boundary-generation',
        incarnation: DEAD_OWNER_INCARNATION,
      })

      expect(
        acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: bound }),
      ).toMatchObject({ kind: 'acquired', epoch: 2, reclaimed: staleLease })
    } finally {
      lockClock.mockRestore()
      wallClock.mockRestore()
    }

    expect(surrogate.signalCode).toBeNull()
    expect(processIsAliveInTest(surrogate.pid)).toBe(true)
    writeFileSync(exitPermit, 'exit\n', 'utf8')
    expect(await surrogateExit).toMatchObject({ code: 0, signal: null })
  }, 25_000)

  it('upgrades a pre-incarnation authority store and leaves its inherited row unattributed', async () => {
    const exitPermit = join(root, 'legacy.exit')
    const surrogate = track(spawnIdleSurrogate(exitPermit))
    const surrogateExit = observeExit(surrogate)
    await waitForOutput(surrogate, 'surrogate-alive\n')
    if (surrogate.pid === undefined) throw new Error('surrogate never started')

    seedMutationLockRow({
      pid: surrogate.pid,
      acquiredAtMs: Date.now(),
      generationToken: 'legacy-generation',
      legacyShape: true,
    })
    expect(mutationLockColumnNames()).not.toContain('incarnation')

    writeFileSync(join(knowledgeRoot, EPOCH_FILE), '1\n', 'utf8')
    const staleLease: WriterLease = {
      leaseId: '22222222-2222-4222-8222-222222222222',
      pid: surrogate.pid,
      epoch: 1,
      heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS - 1,
    }
    writeFileSync(join(knowledgeRoot, LEASE_FILE), `${JSON.stringify(staleLease)}\n`, 'utf8')

    expect(acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 60_000 })).toEqual({
      kind: 'held',
      holder: staleLease,
    })
    expect(mutationLockColumnNames()).toContain('incarnation')
    expect(readMutationLockRow()?.incarnation).toBeNull()
    expect(surrogate.signalCode).toBeNull()

    let claimedRow: Record<string, unknown> | undefined
    const acquired = acquireWriterLease(knowledgeRoot, {
      mutationLockTakeoverMs: 0,
      afterMutationLockAcquired: () => { claimedRow = readMutationLockRow() },
    })

    expect(acquired).toMatchObject({ kind: 'acquired', epoch: 2 })
    expect(claimedRow).toMatchObject({ pid: process.pid })
    expect(String(claimedRow?.incarnation ?? '')).toContain(
      observedProcessStartToken(process.pid),
    )
    expect(surrogate.signalCode).toBeNull()
    expect(processIsAliveInTest(surrogate.pid)).toBe(true)

    writeFileSync(exitPermit, 'exit\n', 'utf8')
    expect(await surrogateExit).toMatchObject({ code: 0, signal: null })
  }, 25_000)

  /**
   * W-06: the schema upgrade is an unserialized check-then-ALTER, so two daemons starting against
   * one legacy store can both decide the column is missing.
   *
   * The race is driven deterministically rather than hoped for: the winner holds the write
   * transaction, this process enters the upgrade and blocks inside `ALTER` (its busy timeout is
   * 2 s), and the winner adds the column and commits INSIDE that window. The loser then wakes,
   * re-prepares against the new schema, and gets `duplicate column name` — an error `isSqliteBusy`
   * does not match, so before the fix it escaped as a raw SqliteError and killed a starting daemon.
   *
   * The `elapsedMs` assertion is the leg's own precondition, not decoration: an upgrade that
   * returned promptly never blocked, which means the window was missed and the case proved nothing.
   */
  it('completes a schema upgrade that loses the ALTER race to another connection (W-06)', async () => {
    seedMutationLockRow({
      pid: process.pid,
      acquiredAtMs: Date.now() - 600_000,
      generationToken: 'pre-upgrade-generation',
      legacyShape: true,
    })
    expect(mutationLockColumnNames()).not.toContain('incarnation')

    const winnerHoldMs = 1_500
    const winner = track(spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '--eval', `
        const { DatabaseSync } = await import('node:sqlite');
        const { writeFileSync } = await import('node:fs');
        const db = new DatabaseSync(process.env.AGENT_QA_LEASE_TEST_DB);
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec('BEGIN IMMEDIATE');
        writeFileSync(process.env.AGENT_QA_LEASE_TEST_HOLD_MARKER, 'holding\\n', 'utf8');
        const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        Atomics.wait(wait, 0, 0, Number(process.env.AGENT_QA_LEASE_TEST_HOLD_MS));
        db.exec('ALTER TABLE mutation_lock ADD COLUMN incarnation TEXT');
        db.exec('COMMIT');
        db.close();
      `],
      {
        env: {
          ...process.env,
          AGENT_QA_LEASE_TEST_DB: authorityDbPath(),
          AGENT_QA_LEASE_TEST_HOLD_MARKER: join(root, 'upgrade-winner.holding'),
          AGENT_QA_LEASE_TEST_HOLD_MS: String(winnerHoldMs),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ))
    const winnerExit = observeExit(winner)
    await waitForFileInTest(join(root, 'upgrade-winner.holding'), 15_000)

    const startedAtNs = process.hrtime.bigint()
    const loser = acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 })
    const blockedForMs = elapsedMs(startedAtNs)

    expect(blockedForMs).toBeGreaterThan(winnerHoldMs * 0.6)
    expect(loser.kind).not.toBe('refused')
    expect(mutationLockColumnNames()).toContain('incarnation')
    expect(await winnerExit).toMatchObject({ code: 0, signal: null })

    // The postcondition the upgrade exists for: both connections now transact normally.
    expect(acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 }).kind).not.toBe('refused')
  }, 40_000)

  /**
   * The other half of W-06, and the one the duplicate-column case cannot reach: the catch must be
   * a CLASSIFIER, not a swallow.
   *
   * Found by probing my own control — a `catch { }` that discards every ALTER failure passes the
   * race case above, because that case only ever asks whether the benign error was tolerated. Here
   * the upgrade fails for a reason that is NOT benign (the write lock is held past the whole
   * acquisition budget), and the difference is observable: keeping the error's meaning yields the
   * typed unreclaimable refusal, while discarding it lets the flow proceed onto a table that still
   * has no `incarnation` column and die there with a raw SQL logic error.
   */
  it('keeps a non-duplicate upgrade failure meaningful instead of swallowing it (W-06)', () => {
    seedMutationLockRow({
      pid: process.pid,
      acquiredAtMs: Date.now() - 600_000,
      generationToken: 'unupgradable-generation',
      legacyShape: true,
    })
    expect(mutationLockColumnNames()).not.toContain('incarnation')

    const blocker = new DatabaseSync(authorityDbPath())
    blocker.exec('PRAGMA busy_timeout = 250')
    blocker.exec('BEGIN IMMEDIATE')
    try {
      expect(
        acquireWithIncarnationObserver(knowledgeRoot, {
          acquireDeadlineMs: 3_000,
          mutationLockTakeoverMs: 0,
        }),
      ).toMatchObject({ kind: 'refused', reason: 'mutation-lock-unreclaimable' })
      // The upgrade genuinely did not happen, and the flow reported that rather than assuming it.
      expect(mutationLockColumnNames()).not.toContain('incarnation')
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
    }
  }, 40_000)

  /** A repeated upgrade over an already-upgraded store stays a no-op (the cheap half of W-06). */
  it('leaves an already-upgraded store untouched when the upgrade runs again (W-06)', () => {
    seedMutationLockRow({
      pid: process.pid,
      acquiredAtMs: Date.now() - 600_000,
      generationToken: 'already-upgraded-generation',
      incarnation: null,
    })
    expect(mutationLockColumnNames()).toContain('incarnation')

    for (let round = 0; round < 3; round += 1) {
      expect(acquireWriterLease(knowledgeRoot, { mutationLockTakeoverMs: 0 }).kind).not.toBe(
        'refused',
      )
    }
    expect(mutationLockColumnNames().filter((name) => name === 'incarnation')).toHaveLength(1)
  }, 25_000)
})

/**
 * W-05: what an escalated takeover COSTS the caller that asked for the lock.
 *
 * Both legs use the one shape that makes the post-signal wait genuinely run: an owner whose parent
 * never reaps it. `SIGKILL` cannot be survived, but a killed child of a process that never returns
 * to its event loop stays an unreaped zombie, and `kill(pid, 0)` keeps answering "alive" for as
 * long as that parent lives. This is not a contrived shape — a daemon spinning synchronously on its
 * main thread is precisely the V-02 finding this phase reproduced, and its children are precisely
 * these zombies.
 */
describe('escalation cost and budget on the acquisition hot path (W-05)', () => {
  let root: string
  let knowledgeRoot: string
  const spawned: ChildProcessWithoutNullStreams[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-escalation-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(knowledgeRoot, { recursive: true })
  })

  afterEach(() => {
    for (const child of spawned.splice(0)) {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Already gone; the leg's own assertions own the outcome.
        }
      }
    }
    rmSync(root, { recursive: true, force: true })
  })

  function track(child: ChildProcessWithoutNullStreams): ChildProcessWithoutNullStreams {
    spawned.push(child)
    return child
  }

  function authorityDbPath(): string {
    return join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE)
  }

  /**
   * Spawn a mutation-lock owner whose parent will never reap it.
   *
   * The nanny blocks in `Atomics.wait` forever, so libuv never runs the loop iteration that would
   * `waitpid` the dead grandchild. Returns the grandchild's pid — the owner the lock row names.
   */
  async function spawnNonReapingOwner(): Promise<number> {
    const pidFile = join(root, 'orphan.pid')
    track(spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '--eval', `
        const { spawn } = await import('node:child_process');
        const { writeFileSync } = await import('node:fs');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        writeFileSync(process.env.AGENT_QA_LEASE_TEST_PID_FILE, String(child.pid), 'utf8');
        const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        Atomics.wait(wait, 0, 0, 300000);
      `],
      {
        env: { ...process.env, AGENT_QA_LEASE_TEST_PID_FILE: pidFile },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ))
    await waitForFileInTest(pidFile, 15_000)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`bad orphan pid: ${pid}`)
    // The owner must be attributable, or the escalation refuses and never reaches the wait at all.
    await waitForConditionInTest(() => processState(pid) === 'S' || processState(pid) === 'R', 15_000)
    return pid
  }

  /** Seed a lock row naming `pid` with the incarnation the pid genuinely reports right now. */
  function seedAttributedOwnerRow(pid: number, generationToken: string): void {
    const resolve = (publicWriterSurface as unknown as Record<string, unknown>)
      .resolveProcessIncarnation as (candidate: number) => string | undefined
    const incarnation = resolve(pid)
    if (incarnation === undefined) throw new Error(`pid ${pid} is not attributable`)
    const db = new DatabaseSync(authorityDbPath())
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS mutation_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          generation_token TEXT NOT NULL,
          pid INTEGER NOT NULL CHECK (pid > 0),
          acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
          incarnation TEXT
        ) STRICT
      `)
      db.prepare(`
        INSERT OR REPLACE INTO mutation_lock
          (id, generation_token, pid, acquired_at_ms, incarnation)
        VALUES (1, ?, ?, ?, ?)
      `).run(generationToken, pid, Date.now() - 600_000, incarnation)
    } finally {
      db.close()
    }
  }

  /** Occupy the store's write transaction so the claim is forced onto the escalation path. */
  function holdAuthorityTransaction(): () => void {
    const db = new DatabaseSync(authorityDbPath())
    db.exec('PRAGMA busy_timeout = 250')
    db.exec('BEGIN IMMEDIATE')
    let open = true
    return () => {
      if (!open) return
      open = false
      try {
        db.exec('ROLLBACK')
      } finally {
        db.close()
      }
    }
  }

  it.runIf(process.platform !== 'win32')(
    'charges the post-signal exit wait to the acquisition budget instead of adding to it (W-05)',
    async () => {
      const orphanPid = await spawnNonReapingOwner()
      seedAttributedOwnerRow(orphanPid, 'never-reaped-generation')
      const releaseBlockingWrite = holdAuthorityTransaction()

      try {
        const source = `
          const { acquireWriterLease } = await import(${JSON.stringify(WRITER_LEASE_MODULE_URL)});
          const startedAtNs = process.hrtime.bigint();
          const outcome = acquireWriterLease(process.env.AGENT_QA_LEASE_TEST_ROOT, {
            acquireDeadlineMs: 2000,
            mutationLockTakeoverMs: 0,
          });
          const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
          process.stdout.write(JSON.stringify({
            kind: outcome.kind,
            reason: outcome.reason,
            attempts: outcome.attempts,
            elapsedMs,
          }) + '\\n');
        `
        const contender = track(spawn(
          process.execPath,
          ['--experimental-strip-types', '--input-type=module', '--eval', source],
          {
            env: { ...process.env, AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        ))
        const contenderStdout = collectStdout(contender)
        expect(await observeExit(contender)).toMatchObject({ code: 0, signal: null })
        const outcome = lastJsonLine(contenderStdout()) as { kind: string; elapsedMs: number }

        expect(outcome).toMatchObject({ kind: 'refused', reason: 'mutation-lock-unreclaimable' })
        // The escalation genuinely reached the signal AND the target genuinely never exited: an
        // external kernel fact, not the module's own account of what it did.
        expect(processState(orphanPid)).toBe('Z')
        // The refusal must arrive on the caller's budget. An unbudgeted wait adds the full
        // MUTATION_LOCK_TERMINATION_TIMEOUT_MS (5 s) on top of the 2 s deadline.
        expect(outcome.elapsedMs).toBeLessThan(5_000)
      } finally {
        releaseBlockingWrite()
      }
    },
    90_000,
  )

  it.runIf(process.platform !== 'win32')(
    'resolves the owner incarnation once per escalated attempt, never inside the exit wait (W-05)',
    async () => {
      const orphanPid = await spawnNonReapingOwner()
      seedAttributedOwnerRow(orphanPid, 'resolution-count-generation')
      const releaseBlockingWrite = holdAuthorityTransaction()

      try {
        const resolvedPids: number[] = []
        const outcome = acquireWithIncarnationObserver(knowledgeRoot, {
          acquireDeadlineMs: 8_000,
          mutationLockTakeoverMs: 0,
          onProcessIncarnationResolved: (pid) => { resolvedPids.push(pid) },
        })

        if (outcome.kind !== 'refused' || outcome.reason !== 'mutation-lock-unreclaimable') {
          throw new Error(`expected an unreclaimable refusal, received ${outcome.kind}`)
        }
        expect(processState(orphanPid)).toBe('Z')
        const ownerResolutions = resolvedPids.filter((pid) => pid === orphanPid)
        // The 386-31 mandate: the identity is re-read immediately before every signal decision.
        expect(ownerResolutions.length).toBeGreaterThanOrEqual(1)
        // ...and nowhere else. The exit wait polls kill(pid, 0); moving incarnation resolution
        // into that loop turns one shell fork per attempt into one per 10 ms poll.
        expect(ownerResolutions.length).toBeLessThanOrEqual(outcome.attempts)
      } finally {
        releaseBlockingWrite()
      }
    },
    90_000,
  )
})

/**
 * V-02: the acquisition retry loop must end, and the bound must be anchored OUTSIDE the lease
 * vocabulary it is arbitrating.
 *
 * The verifier reproduced an unbounded synchronous spin here with two probes. Both are converted
 * below into rejecting tests, and both keep their adversary ALIVE for the entire observation
 * window — a probe whose blocker dies early proves nothing about a bound. The contender runs in a
 * child process so a still-defective build fails as "no outcome within the watchdog" rather than
 * hanging the suite, which is exactly how the verifier had to observe it (SIGKILL at 25 s / 100 s).
 */
describe('writer lease acquisition deadline against an unreclaimable owner (V-02)', () => {
  let root: string
  let knowledgeRoot: string
  const spawned: ChildProcessWithoutNullStreams[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-deadline-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(knowledgeRoot, { recursive: true })
  })

  afterEach(() => {
    for (const child of spawned.splice(0)) {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Already gone; the leg's own assertions own the outcome.
        }
      }
    }
    rmSync(root, { recursive: true, force: true })
  })

  function track(child: ChildProcessWithoutNullStreams): ChildProcessWithoutNullStreams {
    spawned.push(child)
    return child
  }

  interface ContenderOutcome {
    kind: string
    reason?: string
    message?: string
    attempts?: number
    waitedMs?: number
    elapsedMs: number
  }

  /**
   * Acquire in a child so an unbounded build is observable as a watchdog miss.
   *
   * The child reports the acquisition's own diagnostics AND its independently measured wall-clock
   * elapsed time, so "returned" and "returned within the bound" are separate assertions rather
   * than one claim resting on the module's own accounting.
   */
  function spawnBoundedContender(
    acquireDeadlineMs: number,
  ): ChildProcessWithoutNullStreams {
    const source = `
      const { acquireWriterLease } = await import(${JSON.stringify(WRITER_LEASE_MODULE_URL)});
      const startedAtNs = process.hrtime.bigint();
      const outcome = acquireWriterLease(process.env.AGENT_QA_LEASE_TEST_ROOT, {
        acquireDeadlineMs: Number(process.env.AGENT_QA_LEASE_TEST_DEADLINE_MS),
      });
      const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
      process.stdout.write(JSON.stringify({
        kind: outcome.kind,
        reason: outcome.reason,
        message: outcome.error === undefined ? undefined : outcome.error.message,
        attempts: outcome.attempts,
        waitedMs: outcome.waitedMs,
        elapsedMs,
      }) + '\\n');
    `
    return track(spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '--eval', source],
      {
        env: {
          ...process.env,
          AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot,
          AGENT_QA_LEASE_TEST_DEADLINE_MS: String(acquireDeadlineMs),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ))
  }

  /** Fail as a missed watchdog rather than as a suite hang when the loop is still unbounded. */
  function awaitContenderOutcome(
    child: ChildProcessWithoutNullStreams,
    watchdogMs: number,
  ): Promise<ContenderOutcome> {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        reject(new Error(
          `contender produced no acquisition outcome within ${watchdogMs}ms `
          + '(the retry loop is unbounded)',
        ))
      }, watchdogMs)
      timer.unref()
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
        if (!stdout.includes('\n')) return
        clearTimeout(timer)
        resolve(JSON.parse(stdout.split('\n')[0] ?? '') as ContenderOutcome)
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (stdout.includes('\n')) return
        clearTimeout(timer)
        reject(new Error(`contender exited ${code} with no outcome: ${stderr}`))
      })
    })
  }

  function authorityDbPath(): string {
    return join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE)
  }

  function seedUnattributedMutationLockRow(pid: number): void {
    const db = new DatabaseSync(authorityDbPath())
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS mutation_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          generation_token TEXT NOT NULL,
          pid INTEGER NOT NULL CHECK (pid > 0),
          acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
          incarnation TEXT
        ) STRICT
      `)
      db.prepare(`
        INSERT OR REPLACE INTO mutation_lock
          (id, generation_token, pid, acquired_at_ms, incarnation)
        VALUES (1, ?, ?, ?, NULL)
      `).run('unattributable-generation', pid, Date.now())
    } finally {
      db.close()
    }
  }

  /** Keep the published lease genuinely fresh from another process for the observation window. */
  function spawnLeaseBeater(leaseId: string): ChildProcessWithoutNullStreams {
    const source = `
      const { readFileSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const file = join(process.env.AGENT_QA_LEASE_TEST_ROOT, '.lease');
      const leaseId = process.env.AGENT_QA_LEASE_TEST_LEASE_ID;
      const write = () => {
        const lease = JSON.parse(readFileSync(file, 'utf8'));
        if (lease.leaseId !== leaseId) return;
        writeFileSync(
          file,
          JSON.stringify({ ...lease, heartbeatAtMs: Date.now() }) + '\\n',
          'utf8',
        );
      };
      write();
      process.stdout.write('beating\\n');
      setInterval(write, 200);
    `
    return track(spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '--eval', source],
      {
        env: {
          ...process.env,
          AGENT_QA_LEASE_TEST_ROOT: knowledgeRoot,
          AGENT_QA_LEASE_TEST_LEASE_ID: leaseId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ))
  }

  it('refuses by name within the deadline against an unattributable live lock owner (Probe A)', async () => {
    const startPermit = join(root, 'probe-a.start')
    const releasePermit = join(root, 'probe-a.release')
    const blocker = track(spawnAuthorityDbBlocker(authorityDbPath(), startPermit, releasePermit))
    if (blocker.pid === undefined) throw new Error('probe A blocker never started')

    // A NULL-incarnation row naming the live blocker: unattributable, so escalation must refuse,
    // and no lease file exists, so the busy-catch has no `held` exit either.
    seedUnattributedMutationLockRow(blocker.pid)
    writeFileSync(startPermit, 'go\n', 'utf8')
    await waitForOutput(blocker, 'blocking\n')

    const contender = spawnBoundedContender(2_000)
    const outcome = await awaitContenderOutcome(contender, 30_000)

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'mutation-lock-unreclaimable',
    })
    expect(outcome.message).toContain('mutation-lock-unreclaimable')
    expect(outcome.attempts).toBeGreaterThan(0)
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(2_000)
    expect(outcome.elapsedMs).toBeLessThan(25_000)
    // The whole point of refusing rather than escalating: the unattributable owner is untouched.
    expect(blocker.exitCode).toBeNull()
    expect(blocker.signalCode).toBeNull()
    expect(processIsAliveInTest(blocker.pid)).toBe(true)

    writeFileSync(releasePermit, 'release\n', 'utf8')
  }, 60_000)

  it('refuses by name within the deadline against a beaten epoch-invalid lease (Probe B)', async () => {
    const permitFile = join(root, 'probe-b.permit')
    const holder = track(spawnAuthorityHolder(knowledgeRoot, permitFile))
    await waitForOutput(holder, 'inside\n')
    if (holder.pid === undefined) throw new Error('probe B holder never started')

    const lease = JSON.parse(
      readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8'),
    ) as WriterLease
    // The verifier's decisive shape, carried across the mechanism change: the published lease
    // names a superseded epoch while a live writer keeps beating it, so the epoch-strict
    // busy-catch will never accept it as `held` and only the deadline can end the wait.
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), `${lease.epoch + 1}\n`, 'utf8')
    const renewer = spawnLeaseBeater(lease.leaseId)
    await waitForOutput(renewer, 'beating\n')

    const contender = spawnBoundedContender(2_000)
    const outcome = await awaitContenderOutcome(contender, 30_000)

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'mutation-lock-unreclaimable',
    })
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(2_000)
    expect(outcome.elapsedMs).toBeLessThan(25_000)
    // Both adversaries held the state for the entire window and neither was signalled.
    expect(holder.exitCode).toBeNull()
    expect(holder.signalCode).toBeNull()
    expect(renewer.exitCode).toBeNull()
    expect(renewer.signalCode).toBeNull()
    expect(processIsAliveInTest(holder.pid)).toBe(true)

    writeFileSync(permitFile, 'resume\n', 'utf8')
  }, 60_000)

  it('still acquires when the blocking owner releases before the deadline (accepting control)', async () => {
    const startPermit = join(root, 'control.start')
    const releasePermit = join(root, 'control.release')
    // No unattributable row here: the owner is merely SLOW, not unreclaimable. This is the exact
    // schedule of Probe A minus the one fact that makes escalation impossible.
    const blocker = track(spawnAuthorityDbBlocker(authorityDbPath(), startPermit, releasePermit))
    writeFileSync(startPermit, 'go\n', 'utf8')
    await waitForOutput(blocker, 'blocking\n')

    const contender = spawnBoundedContender(20_000)
    const releaseTimer = setTimeout(() => {
      writeFileSync(releasePermit, 'release\n', 'utf8')
    }, 1_500)
    releaseTimer.unref()

    const outcome = await awaitContenderOutcome(contender, 40_000)

    // The deadline is an exit for the unreclaimable case only; a bound that refuses a recoverable
    // owner would be a blanket refusal, which is the wrong fix wearing the right shape.
    expect(outcome.kind).toBe('acquired')
    expect(outcome.elapsedMs).toBeLessThan(20_000)
  }, 60_000)
})
