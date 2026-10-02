/**
 * The receipt each forget answered, recorded under its change id (quick 261002-lse, 432-16 #3).
 *
 * A retry of the same operation identity is the same change, so it must answer the same receipt,
 * byte for byte. `forgottenAt` is a wall-clock instant nothing else in the store records, so the
 * first answer is kept here, beside the commit intents and completed-effect receipts: gitignored
 * operational state under `memory/queue/`, written atomically inside the writer's authority. The
 * text is the answer's own serialization, so a retry parses back the same keys in the same order.
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import {
  ForgetReceiptV1Schema,
  KnowledgeChangeIdSchema,
  type ForgetReceiptV1,
} from '@vostride/agent-qa-schema'

import { fsyncDirectory } from '../durable-fs.js'
import { JOURNAL_SUBDIR } from '../journal/intent-journal.js'
import { withCurrentWriterAuthority, type CurrentWriterAuthority } from '../lease/writer-lease.js'

export const FORGET_RECEIPTS_SUBDIR = `${JOURNAL_SUBDIR}/forget-receipts`

function receiptFile(knowledgeRoot: string, changeId: string): string {
  if (!isAbsolute(knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')
  const name = `${KnowledgeChangeIdSchema.parse(changeId)}.json`
  return join(knowledgeRoot, FORGET_RECEIPTS_SUBDIR, name)
}

/** The receipt a change's earlier application answered, or `undefined` when none is readable. */
export function readRecordedForgetReceipt(
  knowledgeRoot: string,
  changeId: string,
): ForgetReceiptV1 | undefined {
  let text: string
  try {
    text = readFileSync(receiptFile(knowledgeRoot, changeId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  // Validated, but the parsed value itself is answered so its key order is the recorded one.
  const parsed = ForgetReceiptV1Schema.safeParse(value)
  if (!parsed.success || parsed.data.proposalId !== changeId) return undefined
  return value as ForgetReceiptV1
}

/** Record the receipt a forget is answering; a later application of the change replaces it. */
export function recordForgetReceipt(
  knowledgeRoot: string,
  authority: CurrentWriterAuthority,
  receipt: ForgetReceiptV1,
): void {
  const file = receiptFile(knowledgeRoot, ForgetReceiptV1Schema.parse(receipt).proposalId)
  const text = `${JSON.stringify(receipt)}\n`
  withCurrentWriterAuthority(knowledgeRoot, authority, () => {
    mkdirSync(dirname(file), { recursive: true })
    fsyncDirectory(dirname(dirname(file)))
    const temporary = `${file}.tmp-${randomUUID()}`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx')
      writeFileSync(fd, text, 'utf8')
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, file)
      fsyncDirectory(dirname(file))
    } finally {
      if (fd !== undefined) closeSync(fd)
      rmSync(temporary, { force: true })
    }
  })
}
