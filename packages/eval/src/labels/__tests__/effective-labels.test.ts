import { describe, expect, it } from 'vitest'
import * as api from '../../index'
import type { StandaloneLabelRecord } from '../label-record'

function base(): StandaloneLabelRecord {
  return {
    schemaVersion: 1,
    cassetteId: api.deriveLeafCassetteId({ runSlug: api.deriveRunSlug('revision fixture'), testIndex: 0, stepIndex: 0, decisionOrdinal: 0 }),
    label: { sourceChannel: 'recorded-verdict', tier: 'silver', verdict: { pass: false, reasoning: 'original' } },
    provenance: { runId: 'revision fixture', runSlug: api.deriveRunSlug('revision fixture'), capturedAtOrdinal: 1, receiptDigest: 'a'.repeat(64) },
  }
}

describe('420 effective label histories', () => {
  it('parses legacy v1 bytes unchanged', () => {
    const record = base()
    expect(api.parseStandaloneLabelRecord?.(record)).toEqual({ ok: true, record })
  })

  it('selects the same terminal from permuted history and duplicate bytes', () => {
    expect(api.selectEffectiveLabels).toBeTypeOf('function')
    const original = base()
    const next = api.createLabelRevision(original, { quarantine: 'rerun-overturned' })
    for (const history of [[original, next], [next, original, next]]) {
      const result = api.selectEffectiveLabels(history)
      expect(result.refusals).toEqual([])
      expect(result.effective.get(original.cassetteId)).toEqual(next)
      expect(result.history).toHaveLength(history.length)
      expect(result.excludedLabelIds.has(original.cassetteId)).toBe(true)
    }
    expect(next.provenance).toEqual(original.provenance)
    expect(next.label).toEqual(original.label)
    expect(next.supersedes).toBe(api.deriveLabelRevisionId(original))
    expect(api.createLabelRevision(next, { quarantine: 'rerun-overturned' })).toEqual(next)
  })

  it('does not reinterpret historic gold supersedes as a revision predecessor', () => {
    expect(api.selectEffectiveLabels).toBeTypeOf('function')
    const record = { ...base(), supersedes: 'historic-gold-cassette' }
    expect(api.selectEffectiveLabels([record]).effective.get(record.cassetteId)).toEqual(record)
  })

  it('requires explicit committed authorization for calibration generations', () => {
    expect(api.selectEffectiveLabels).toBeTypeOf('function')
    const original = base()
    const next = api.createLabelRevision(original, { quarantine: 'rerun-overturned' }, 'generation-1')
    expect(api.selectEffectiveLabels([next, original]).effective.get(original.cassetteId)).toEqual(original)
    expect(api.selectEffectiveLabels([next, original], { committedGenerationIds: new Set(['generation-1']) }).effective.get(original.cassetteId)).toEqual(next)
  })

  it('refuses forks, dangling and foreign predecessors and contradictory roots', () => {
    expect(api.selectEffectiveLabels).toBeTypeOf('function')
    const original = base()
    const next = api.createLabelRevision(original, { quarantine: 'rerun-overturned' })
    const sibling = api.createLabelRevision(original, { provenance: { ...original.provenance, rerun: { attempt: 1 } } })
    const foreign = { ...base(), cassetteId: api.deriveLeafCassetteId({ runSlug: api.deriveRunSlug('other'), testIndex: 0, stepIndex: 0, decisionOrdinal: 0 }) }
    for (const [history, reason] of [
      [[original, next, sibling], 'fork'],
      [[next], 'dangling-predecessor'],
      [[{ ...next, cassetteId: foreign.cassetteId }, original, foreign], 'foreign-predecessor'],
      [[original, { ...original, label: { ...original.label, verdict: { pass: true, reasoning: 'conflict' } } }], 'conflicting-roots'],
    ] as const) {
      const result = api.selectEffectiveLabels(history)
      expect(result.refusals.map(row => row.reason)).toContain(reason)
      expect(result.effective.has(history[0]!.cassetteId)).toBe(false)
      expect(result.excludedLabelIds.has(history[0]!.cassetteId)).toBe(true)
    }
  })

  it('refuses cycles and forged content identity without scoring fallback', () => {
    expect(api.selectEffectiveLabels).toBeTypeOf('function')
    const original = base()
    const next = api.createLabelRevision(original, { quarantine: 'rerun-overturned' })
    const forged = { ...next, quarantine: undefined }
    expect(api.selectEffectiveLabels([original, forged]).refusals.map(row => row.reason)).toContain('revision-id-mismatch')
    const id = 'b'.repeat(64)
    const cycle = { ...next, supersedes: id, revision: { id, predecessorId: id } }
    expect(api.selectEffectiveLabels([cycle]).refusals.map(row => row.reason)).toContain('cycle')
    const changed = api.createLabelRevision(original, { label: { ...original.label, verdict: { pass: true, reasoning: 'rewritten' } } })
    expect(api.selectEffectiveLabels([original, changed]).refusals.map(row => row.reason)).toContain('immutable-identity-changed')
  })

  it('validates numerical weights and refuses malformed authoritative records', () => {
    expect(api.parseStandaloneLabelRecord).toBeTypeOf('function')
    const weight = { value: .75, k: 1, n: 1, verdictSource: 'user-gold', verdictFactor: 1, capabilityTier: 'full', tierFactor: 1, alpha0: 2, beta0: 1, corpusDigest: 'c'.repeat(64), evidenceDigest: 'd'.repeat(64), capabilityEvidence: { kind: 'missing' } } as const
    expect(api.parseStandaloneLabelRecord({ ...base(), weight }).ok).toBe(true)
    const weighted = api.createLabelRevision(base(), { weight })
    expect(api.createLabelRevision(weighted, { weight: { ...weight } })).toEqual(weighted)
    expect(api.selectEffectiveLabels([base(), weighted]).effective.get(weighted.cassetteId)).toEqual(weighted)
    for (const patch of [{ value: NaN }, { value: 2 }, { verdictFactor: -1 }, { tierFactor: Infinity }, { k: 2 }, { n: .1 }, { n: Number.MAX_SAFE_INTEGER + 1 }, { alpha0: 0, beta0: 0 }, { alpha0: Number.MAX_VALUE, beta0: Number.MAX_VALUE }]) {
      expect(api.parseStandaloneLabelRecord({ ...base(), weight: { ...weight, ...patch } }).ok).toBe(false)
    }
    const malformed = { ...base(), provenance: {} }
    const result = api.selectEffectiveLabels([base(), malformed])
    expect(result.effective.size).toBe(0)
    expect(result.refusals.map(row => row.reason)).toContain('invalid-record')
    expect(api.parseStandaloneLabelRecord({ ...base(), quarantine: 'rerun-overturned' }).ok).toBe(false)
    expect(api.selectEffectiveLabels([weighted, { ...weighted, weight: { ...weight, value: .5 } }]).refusals.map(row => row.reason)).toContain('conflicting-id')
  })
})
