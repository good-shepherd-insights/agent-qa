import { z } from 'zod'
import type { ModelIdentity } from '../handoff/model-call-profile'

/** Configured profiles only; healing, assertions and extraction use the verifier lane. */
export type ModelUsageRole = 'planner' | 'verifier'
export const MODEL_USAGE_ROLES = ['planner', 'verifier'] as const satisfies readonly ModelUsageRole[]
const count = z.number().int().nonnegative()
export const ModelUsageRoleSchema = z.enum(MODEL_USAGE_ROLES)
export const ModelUsageIdentitySchema = z.object({
  provider: z.string(), modelId: z.string(),
}).strict() satisfies z.ZodType<ModelIdentity>
const roleSchema = z.object({
  declared: ModelUsageIdentitySchema.optional(),
  respondingModelIds: z.array(z.string()).nonempty().optional(),
}).strict()
export const ModelUsageSchema = z.object({
  roles: z.object({ planner: roleSchema.optional(), verifier: roleSchema.optional() }).strict(),
  calls: z.object({ started: count, succeeded: count, failed: count }).strict(),
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  cachedInputTokens: count.optional(),
}).strict()
export type ModelUsage = z.infer<typeof ModelUsageSchema>

/** Shared bus/detail token shape. Inclusive input already contains cache reads. */
export interface ModelTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedInputTokens?: number
}

/** Structural input from the runner's finished scope, without an execution dependency. */
export interface ModelUsageObservations {
  attempts: readonly {
    role: ModelUsageRole
    kind: 'start' | 'success' | 'failure'
    report?: {
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      respondingModelId?: string
    }
  }[]
  roles: { planner: { declared?: ModelIdentity }; verifier: { declared?: ModelIdentity } }
}

/** Only observed attempts establish measurement; caller applies its live mask before egress. */
export function projectObservedModelUsage(observed: ModelUsageObservations): {
  modelUsage?: ModelUsage
  tokenUsage?: ModelTokenUsage
} {
  const { attempts } = observed
  const roles: ModelUsage['roles'] = {}
  for (const role of MODEL_USAGE_ROLES) {
    const declared = observed.roles[role].declared
    const respondingModelIds = [...new Set(attempts.flatMap(attempt =>
      attempt.role === role && attempt.kind === 'success'
        && typeof attempt.report?.respondingModelId === 'string'
        && attempt.report.respondingModelId.length > 0 ? [attempt.report.respondingModelId] : []))]
    if (declared !== undefined || respondingModelIds.length > 0) {
      roles[role] = {
        ...(declared === undefined ? {} : { declared: { ...declared } }),
        ...(respondingModelIds.length === 0 ? {} : { respondingModelIds }),
      }
    }
  }
  if (attempts.length === 0 && Object.keys(roles).length === 0) return {}
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  // Both counts range over exactly the same complete attempt population. Failed, pending,
  // missing and invalid reports cannot certify a partial total as the step's measured spend.
  const complete = attempts.length > 0 && attempts.every(attempt =>
    attempt.kind === 'success' && valid(attempt.report?.inputTokens)
      && valid(attempt.report?.outputTokens))
  const input = complete ? attempts.reduce((sum, item) => sum + item.report!.inputTokens!, 0) : undefined
  const output = complete ? attempts.reduce((sum, item) => sum + item.report!.outputTokens!, 0) : undefined
  const measured = valid(input) && valid(output) && valid(input + output)
  const cached = measured && attempts.every(item => valid(item.report?.cachedInputTokens)
    && item.report.cachedInputTokens <= item.report.inputTokens!)
    ? attempts.reduce((sum, item) => sum + item.report!.cachedInputTokens!, 0) : undefined
  const cache = valid(cached) ? { cachedInputTokens: cached } : {}
  return {
    modelUsage: {
      roles,
      calls: { started: attempts.length,
        succeeded: attempts.filter(item => item.kind === 'success').length,
        failed: attempts.filter(item => item.kind === 'failure').length },
      ...(measured ? { inputTokens: input, outputTokens: output, ...cache } : {}),
    },
    ...(measured ? { tokenUsage: { promptTokens: input, completionTokens: output,
      totalTokens: input + output, ...cache } } : {}),
  }
}
