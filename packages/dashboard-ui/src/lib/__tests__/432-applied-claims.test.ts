// 2026-10-02, 432 Nyquist audit (prohibition 2): an applied-change line says what the receipt recorded
// (records added, a file written) and nothing the receipt cannot establish: not that the fix was
// published, served or is live for the next run, and not that anything awaits a review.
import { describe, expect, it } from 'vitest'
import * as feedbackView from '@/lib/feedback-view'

const OVERCLAIM = /\b(publish|published|serv(e|ed|ing)|live|in use|next run|deployed|active now|approv|pending|awaits?|review)/iu

const fixes = ['fact', 'caution', 'procedure-hint', 'test-edit'] as const
const knowledgeFixes = ['fact', 'caution', 'procedure-hint'] as const

function appliedKnowledge(fix: (typeof knowledgeFixes)[number], recordIds: string[]) {
  return { kind: 'applied', fix, change: { kind: 'knowledge', changeId: 'prop_aaaaaaaaaaaa', recordIds } } as const
}

describe('432 prohibition 2: applied-change presentation claims only what the receipt recorded', () => {
  it('C432-NYQ-APPLIED-NO-OVERCLAIM: no receipt, history or preview sentence claims publication, serving or a pending review', () => {
    const sentences: string[] = []
    const dispositions = [
      ...knowledgeFixes.map((fix) => appliedKnowledge(fix, ['mem_1'])),
      { kind: 'applied', fix: 'test-edit', change: { kind: 'test-file', filePath: 'tests/a.yaml', contentDigest: 'sha256:x' } },
      { kind: 'drafted', fix: 'fact', proposalId: 'prop_0123456789ab', proposalKind: 'knowledge' },
      { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: false } },
      { kind: 'confirmed-bug', confirmedRecords: 1 },
      { kind: 'quarantined', class: 'flake' },
      // 2026-10-03 (quick 261003-mqc): the refused-fix receipt claims nothing changed.
      { kind: 'not-applied', fix: 'fact', reason: 'target-not-found' },
      { kind: 'not-applied', fix: 'test-edit', reason: 'outside-workspace' },
    ] as unknown as Parameters<typeof feedbackView.dispositionText>[0][]
    for (const disposition of dispositions) {
      sentences.push(feedbackView.dispositionText(disposition), feedbackView.feedbackRecordedText(disposition))
      const view = feedbackView.appliedChangeView({ disposition, changedRecords: [] } as never)
      if (view !== undefined) sentences.push(feedbackView.appliedChangeText(view))
    }
    for (const fix of fixes) {
      const draft = fix === 'test-edit'
        ? { kind: 'test-edit', testRef: 'tests/a.yaml::a' }
        : { kind: 'knowledge', fix, target: { grain: 'bundle', id: 'mem_1' } }
      sentences.push(feedbackView.previewFixText(draft as never))
    }
    sentences.push(feedbackView.replacesLine(1, undefined), feedbackView.APPLIED_UNAVAILABLE_TEXT)

    expect(sentences.length).toBeGreaterThanOrEqual(20)
    for (const sentence of sentences) expect(sentence, sentence).not.toMatch(OVERCLAIM)
  })

  it('C432-NYQ-APPLIED-RECEIPT-BOUND: the history line names exactly the receipt\'s records, and invents no content', () => {
    const view = feedbackView.appliedChangeView({
      disposition: appliedKnowledge('fact', ['mem_b', 'mem_a']),
      changedRecords: [
        { recordId: 'mem_a', recordContent: { content: 'A is true.' } },
        { recordId: 'mem_x', recordContent: { content: 'Not part of this change.' } },
      ],
    } as never)
    expect(view).toEqual({ kind: 'knowledge', records: [{ recordId: 'mem_b' }, { recordId: 'mem_a', content: 'A is true.' }] })
    const text = feedbackView.appliedChangeText(view!)
    expect(text).toBe('Changed knowledge: mem_b (content unavailable); “A is true.”')
    expect(text).not.toContain('Not part of this change.')
    expect(text).not.toContain('mem_x')
  })

  it('C432-NYQ-APPLIED-NO-RECEIPT-NO-CHANGE: a receipt that recorded no change shows no changed line at all', () => {
    for (const disposition of [
      { kind: 'no-draftable-fix', checked: { servedRecords: 3, procedureReads: 1, assertionDrift: true } },
      { kind: 'confirmed-bug', confirmedRecords: 4 },
      { kind: 'quarantined', class: 'flake' },
    ]) {
      expect(feedbackView.appliedChangeView({ disposition, changedRecords: [
        { recordId: 'mem_1', recordContent: { content: 'stray joined record' } },
      ] } as never), disposition.kind).toBeUndefined()
    }
  })
})
