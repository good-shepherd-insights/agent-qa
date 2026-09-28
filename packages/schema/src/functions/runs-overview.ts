// `runs.overview` — one completed run as a compact address map (Phase 431, D-06).
//
// A MAP, NOT A DOCUMENT. Every field is either identity, a verdict, a count the run stored or the
// literal address another read op takes. Bodies, traces, evidence documents and bytes stay behind
// those addresses. Output ids are plain strings; the input keeps the branded run-id codec.

import { z } from 'zod'

import { runIdSchema } from '../run/run-id'
import { RunDetailStepSchema, RunSummarySchema, RunTestDetailSchema } from './runs'

/** Labels and one-line summaries keep this many Unicode code points, then a visible `…`. */
export const RUN_OVERVIEW_TEXT_MAX_CODE_POINTS = 160
export const RUN_OVERVIEW_TRUNCATION_INDICATOR = '…'

export const RunsOverviewInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsOverviewInput = z.infer<typeof RunsOverviewInputSchema>

const index = z.number().int().nonnegative()

export const RunOverviewTextSchema = z.object({
  text: z.string(),
  truncated: z.literal(true).optional(),
}).strict()

export const RunOverviewStepSchema = z.object({
  stepIndex: index,
  label: RunOverviewTextSchema.optional(),
  status: RunDetailStepSchema.shape.status,
}).strict()

export const RunOverviewTestSchema = z.object({
  testIndex: index,
  testId: z.string(),
  name: RunOverviewTextSchema,
  outcome: RunTestDetailSchema.shape.outcome,
  steps: z.array(RunOverviewStepSchema),
}).strict()

export const RunOverviewProjectionSchema = z.object({
  runId: z.string(),
  scope: RunSummarySchema.shape.scope,
  recordedTargets: RunSummarySchema.shape.recordedTargets,
  aggregateVerdict: RunSummarySchema.shape.aggregateVerdict,
  buildOrdinal: index,
  startedAt: index,
  endedAt: index,
  tests: z.array(RunOverviewTestSchema),
}).strict()

export type RunOverviewText = z.infer<typeof RunOverviewTextSchema>
export type RunOverviewStep = z.infer<typeof RunOverviewStepSchema>
export type RunOverviewTest = z.infer<typeof RunOverviewTestSchema>
export type RunOverviewProjection = z.infer<typeof RunOverviewProjectionSchema>
