// 2026-10-08 (437-02, D-05): the input evidence key set beside OperationEvidence. The expected
// set is spelled by hand, never derived from the module under test.
import { readFileSync } from 'node:fs'

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  guardCompletedRunHandoff,
  INPUT_EVIDENCE_KEYS,
} from '../index'
import type { CompletedRunHandoff, InputEvidence, OperationEvidence } from '../index'

const preChangeHandoff = new URL(
  '../../../../test-fixtures/legacy-handoff/handoff.json',
  import.meta.url,
)

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

  it('the handoff schema version is 2', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(2)
    const handoff = JSON.parse(readFileSync(preChangeHandoff, 'utf8')) as CompletedRunHandoff
    expect(handoff.schemaVersion).toBe(CURRENT_HANDOFF_SCHEMA_VERSION)
    expect(guardCompletedRunHandoff(handoff)).toBe(handoff)
  })
})
