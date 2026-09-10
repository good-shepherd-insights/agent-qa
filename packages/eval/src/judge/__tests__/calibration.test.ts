import { describe, expect, it } from 'vitest'
import { asRef, type Action, type MarkReceipt } from '@vostride/agent-qa-schema'
import * as core from '../../index'
import { MATCHER_CONFIG } from '../../match/config'
import { makeArtifactRefV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'

function fixture(kind: MarkReceipt['kind'] = 'confirmed-bug', correction?: Action) {
  const handoff = makeArtifactRefV2Handoff()
  handoff.tests[0]!.steps = [handoff.tests[0]!.steps[0]!]
  handoff.tests[0]!.steps[0]!.verifierVerdict = { pass: false, reasoning: 'recorded fail' }
  const source = core.extractRunCassettes({ handoff, artifacts: { getBlob: () => new Uint8Array([1]) } })
    .cassettes.find(row => row.cassette.granularity === 'leaf')!.cassette as core.LeafCassette
  const mark: MarkReceipt = { schemaVersion: 1, markId: 'mark_abcdef012345', runId: handoff.runId,
    runSlug: core.deriveRunSlug(handoff.runId), testIndex: 0, stepIndex: 0, kind, origin: 'user',
    ordinal: 1, markedAt: 0, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 }, gold: [],
    evidence: { confirmed: 0, overturned: 0 }, ...(correction ? { correctedAction: correction } : {}) }
  const frozen = core.buildGoldenTrajectoryPlan({ handoff, cassettes: [{ cassette: source, blobs: [] }], mark, product: 'shop' })
  const snapshot: core.CommittedCorpusSnapshot = {
    entries: [core.projectCorpusEntry({ cassette: source, product: 'shop', runId: source.runId, assignment: { split: 'natural' } }), ...frozen.cases.map(row => row.corpusEntry)],
    labelsById: new Map([[source.id, core.projectSilverLabelRecord({ cassette: source, runId: source.runId })], ...frozen.cases.map(row => [row.cassetteId, row.labelRecord] as const)]),
    cassettesById: new Map([[source.id, source], ...frozen.goldCassettes.map(row => [row.cassette.id, row.cassette as core.LeafCassette] as const)]),
    blobPresentById: new Map(),
  }
  mark.gold = frozen.cases.map(row => ({ cassetteId: row.cassetteId, sourceCassetteId: source.id, channel: row.labelRecord.label.sourceChannel as 'user-mark' | 'overturned-verdict' }))
  return { snapshot, marks: [mark], source }
}
const select = (input: ReturnType<typeof fixture>) => Reflect.get(core, 'selectJudgeCalibrationGold')?.(input)
const truth = (gold: core.JudgeCalibrationGold, action: Action) => Reflect.get(core, 'resolveJudgeCalibrationTruth')?.({
  gold, candidate: { sampleIndex: 0, durationMs: 1, outcome: { kind: 'decision', action,
    identity: core.computeDecisionIdentity(action, (gold as { cassette: core.LeafCassette }).cassette.input.stateBefore.elements) } },
})

describe('judge calibration independent source truth', () => {
  it('selects one executable private source despite recorded FAIL', () => {
    const input = fixture(), selected = select(input)
    expect(selected?.gold).toHaveLength(1)
    expect(truth(selected.gold[0], input.source.sidecar.goldAction)).toMatchObject({ kind: 'resolved', fullMatch: true, provenance: 'deterministic-full-match' })
  })
  it('newest empty mark retires old gold and changes digest', () => {
    const input = fixture(), before = select(input)
    input.marks.push({ ...input.marks[0]!, ordinal: 2, gold: [] })
    expect(select(input)?.gold).toEqual([])
    expect(select(input)?.goldSetDigest).not.toBe(before?.goldSetDigest)
  })
  it('deduplicates executable user-mark and overturned siblings', () => {
    const input = fixture('false-pass', { type: 'click', ref: asRef('e-continue-1') })
    expect(select(input)?.gold).toHaveLength(1)
    expect(select(input)).toEqual(select({ ...input, marks: [...input.marks, ...input.marks] }))
  })
  it('never uses verifier mark Boolean for wrong-op full-match truth', () => {
    const input = fixture(), selected = select(input)
    expect(selected?.gold).toHaveLength(1)
    expect(truth(selected.gold[0], { type: 'hover', ref: asRef('e-continue-1') })).toMatchObject({ kind: 'resolved', fullMatch: false })
  })
  it('admits correction while leaving a distinct ambiguous target unresolved', () => {
    const input = fixture('false-pass', { type: 'click', ref: asRef('e-continue-1') }), selected = select(input)
    expect(selected?.gold).toHaveLength(1)
    expect(truth(selected.gold[0], { type: 'click', ref: asRef('e-continue-2') })).toMatchObject({ kind: 'unresolved', reason: 'truth-unresolved' })
    expect(truth(selected.gold[0], { type: 'click', ref: asRef('e-continue-1') })).toMatchObject({ kind: 'resolved', fullMatch: true, provenance: 'grounded-correction' })
  })
  it.each(['private', 'excluded', 'quarantine', 'foreign-step', 'missing-source'])('skips invalid %s gold', mode => {
    const input = fixture(), id = input.marks[0]!.gold[0]!.cassetteId
    if (mode === 'private') (input.snapshot.entries.find(row => row.cassetteId === id)! as { heldOutVisibility: string }).heldOutVisibility = 'public'
    if (mode === 'excluded') input.snapshot.excludedLabelIds = new Set([id])
    if (mode === 'quarantine') input.snapshot.labelsById.get(id)!.quarantine = { reason: 'fixture' } as never
    if (mode === 'foreign-step') input.snapshot.cassettesById.get(id)!.stepIndex = 99
    if (mode === 'missing-source') input.snapshot.cassettesById = new Map([...input.snapshot.cassettesById].filter(([id]) => id !== input.source.id))
    expect(select(input)?.gold).toEqual([])
    expect(Object.values(select(input)?.skippedCounts ?? {}).some(n => Number(n) > 0)).toBe(true)
  })
  it('names nonexecutable correction instead of borrowing recorded action', () => {
    const selected = select(fixture('false-pass'))
    expect(selected?.gold).toEqual([])
    expect(selected?.skippedCounts['missing-executable-correction']).toBeGreaterThan(0)
  })
  it('keeps raw recorded model provenance and genuine absence', () => {
    const input = fixture()
    input.source.receipt.model = { declared: { provider: 'custom', modelId: 'unlisted-raw' }, resolvedModelId: 'fallback' }
    expect(select(input)?.gold[0]).toMatchObject({ recordedModelId: 'unlisted-raw', recordedReceipt: { cassetteId: input.source.id } })
    input.source.receipt.model = {}
    expect(select(input)?.gold[0]).not.toHaveProperty('recordedModelId')
  })
  it('panel axis overlay preserves operation, value, side-effect and loop gates', () => {
    const score: core.DecisionScore = { kind: 'scored', matcherVersion: MATCHER_CONFIG.matcherVersion, tierReached: 2,
      axes: { elementIdentity: { kind: 'scored', level: 'partial' } as never, opClass: { kind: 'match' } as never, value: { kind: 'not-applicable' } },
      sideEffect: { kind: 'none' }, loop: { kind: 'not-flagged' } as never }
    const overlay = (value: core.DecisionScore) => Reflect.get(core, 'judgeCalibrationFullMatch')?.(value, { axis: 'element-identity', resolution: 'equivalent' })
    expect(overlay(score)).toBe(true)
    expect(overlay({ ...score, axes: { ...score.axes, opClass: { kind: 'mismatch' } as never } })).toBe(false)
    expect(overlay({ ...score, axes: { ...score.axes, value: { kind: 'scored', f1: 0, band: 'low' } } })).toBe(false)
    expect(overlay({ ...score, sideEffect: { kind: 'unexpected' } as never })).toBe(false)
    expect(overlay({ ...score, loop: { kind: 'flagged' } as never })).toBe(false)
  })
})
