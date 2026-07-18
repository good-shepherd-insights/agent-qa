import { describe, expect, it } from 'vitest'

import {
  EMPTY_PROCEDURE_BINDING_AVAILABILITY,
  procedureParameterFillability,
  type ProcedureBindingAvailability,
  type ProcedureBodyPayload,
  type ProcedureParameterSpec,
} from '../../index'

function procedurePayload(
  parameters: ProcedureParameterSpec[],
  referencedParameters: string[],
): ProcedureBodyPayload {
  return {
    schemaVersion: 1,
    parameters,
    steps: [
      {
        instruction: 'Exercise the parameter bindings',
        action: {
          type: 'fill',
          targets: { ref: { role: 'textbox', nameNormalized: 'input' } },
          values: Object.fromEntries(
            referencedParameters.map((name, index) => [`value${index}`, { param: name }]),
          ),
        },
        guard: {
          target: { role: 'textbox', nameNormalized: 'input' },
          pageAnchor: { t: 'page', route: '/form' },
        },
      },
    ],
    successAssertion: 'The parameters bind',
  }
}

function availability(
  overrides: Partial<ProcedureBindingAvailability> = {},
): ProcedureBindingAvailability {
  return {
    variables: [],
    memory: [],
    secrets: [],
    ...overrides,
  }
}

describe('procedureParameterFillability', () => {
  it.each([
    {
      caseName: 'does not satisfy a secret parameter from variables',
      parameters: [{ name: 'api_key', type: 'secret', required: true }],
      refs: ['api_key'],
      available: availability({ variables: ['api_key'] }),
      expected: { fillable: false, unfillable: ['api_key'] },
    },
    {
      caseName: 'satisfies a string parameter from working memory',
      parameters: [{ name: 'account_name', type: 'string', required: true }],
      refs: ['account_name'],
      available: availability({ memory: ['account_name'] }),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: 'satisfies a non-secret parameter from the secret-store fallback',
      parameters: [{ name: 'email', type: 'string', required: true }],
      refs: ['email'],
      available: availability({ secrets: ['email'] }),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: 'requires a referenced optional parameter when no typed default exists',
      parameters: [{ name: 'nickname', type: 'string', required: false }],
      refs: ['nickname'],
      available: availability(),
      expected: { fillable: false, unfillable: ['nickname'] },
    },
    {
      caseName: 'ignores an unavailable declaration that no value slot references',
      parameters: [{ name: 'unused', type: 'string', required: true }],
      refs: [],
      available: availability(),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: 'fails closed when a value slot references an undeclared parameter',
      parameters: [],
      refs: ['undeclared'],
      available: availability({ variables: ['undeclared'] }),
      expected: { fillable: false, unfillable: ['undeclared'] },
    },
    {
      caseName: 'uses the non-secret source rule for number and boolean parameters',
      parameters: [
        { name: 'count', type: 'number', required: true },
        { name: 'enabled', type: 'boolean', required: true },
      ],
      refs: ['count', 'enabled'],
      available: availability({ variables: ['enabled'], secrets: ['count'] }),
      expected: { fillable: true, unfillable: [] },
    },
  ] satisfies Array<{
    caseName: string
    parameters: ProcedureParameterSpec[]
    refs: string[]
    available: ProcedureBindingAvailability
    expected: { fillable: boolean; unfillable: string[] }
  }>)('$caseName', ({ parameters, refs, available, expected }) => {
    expect(procedureParameterFillability(procedurePayload(parameters, refs), available)).toEqual(
      expected,
    )
  })

  it('deduplicates and sorts unfillable names deterministically', () => {
    const payload = procedurePayload(
      [
        { name: 'zeta', type: 'secret', required: true },
        { name: 'alpha', type: 'string', required: true },
      ],
      ['zeta', 'zeta', 'alpha'],
    )

    const first = procedureParameterFillability(
      payload,
      EMPTY_PROCEDURE_BINDING_AVAILABILITY,
    )
    expect(first).toEqual({ fillable: false, unfillable: ['alpha', 'zeta'] })
    expect(
      procedureParameterFillability(payload, EMPTY_PROCEDURE_BINDING_AVAILABILITY),
    ).toEqual(first)
  })
})
