import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

export const DRAIN_SESSION_RECEIPTS_FILE = 'drain-session-receipts.jsonl'

export const drainSessionReceiptSchema = z
  .object({
    ts: z.string().min(1),
    sessionId: z.string().uuid(),
    holderPid: z.number().int().positive(),
    epoch: z.number().int().nonnegative(),
    candidateIds: z.array(z.string()).refine(
      (ids) => ids.every((id, index) => index === 0 || ids[index - 1]! <= id),
      'candidateIds must be sorted',
    ),
    remainingAfter: z.number().int().nonnegative(),
    outcome: z.enum(['completed', 'failed']).default('completed'),
    failures: z.number().int().nonnegative().default(0),
    quarantined: z.number().int().nonnegative().default(0),
  })
  .strict()

export type DrainSessionReceipt = z.infer<typeof drainSessionReceiptSchema>

export interface DrainSessionReceiptReadWarning {
  readonly kind: 'torn-final-line'
  readonly line: number
  readonly message: string
}

export interface DrainSessionReceiptLedger {
  readonly receipts: DrainSessionReceipt[]
  readonly warnings: DrainSessionReceiptReadWarning[]
}

export interface AppendDrainSessionReceiptOptions {
  /**
   * Focused durability seam; production uses the best-effort platform directory fsync.
   *
   * Observing a directory fsync is the only way to assert WR-03 without simulating a machine
   * crash, so the observation point is part of the API rather than a mock of `node:fs`.
   */
  readonly fsyncDirectory?: (directory: string) => void
}

/** Append one daemon-owned drain provenance record without rewriting earlier sessions. */
export function appendDrainSessionReceipt(
  agentQaRoot: string,
  receipt: DrainSessionReceipt,
  options: AppendDrainSessionReceiptOptions = {},
): void {
  void options
  const validated = drainSessionReceiptSchema.parse(receipt)
  mkdirSync(agentQaRoot, { recursive: true, mode: 0o700 })
  const descriptor = openSync(
    join(agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE),
    'a',
    0o600,
  )
  try {
    writeFileSync(descriptor, `${JSON.stringify(validated)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Read append order while isolating exactly one interrupted final append.
 * A syntactically complete malformed row is never treated as a crash tear.
 */
export function readDrainSessionReceiptLedger(
  agentQaRoot: string,
): DrainSessionReceiptLedger {
  let raw: string
  try {
    raw = readFileSync(join(agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { receipts: [], warnings: [] }
    }
    throw error
  }

  const lines = raw.split('\n')
  const receipts: DrainSessionReceipt[] = []
  const warnings: DrainSessionReceiptReadWarning[] = []
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch (error) {
      const isTornTail = index === lines.length - 1 && !raw.endsWith('\n')
      if (!isTornTail) throw error
      warnings.push({
        kind: 'torn-final-line',
        line: index + 1,
        message: `Ignored torn final drain-session receipt at line ${index + 1}`,
      })
      break
    }
    receipts.push(drainSessionReceiptSchema.parse(parsed))
  }
  return { receipts, warnings }
}

/** Read validated receipts and surface any tolerated torn-tail warning to the process. */
export function readDrainSessionReceipts(agentQaRoot: string): DrainSessionReceipt[] {
  const ledger = readDrainSessionReceiptLedger(agentQaRoot)
  for (const warning of ledger.warnings) {
    process.emitWarning(warning.message, { code: 'AGENT_QA_TORN_DRAIN_RECEIPT' })
  }
  return ledger.receipts
}
