import { appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { canonicalJson } from '@vostride/agent-qa-eval'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { MarkReceiptSchema, type MarkAddress, type MarkReceipt } from '@vostride/agent-qa-schema'

export const MARKS_LEDGER_FILE = 'marks.jsonl'
export const MARKS_LEDGER_LOCK_FILE = 'marks.jsonl.lock'
const LOCK_WAIT_MS = 10_000
const LOCK_RETRY_MS = 50

export class MarkLedgerBusyError extends Error {
  constructor() {
    super('Mark ledger is busy; retry the mark after the current transaction finishes')
    this.name = 'MarkLedgerBusyError'
  }
}

export class MarkLedgerCorruptError extends Error {
  constructor(readonly line: number) {
    // Never echo malformed user text or parser diagnostics into a host surface.
    super(`Mark ledger is corrupt at line ${line}`)
    this.name = 'MarkLedgerCorruptError'
  }
}

export class MarkLedgerNoRunError extends Error {
  constructor() {
    super('run-not-found: mark ledger requires a completed run handoff')
    this.name = 'MarkLedgerNoRunError'
  }
}

function addressKey(address: MarkAddress): string {
  return `${address.testIndex}:${address.stepIndex ?? 'run'}`
}

/** Gate-side runtime ledger. The proposer reader entry never exports this store. */
export class FsMarkLedger {
  private readonly dir: string
  private readonly file: string
  private readonly lock: string
  private readonly runId: string
  private readonly runSlug: string

  constructor(config: { root: string; runId: string }) {
    this.runId = config.runId
    this.runSlug = slugBranch(config.runId)
    this.dir = join(config.root, RUNS_SUBDIR, this.runSlug)
    this.file = join(this.dir, MARKS_LEDGER_FILE)
    this.lock = join(this.dir, MARKS_LEDGER_LOCK_FILE)
  }

  read(): MarkReceipt[] {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (text === '') return []
    const lines = text.split('\n')
    // A missing terminator may be a torn append; concatenating another receipt would corrupt it.
    if (lines.pop() !== '') throw new MarkLedgerCorruptError(lines.length + 1)
    return lines.map((line, index) => {
      try {
        const receipt = MarkReceiptSchema.parse(JSON.parse(line))
        if (receipt.ordinal !== index + 1 || receipt.runId !== this.runId || receipt.runSlug !== this.runSlug) {
          throw new Error('ledger identity or ordinal mismatch')
        }
        return receipt
      } catch {
        throw new MarkLedgerCorruptError(index + 1)
      }
    })
  }

  latestPerAddress(): MarkReceipt[] {
    const latest = new Map<string, MarkReceipt>()
    for (const receipt of this.read()) {
      const key = addressKey(receipt)
      if ((latest.get(key)?.ordinal ?? 0) < receipt.ordinal) latest.set(key, receipt)
    }
    return [...latest.values()].sort((a, b) =>
      a.testIndex - b.testIndex || (a.stepIndex ?? -1) - (b.stepIndex ?? -1),
    )
  }

  latestFor(address: MarkAddress): MarkReceipt | undefined {
    if (address.runId !== this.runId) return undefined
    return this.latestPerAddress().find(receipt => addressKey(receipt) === addressKey(address)
      && (address.testId === undefined || receipt.testId === address.testId))
  }

  async transact(
    fn: (nextOrdinal: number) => Promise<Omit<MarkReceipt, 'ordinal'> | undefined>,
  ): Promise<MarkReceipt | undefined> {
    if (!existsSync(join(this.dir, HANDOFF_FILE))) throw new MarkLedgerNoRunError()
    const started = Date.now()
    let fd: number
    while (true) {
      try {
        fd = openSync(this.lock, 'wx')
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const remaining = LOCK_WAIT_MS - (Date.now() - started)
        if (remaining <= 0) throw new MarkLedgerBusyError()
        await new Promise(resolve => setTimeout(resolve, Math.min(LOCK_RETRY_MS, remaining)))
      }
    }
    try {
      // Freeze and draft inside this callback: the next host sees the entire prior receipt.
      const nextOrdinal = this.read().length + 1
      const record = await fn(nextOrdinal)
      if (record === undefined) return undefined
      const receipt = MarkReceiptSchema.parse({ ...record, ordinal: nextOrdinal })
      if (receipt.runId !== this.runId || receipt.runSlug !== this.runSlug) {
        throw new Error('mark receipt does not belong to this run ledger')
      }
      appendFileSync(this.file, `${canonicalJson(receipt)}\n`, 'utf8')
      return receipt
    } finally {
      try { closeSync(fd) } finally { unlinkSync(this.lock) }
    }
  }

  append(record: Omit<MarkReceipt, 'ordinal'>): Promise<MarkReceipt | undefined> {
    return this.transact(async () => record)
  }
}
