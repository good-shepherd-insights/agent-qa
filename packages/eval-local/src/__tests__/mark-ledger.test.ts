import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FsHandoffStore, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { asRunId, type MarkReceipt } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FsMarkLedger, MARKS_LEDGER_FILE, MARKS_LEDGER_LOCK_FILE,
  MarkLedgerBusyError, MarkLedgerCorruptError, MarkLedgerNoRunError,
} from '../mark-ledger.js'
import { makeLocalV2Handoff } from './fixtures/local-handoff-fixture.js'

describe('FsMarkLedger', () => {
  let root: string
  let ledger: FsMarkLedger
  let dir: string
  let record: Omit<MarkReceipt, 'ordinal'>
  const runId = asRunId('run-mark-ledger')
  const runSlug = slugBranch(runId)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mark-ledger-'))
    dir = join(root, RUNS_SUBDIR, runSlug)
    const handoff = { ...makeLocalV2Handoff(), runId }
    new FsHandoffStore({ root, runId }).save(handoff)
    ledger = new FsMarkLedger({ root, runId })
    record = {
      schemaVersion: 1, markId: 'mark_0123456789ab', runId, runSlug, testIndex: 0,
      kind: 'false-fail', origin: 'user', markedAt: 0, gold: [],
      disposition: { kind: 'confirmed-bug', confirmedRecords: 0 },
      evidence: { confirmed: 0, overturned: 0 },
    }
  })
  afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }) })

  it('appends ordinals 1/2/3, preserves prior bytes and selects the latest address independent of time', async () => {
    expect(ledger.read()).toEqual([])
    expect(await ledger.append({ ...record, markedAt: 100 })).toMatchObject({ ordinal: 1 })
    const firstBytes = readFileSync(join(dir, MARKS_LEDGER_FILE), 'utf8')
    expect(await ledger.append({ ...record, stepIndex: 2 })).toMatchObject({ ordinal: 2 })
    expect(await ledger.append(record)).toMatchObject({ ordinal: 3 })
    expect(readFileSync(join(dir, MARKS_LEDGER_FILE), 'utf8').startsWith(firstBytes)).toBe(true)
    expect(ledger.read().map(row => row.ordinal)).toEqual([1, 2, 3])
    expect(ledger.latestPerAddress().map(row => row.ordinal)).toEqual([3, 2])
    expect(ledger.latestFor({ runId, testIndex: 0 })?.ordinal).toBe(3)
    expect(ledger.latestFor({ runId, testIndex: 0, stepIndex: 2 })?.ordinal).toBe(2)
    expect(ledger.latestFor({ runId: asRunId('other-run'), testIndex: 0 })).toBeUndefined()
  })

  it.each([
    { origin: 'agent' }, { schemaVersion: 2 }, { ordinal: 1 }, { runId: 'other-run' },
    { runSlug: 'other-run' }, { unexpected: true },
  ])('refuses corrupt or foreign line 2 with safe typed diagnostics: %j', async patch => {
    await ledger.append(record)
    writeFileSync(join(dir, MARKS_LEDGER_FILE), `${JSON.stringify({ ...record, ordinal: 2, ...patch })}\n`, { flag: 'a' })
    expect(() => ledger.read()).toThrow(MarkLedgerCorruptError)
    expect(() => ledger.read()).toThrow('line 2')
    const fn = vi.fn(async () => record)
    await expect(ledger.transact(fn)).rejects.toThrow(MarkLedgerCorruptError)
    expect(fn).not.toHaveBeenCalled()
    expect(existsSync(join(dir, MARKS_LEDGER_LOCK_FILE))).toBe(false)
  })

  it.each(['not JSON\n', '\n', '{"credential":"never-echo-this"}\n', JSON.stringify({ ordinal: 1 })])(
    'refuses malformed, empty and unterminated lines without echoing raw bytes', text => {
      writeFileSync(join(dir, MARKS_LEDGER_FILE), text)
      expect(() => ledger.read()).toThrow('Mark ledger is corrupt at line 1')
    },
  )

  it('never creates a ledger or run directory without a handoff', async () => {
    const missing = new FsMarkLedger({ root, runId: 'absent-run' })
    await expect(missing.append(record)).rejects.toThrow(MarkLedgerNoRunError)
    expect(existsSync(join(root, RUNS_SUBDIR, 'absent-run'))).toBe(false)
  })

  it('serializes two same-tick transactions across store instances and exposes prior completion', async () => {
    const second = new FsMarkLedger({ root, runId })
    const observed: number[] = []
    const results = await Promise.all([
      ledger.transact(async nextOrdinal => {
        observed.push(nextOrdinal)
        await new Promise(resolve => setTimeout(resolve, 100))
        return record
      }),
      second.transact(async nextOrdinal => {
        observed.push(nextOrdinal)
        expect(second.latestFor({ runId, testIndex: 0 })?.ordinal).toBe(1)
        return { ...record, markId: 'mark_abcdef012345' }
      }),
    ])
    expect(results.map(row => row?.ordinal)).toEqual([1, 2])
    expect(observed).toEqual([1, 2])
    expect(ledger.read()).toHaveLength(2)
    expect(existsSync(join(dir, MARKS_LEDGER_LOCK_FILE))).toBe(false)
  })

  it('a throwing callback appends nothing and releases its lock', async () => {
    await expect(ledger.transact(async () => { throw new Error('draft failed') })).rejects.toThrow('draft failed')
    expect(ledger.read()).toEqual([])
    expect(existsSync(join(dir, MARKS_LEDGER_LOCK_FILE))).toBe(false)
    expect(await ledger.append(record)).toMatchObject({ ordinal: 1 })
  })
  it('resumes a strictly validated intent at the same ordinal and rejects a different request', async () => {
    const proposalUuid = '01234567-89ab-4def-8123-456789abcdef'
    await expect(ledger.transact(async ordinal => {
      ledger.prepareIntent({ ...record, ordinal }, proposalUuid)
      throw new Error('after intent')
    })).rejects.toThrow('after intent')
    await expect(ledger.transact(async ordinal => {
      ledger.prepareIntent({ ...record, ordinal, kind: 'false-pass' }, proposalUuid)
      return undefined
    })).rejects.toThrow('unfinished mark')
    const recovered = await ledger.transact(async ordinal => {
      const intent = ledger.prepareIntent({ ...record, markId: 'mark_abcdef012345', ordinal }, proposalUuid)
      expect(intent.mark.markId).toBe(record.markId)
      ledger.checkpointIntent({ ...intent, stage: 'drafted' })
      return intent.mark
    })
    expect(recovered).toMatchObject({ ordinal: 1, markId: record.markId })
    expect(ledger.read()).toEqual([recovered])
    expect(existsSync(join(dir, 'mark-intent.json'))).toBe(false)
  })
  it('refuses malformed intent bytes before invoking any side effect', async () => {
    writeFileSync(join(dir, 'mark-intent.json'), JSON.stringify({ schemaVersion: 1, mark: record, extra: true }))
    const fn = vi.fn(async () => record)
    await expect(ledger.transact(fn)).rejects.toThrow(MarkLedgerCorruptError)
    expect(fn).not.toHaveBeenCalled()
    expect(ledger.read()).toEqual([])
  })

  it('a no-op callback consumes no ordinal and appends no file', async () => {
    expect(await ledger.transact(async () => undefined)).toBeUndefined()
    expect(existsSync(join(dir, MARKS_LEDGER_FILE))).toBe(false)
    expect(await ledger.append(record)).toMatchObject({ ordinal: 1 })
  })

  it('invalid callback records release the lock without a write', async () => {
    await expect(ledger.append({ ...record, runId: asRunId('other-run') })).rejects.toThrow('does not belong')
    await expect(ledger.append({ ...record, origin: 'agent' as 'user' })).rejects.toThrow()
    expect(ledger.read()).toEqual([])
    expect(await ledger.append(record)).toMatchObject({ ordinal: 1 })
  })

  it('retries a held lock every 50 ms and refuses at exactly 10 seconds without deleting it', async () => {
    vi.useFakeTimers()
    writeFileSync(join(dir, MARKS_LEDGER_LOCK_FILE), 'external holder')
    const fn = vi.fn(async () => record)
    let settled = false
    const result = ledger.transact(fn).catch(error => { settled = true; return error })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBeInstanceOf(MarkLedgerBusyError)
    expect(fn).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, MARKS_LEDGER_LOCK_FILE), 'utf8')).toBe('external holder')
    expect(ledger.read()).toEqual([])
  })
})
