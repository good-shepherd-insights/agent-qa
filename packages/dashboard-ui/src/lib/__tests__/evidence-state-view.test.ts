import { expect, test } from 'vitest'
import { EVIDENCE_ABSENCE_REASONS } from '@vostride/agent-qa-schema'
import * as view from '../evidence-state-view'

test('C424-STATES-EXACT', () => {
  expect(view.EVIDENCE_STATES).toEqual([
    'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'no-selection',
  ])
  expect(Object.keys(view.EVIDENCE_STATE_OF_REASON).sort()).toEqual([...EVIDENCE_ABSENCE_REASONS].sort())
  for (const reason of EVIDENCE_ABSENCE_REASONS) {
    expect(view.EVIDENCE_STATE_OF_REASON[reason]).toBe(reason)
  }
})

test('C424-TONES-EXACT', () => {
  expect(view.EVIDENCE_TONES).toEqual(['positive', 'neutral', 'alert'])
  expect(view.EVIDENCE_TONE_OF_STATE).toEqual({
    empty: 'positive', 'not-captured': 'neutral', unsupported: 'neutral',
    unavailable: 'neutral', failed: 'alert', 'no-selection': 'neutral',
  })
})

test('C424-FAILURES-EXACT', () => {
  expect(view.EVIDENCE_FAILURES).toEqual(['capture', 'load'])
})

test('C424-EVIDENCE-KINDS-EXACT', () => {
  expect(view.EVIDENCE_KIND_LABELS).toEqual([
    'variables', 'network', 'console', 'aria', 'a11y', 'video', 'frame',
  ])
})
