import { guardrailPolicySchema, type GuardrailPolicy } from '@vostride/agent-qa-schema'

export class GuardrailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardrailConfigError'
  }
}

export const defaultGuardrailPolicyInput: unknown = {
  detectors: {
    awsKey: 'block',
    creditCard: 'block',
    pemKey: 'block',
    bearer: 'redact',
    apiKey: 'redact',
    email: 'redact',
  },
  allowlist: [],
}

export function loadGuardrailPolicy(input: unknown): GuardrailPolicy {
  const parsed = guardrailPolicySchema.safeParse(input)

  if (!parsed.success) {
    throw new GuardrailConfigError(`Unloadable guardrail policy: ${parsed.error.message}`)
  }

  return parsed.data
}
