import { z } from 'zod'

const guardrailDetectorActionSchema = z.enum(['block', 'redact', 'off'])

export const guardrailPolicySchema = z.object({
  detectors: z.object({
    awsKey: guardrailDetectorActionSchema,
    creditCard: guardrailDetectorActionSchema,
    pemKey: guardrailDetectorActionSchema,
    bearer: guardrailDetectorActionSchema,
    apiKey: guardrailDetectorActionSchema,
    email: guardrailDetectorActionSchema,
  }).strict(),
  allowlist: z.array(z.string()).default([]),
}).strict()

export type GuardrailPolicy = z.infer<typeof guardrailPolicySchema>
export type GuardrailDetectorFamily = keyof GuardrailPolicy['detectors']
