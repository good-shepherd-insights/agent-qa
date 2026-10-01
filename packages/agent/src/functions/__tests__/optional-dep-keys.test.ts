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
      'standingGrants',
      'chatTurn',
      'draftEvaluation',
      'authoringRead',
      'authoringScope',
      'draftShelf',
      'authoringFunnel',
      'configFiles',
      'configValidate',
      'configScan',
      'scaffoldContent',
      'capabilityCatalog',
      'feedback',
      'feedbackReads',
      'configWrite',
    ])
  })

  // 2026-09-30, 432-07: configWrite, the direct config writer, is the thirtieth binding.
  // 2026-10-01, 432-17 (D-05/D-07/D-09): proposalsInbox, draftApply, authoringProposals,
  // configApply, configProposals and configUndoSource leave with the inbox, the apply ops and the
  // undo, so 30 - 6 = 24.
  it('has exactly 24 optional bindings', () => {
    expect(OPTIONAL_FUNCTION_DEP_KEYS).toHaveLength(24)
  })
})

// 2026-09-15, 423-37: an independent oracle for plan 423-23's mutation, spelled by hand again
// rather than shared with the pin above.
// 2026-10-01, 432-17: the six proposal, apply and undo bindings leave the hand-spelled roster too.
const EXPECTED_BINDINGS = [
  'liveView', 'runInvocation', 'knowledgeReview', 'postProcessing', 'runDetail', 'evidenceBlobs',
  'analysis', 'recurrence', 'quarantine', 'standingGrants', 'chatTurn',
  'draftEvaluation', 'authoringRead', 'authoringScope', 'draftShelf', 'authoringFunnel',
  'configFiles', 'configValidate', 'configScan',
  'scaffoldContent', 'capabilityCatalog', 'feedback', 'feedbackReads',
  'configWrite',
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
