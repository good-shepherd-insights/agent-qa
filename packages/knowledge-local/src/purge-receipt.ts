import { createVersionGuard } from '@vostride/agent-qa-schema'
import { z } from 'zod'

export const PURGE_RECEIPT_SCHEMA_VERSION = 1

/**
 * Receipt ids are used in a suffix-addressed series, so dots cannot be admitted without making
 * `purge-X.2.json` ambiguous between an id and a cycle number.
 */
export const PURGE_SAFE_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export const purgeReceiptRelativePathSchema = z.string().refine((value) => {
  if (value === '' || value.startsWith('/') || value.includes('\\')) return false
  return value
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}, 'expected a knowledge-root-relative committed path')

/**
 * Content-free committed audit receipt shared by the purge writer and read-only maintenance
 * history. Keeping the contract outside purge.ts prevents the reader graph from importing the
 * destructive implementation merely to validate committed receipt bytes.
 */
export const PurgeReceiptSchema = z.object({
  schemaVersion: z.literal(PURGE_RECEIPT_SCHEMA_VERSION),
  purgedRecordId: z.string().regex(PURGE_SAFE_RECORD_ID),
  purgedAtOrdinal: z.number().int().nonnegative(),
  initiator: z.string().min(1).refine((value) => value.trim() !== '', 'initiator is required'),
  affectedPaths: z.array(purgeReceiptRelativePathSchema).min(1),
  firstCommittedOrdinal: z.number().int().nonnegative(),
}).strict()

export const purgeReceiptSchema = PurgeReceiptSchema
export type PurgeReceipt = z.infer<typeof PurgeReceiptSchema>

const guardPurgeReceiptVersion = createVersionGuard<PurgeReceipt>({
  name: 'PurgeReceipt',
  current: PURGE_RECEIPT_SCHEMA_VERSION,
  migrations: {},
})

export function guardPurgeReceipt(value: unknown): PurgeReceipt {
  return PurgeReceiptSchema.parse(guardPurgeReceiptVersion(value))
}
