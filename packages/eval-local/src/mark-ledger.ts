import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { canonicalJson } from '@vostride/agent-qa-eval'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { AuthoringDraftEditOutputSchema, ImprovementPlanSchema, MarkReceiptSchema, type MarkAddress, type MarkReceipt } from '@vostride/agent-qa-schema'
import { z } from 'zod'
import { acquireMarkLock } from './mark-lock.js'

export const MARKS_LEDGER_FILE = 'marks.jsonl'
export const MARKS_LEDGER_LOCK_FILE = 'marks.jsonl.lock'
const intentSchema = z.object({
  schemaVersion: z.literal(1), mark: MarkReceiptSchema,
  stage: z.enum(['prepared', 'evidence', 'drafted']),
  proposalUuid: z.uuid(),
  plan: ImprovementPlanSchema.optional(),
  testDraft: AuthoringDraftEditOutputSchema.optional(),
}).strict()
type MarkIntent = z.infer<typeof intentSchema>

function atomicPublish(path: string, text: string): void {
  const staged = `${path}.pending`
  const fd = openSync(staged, 'w', 0o600)
  try { writeFileSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(staged, path)
}

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
  private inTransaction = false
  private intentValue: MarkIntent | undefined

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

  /** Private resumable state is admitted only while this run's existing lock is held. */
  prepareIntent(mark: MarkReceipt, proposalUuid: string): MarkIntent {
    if (!this.inTransaction) throw new Error('mark intent requires the run transaction')
    const prior = this.intentValue
    if (prior !== undefined) {
      const request = (value: MarkReceipt) => ({ runId: value.runId, testIndex: value.testIndex,
        testId: value.testId, stepIndex: value.stepIndex, kind: value.kind, note: value.note,
        correctedExpectation: value.correctedExpectation, correctedAction: value.correctedAction })
      if (canonicalJson(request(prior.mark)) !== canonicalJson(request(mark))) {
        throw new Error('An unfinished mark must be retried with its original address and correction')
      }
      return prior
    }
    return this.checkpointIntent({ schemaVersion: 1, mark, proposalUuid, stage: 'prepared' })
  }

  checkpointIntent(value: MarkIntent): MarkIntent {
    if (!this.inTransaction) throw new Error('mark intent requires the run transaction')
    const intent = intentSchema.parse(value)
    if (intent.mark.runId !== this.runId || intent.mark.runSlug !== this.runSlug
      || intent.mark.ordinal !== this.read().length + 1) throw new MarkLedgerCorruptError(intent.mark.ordinal)
    atomicPublish(join(this.dir, 'mark-intent.json'), `${canonicalJson(intent)}\n`)
    this.intentValue = intent
    return intent
  }

  async transact(
    fn: (nextOrdinal: number) => Promise<Omit<MarkReceipt, 'ordinal'> | undefined>,
  ): Promise<MarkReceipt | undefined> {
    if (!existsSync(join(this.dir, HANDOFF_FILE))) throw new MarkLedgerNoRunError()
    const release = await acquireMarkLock(this.lock, this.runId, () => new MarkLedgerBusyError())
    try {
      // Freeze and draft inside this callback: the next host sees the entire prior receipt.
      const receipts = this.read()
      const nextOrdinal = receipts.length + 1
      const intentPath = join(this.dir, 'mark-intent.json')
      this.intentValue = undefined
      if (existsSync(intentPath)) {
        try {
          const intent = intentSchema.parse(JSON.parse(readFileSync(intentPath, 'utf8')))
          if (intent.mark.runId !== this.runId || intent.mark.runSlug !== this.runSlug) throw new Error('foreign intent')
          if (intent.mark.ordinal === nextOrdinal) this.intentValue = intent
          else if (canonicalJson(receipts[intent.mark.ordinal - 1]) === canonicalJson(intent.mark)) unlinkSync(intentPath)
          else throw new Error('intent does not match receipt order')
        } catch { throw new MarkLedgerCorruptError(nextOrdinal) }
      }
      this.inTransaction = true
      const record = await fn(nextOrdinal)
      if (record === undefined) return undefined
      const receipt = MarkReceiptSchema.parse({ ...record, ordinal: nextOrdinal })
      if (receipt.runId !== this.runId || receipt.runSlug !== this.runSlug) {
        throw new Error('mark receipt does not belong to this run ledger')
      }
      if (this.intentValue !== undefined && (this.intentValue.stage !== 'drafted'
        || canonicalJson(this.intentValue.mark) !== canonicalJson(receipt))) {
        throw new MarkLedgerCorruptError(nextOrdinal)
      }
      // Preserve the exact historical prefix while atomically publishing the next complete line.
      const before = existsSync(this.file) ? readFileSync(this.file, 'utf8') : ''
      atomicPublish(this.file, `${before}${canonicalJson(receipt)}\n`)
      if (this.intentValue !== undefined) unlinkSync(intentPath)
      return receipt
    } finally {
      this.inTransaction = false
      this.intentValue = undefined
      release()
    }
  }

  append(record: Omit<MarkReceipt, 'ordinal'>): Promise<MarkReceipt | undefined> {
    return this.transact(async () => record)
  }
}
