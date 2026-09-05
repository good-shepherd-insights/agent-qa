/** Pure classifier disclosure over the supplied analysis sweeps, without invoking a producer. */
import type { VerdictClass } from '@vostride/agent-qa-schema'
import { z } from 'zod'

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

export const classifierRepeatabilitySchema = z.object({}).strict()

export function guardClassifierRepeatability(
  _value: unknown,
): { kind: 'ok'; repeatability: ClassifierRepeatability } | { kind: 'rejected'; reason: string } {
  return { kind: 'rejected', reason: 'RED contract skeleton' }
}

export function foldClassifierRepeatability(_input: {
  k: number
  runs: readonly ClassifierRunInput[]
  cost?: RunCostRecord
}): ClassifierRepeatability {
  throw new TypeError('RED contract skeleton')
}
