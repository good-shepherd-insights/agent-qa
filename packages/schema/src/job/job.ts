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

export type JobStatus = 'queued' | 'authored' | 'bundling' | 'committing' | 'done'

export type JobConclusionKind =
  | 'no_issue'
  | 'needs_user_input'
  | 'insufficient_evidence'
  | 'knowledge_skipped_draft'
  | 'model_capability_error'
  | 'provider_error'
  | 'insufficient_model_output'

export interface Job {
  id: JobId
  kind: JobKind
  status: JobStatus
  runRef?: RunId
  summary: string
  conclusionKind?: JobConclusionKind
}

const jobKindValues = [
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
}).strict()
