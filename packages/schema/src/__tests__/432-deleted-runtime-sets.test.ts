// 2026-09-30, 432-09 (D-03/D-04/D-15/D-22/D-25): the runtime key sets beside the types they pin.
//
// First created by 432-09, which narrows the mark, marks-history, preview, digest and run-knowledge
// outputs to applied changes and the mark refusal to a plain reason. Later owners (432-18/19/22/39/42)
// extend this file with their own removed members only. Every expected set is spelled by hand, so no
// expectation is derived from the production value it checks.
import { describe, expect, it } from 'vitest'

import * as schema from '../index'

type Shaped = { shape: Record<string, { value?: unknown }> }
type Options = { options: readonly Shaped[] }

const keysOf = (value: unknown): string[] => Object.keys((value as Shaped).shape).sort()
const armOf = (union: unknown, key: string, literal: string): Shaped | undefined =>
  (union as Options).options.find(option => option.shape[key]?.value === literal)
const sorted = (values: readonly string[]) => [...values].sort()
const exported = (name: string) => (schema as Record<string, unknown>)[name]

describe('432-09 applied output key sets', () => {
  it('C432-RUNTIME-SETS: marks, history, preview, digest and run knowledge carry applied changes and no inbox member', () => {
    expect(exported('MARK_DISPOSITIONS'), 'the written dispositions')
      .toEqual(['quarantined', 'applied', 'no-draftable-fix', 'confirmed-bug'])
    expect(exported('MARK_HISTORICAL_DISPOSITIONS'), 'read, never written').toEqual(['drafted'])
    expect(exported('MARK_APPLIED_CHANGE_KINDS')).toEqual(['knowledge', 'test-file'])

    const dispositions = exported('MarkDispositionSchema')
    expect(armOf(dispositions, 'kind', 'applied'), 'the applied arm').toBeDefined()
    expect((dispositions as Options).options.map(option => option.shape.kind!.value))
      .toEqual(['quarantined', 'applied', 'no-draftable-fix', 'confirmed-bug', 'drafted'])
    expect(keysOf(armOf(dispositions, 'kind', 'applied')), 'an applied fix names its change, never a proposal')
      .toEqual(sorted(['kind', 'fix', 'change']))

    const changes = exported('MarkAppliedChangeSchema')
    expect(keysOf(armOf(changes, 'kind', 'knowledge'))).toEqual(sorted(['kind', 'changeId', 'recordIds']))
    expect(keysOf(armOf(changes, 'kind', 'test-file'))).toEqual(sorted(['kind', 'filePath', 'contentDigest']))

    expect(keysOf(exported('MarkHistoryEntrySchema')), 'history projects the applied change, not an inbox state')
      .toEqual(sorted([
        'markId', 'runId', 'testIndex', 'testId', 'stepIndex', 'kind', 'origin', 'ordinal', 'markedAt',
        'rootCause', 'isRerun', 'disposition', 'gold', 'evidence', 'supersedes', 'note', 'corrected',
        'active', 'supersededBy', 'changedRecords',
      ]))

    const preview = exported('RunsMarkPreviewResultSchema')
    expect(keysOf(armOf(preview, 'kind', 'consequences')), 'a later mark withdraws nothing')
      .toEqual(sorted([
        'kind', 'runId', 'prospective', 'markKind', 'member', 'resolvedStep', 'latest', 'basis',
        'markedDecisionCount', 'groundTruth', 'labels', 'knowledge', 'draft',
      ]))

    expect(keysOf(exported('RunDigestSchema')), 'the digest reads applied mark changes, never the inbox')
      .toEqual(sorted([
        'runId', 'verdictClusters', 'chain', 'markChanges', 'candidates', 'quarantine', 'lines',
      ]))
    expect(keysOf(exported('RunDigestMarkChangeSchema'))).toEqual(sorted(['markId', 'ordinal', 'fix', 'change']))

    expect(keysOf(armOf(exported('RunKnowledgeProjectionSchema'), 'kind', 'ready')), 'no pending inbox count')
      .toEqual(sorted([
        'kind', 'runId', 'buildOrdinal', 'knowledgeStore', 'retrievalRung', 'steps', 'curation', 'learned',
      ]))

    for (const name of [
      'MARK_PROPOSAL_STATES', 'MarkProposalCurrentSchema', 'MarkPreviewWithdrawalSchema',
      'RunDigestProposalRowSchema',
    ]) expect(exported(name), `${name} is gone from the schema barrel`).toBeUndefined()
  })

  it('C432-PLAIN-REFUSAL: a refused mark answers a plain reason and nothing a caller must act on', () => {
    const refusal = exported('MarkRefusalSchema')
    expect(refusal, 'the plain mark refusal is a shared contract').toBeDefined()
    expect(keysOf(refusal)).toEqual(sorted(['error', 'reason']))
    const parse = (value: unknown) => (refusal as { safeParse(value: unknown): { success: boolean } }).safeParse(value)
    expect(parse({ error: 'mark_denied', reason: 'The mark could not be recorded.' }).success).toBe(true)
    expect(parse({ error: 'mark_denied', reason: 'x', remedies: [] }).success, 'no remedy list rides a refusal').toBe(false)
  })
})
