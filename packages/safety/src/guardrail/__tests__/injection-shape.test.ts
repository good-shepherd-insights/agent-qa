import { describe, expect, it } from 'vitest'

import { GuardrailConfigError, loadGuardrailPolicy } from '../policy-loader'

const legacyDetectors = {
  awsKey: 'block',
  creditCard: 'block',
  pemKey: 'block',
  bearer: 'redact',
  apiKey: 'redact',
  email: 'redact',
} as const

describe('injection-shape guardrail policy', () => {
  it('materializes the route default for legacy policy files', () => {
    const policy = loadGuardrailPolicy({
      detectors: legacyDetectors,
      allowlist: [],
    })

    expect(policy.detectors).toEqual({
      ...legacyDetectors,
      injectionShape: 'route',
    })
  })

  it('accepts route and off as explicit injection-shape actions', () => {
    const routed = loadGuardrailPolicy({
      detectors: { ...legacyDetectors, injectionShape: 'route' },
      allowlist: [],
    })
    const disabled = loadGuardrailPolicy({
      detectors: { ...legacyDetectors, injectionShape: 'off' },
      allowlist: [],
    })

    expect(routed.detectors.injectionShape).toBe('route')
    expect(disabled.detectors.injectionShape).toBe('off')
  })

  it('continues to reject unknown detector keys', () => {
    expect(() =>
      loadGuardrailPolicy({
        detectors: { ...legacyDetectors, unexpectedDetector: 'route' },
        allowlist: [],
      }),
    ).toThrow(GuardrailConfigError)
  })
})
