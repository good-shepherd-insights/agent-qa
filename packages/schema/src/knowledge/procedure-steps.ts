// D-04 committed procedure step-sequence contract. The payload is embedded in record.md as ONE
// canonicalJson fenced block (lean + PR-reviewable); parseProcedureBody is fail-closed — any
// malformation returns undefined (downstream treats unparseable as no-match/hint, T-381-01),
// never a throw, never eval/dynamic dispatch.

import { z } from 'zod'

import { canonicalJson } from '../determinism/canonical-json'
import type { Anchor } from '../identity/anchor'
import type { ProcedureParamType } from './curator-tier'

/**
 * A descriptor-only element target, shaped exactly like the runner's cached-plan locators
 * (role + nameNormalized + ordinal) so the deterministic descriptor matcher re-grounds it
 * against a fresh observation unchanged.
 */
export interface ProcedureGuardTarget {
  role: string
  nameNormalized: string
  ordinal?: number
}

/**
 * The per-step replay guard (D-05): the target the step is about to act on, the page anchor
 * the step was authored against, and optional stable landmark texts for the guard fold.
 */
export interface ProcedureGuardDescriptor {
  target: ProcedureGuardTarget
  pageAnchor: Extract<Anchor, { t: 'page' }>
  landmarks?: string[]
}

/**
 * One action value slot: a literal string, or a `{ param }` ref into the payload's parameter
 * schema. Parameterized values are ALWAYS refs, never inlined literals (T-381-02 — the secret
 * param type only protects values that stay referenced).
 */
export type ProcedureValueSlot = string | { param: string }

/** One declared procedure parameter (D-03 closed type union). */
export interface ProcedureParameterSpec {
  name: string
  type: ProcedureParamType
  required: boolean
}

/**
 * One committed procedure step: the authored instruction prose, the replayable action shape
 * (targets keyed by ref lane, values keyed by field), and the D-05 guard descriptor.
 */
export interface ProcedureStepSpec {
  instruction: string
  action: {
    type: string
    targets: Record<string, ProcedureGuardTarget>
    values: Record<string, ProcedureValueSlot>
  }
  guard: ProcedureGuardDescriptor
}

/** The one committed procedure body payload (schemaVersion pinned at 1). */
export interface ProcedureBodyPayload {
  schemaVersion: 1
  parameters: ProcedureParameterSpec[]
  steps: ProcedureStepSpec[]
  successAssertion: string
}

const guardTargetSchema = z
  .object({
    role: z.string(),
    nameNormalized: z.string(),
    ordinal: z.number().int().optional(),
  })
  .strict()

const guardDescriptorSchema = z
  .object({
    target: guardTargetSchema,
    pageAnchor: z.object({ t: z.literal('page'), route: z.string() }).strict(),
    landmarks: z.array(z.string()).optional(),
  })
  .strict()

const valueSlotSchema = z.union([z.string(), z.object({ param: z.string() }).strict()])

const stepSpecSchema = z
  .object({
    instruction: z.string(),
    action: z
      .object({
        type: z.string(),
        targets: z.record(z.string(), guardTargetSchema),
        values: z.record(z.string(), valueSlotSchema),
      })
      .strict(),
    guard: guardDescriptorSchema,
  })
  .strict()

const bodyPayloadSchema: z.ZodType<ProcedureBodyPayload> = z
  .object({
    schemaVersion: z.literal(1),
    parameters: z.array(
      z
        .object({
          name: z.string(),
          type: z.enum(['string', 'number', 'boolean', 'secret']),
          required: z.boolean(),
        })
        .strict(),
    ),
    steps: z.array(stepSpecSchema),
    successAssertion: z.string(),
  })
  .strict()

const FENCE_OPEN = '```json agent-qa-procedure'
const FENCE_CLOSE = '```'

/**
 * Serialize a payload into the ONE fenced canonicalJson block a record.md body carries.
 * Byte-stable across calls (canonicalJson sorts keys recursively).
 */
export function serializeProcedureBody(payload: ProcedureBodyPayload): string {
  return `${FENCE_OPEN}\n${canonicalJson(payload)}\n${FENCE_CLOSE}\n`
}

/**
 * Fail-closed parse of a record.md body: locate the fenced block, JSON-parse it, and validate
 * structurally. ANY malformation — no fence, bad JSON, a param type outside the closed union,
 * an unknown key — returns undefined; this function never throws (T-381-01).
 */
export function parseProcedureBody(body: string): ProcedureBodyPayload | undefined {
  const fenceStart = body.indexOf(FENCE_OPEN)
  if (fenceStart === -1) return undefined
  const contentStart = fenceStart + FENCE_OPEN.length
  const fenceEnd = body.indexOf(`\n${FENCE_CLOSE}`, contentStart)
  if (fenceEnd === -1) return undefined
  const raw = body.slice(contentStart, fenceEnd).trim()
  if (raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = bodyPayloadSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/**
 * The ONE derivation of the ordered step keys feeding `computeStepSequenceSignature` for the
 * D-01 content address ({ kind: 'procedure', flowName, stepSignature }). Each key is the
 * canonicalJson of the step's structural shape — action type + descriptor targets + guard.
 * Authored prose (instruction/successAssertion) is EXCLUDED per the content-address prose ban,
 * and value slots are excluded so re-parameterization never forks procedure identity.
 */
export function procedureStepKeys(payload: ProcedureBodyPayload): string[] {
  return payload.steps.map((step) =>
    canonicalJson({
      action: { targets: step.action.targets, type: step.action.type },
      guard: step.guard,
    }),
  )
}
