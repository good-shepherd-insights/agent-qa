import { describe, expect, it } from 'vitest'

import type { GuardrailPolicy } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  GuardrailConfigError,
  loadGuardrailPolicy,
} from '../policy-loader'

const expectedDetectors = {
  awsKey: 'block',
  creditCard: 'block',
  pemKey: 'block',
  bearer: 'redact',
  apiKey: 'redact',
  email: 'redact',
  injectionShape: 'route',
} as const

function expectConfigError(input: unknown): void {
  let thrown: unknown

  try {
    loadGuardrailPolicy(input)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(GuardrailConfigError)
  expect((thrown as Error).message.trim().length).toBeGreaterThan(0)
}

describe('loadGuardrailPolicy', () => {
  it('loads the default policy through the validated boundary', () => {
    const policy: GuardrailPolicy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

    expect(policy.detectors).toEqual(expectedDetectors)
    expect(policy.allowlist).toEqual([])
  })

  it('throws GuardrailConfigError when detectors are missing', () => {
    expectConfigError({})
  })

  it('throws GuardrailConfigError for invalid detector actions', () => {
    expectConfigError({
      detectors: {
        ...expectedDetectors,
        awsKey: 'nonsense',
      },
      allowlist: [],
    })
  })

  it('throws GuardrailConfigError for unknown top-level keys', () => {
    expectConfigError({
      detectors: expectedDetectors,
      allowlist: [],
      unexpected: true,
    })
  })

  it('throws GuardrailConfigError for nullish input', () => {
    expectConfigError(null)
    expectConfigError(undefined)
  })
})
