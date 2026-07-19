import { describe, expect, it } from 'vitest'

import {
  EMPTY_PROCEDURE_BINDING_AVAILABILITY,
  procedureParameterFillability,
  procedureSourceBinding,
  type ProcedureBindingAvailability,
  type ProcedureBodyPayload,
  type ProcedureParameterSpec,
  type ProcedureSourceBinding,
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

/**
 * Builds capability entries through the real sanitizer: raw values in, name + capability
 * bits out. Fixtures give raw values so every row exercises procedureSourceBinding exactly
 * as the loop assembler does.
 */
function entries(values: Record<string, unknown>): ProcedureSourceBinding[] {
  return Object.entries(values)
    .map(([name, raw]) => procedureSourceBinding(name, raw))
    .filter((entry): entry is ProcedureSourceBinding => entry !== undefined)
}

function availability(
  overrides: {
    variables?: Record<string, unknown>
    memory?: Record<string, unknown>
    secrets?: string[]
  } = {},
): ProcedureBindingAvailability {
  return {
    variables: entries(overrides.variables ?? {}),
    memory: entries(overrides.memory ?? {}),
    secrets: overrides.secrets ?? [],
  }
}

describe('procedureParameterFillability', () => {
  it.each([
    {
      caseName: 'does not satisfy a secret parameter from variables',
      parameters: [{ name: 'api_key', type: 'secret', required: true }],
      refs: ['api_key'],
      available: availability({ variables: { api_key: 'raw-key' } }),
      expected: { fillable: false, unfillable: ['api_key'] },
    },
    {
      caseName: 'satisfies a string parameter from working memory',
      parameters: [{ name: 'account_name', type: 'string', required: true }],
      refs: ['account_name'],
      available: availability({ memory: { account_name: 'Acme Corp' } }),
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
      available: availability({ variables: { undeclared: 'present' } }),
      expected: { fillable: false, unfillable: ['undeclared'] },
    },
    {
      caseName: 'rejects a secret-only number while accepting a variable-backed boolean',
      parameters: [
        { name: 'count', type: 'number', required: true },
        { name: 'enabled', type: 'boolean', required: true },
      ],
      refs: ['count', 'enabled'],
      available: availability({ variables: { enabled: 'true' }, secrets: ['count'] }),
      expected: { fillable: false, unfillable: ['count'] },
    },
    {
      caseName: 'downranks a required number whose only variables entry is number-incapable',
      parameters: [{ name: 'delay', type: 'number', required: true }],
      refs: ['delay'],
      available: availability({ variables: { delay: 'not-a-number' } }),
      expected: { fillable: false, unfillable: ['delay'] },
    },
    {
      caseName: 'rescues a number-incapable variable with a number-capable memory entry (per-source OR)',
      parameters: [{ name: 'delay', type: 'number', required: true }],
      refs: ['delay'],
      available: availability({
        variables: { delay: 'not-a-number' },
        memory: { delay: '250' },
      }),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: 'rejects a required boolean when every entry is boolean-incapable (exact lowercase canon)',
      parameters: [{ name: 'autoRenew', type: 'boolean', required: true }],
      refs: ['autoRenew'],
      available: availability({
        variables: { autoRenew: 'True' },
        memory: { autoRenew: 1 },
      }),
      expected: { fillable: false, unfillable: ['autoRenew'] },
    },
    {
      caseName: 'a string parameter is fillable from a capability-false entry (presence is string-bindability)',
      parameters: [{ name: 'note', type: 'string', required: true }],
      refs: ['note'],
      available: availability({ variables: { note: 'not-a-number' } }),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: "an entry named 'Delay' does not fill a parameter named 'delay' (exact code-unit equality)",
      parameters: [{ name: 'delay', type: 'number', required: true }],
      refs: ['delay'],
      available: availability({ variables: { Delay: '250' } }),
      expected: { fillable: false, unfillable: ['delay'] },
    },
    {
      caseName: "the empty string is number-capable and fills a number parameter (mechanical Number law: '' binds 0)",
      parameters: [{ name: 'delay', type: 'number', required: true }],
      refs: ['delay'],
      available: availability({ variables: { delay: '' } }),
      expected: { fillable: true, unfillable: [] },
    },
    {
      caseName: 'a nullish raw value is absence — the name is simply not listed',
      parameters: [{ name: 'delay', type: 'number', required: true }],
      refs: ['delay'],
      available: availability({ variables: { delay: null }, memory: { delay: undefined } }),
      expected: { fillable: false, unfillable: ['delay'] },
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

  it.each([
    { type: 'secret', source: 'variables', expectedFillable: false },
    { type: 'secret', source: 'memory', expectedFillable: false },
    { type: 'secret', source: 'secrets', expectedFillable: true },
    { type: 'string', source: 'variables', expectedFillable: true },
    { type: 'string', source: 'memory', expectedFillable: true },
    { type: 'string', source: 'secrets', expectedFillable: true },
    { type: 'number', source: 'variables', expectedFillable: true },
    { type: 'number', source: 'memory', expectedFillable: true },
    { type: 'number', source: 'secrets', expectedFillable: false },
    { type: 'boolean', source: 'variables', expectedFillable: true },
    { type: 'boolean', source: 'memory', expectedFillable: true },
    { type: 'boolean', source: 'secrets', expectedFillable: false },
  ] satisfies Array<{
    type: ProcedureParameterSpec['type']
    source: keyof ProcedureBindingAvailability
    expectedFillable: boolean
  }>)('$type parameter from $source has fillable=$expectedFillable', ({
    type,
    source,
    expectedFillable,
  }) => {
    const name = 'typed_value'
    // A raw value that is capability-true for the declared type keeps this matrix a pure
    // source-law table (the typed-capability rows above own value-level discrimination).
    const raw = type === 'number' ? '42' : type === 'boolean' ? 'true' : 'text'
    const available =
      source === 'secrets'
        ? availability({ secrets: [name] })
        : availability({ [source]: { [name]: raw } })
    expect(
      procedureParameterFillability(
        procedurePayload([{ name, type, required: true }], [name]),
        available,
      ),
    ).toEqual({
      fillable: expectedFillable,
      unfillable: expectedFillable ? [] : [name],
    })
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
