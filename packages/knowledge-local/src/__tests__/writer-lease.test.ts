import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
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
