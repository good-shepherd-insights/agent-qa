import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
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
  })
  .strict()

export type DrainSessionReceipt = z.infer<typeof drainSessionReceiptSchema>

/** Append one daemon-owned drain provenance record without rewriting earlier sessions. */
export function appendDrainSessionReceipt(
  agentQaRoot: string,
  receipt: DrainSessionReceipt,
): void {
  const validated = drainSessionReceiptSchema.parse(receipt)
  mkdirSync(agentQaRoot, { recursive: true, mode: 0o700 })
  appendFileSync(
    join(agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE),
    `${JSON.stringify(validated)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

/** Read validated session receipts in their append order. An absent ledger is an empty history. */
export function readDrainSessionReceipts(agentQaRoot: string): DrainSessionReceipt[] {
  let raw: string
  try {
    raw = readFileSync(join(agentQaRoot, DRAIN_SESSION_RECEIPTS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => drainSessionReceiptSchema.parse(JSON.parse(line) as unknown))
}
