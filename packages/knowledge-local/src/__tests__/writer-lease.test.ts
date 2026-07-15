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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acquireWriterLease,
  assertEpochCurrent,
  EPOCH_FILE,
  heartbeatLease,
  isLeaseStale,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  readCurrentEpoch,
  releaseLease,
  type WriterLease,
} from '../lease/writer-lease.js'

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

  it('reads missing or malformed epoch bytes as the pre-acquire epoch zero', () => {
    expect(readCurrentEpoch(knowledgeRoot)).toBe(0)

    mkdirSync(knowledgeRoot, { recursive: true })
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), 'not-an-integer\n', 'utf8')

    expect(readCurrentEpoch(knowledgeRoot)).toBe(0)
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
