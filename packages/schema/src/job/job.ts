import { z } from 'zod'

import { asRunId } from '../run/run-id'
import type { RunId } from '../run/run-id'
import { asJobId } from './job-id'
import type { JobId } from './job-id'

export type JobKind =
  | 'chat'
  | 'analyze-run'
  | 'curate-memory'
  | 'triage-issues'
  | 'consolidate'
  | 'propose-improvements'

// 385 C6 (JOBQ-01): `failed` and `cancelled` are the two TERMINAL statuses the agent job
// queue needs and the v47 contract lacked — a bounded-retry queue that cannot record
// exhaustion has no way to stop, and a cooperative cancel has no state to land in.
export type JobStatus =
  | 'queued'
  | 'authored'
  | 'bundling'
  | 'committing'
  | 'done'
  | 'failed'
  | 'cancelled'

export type JobConclusionKind =
  | 'no_issue'
  | 'needs_user_input'
  | 'insufficient_evidence'
  | 'knowledge_skipped_draft'
  | 'model_capability_error'
  | 'provider_error'
  | 'insufficient_model_output'

// 385 C6 (JOBQ-01): `attempts` is incremented at CLAIM (D-18), so a job that kills its host
// every time still exhausts its bound instead of crash-looping. `createdAt`/`updatedAt` are
// ISO strings minted by the injected ClockPort — never the ambient wall clock and never a
// SQL-side default, or the D-03 logical dump can never be compared across an interrupted
// history. (This package's module-discipline guard forbids naming that ambient API here,
// even in prose, so the rule is stated rather than quoted.)
export interface Job {
  id: JobId
  kind: JobKind
  status: JobStatus
  runRef?: RunId
  summary: string
  conclusionKind?: JobConclusionKind
  attempts: number
  createdAt: string
  updatedAt: string
}

// Exported for the sibling job DTO modules only (385 plan 02). They enumerate the same kind
// set, and a second hand-written literal list is how one of them ends up admitting a kind the
// other refuses. It is not on the package barrel: the kind vocabulary consumers need is the
// `JobKind` type, and publishing the array as well would invite a caller to iterate it and
// build a parallel registry beside the declared one.
export const jobKindValues = [
  'chat',
  'analyze-run',
  'curate-memory',
  'triage-issues',
  'consolidate',
  'propose-improvements',
] as const satisfies readonly JobKind[]

const jobStatusValues = [
  'queued',
  'authored',
  'bundling',
  'committing',
  'done',
  'failed',
  'cancelled',
] as const satisfies readonly JobStatus[]

const jobConclusionKindValues = [
  'no_issue',
  'needs_user_input',
  'insufficient_evidence',
  'knowledge_skipped_draft',
  'model_capability_error',
  'provider_error',
  'insufficient_model_output',
] as const satisfies readonly JobConclusionKind[]

const jobIdSchema = z.string().transform(asJobId)
const runIdSchema = z.string().transform(asRunId)

export const jobSchema = z.object({
  id: jobIdSchema,
  kind: z.enum(jobKindValues),
  status: z.enum(jobStatusValues),
  runRef: runIdSchema.optional(),
  summary: z.string(),
  conclusionKind: z.enum(jobConclusionKindValues).optional(),
  // REQUIRED, not optional. A store reads its rows back through this schema, so an optional
  // field here would let a row that never recorded an attempt or a timestamp parse clean —
  // and the C6 break exists precisely so that row cannot exist.
  attempts: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
