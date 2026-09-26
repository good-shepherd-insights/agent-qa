import { expect, test } from 'vitest'
import * as api from '../index'

test('C429-CONFIG-WRITE-OPS-EXACT', () => {
  expect(api.CONFIG_WRITE_OPS).toEqual(['set', 'unset', 'append'])
})

test('C429-CONFIG-WRITE-REFUSALS-EXACT', () => {
  expect(api.CONFIG_WRITE_REFUSALS).toEqual([
    'invalid_write_input',
    'file_invalid',
    'path_not_found',
    'validation_failed',
    'mask_written_back',
    'write_failed',
  ])
})

test('C429-CONFIG-NAMED-ARRAYS-EXACT', () => {
  expect(api.CONFIG_NAMED_ARRAYS).toEqual([
    'registry.llms',
    'services.mcp.tokens',
    'services.dashboard.runServiceTokens',
  ])
})

test('C429-CONFIG-CHANGE-STRICT', () => {
  const schema = api.ConfigWriteRequestSchema
  const accepted = [
    { changes: [{ op: 'set', path: ['registry', 'llms', { name: 'gpt-5.6' }, 'model'], value: 'x' }] },
    { changes: [{ op: 'unset', path: ['use', 'cache'] }] },
    { changes: [{ op: 'append', path: ['registry', 'llms'], value: { name: 'local', provider: 'gemini' } }] },
    { changes: [{ op: 'set', path: ['registry', 'llms', 0, 'model'], value: 'y' }], undoable: true },
  ]
  for (const body of accepted) {
    expect(schema.parse(body)).toEqual(body)
  }

  const refused = [
    { changes: [{ op: 'set', path: 'use.timeout.step', value: '45s' }] },
    { changes: [{ op: 'merge', path: ['use'], value: {} }] },
    { changes: [{ op: 'set', path: ['use', 'timeout', 'step'], value: '45s', extra: true }] },
    { changes: [{ op: 'unset', path: ['use', 'cache'], value: 1 }] },
    { changes: [] },
    { changes: [{ op: 'set', path: ['registry', 'llms', { name: '' }, 'model'], value: 'x' }] },
    { changes: [{ op: 'set', path: [], value: 'x' }] },
    { changes: [{ op: 'set', path: ['use', -1], value: 'x' }] },
    { changes: [{ op: 'set', path: ['registry', 'llms', { name: 'a', index: 0 }], value: 'x' }] },
    { changes: [{ op: 'set', path: ['use'], value: 1 }], extra: true },
  ]
  for (const body of refused) {
    expect(schema.safeParse(body).success).toBe(false)
  }
})

test('C429-MASKING-CLASSES-EXACT', () => {
  expect(api.MASKING_CLASSES).toEqual(['secret', 'env-var-name', 'plain'])
})

test('CLASSIFY-KNOWN-ANSWERS', () => {
  const cases: readonly [readonly (string | number)[], api.MaskingClass][] = [
    [['services', 'mcp', 'tokens', 0, 'tokenEnvVar'], 'env-var-name'],
    [['services', 'dashboard', 'runServiceTokens', 0, 'tokenEnvVar'], 'env-var-name'],
    [['registry', 'llms', 0, 'providerHeaders', 'Authorization'], 'secret'],
    [['registry', 'llms', 0, 'providerHeaders', 'x-trace'], 'secret'],
    [['registry', 'providers', 'farm', 'accessKey'], 'secret'],
    [['registry', 'providers', 'farm', 'nested', 'deep'], 'secret'],
    [['registry', 'devices', 'pixel', 'match', 'udid'], 'secret'],
    [['analytics', 'passRateScope', 'attributes', 'git.branch'], 'secret'],
    [['workspace', 'secretsFile'], 'secret'],
    [['knowledge', 'contextBudgetTokens'], 'plain'],
    [['plugins', 'auth', 0, 'package'], 'plain'],
    [['registry', 'llms', 0, 'baseURL'], 'plain'],
    [['registry', 'llms', 0, 'name'], 'plain'],
    [['use', 'timeout', 'step'], 'plain'],
  ]
  for (const [segments, expected] of cases) {
    expect({ segments, class: api.classifyConfigPath(segments) }).toEqual({
      segments,
      class: expected,
    })
  }
})

test('CLASSIFY-UNKNOWN-FAILS-CLOSED', () => {
  for (const segments of [['use', 'authState'], ['nope'], ['use', 'timeout', 'step', 'extra']]) {
    expect({ segments, class: api.classifyConfigPath(segments) }).toEqual({
      segments,
      class: 'secret',
    })
  }
})

test('LEAF-OWNER', () => {
  expect(api.configLeafOwner('registry.targets.*.url')).toBe('registry.targets')
  expect(api.configLeafOwner('workspace.testMatch[]')).toBe('workspace.testMatch')
  expect(api.configLeafOwner('use.timeout.step')).toBe('use.timeout.step')
})

test('C429-PROVIDER-ERROR-CLASSES-EXACT', () => {
  expect(api.PROVIDER_ERROR_CLASSES).toEqual([
    'auth_error',
    'model_not_found',
    'rate_limit',
    'network_error',
    'invalid_request',
    'provider_error',
  ])
})

test('CLASSIFIER-ORDER-PINNED', () => {
  const cases: readonly [string, number | undefined, api.ProviderErrorClass][] = [
    ['401 unauthorized', undefined, 'auth_error'],
    ['Invalid API key', undefined, 'auth_error'],
    ['model gpt-x does not exist', undefined, 'model_not_found'],
    ['x', 404, 'model_not_found'],
    ['quota exceeded', undefined, 'rate_limit'],
    ['request timeout: rate limit', undefined, 'rate_limit'],
    ['fetch failed', undefined, 'network_error'],
    ['ECONNREFUSED 127.0.0.1', undefined, 'network_error'],
    ['invalid_request: bad field', undefined, 'invalid_request'],
    ['teapot', undefined, 'provider_error'],
  ]
  for (const [message, statusCode, expected] of cases) {
    expect({ message, statusCode, class: api.classifyProviderError(message, statusCode) }).toEqual({
      message,
      statusCode,
      class: expected,
    })
  }
  expect([...new Set(cases.map(([, , expected]) => expected))]).toEqual([
    ...api.PROVIDER_ERROR_CLASSES,
  ])
})

test('CLASSIFIER-EMPTY-MESSAGE', () => {
  expect(api.classifyProviderError('')).toBe('provider_error')
  expect(api.providerErrorSentence('provider_error', '')).toBe('Connection failed. ')
  for (const thrown of [null, undefined, 42, {}]) {
    const { message } = api.extractProviderError(thrown)
    expect(api.classifyProviderError(message)).toBe('provider_error')
  }
})

test('SENTENCES-BYTE-IDENTICAL', () => {
  const sentences = Object.fromEntries(
    api.PROVIDER_ERROR_CLASSES.map(errorClass => [
      errorClass,
      api.providerErrorSentence(errorClass, 'upstream said no'),
    ]),
  )
  expect(sentences).toEqual({
    auth_error: 'Authentication failed. Check the saved credential for this config.',
    model_not_found: 'Model not found. Check the model name.',
    rate_limit: 'Rate limited. Try again later.',
    network_error: 'Network error. Check the exact base URL and try again.',
    invalid_request: 'Invalid request. Check model and provider settings.',
    provider_error: 'Connection failed. upstream said no',
  })
})

test('EXTRACT-PROVIDER-ERROR', () => {
  const withProps = (props: Record<string, unknown>) =>
    Object.assign(new Error('original message'), props)

  expect(api.extractProviderError(withProps({ data: { error: { message: 'bad key' } } }))).toEqual({
    message: 'bad key',
  })
  expect(api.extractProviderError(withProps({ data: { detail: 'nope' } }))).toEqual({
    message: 'nope',
  })
  expect(api.extractProviderError(withProps({ responseBody: '{"detail":"d"}' }))).toEqual({
    message: 'd',
  })
  expect(api.extractProviderError(withProps({ responseBody: 'not json' }))).toEqual({
    message: 'original message',
  })
  expect(api.extractProviderError(withProps({ statusCode: 429 }))).toEqual({
    message: 'original message',
    statusCode: 429,
  })
  expect(api.extractProviderError('x')).toEqual({ message: 'x' })
})
