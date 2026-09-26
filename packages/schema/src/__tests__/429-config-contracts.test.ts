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
