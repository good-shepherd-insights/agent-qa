import { z } from 'zod'

import type { ScopeKey, ScopeTier } from '../identity/scope-key'
import { asRunId } from '../run/run-id'
import type { RunId } from '../run/run-id'
import type { ExecutionContext, RunStatus } from '../run/run-status'

export const RUN_SUMMARY_SCHEMA_VERSION = 1

/**
 * Surface-facing projection of one completed run (Phase 384, D-16).
 *
 * Minimal by construction: it carries the identity fields 387's run addressing
 * (`RUN-456`) resolves against, the build ordinal knowledge folds key on, and the
 * coarse outcome a listing renders. Step-level evidence stays in the handoff
 * document — 389's evidence links reach it through `runId`, not through this DTO.
 */
export interface RunSummary {
  runId: RunId
  scope: ScopeKey
  buildOrdinal: number
  executionContext: ExecutionContext
  aggregateVerdict: RunStatus
  startedAt: number
  endedAt: number
  /** Number of member tests the run recorded. */
  testCount: number
}

const scopeTierValues = [
  'global',
  'product',
  'suite',
  'test',
] as const satisfies readonly ScopeTier[]

const runStatusValues = [
  'passed',
  'failed',
  'healed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[]

const executionContextValues = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
] as const satisfies readonly ExecutionContext[]

const scopeKeySchema = z.object({
  tier: z.enum(scopeTierValues),
  key: z.string(),
}).strict()

const runIdSchema = z.string().transform(asRunId)

export const RunSummarySchema = z.object({
  runId: runIdSchema,
  scope: scopeKeySchema,
  buildOrdinal: z.number().int().nonnegative(),
  executionContext: z.enum(executionContextValues),
  aggregateVerdict: z.enum(runStatusValues),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  testCount: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<RunSummary>

/**
 * `runs.list` takes no arguments in the tracer slice. It is a `.strict()` empty object
 * rather than `z.void()` so filters (product, since-ordinal, limit) become additive
 * fields later without changing the op's input contract shape.
 */
export const RunsListInputSchema = z.object({}).strict()

export type RunsListInput = z.infer<typeof RunsListInputSchema>
