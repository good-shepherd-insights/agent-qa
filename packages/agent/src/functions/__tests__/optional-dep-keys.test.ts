import { describe, expect, it } from 'vitest'

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
    ])
  })

  it('has exactly 28 optional bindings', () => {
    expect(OPTIONAL_FUNCTION_DEP_KEYS).toHaveLength(28)
  })
})
