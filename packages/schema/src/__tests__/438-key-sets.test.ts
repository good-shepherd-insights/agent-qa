// 2026-10-09 (438-02, D-05, 436 D-17): the persisted target refusal block and its historical
// reader. Every expected set is spelled by hand, never derived from the module under test.
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  readTargetRefusalMeta,
  TARGET_IDENTITY_KEYS,
  TARGET_REFUSAL_KEYS,
} from '../index'
import type { TargetIdentity, TargetRefusalMeta } from '../index'

function wellFormed(): Record<string, unknown> {
  return {
    kind: 'target-mismatch',
    lane: 'ref',
    path: 'live',
    stated: { role: 'button', name: 'Submit' },
    observed: { role: 'textbox', name: '' },
    reasons: ['role-kind'],
    rowStated: false,
    inputSent: false,
  }
}

const withBlock = (block: unknown) => ({ success: false, metadata: { targetRefusal: block } })

describe('C438-KEY-SETS', () => {
  it('the target refusal block carries exactly its eight members', () => {
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

  it('reads a well-formed refusal block back', () => {
    expect(readTargetRefusalMeta(withBlock(wellFormed()))).toEqual(wellFormed())
  })

  it('reads a heal refusal with a stated row', () => {
    const block = {
      ...wellFormed(),
      lane: 'toRef',
      path: 'heal',
      stated: { role: 'button', name: 'Edit label', row: '7 Elm Street' },
      observed: { role: 'button', name: 'Edit label', row: '9 Oak Road' },
      reasons: ['row'],
      rowStated: true,
    }
    expect(readTargetRefusalMeta(withBlock(block))).toEqual(block)
  })

  it('returns undefined for a result with no metadata', () => {
    expect(readTargetRefusalMeta({})).toBeUndefined()
    expect(readTargetRefusalMeta(undefined)).toBeUndefined()
  })

  it('returns undefined for an idempotentNoop result', () => {
    const noop = {
      success: true,
      metadata: { idempotentNoop: { currentState: 'checked', inputSent: false } },
    }
    expect(readTargetRefusalMeta(noop)).toBeUndefined()
  })

  it('returns undefined for a block missing stated', () => {
    const { stated: _stated, ...block } = wellFormed()
    expect(readTargetRefusalMeta(withBlock(block))).toBeUndefined()
  })

  it('returns undefined for a block with inputSent true', () => {
    expect(readTargetRefusalMeta(withBlock({ ...wellFormed(), inputSent: true }))).toBeUndefined()
  })

  it("returns undefined for a block whose kind is not 'target-mismatch'", () => {
    expect(readTargetRefusalMeta(withBlock({ ...wellFormed(), kind: 'refused' }))).toBeUndefined()
  })

  it('returns undefined for a block whose reasons hold an unknown string', () => {
    const block = { ...wellFormed(), reasons: ['role-kind', 'ordinal'] }
    expect(readTargetRefusalMeta(withBlock(block))).toBeUndefined()
  })
})
