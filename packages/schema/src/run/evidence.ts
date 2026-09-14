import { z } from 'zod'
import { EvidenceArtifactRefSchema } from '../ids/artifact-ref'

export type EvidenceKind = 'console' | 'network' | 'a11y' | 'aria' | 'variables'
export const EVIDENCE_KINDS = [
  'console', 'network', 'a11y', 'aria', 'variables',
] as const satisfies readonly EvidenceKind[]
export type EvidenceAbsenceReason =
  | 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed'
export const EVIDENCE_ABSENCE_REASONS = [
  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed',
] as const satisfies readonly EvidenceAbsenceReason[]
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS)
export const EvidenceAbsenceReasonSchema = z.enum(EVIDENCE_ABSENCE_REASONS)

const count = z.number().int().nonnegative()
export const ConsoleEvidenceRecordSchema = z.strictObject({
  level: z.string(), text: z.string(), timestamp: z.number(),
  location: z.strictObject({ url: z.string(), lineNumber: count, columnNumber: count }).optional(),
})
export const NetworkEvidenceRecordSchema = z.strictObject({
  url: z.string(), method: z.string(), status: count,
  requestHeaders: z.record(z.string(), z.string()),
  responseHeaders: z.record(z.string(), z.string()),
  body: z.string().optional(), requestBody: z.string().optional(),
  startTime: z.number(), endTime: z.number(),
  timing: z.record(z.string(), z.number()).optional(),
  requestSize: count.optional(), responseSize: count.optional(),
})
export const A11yEvidenceRecordSchema = z.strictObject({
  ruleId: z.string(), impact: z.enum(['minor', 'moderate', 'serious', 'critical']),
  description: z.string(), help: z.string(), helpUrl: z.string(),
  nodes: z.array(z.strictObject({ html: z.string(), target: z.array(z.string()) })),
})
export const VariableSnapshotSchema = z.record(z.string(), z.strictObject({
  value: z.string(), source: z.enum(['env', 'inline', 'suite', 'cli', 'capture', 'hook', 'step']),
}))
export type VariableSnapshot = z.infer<typeof VariableSnapshotSchema>

export const ConsoleEvidenceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('console'),
  records: z.array(ConsoleEvidenceRecordSchema),
})
export const NetworkEvidenceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('network'),
  records: z.array(NetworkEvidenceRecordSchema),
})
export const A11yEvidenceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('a11y'),
  records: z.array(A11yEvidenceRecordSchema),
})
export const AriaEvidenceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('aria'), tree: z.string(),
})
// Variables share the read-document shape but remain inline; they have no blob ref kind.
export const VariablesEvidenceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('variables'), records: VariableSnapshotSchema,
})
export const EvidenceDocumentSchema = z.discriminatedUnion('kind', [
  ConsoleEvidenceDocumentSchema, NetworkEvidenceDocumentSchema, A11yEvidenceDocumentSchema,
  AriaEvidenceDocumentSchema, VariablesEvidenceDocumentSchema,
])
export type EvidenceDocument = z.infer<typeof EvidenceDocumentSchema>

const consolePresent = z.strictObject({
  kind: z.literal('console'), state: z.literal('present'),
  ref: EvidenceArtifactRefSchema.refine(ref => ref.id.startsWith('console-evidence:')),
  counts: z.strictObject({ total: count, errors: count, warnings: count }),
})
const networkPresent = z.strictObject({
  kind: z.literal('network'), state: z.literal('present'),
  ref: EvidenceArtifactRefSchema.refine(ref => ref.id.startsWith('network-evidence:')),
  counts: z.strictObject({ total: count, failed: count, errored: count }),
})
const a11yPresent = z.strictObject({
  kind: z.literal('a11y'), state: z.literal('present'),
  ref: EvidenceArtifactRefSchema.refine(ref => ref.id.startsWith('a11y-evidence:')),
  counts: z.strictObject({ minor: count, moderate: count, serious: count, critical: count }),
})
const ariaPresent = z.strictObject({
  kind: z.literal('aria'), state: z.literal('present'),
  ref: EvidenceArtifactRefSchema.refine(ref => ref.id.startsWith('aria-state:')),
})
const variablesPresent = z.strictObject({
  kind: z.literal('variables'), state: z.literal('present'), counts: z.strictObject({ count }),
})
const absent = z.strictObject({
  kind: EvidenceKindSchema, state: z.literal('absent'), reason: EvidenceAbsenceReasonSchema,
  evidenceIncomplete: z.boolean().optional(),
})
export const EvidenceEntrySchema = z.union([
  consolePresent, networkPresent, a11yPresent, ariaPresent, variablesPresent, absent,
])
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>
export type AriaEvidenceEntry =
  | Extract<EvidenceEntry, { kind: 'aria'; state: 'present' }>
  | (Extract<EvidenceEntry, { state: 'absent' }> & { kind: 'aria' })
export type StepEvidenceEntries = {
  [K in Exclude<EvidenceKind, 'aria'>]:
    | Extract<EvidenceEntry, { kind: K; state: 'present' }>
    | (Extract<EvidenceEntry, { state: 'absent' }> & { kind: K })
}
