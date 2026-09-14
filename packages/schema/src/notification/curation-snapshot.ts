import { z } from 'zod'

import { RecordChangeSchema } from '../knowledge/maintenance-views'

export type CurationBucket = 'added' | 'confirmed' | 'superseded' | 'deprecated' | 'proposed'
export const CURATION_BUCKETS = [
  'added', 'confirmed', 'superseded', 'deprecated', 'proposed',
] as const satisfies readonly CurationBucket[]
export const CURATION_BUCKET_PRECEDENCE = [
  'superseded', 'deprecated', 'proposed', 'added', 'confirmed',
] as const satisfies readonly CurationBucket[]
export const CURATION_SNAPSHOT_SCHEMA_VERSION = 1
export const CurationBucketSchema = z.enum(CURATION_BUCKETS)

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

export const CurationSnapshotRowSchema = z.object({
  recordId: z.string().min(1),
  bucket: CurationBucketSchema,
  byRecordId: z.string().min(1).optional(),
  changes: z.array(CurationSnapshotChangeSchema).min(1),
}).strict()
export type CurationSnapshotRow = z.infer<typeof CurationSnapshotRowSchema>

export const CurationBreakdownSchema = z.object({
  added: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  superseded: z.number().int().nonnegative(),
  deprecated: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
}).strict()
export type CurationBreakdown = z.infer<typeof CurationBreakdownSchema>

// Structural bootstrap for assertion-based RED; relational validation follows.
export const CurationSnapshotSchema = z.object({
  schemaVersion: z.literal(CURATION_SNAPSHOT_SCHEMA_VERSION),
  rows: z.array(CurationSnapshotRowSchema),
  breakdown: CurationBreakdownSchema,
}).strict()
export type CurationSnapshot = z.infer<typeof CurationSnapshotSchema>
