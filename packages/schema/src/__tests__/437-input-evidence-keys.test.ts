// 2026-10-08 (437-02, D-05): the input evidence key set beside OperationEvidence. The expected
// set is spelled by hand, never derived from the module under test.
import { describe, expect, expectTypeOf, it } from 'vitest'

import { CURRENT_HANDOFF_SCHEMA_VERSION, INPUT_EVIDENCE_KEYS } from '../index'
import type { InputEvidence, OperationEvidence } from '../index'

describe('C437-KEY-SETS', () => {
  it('the input evidence carries exactly its nine members', () => {
    expect([...INPUT_EVIDENCE_KEYS].sort()).toEqual([
      'currentState',
      'fillVerdict',
      'inputPath',
      'inputSent',
      'secure',
      'submit',
      'submitReason',
      'unavailableReason',
      'verb',
    ])
    expectTypeOf<keyof InputEvidence>().toEqualTypeOf<(typeof INPUT_EVIDENCE_KEYS)[number]>()
  })

  it('operation evidence gains an optional input array', () => {
    expectTypeOf<OperationEvidence['input']>().toEqualTypeOf<InputEvidence[] | undefined>()
  })

  it('the handoff schema version is still 7', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(7)
  })
})
