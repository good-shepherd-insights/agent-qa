import { describe, expect, it } from 'vitest'

import {
  coerceProcedureBindingValue,
  procedureSourceBinding,
  type ProcedureSourceBinding,
} from '../../index'

describe('coerceProcedureBindingValue', () => {
  it.each([
    { type: 'number', raw: 'not-a-number', expected: undefined },
    { type: 'number', raw: '250', expected: 250 },
    { type: 'number', raw: '', expected: 0 },
    { type: 'number', raw: null, expected: undefined },
    { type: 'number', raw: undefined, expected: undefined },
    { type: 'number', raw: 'Infinity', expected: undefined },
    { type: 'number', raw: 42, expected: 42 },
    { type: 'boolean', raw: true, expected: true },
    { type: 'boolean', raw: false, expected: false },
    { type: 'boolean', raw: 'true', expected: true },
    { type: 'boolean', raw: 'false', expected: false },
    { type: 'boolean', raw: 'True', expected: undefined },
    { type: 'boolean', raw: 1, expected: undefined },
    { type: 'boolean', raw: 0, expected: undefined },
    { type: 'boolean', raw: '', expected: undefined },
    { type: 'boolean', raw: null, expected: undefined },
    { type: 'boolean', raw: undefined, expected: undefined },
    { type: 'string', raw: 42, expected: '42' },
    { type: 'string', raw: 'text', expected: 'text' },
    { type: 'string', raw: '', expected: '' },
    { type: 'string', raw: null, expected: undefined },
    { type: 'string', raw: undefined, expected: undefined },
  ] satisfies Array<{
    type: 'string' | 'number' | 'boolean'
    raw: unknown
    expected: string | number | boolean | undefined
  }>)('($type, $raw) -> $expected', ({ type, raw, expected }) => {
    expect(coerceProcedureBindingValue(type, raw)).toBe(expected)
  })
})

describe('procedureSourceBinding', () => {
  it.each([
    {
      caseName: 'a non-numeric non-boolean string has both capability bits false',
      name: 'delay',
      raw: 'not-a-number',
      expected: { name: 'delay', canBindNumber: false, canBindBoolean: false },
    },
    {
      caseName: 'a numeric string is number-capable only',
      name: 'delay',
      raw: '250',
      expected: { name: 'delay', canBindNumber: true, canBindBoolean: false },
    },
    {
      caseName: 'the exact lowercase boolean string is boolean-capable only',
      name: 'flag',
      raw: 'false',
      expected: { name: 'flag', canBindNumber: false, canBindBoolean: true },
    },
    {
      caseName: 'the empty string is number-capable (mechanical Number law, binds 0)',
      name: 'delay',
      raw: '',
      expected: { name: 'delay', canBindNumber: true, canBindBoolean: false },
    },
    {
      caseName: 'a non-canonical boolean casing has both bits false',
      name: 'flag',
      raw: 'True',
      expected: { name: 'flag', canBindNumber: false, canBindBoolean: false },
    },
  ] satisfies Array<{
    caseName: string
    name: string
    raw: unknown
    expected: ProcedureSourceBinding
  }>)('$caseName', ({ name, raw, expected }) => {
    expect(procedureSourceBinding(name, raw)).toEqual(expected)
  })

  it.each([
    { caseName: 'null raw is absence — no entry', raw: null },
    { caseName: 'undefined raw is absence — no entry', raw: undefined },
  ])('$caseName', ({ raw }) => {
    expect(procedureSourceBinding('delay', raw)).toBeUndefined()
  })

  it('carries exactly name and the two capability bits — never a value', () => {
    const entry = procedureSourceBinding('delay', 'not-a-number')
    expect(entry).toBeDefined()
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'canBindBoolean',
      'canBindNumber',
      'name',
    ])
  })
})
