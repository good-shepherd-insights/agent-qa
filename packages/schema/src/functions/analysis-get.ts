import { z } from 'zod'

import { asRunId } from '../run/run-id'
import type { Verdict } from '../verdict/verdict'

// The `analysis.get` op contracts (Phase 389, D-11/D-15 — minted in schema per 384 D-16).
//
// THE one producer of a run's full analysis: resolved verdicts (through the D-10 accessor),
// rendered sentences (the one renderer, live recurrence joins applied), and render-time
// clusters. The DTO carries clusters AND the full per-test sentences so a run page can
// expand a cluster (D-15) — every verdict still carries its sentence (ANLZ-03), the
// presentation dedupes (ANLZ-04).
//
// Clusters mint NO identity (D-16): fingerprint value, count, member refs and a
// representative — no short-ID, no `agentqa://` address, no `BUG-`. Durable problem
// identity belongs to the issue engine's identity-key model (387 D-03).

const runIdSchema = z.string().transform(asRunId)

const verdictClassValues = [
  'test_bug',
  'app_bug',
  'environment',
  'flake',
  'config_error',
  'llm_error',
  'unknown',
  'timeout',
] as const satisfies readonly Verdict['class'][]

/** `analysis.get` addresses exactly one completed run by id — the `runs.get` shape. */
export const AnalysisGetInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type AnalysisGetInput = z.infer<typeof AnalysisGetInputSchema>

/**
 * One resolved verdict as the analysis surface lists it: the three classification fields a
 * reader triages on, joined to the member test by `perTest` (D-07's join key) and named by
 * its per-run `testId`. The full `Verdict` (evidence arrays, attribution) stays in the
 * artifact/handoff documents rather than crossing every surface boundary by default.
 */
export interface AnalysisResolvedVerdict {
  perTest: number
  testId: string
  class: Verdict['class']
  producer: 'deterministic-classifier' | 'analyze-run'
  confidence: number
}

/** One member test's composed sentence — the ONE renderer's output, verbatim (D-05). */
export interface AnalysisSentence {
  perTest: number
  testId: string
  sentence: string
}

/** A cluster member ref: the join keys a surface needs to expand, nothing more (D-16). */
export interface AnalysisClusterMemberRef {
  testIndex: number
  testId: string
}

/**
 * One cluster as the op serves it (D-15/D-16): the fingerprint VALUE (never hashed, never
 * given an id), occurrence count, member refs ordered by testIndex, and the representative
 * member with its composed sentence.
 */
export interface AnalysisClusterView {
  fingerprint: string
  count: number
  members: AnalysisClusterMemberRef[]
  representative: {
    testIndex: number
    sentence: string
  }
}

/** The `analysis.get` result (D-11): verdicts + sentences + clusters, one producer. */
export interface AnalysisGetOutput {
  runId: string
  verdicts: AnalysisResolvedVerdict[]
  sentences: AnalysisSentence[]
  clusters: AnalysisClusterView[]
}

export const AnalysisResolvedVerdictSchema = z.object({
  perTest: z.number().int().nonnegative(),
  testId: z.string(),
  class: z.enum(verdictClassValues),
  producer: z.enum(['deterministic-classifier', 'analyze-run']),
  confidence: z.number(),
}).strict() satisfies z.ZodType<AnalysisResolvedVerdict>

export const AnalysisSentenceSchema = z.object({
  perTest: z.number().int().nonnegative(),
  testId: z.string(),
  sentence: z.string(),
}).strict() satisfies z.ZodType<AnalysisSentence>

const analysisClusterMemberRefSchema = z.object({
  testIndex: z.number().int().nonnegative(),
  testId: z.string(),
}).strict() satisfies z.ZodType<AnalysisClusterMemberRef>

export const AnalysisClusterViewSchema = z.object({
  fingerprint: z.string(),
  count: z.number().int().positive(),
  members: z.array(analysisClusterMemberRefSchema),
  representative: z.object({
    testIndex: z.number().int().nonnegative(),
    sentence: z.string(),
  }).strict(),
}).strict() satisfies z.ZodType<AnalysisClusterView>

export const AnalysisGetOutputSchema = z.object({
  runId: z.string(),
  verdicts: z.array(AnalysisResolvedVerdictSchema),
  sentences: z.array(AnalysisSentenceSchema),
  clusters: z.array(AnalysisClusterViewSchema),
}).strict() satisfies z.ZodType<AnalysisGetOutput>
