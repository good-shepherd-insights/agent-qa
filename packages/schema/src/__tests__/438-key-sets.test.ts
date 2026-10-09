// 2026-10-09 (438-02, D-05, 436 D-17): the persisted shapes Phase 438 adds, optional-additive at
// handoff schema version 7. Every expected set is spelled by hand, never derived from the module
// under test. Later 438 plans extend this file.
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  readTargetRefusalMeta,
  TARGET_IDENTITY_KEYS,
  TARGET_REFUSAL_KEYS,
} from '../index'
import type { TargetIdentity, TargetRefusalMeta } from '../index'

const block = (): Record<string, unknown> => ({
  kind: 'target-mismatch',
  lane: 'ref',
  path: 'live',
  stated: { role: 'button', name: 'Submit' },
  observed: { role: 'textbox', name: '' },
  reasons: ['role-kind'],
  rowStated: false,
  inputSent: false,
})

const withRefusal = (value: unknown) => ({ metadata: { targetRefusal: value } })

describe('C438-KEY-SETS', () => {
  it('the target refusal carries exactly its eight members', () => {
    expect([...TARGET_REFUSAL_KEYS].sort()).toEqual([
      'inputSent',
      'kind',
      'lane',
      'observed',
      'path',
      'reasons',
      'rowStated',
      'stated',
    ])
    expectTypeOf<keyof TargetRefusalMeta>().toEqualTypeOf<(typeof TARGET_REFUSAL_KEYS)[number]>()
  })

  it('a target identity carries exactly role, name and row', () => {
    expect([...TARGET_IDENTITY_KEYS].sort()).toEqual(['name', 'role', 'row'])
    expectTypeOf<keyof TargetIdentity>().toEqualTypeOf<(typeof TARGET_IDENTITY_KEYS)[number]>()
  })

  it('the handoff schema version is still 7', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(7)
  })

  it('a well-formed refusal reads back', () => {
    expect(readTargetRefusalMeta(withRefusal(block()))).toEqual(block())
  })

  it('a refusal whose stated target has no role reads back', () => {
    const raw = { ...block(), stated: { name: 'Submit' }, reasons: ['name-no-shared-word'] }
    expect(readTargetRefusalMeta(withRefusal(raw))?.stated).toEqual({ name: 'Submit' })
  })

  it('a result with no metadata reads as no refusal', () => {
    expect(readTargetRefusalMeta(undefined)).toBeUndefined()
    expect(readTargetRefusalMeta({})).toBeUndefined()
  })

  it('an idempotentNoop result reads as no refusal', () => {
    const result = { metadata: { idempotentNoop: { currentState: 'checked', inputSent: false } } }
    expect(readTargetRefusalMeta(result)).toBeUndefined()
  })

  it('a block missing stated reads as no refusal', () => {
    const { stated: _stated, ...raw } = block()
    void _stated
    expect(readTargetRefusalMeta(withRefusal(raw))).toBeUndefined()
  })

  it('a block with inputSent true reads as no refusal', () => {
    expect(readTargetRefusalMeta(withRefusal({ ...block(), inputSent: true }))).toBeUndefined()
  })

  it('a block whose kind is not target-mismatch reads as no refusal', () => {
    expect(readTargetRefusalMeta(withRefusal({ ...block(), kind: 'binding' }))).toBeUndefined()
  })

  it('a block with an unknown reason reads as no refusal', () => {
    const raw = { ...block(), reasons: ['role-kind', 'ordinal'] }
    expect(readTargetRefusalMeta(withRefusal(raw))).toBeUndefined()
  })
})
