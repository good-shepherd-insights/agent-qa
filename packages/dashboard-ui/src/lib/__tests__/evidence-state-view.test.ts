import { expect, test } from 'vitest'
import { EVIDENCE_ABSENCE_REASONS } from '@vostride/agent-qa-schema'
import * as view from '../evidence-state-view'
import { EVIDENCE_INCOMPLETE_LABEL } from '../run-detail-view'

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

const tabKinds = ['variables', 'network', 'console', 'aria', 'a11y', 'video'] as const

test('C424-COPY-TOTAL', () => {
  for (const kind of tabKinds) {
    const copy = view.EVIDENCE_COPY[kind]
    expect(copy).toBeDefined()
    for (const state of view.EVIDENCE_STATES) {
      const pairs = state === 'failed' ? [copy.failed.capture, copy.failed.load] : [copy[state]]
      for (const pair of pairs) {
        expect(pair.title.length).toBeGreaterThan(0)
        expect(pair.explanation.length).toBeGreaterThan(0)
      }
    }
    expect(copy.failed.capture).not.toEqual(copy.failed.load)
  }
  expect(new Set(tabKinds.map(kind => view.EVIDENCE_COPY[kind]['not-captured'].title)).size).toBe(6)
  const frame = view.EVIDENCE_COPY.frame
  for (const pair of [frame['not-captured']['sub-action'], frame['not-captured'].step, frame.unavailable, frame.failed.load]) {
    expect(pair.title.length).toBeGreaterThan(0)
    expect(pair.explanation.length).toBeGreaterThan(0)
  }
  expect(Object.keys(view.EVIDENCE_RETRY_LABELS).sort()).toEqual([...view.EVIDENCE_KIND_LABELS].sort())
  expect(view.EVIDENCE_INCOMPLETE_EXPLANATION).toBe(`${EVIDENCE_INCOMPLETE_LABEL} — this was recorded, but the saved file is no longer on disk.`)
  expect(frame.unavailable.explanation).toBe(view.EVIDENCE_INCOMPLETE_EXPLANATION)
  expect(view.RECORDED_ELSEWHERE_LABEL(3)).toBe('Recorded on step 3')
  expect(view.GO_TO_STEP_LABEL(3)).toBe('Go to step 3')
  expect(view.EVIDENCE_LOADING_LABEL).toBe('Loading records')
})

test('C424-COPY-RULES', () => {
  for (const kind of tabKinds) {
    const copy = view.EVIDENCE_COPY[kind]
    expect(copy).toBeDefined()
    expect(`${copy['not-captured'].title} ${copy['not-captured'].explanation}`).not.toMatch(/disabled|turned off|switched off|not scheduled/i)
    expect(copy.unavailable.explanation).toContain('not recorded')
    expect(copy.failed.capture.explanation).toContain('nothing to retry')
    expect(copy.failed.load.explanation).not.toContain('nothing to retry')
  }
})
