import { z } from 'zod'

import { RecordChangeSchema } from '../knowledge/maintenance-views'
import { canonicalJson } from '../determinism/index'

export type CurationBucket = 'added' | 'confirmed' | 'superseded' | 'deprecated' | 'proposed'
export const CURATION_BREAKDOWN_BUCKETS = [
  'added', 'confirmed', 'superseded', 'deprecated', 'proposed',
] as const satisfies readonly CurationBucket[]
export const CURATION_BUCKET_PRECEDENCE = [
  'superseded', 'deprecated', 'proposed', 'added', 'confirmed',
] as const satisfies readonly CurationBucket[]
export const CURATION_SNAPSHOT_SCHEMA_VERSION = 1
export const CurationBucketSchema = z.enum(CURATION_BREAKDOWN_BUCKETS)

/** Classification is recorded by curation, not inferred from a record's current status. */
export const CurationSnapshotChangeSchema = z.discriminatedUnion('bucket', [
  z.object({
    bucket: z.literal('added'),
    change: RecordChangeSchema.safeExtend({ change: z.literal('added') }),
  }).strict(),
  z.object({
    bucket: z.literal('confirmed'),
    change: RecordChangeSchema.safeExtend({ change: z.enum(['confirmed', 'promoted']) }),
  }).strict(),
  z.object({
    bucket: z.literal('superseded'),
    change: RecordChangeSchema.safeExtend({
      change: z.literal('superseded'), byRecordId: z.string().min(1),
    }),
  }).strict(),
  z.object({
    bucket: z.literal('deprecated'),
    change: RecordChangeSchema.safeExtend({ change: z.literal('deprecated') }),
  }).strict(),
  z.object({
    bucket: z.literal('proposed'),
    // Both a newly held candidate and confirmation of an existing replacement
    // can be the successful effect of an original Supersede/Deprecate downgrade.
    change: RecordChangeSchema.safeExtend({ change: z.enum(['added', 'confirmed']) }),
  }).strict(),
])
export type CurationSnapshotChange = z.infer<typeof CurationSnapshotChangeSchema>

/**
 * One affected unit retains every historical identity used to classify it.
 * A supersession may retain its replacement's Add here for since-then exclusion;
 * that identity does not become a second affected-record membership.
 * This validator checks supplied facts; the committed-effect fold lives in knowledge-local.
 */
export const CurationSnapshotRowSchema = z.object({
  recordId: z.string().min(1),
  bucket: CurationBucketSchema,
  byRecordId: z.string().min(1).optional(),
  changes: z.array(CurationSnapshotChangeSchema).min(1),
}).strict().superRefine((row, ctx) => {
  const ownChanges = row.changes.filter(({ change }) => change.recordId === row.recordId)
  const strongest = CURATION_BUCKET_PRECEDENCE.find((bucket) =>
    ownChanges.some((entry) => entry.bucket === bucket),
  )
  if (strongest !== row.bucket) {
    ctx.addIssue({ code: 'custom', path: ['bucket'], message: 'expected strongest affected bucket' })
  }
  const supersessions = ownChanges.filter((entry) => entry.bucket === 'superseded')
  const replacementIds = new Set(supersessions.map(({ change }) => change.byRecordId))
  const latestOrdinal = supersessions.reduce((latest, { change }) =>
    Math.max(latest, change.atOrdinal), -1)
  if (row.bucket === 'superseded'
    ? !supersessions.some(({ change }) =>
        change.atOrdinal === latestOrdinal && change.byRecordId === row.byRecordId)
    : row.byRecordId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['byRecordId'], message: 'expected recorded replacement' })
  }
  const identities = new Set<string>()
  for (const [index, { bucket, change }] of row.changes.entries()) {
    const path = ['changes', index]
    if (change.recordId !== row.recordId
      && !(bucket === 'added' && replacementIds.has(change.recordId))) {
      ctx.addIssue({ code: 'custom', path, message: 'change belongs to another affected unit' })
    }
    if (change.byRecordId !== undefined
      && (change.change !== 'superseded' || change.byRecordId === change.recordId)) {
      ctx.addIssue({ code: 'custom', path, message: 'invalid historical replacement' })
    }
    // Classification is deliberately excluded: two classifications of the same
    // historical identity are a conflict, not two pieces of history.
    const identity = canonicalJson(change)
    if (identities.has(identity)) {
      ctx.addIssue({ code: 'custom', path, message: 'duplicate historical change identity' })
    }
    identities.add(identity)
  }
})
export type CurationSnapshotRow = z.infer<typeof CurationSnapshotRowSchema>

export const CurationBreakdownSchema = z.object({
  added: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  superseded: z.number().int().nonnegative(),
  deprecated: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
}).strict()
export type CurationBreakdown = z.infer<typeof CurationBreakdownSchema>

/** Fixed recorded snapshot; parsing never folds, reclassifies or repairs supplied rows/counts. */
export const CurationSnapshotSchema = z.object({
  schemaVersion: z.literal(CURATION_SNAPSHOT_SCHEMA_VERSION),
  rows: z.array(CurationSnapshotRowSchema),
  breakdown: CurationBreakdownSchema,
}).strict().superRefine((snapshot, ctx) => {
  const records = new Set<string>()
  const replacements = new Set<string>()
  const counts: CurationBreakdown = {
    added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0,
  }
  for (const [index, row] of snapshot.rows.entries()) {
    if (records.has(row.recordId)) {
      ctx.addIssue({ code: 'custom', path: ['rows', index, 'recordId'],
        message: 'duplicate affected-record membership' })
    } else {
      records.add(row.recordId)
      counts[row.bucket]++
    }
    for (const entry of row.changes) {
      if (entry.bucket === 'superseded') replacements.add(entry.change.byRecordId)
    }
  }
  for (const [index, row] of snapshot.rows.entries()) {
    if (row.bucket === 'added' && replacements.has(row.recordId)) {
      ctx.addIssue({ code: 'custom', path: ['rows', index],
        message: 'replacement Add is represented by its victim' })
    }
  }
  for (const bucket of CURATION_BREAKDOWN_BUCKETS) {
    if (snapshot.breakdown[bucket] !== counts[bucket]) {
      ctx.addIssue({ code: 'custom', path: ['breakdown', bucket],
        message: 'count must equal unique affected-record membership' })
    }
  }
})
export type CurationSnapshot = z.infer<typeof CurationSnapshotSchema>
