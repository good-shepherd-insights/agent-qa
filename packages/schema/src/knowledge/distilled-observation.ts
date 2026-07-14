/**
 * Phase 377 D-09 distilled graph evidence contract (memory.md §6.1).
 * observations.jsonl stores one guarded observation object per line; the file reader lives at the
 * knowledge-local boundary, while this browser-safe module owns each line's strict validation.
 */
import { z } from 'zod'

import { createVersionGuard } from '../versioning/create-version-guard'

export const DISTILLED_OBSERVATION_SCHEMA_VERSION = 1

const stepSchema = z.object({
  naturalKey: z.string(),
  ordinal: z.number().int().nonnegative(),
}).strict()

const testSchema = z.object({ id: z.string() }).strict()
const procedureSchema = z.object({ id: z.string() }).strict()
const flowSchema = z.object({
  name: z.string(),
  precedes: z.string().optional(),
}).strict()
const surfaceSchema = z.object({
  kind: z.enum(['page', 'screen']),
  naturalKey: z.string(),
}).strict()
const elementSchema = z.object({ naturalKey: z.string() }).strict()
const locatorSchema = z.object({ selector: z.string() }).strict()
const errorSchema = z.object({ naturalKey: z.string() }).strict()

export const distilledObservationSchema = z.object({
  schemaVersion: z.number().int().positive(),
  step: stepSchema,
  platform: z.enum(['web', 'mobile']).optional(),
  test: testSchema.optional(),
  procedure: procedureSchema.optional(),
  flow: flowSchema.optional(),
  surface: surfaceSchema.optional(),
  element: elementSchema.optional(),
  locator: locatorSchema.optional(),
  error: errorSchema.optional(),
  observedAtOrdinal: z.number().int().nonnegative(),
}).strict().superRefine((observation, ctx) => {
  if (
    (observation.element !== undefined || observation.locator !== undefined)
    && observation.platform === undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['platform'],
      message: 'element or locator requires platform (377 D-09; Pitfall 8)',
    })
  }

  if (observation.locator !== undefined && observation.element === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['element'],
      message: 'locator requires element (377 D-09)',
    })
  }

  if (
    observation.platform !== undefined
    && observation.surface !== undefined
    && (
      (observation.platform === 'web' && observation.surface.kind !== 'page')
      || (observation.platform === 'mobile' && observation.surface.kind !== 'screen')
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['surface', 'kind'],
      message: 'surface kind must agree with platform (377 D-09)',
    })
  }
})

export type DistilledObservation = z.infer<typeof distilledObservationSchema>

const guardDistilledObservationVersion = createVersionGuard<DistilledObservation>({
  name: 'DistilledObservation',
  current: DISTILLED_OBSERVATION_SCHEMA_VERSION,
  migrations: {},
})

/** Guards and parses one untrusted observations.jsonl line. */
export function guardDistilledObservation(value: unknown): DistilledObservation {
  return distilledObservationSchema.parse(guardDistilledObservationVersion(value))
}
