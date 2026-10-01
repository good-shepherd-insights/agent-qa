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
  // 2026-10-01, 432-18 (D-03/D-15): standingGrants leaves with the grant ops and the ledger, so
  // 24 - 1 = 23.
  it('has exactly 23 optional bindings', () => {
    expect(OPTIONAL_FUNCTION_DEP_KEYS).toHaveLength(23)
  })
})

// 2026-09-15, 423-37: an independent oracle for plan 423-23's mutation, spelled by hand again
// rather than shared with the pin above.
// 2026-10-01, 432-17: the six proposal, apply and undo bindings leave the hand-spelled roster too.
// 2026-10-01, 432-18: standingGrants leaves it with the grant ops.
const EXPECTED_BINDINGS = [
  'liveView', 'runInvocation', 'knowledgeReview', 'postProcessing', 'runDetail', 'evidenceBlobs',
  'analysis', 'recurrence', 'quarantine', 'chatTurn',
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
    // RE-SPELLED 2026-10-01 (432-24, D-12): runs.mark.preview declares no scope now; both reads
    // keep their read-only risk. runs.marks.history keeps ['read'] until its own owner.
    expect([runsMarksHistorySpec, runsMarkPreviewSpec].map(op => op.risk.readOnly)).toEqual([true, true])
    expect(runsMarksHistorySpec.requiredScopes).toEqual(['read'])
    expect(runsMarkPreviewSpec).not.toHaveProperty('requiredScopes')
  })
})

// 2026-10-01, 432-18 (D-03/D-15): the standing-grant port leaves FunctionDeps with both rosters. The
// type half of this claim is the same-named block in port-split.test-d.ts; this is the runtime half.
describe('C432-GRANT-DEPS-ABSENT', () => {
  it('C432-GRANT-DEPS-ABSENT: no optional binding names a grant port, and the roster counts 23', () => {
    const roster: readonly string[] = OPTIONAL_FUNCTION_DEP_KEYS
    expect(roster.includes('standingGrants'), 'standingGrants is still an optional binding').toBe(false)
    expect(roster.filter(key => /grant/i.test(key)), 'a grant-shaped binding replaced it').toEqual([])
    expect(roster).toHaveLength(23)
    expect(EXPECTED_BINDINGS).toHaveLength(23)
  })
})
