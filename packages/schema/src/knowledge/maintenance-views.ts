import { z } from 'zod'

import { createVersionGuard } from '../versioning/create-version-guard'

export const RECORD_CHANGE_SCHEMA_VERSION = 1
export const INSPECT_RECORD_VIEW_SCHEMA_VERSION = 1

const knowledgeRecordKindSchema = z.enum([
  'fact',
  'procedure',
  'caution',
  'unknown',
  'policy',
])

const bundleStatusSchema = z.enum([
  'active',
  'candidate',
  'superseded',
  'deprecated',
])

/** Closed structural filter for deterministic maintenance inspection (D-06). */
export const InspectFilterSchema = z.object({
  product: z.string().optional(),
  scope: z.string().optional(),
  kind: knowledgeRecordKindSchema.optional(),
  status: bundleStatusSchema.optional(),
  anchor: z.string().optional(),
  recordId: z.string().optional(),
  asOfBuild: z.number().int().nonnegative().optional(),
  unresolvedOnly: z.boolean().optional(),
}).strict()

export type InspectFilter = z.infer<typeof InspectFilterSchema>

/** Stable machine-readable view of one record derived from committed bundle truth. */
export const InspectRecordViewSchema = z.object({
  schemaVersion: z.literal(INSPECT_RECORD_VIEW_SCHEMA_VERSION),
  recordId: z.string(),
  product: z.string(),
  scope: z.string(),
  kind: knowledgeRecordKindSchema,
  status: bundleStatusSchema,
  confirmations: z.number().int().nonnegative(),
  contradictions: z.number().int().nonnegative(),
  evidenceTokens: z.array(z.string()),
  lastEventOrdinal: z.number().int().nonnegative(),
  openedAtOrdinal: z.number().int().nonnegative(),
  closedAtOrdinal: z.number().int().nonnegative().optional(),
  anchors: z.array(z.string()),
  /** LLM-authored prose remains separate from code-computed evidence and counts. */
  trustNarrative: z.string().nullable().optional(),
}).strict()

export type InspectRecordView = z.infer<typeof InspectRecordViewSchema>

const guardInspectRecordViewVersion = createVersionGuard<InspectRecordView>({
  name: 'InspectRecordView',
  current: INSPECT_RECORD_VIEW_SCHEMA_VERSION,
  migrations: {},
})

export function guardInspectRecordView(value: unknown): InspectRecordView {
  return InspectRecordViewSchema.parse(guardInspectRecordViewVersion(value))
}

export const RecordChangeSchema = z.object({
  schemaVersion: z.literal(RECORD_CHANGE_SCHEMA_VERSION),
  recordId: z.string(),
  change: z.enum([
    'added',
    'confirmed',
    'superseded',
    'deprecated',
    'promoted',
    'purged',
  ]),
  atOrdinal: z.number().int().nonnegative(),
  evidenceToken: z.string().optional(),
  byRecordId: z.string().optional(),
}).strict()

export type RecordChange = z.infer<typeof RecordChangeSchema>

const guardRecordChangeVersion = createVersionGuard<RecordChange>({
  name: 'RecordChange',
  current: RECORD_CHANGE_SCHEMA_VERSION,
  migrations: {},
})

export function guardRecordChange(value: unknown): RecordChange {
  return RecordChangeSchema.parse(guardRecordChangeVersion(value))
}
