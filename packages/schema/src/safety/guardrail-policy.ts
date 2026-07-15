import { z } from 'zod'

/**
 * `route` is SAFE-03's soft Curator-review signal. It reports suspicious content
 * without deterministically blocking or redacting it.
 */
const guardrailDetectorActionSchema = z.enum(['block', 'redact', 'route', 'off'])

export const guardrailPolicySchema = z.object({
  detectors: z.object({
    awsKey: guardrailDetectorActionSchema,
    creditCard: guardrailDetectorActionSchema,
    pemKey: guardrailDetectorActionSchema,
    bearer: guardrailDetectorActionSchema,
    apiKey: guardrailDetectorActionSchema,
    email: guardrailDetectorActionSchema,
    injectionShape: guardrailDetectorActionSchema.default('route'),
  }).strict(),
  allowlist: z.array(z.string()).default([]),
}).strict()

export type GuardrailPolicy = z.infer<typeof guardrailPolicySchema>
export type GuardrailDetectorFamily = keyof GuardrailPolicy['detectors']
