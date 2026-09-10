import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../canonical-json'
import type { CorpusEntry } from '../../labels/corpus-entry'
import { createLabelRevision, selectEffectiveLabels } from '../../labels/effective-labels'
import type { StandaloneLabelRecord } from '../../labels/label-record'
import { deriveCensus, type CommittedCorpusSnapshot } from '../derive-census'
import { renderCensusMarkdown } from '../render-census'

const entry = (cassetteId: string): CorpusEntry => ({ schemaVersion: 2, cassetteId,
  product: 'actual-product', split: 'natural', captured_at_ordinal: 1,
  run_links: { runId: 'run-fixture', runSlug: 'run-fixture' }, receiptDigest: 'a'.repeat(64) })
const label = (cassetteId: string, pairedCassetteId?: string): StandaloneLabelRecord => ({
  schemaVersion: 1, cassetteId,
  label: { sourceChannel: pairedCassetteId ? 'self-heal-pair' : 'recorded-verdict',
    tier: pairedCassetteId ? 'near-gold' : 'silver',
    ...(pairedCassetteId ? { pairing: { pairedCassetteId, relation: 'contrastive-positive' as const } } : {}) },
  provenance: { runId: 'run-fixture', runSlug: 'run-fixture', capturedAtOrdinal: 1,
    receiptDigest: 'a'.repeat(64), rerun: { attempt: 2 } },
})
function census(history: readonly unknown[], ids: string[]) {
  const selected = selectEffectiveLabels(history)
  const members = new Map(ids.map(id => [id, entry(id)]))
  const snapshot: CommittedCorpusSnapshot = {
    entries: [...members.values()].filter(row => !selected.excludedLabelIds.has(row.cassetteId)),
    labelsById: selected.effective, labelHistory: history, excludedLabelIds: selected.excludedLabelIds,
    cassettesById: new Map(), blobPresentById: new Map(),
  }
  return deriveCensus({ snapshot, corpusEntriesById: members } as Parameters<typeof deriveCensus>[0])
}

describe('420 committed label audit census', () => {
  it('counts logical rerun pairs, normal silver and retired originals once across repeated histories', () => {
    const original = label('opaque-original')
    delete original.provenance.rerun
    const quarantine = createLabelRevision(original, { quarantine: 'rerun-overturned' })
    const history = [label('opaque-a', 'opaque-b'), label('opaque-b', 'opaque-a'),
      label('opaque-silver'), original, quarantine]
    const ids = ['opaque-a', 'opaque-b', 'opaque-silver', 'opaque-original']
    const result = census(history, ids)
    expect(result.products['actual-product']).toMatchObject({ total: 3,
      scorableByTier: { tier1: 3 }, labelAudit: { committedMembers: 4, scorableMembers: 3,
        rerunPairs: 1, rerunMarkedLabels: 3, rerunOverturnedOriginals: 1,
        rerunOverturnQuarantined: 1, refusedHistories: 0 } })
    expect(canonicalJson(census([...history, ...history].reverse(), [...ids].reverse())))
      .toBe(canonicalJson(result))
    expect(renderCensusMarkdown(result)).toContain('- committedMembers: 4')
    expect(renderCensusMarkdown(result)).toContain('- rerunPairs: 1')
  })

  it('counts an excluded-only product and guards refused raw histories without guessing ownership', () => {
    const raw = { cassetteId: 'opaque-invalid', quarantine: 'rerun-overturned' }
    const result = census([raw, raw, null, { cassetteId: 'unknown-product-id' }], ['opaque-invalid'])
    expect(result.products['actual-product']).toMatchObject({ total: 0, labelAudit: {
      committedMembers: 1, scorableMembers: 0, refusedHistories: 1,
      rerunPairs: 0, rerunMarkedLabels: 0, rerunOverturnedOriginals: 0, rerunOverturnQuarantined: 0 } })
    expect(Object.keys(result.products)).toEqual(['actual-product'])
  })

  it('does not invent missing originals or pairs for normal silver reruns', () => {
    expect(census([label('opaque-silver')], ['opaque-silver']).products['actual-product'])
      .toMatchObject({ labelAudit: { rerunMarkedLabels: 1, rerunPairs: 0,
        rerunOverturnedOriginals: 0, rerunOverturnQuarantined: 0 } })
  })

  it('keeps old unmarked and empty census bytes unchanged', () => {
    const ordinary = label('opaque-legacy')
    delete ordinary.provenance.rerun
    for (const result of [census([], []), census([ordinary], ['opaque-legacy'])]) {
      expect(canonicalJson(result)).not.toContain('labelAudit')
      expect(renderCensusMarkdown(result)).not.toContain('labelAudit')
    }
  })
})
