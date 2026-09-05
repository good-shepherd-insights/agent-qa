/** Pure classifier disclosure over the supplied analysis sweeps, without invoking a producer. */
import { VERDICT_CLASSES, type VerdictClass } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { EXCLUSION_CLASSES } from '../labels/run-exclusion'
import type { RunCostRecord } from './floor-artefact'

export const CLASSIFIER_REPEATABILITY_SCHEMA_VERSION = 1 as const

export interface ClassifierSweep {
  analysisDigest: string
  verdicts: readonly { testId?: string; class: VerdictClass }[]
}

export interface ClassifierRunInput {
  runSlug: string
  product: string
  sweeps: readonly ClassifierSweep[]
}

export interface ClassifierRepeatability {
  schemaVersion: typeof CLASSIFIER_REPEATABILITY_SCHEMA_VERSION
  k: number
  n: number
  incomplete: readonly string[]
  classFlips: number
  classFlipRate?: number
  admitExcludeFlips: number
  admitExcludeFlipRate?: number
  perRun: readonly {
    runSlug: string
    product: string
    digests: readonly string[]
    classVectors: readonly (readonly string[])[]
    classFlip: boolean
    admitExcludeFlip: boolean
  }[]
  cost?: RunCostRecord
}

const count = z.number().int().nonnegative()

/** Shared by both committed documents; the type-only cost import keeps the modules acyclic. */
export const runCostRecordSchema = z
  .object({
    modelCalls: count.optional(),
    sampleCount: count.optional(),
    samplesMissingTokenUsage: count.optional(),
    promptTokens: count.optional(),
    completionTokens: count.optional(),
    totalTokens: count.optional(),
    durationMs: z.number().nonnegative().optional(),
    judgeCost: z
      .object({ calls: count, inputTokens: count, outputTokens: count, outcomesMissingUsage: count })
      .strict()
      .optional(),
    wallClockMs: z.number().nonnegative(),
  })
  .strict()

export const classifierRepeatabilitySchema = z
  .object({
    schemaVersion: z.literal(CLASSIFIER_REPEATABILITY_SCHEMA_VERSION),
    k: z.number().int().positive(),
    n: count,
    incomplete: z.array(z.string().min(1)),
    classFlips: count,
    classFlipRate: z.number().min(0).max(1).optional(),
    admitExcludeFlips: count,
    admitExcludeFlipRate: z.number().min(0).max(1).optional(),
    perRun: z.array(
      z
        .object({
          runSlug: z.string().min(1),
          product: z.string().min(1),
          digests: z.array(z.string().min(1)),
          classVectors: z.array(z.array(z.enum(VERDICT_CLASSES))),
          classFlip: z.boolean(),
          admitExcludeFlip: z.boolean(),
        })
        .strict(),
    ),
    cost: runCostRecordSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.n !== value.perRun.length) {
      ctx.addIssue({ code: 'custom', path: ['n'], message: 'must equal the complete-run count' })
    }
    for (const [i, run] of value.perRun.entries()) {
      if (run.digests.length < value.k || run.digests.length !== run.classVectors.length) {
        ctx.addIssue({ code: 'custom', path: ['perRun', i, 'digests'], message: 'requires matching vectors and at least k sweeps' })
      }
    }
    for (const [countKey, rateKey, flag] of [
      ['classFlips', 'classFlipRate', 'classFlip'],
      ['admitExcludeFlips', 'admitExcludeFlipRate', 'admitExcludeFlip'],
    ] as const) {
      if (value[countKey] !== value.perRun.filter(run => run[flag]).length) {
        ctx.addIssue({ code: 'custom', path: [countKey], message: 'must equal the per-run flip count' })
      }
      const expected = value.n === 0 ? undefined : value[countKey] / value.n
      if (value[rateKey] !== expected) {
        ctx.addIssue({ code: 'custom', path: [rateKey], message: 'must be flips/n, absent when n is 0' })
      }
    }
  })

export function guardClassifierRepeatability(
  value: unknown,
): { kind: 'ok'; repeatability: ClassifierRepeatability } | { kind: 'rejected'; reason: string } {
  const parsed = classifierRepeatabilitySchema.safeParse(value)
  if (!parsed.success) {
    return {
      kind: 'rejected',
      reason: parsed.error.issues
        .map(issue => `${issue.path.length ? issue.path.map(String).join('.') : '<root>'}: ${issue.message}`)
        .join('; '),
    }
  }
  return { kind: 'ok', repeatability: parsed.data }
}

export function foldClassifierRepeatability(input: {
  k: number
  runs: readonly ClassifierRunInput[]
  cost?: RunCostRecord
}): ClassifierRepeatability {
  if (!Number.isSafeInteger(input.k) || input.k < 1) {
    throw new TypeError('classifier repeatability k must be a positive integer')
  }
  if (new Set(input.runs.map(run => run.runSlug)).size !== input.runs.length) {
    throw new TypeError('classifier repeatability run slugs must be unique')
  }
  const incomplete: string[] = []
  const perRun: ClassifierRepeatability['perRun'][number][] = []
  for (const run of input.runs) {
    if (run.sweeps.length < input.k) {
      incomplete.push(run.runSlug)
      continue
    }
    // Preserve every supplied sweep; the digest/vector lengths disclose any extra evidence.
    const classVectors = run.sweeps.map(sweep => sweep.verdicts.map(verdict => verdict.class))
    const first = classVectors[0]!
    const classFlip = classVectors.some(vector =>
      vector.length !== first.length || vector.some((cls, i) => cls !== first[i]),
    )
    const excluded = classVectors.map(vector =>
      vector.some(cls => EXCLUSION_CLASSES.some(excludedClass => excludedClass === cls)),
    )
    perRun.push({
      runSlug: run.runSlug,
      product: run.product,
      digests: run.sweeps.map(sweep => sweep.analysisDigest),
      classVectors,
      classFlip,
      admitExcludeFlip: excluded.some(value => value !== excluded[0]),
    })
  }
  const n = perRun.length
  const classFlips = perRun.filter(run => run.classFlip).length
  const admitExcludeFlips = perRun.filter(run => run.admitExcludeFlip).length
  const guarded = guardClassifierRepeatability({
    schemaVersion: CLASSIFIER_REPEATABILITY_SCHEMA_VERSION,
    k: input.k,
    n,
    incomplete,
    classFlips,
    ...(n === 0 ? {} : { classFlipRate: classFlips / n }),
    admitExcludeFlips,
    ...(n === 0 ? {} : { admitExcludeFlipRate: admitExcludeFlips / n }),
    perRun,
    ...(input.cost === undefined ? {} : { cost: input.cost }),
  })
  if (guarded.kind === 'rejected') throw new TypeError(`classifier fold rejected: ${guarded.reason}`)
  return guarded.repeatability
}
