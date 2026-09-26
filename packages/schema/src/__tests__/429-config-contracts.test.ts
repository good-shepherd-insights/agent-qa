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
