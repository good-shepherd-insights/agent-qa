import { describe, expect, it } from 'vitest'

import { runsMarkPreviewSpec } from '../ops/runs-mark-preview'
import { runsMarkSpec } from '../ops/runs-mark'
import { runsMarksHistorySpec } from '../ops/runs-marks-history'
import { OPTIONAL_FUNCTION_DEP_KEYS } from '../spec'

describe('optional function dep keys (419 GATE3-01)', () => {
  it('pins every host binding by name and declaration order', () => {
    expect([...OPTIONAL_FUNCTION_DEP_KEYS]).toEqual([
      'liveView',
      'runInvocation',
      'knowledgeReview',
      'postProcessing',
      'runDetail',
      'evidenceBlobs',
      'analysis',
      'recurrence',
      'quarantine',
      'proposalsInbox',
      'standingGrants',
      'chatTurn',
      'draftEvaluation',
      'authoringRead',
      'authoringScope',
      'draftShelf',
      'authoringFunnel',
      'draftApply',
      'authoringProposals',
      'configFiles',
      'configValidate',
      'configApply',
      'configProposals',
      'configScan',
      'configUndoSource',
      'scaffoldContent',
      'capabilityCatalog',
      'feedback',
      'feedbackReads',
    ])
  })

  it('has exactly 29 optional bindings', () => {
    expect(OPTIONAL_FUNCTION_DEP_KEYS).toHaveLength(29)
  })
})

// 2026-09-15, 423-37: an independent oracle for plan 423-23's mutation, spelled by hand again
// rather than shared with the pin above.
const EXPECTED_BINDINGS = [
  'liveView', 'runInvocation', 'knowledgeReview', 'postProcessing', 'runDetail', 'evidenceBlobs',
  'analysis', 'recurrence', 'quarantine', 'proposalsInbox', 'standingGrants', 'chatTurn',
  'draftEvaluation', 'authoringRead', 'authoringScope', 'draftShelf', 'authoringFunnel', 'draftApply',
  'authoringProposals', 'configFiles', 'configValidate', 'configApply', 'configProposals', 'configScan',
  'configUndoSource', 'scaffoldContent', 'capabilityCatalog', 'feedback', 'feedbackReads',
]

describe('C423-FEEDBACK-BINDINGS-EXACT', () => {
  it('pins the runtime roster exactly, with no missing, extra or repeated binding', () => {
    expect([...OPTIONAL_FUNCTION_DEP_KEYS]).toEqual(EXPECTED_BINDINGS)
    expect(new Set(OPTIONAL_FUNCTION_DEP_KEYS).size).toBe(OPTIONAL_FUNCTION_DEP_KEYS.length)
    expect(OPTIONAL_FUNCTION_DEP_KEYS.filter(key => key.startsWith('feedback'))).toEqual(['feedback', 'feedbackReads'])
  })

  it('binds the mark writer through feedback and both feedback reads through feedbackReads', () => {
    const bindings = [runsMarkSpec, runsMarksHistorySpec, runsMarkPreviewSpec].map(op => [op.id, op.boundThrough])
    expect(bindings).toEqual([
      ['runs.mark', 'feedback'],
      ['runs.marks.history', 'feedbackReads'],
      ['runs.mark.preview', 'feedbackReads'],
    ])
    expect([runsMarksHistorySpec, runsMarkPreviewSpec].map(op => [op.requiredScopes, op.risk.readOnly])).toEqual([
      [['read'], true],
      [['read'], true],
    ])
  })
})
