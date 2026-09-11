import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@vostride/agent-qa-eval'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, sha256hex, slugBranch, type MarkReceipt } from '@vostride/agent-qa-schema'
import { afterEach, expect, it } from 'vitest'
import * as local from '../index.js'
import * as reader from '../reader.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const digest = (value: unknown) => sha256hex(core.canonicalJson(value))
function fixture(model: core.CassetteModelReceipt = { declared: { provider: 'openai', modelId: 'gpt-5' } }) {
  const root = mkdtempSync(join(tmpdir(), 'judge-calibration-evidence-')); roots.push(root)
  const committedRoot = join(root, 'committed')
  const handoff = makeLocalV2Handoff({ runId: asRunId('judge-calibration-local'), scope: { tier: 'product', key: 'shop' } })
  handoff.tests[0]!.steps = [handoff.tests[0]!.steps[0]!]
  for (const sub of handoff.tests[0]!.steps[0]!.subActions) sub.stateBefore.timestamp = 1_725_000_000
  const run = join(root, 'runs', core.deriveRunSlug(handoff.runId)); mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'handoff.json'), JSON.stringify(handoff))
  new FsEvidenceArtifactStore({ root, runId: handoff.runId }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
  const cassettes = core.extractRunCassettes({ handoff, artifacts: new local.FsRunArtifactSource({ root, runId: handoff.runId }) }).cassettes
  const source = cassettes.find(row => row.cassette.granularity === 'leaf')!.cassette as core.LeafCassette
  source.receipt.model = model
  const plan = core.buildSeedingPlan({ handoff, cassettes, partition: { saltHex: 'a'.repeat(64), heldOutFraction: 0.000001, privateFraction: 0.5 } })
  const seeded = local.seedCommittedCorpus({ plan, cassettes, committedRoot, seedingOutputBaseDir: join(root, 'seed') })
  if (seeded.refusals.length) throw new Error('Fixture seed refused')
  const mark: MarkReceipt = { schemaVersion: 1, markId: 'mark_abcdef012345', runId: handoff.runId,
    runSlug: core.deriveRunSlug(handoff.runId), testIndex: 0, stepIndex: 0, kind: 'confirmed-bug', origin: 'user', ordinal: 1,
    markedAt: 0, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 }, gold: [], evidence: { confirmed: 0, overturned: 0 } }
  const frozen = core.buildGoldenTrajectoryPlan({ handoff, cassettes, mark, product: 'shop' })
  const freeze = local.seedCommittedCorpus({ plan: { ...plan, cases: frozen.cases }, cassettes: frozen.goldCassettes, committedRoot, seedingOutputBaseDir: join(root, 'gold-seed') })
  if (freeze.refusals.length) throw new Error('Fixture gold refused')
  mark.gold = frozen.cases.map(row => ({ cassetteId: row.cassetteId, sourceCassetteId: source.id, channel: 'user-mark' }))
  const marks = [mark]
  const saveMarks = () => writeFileSync(join(run, 'marks.jsonl'), marks.map(value => JSON.stringify(value)).join('\n') + '\n')
  saveMarks()
  const cassette = frozen.goldCassettes[0]!.cassette as core.LeafCassette, labelRecord = frozen.cases[0]!.labelRecord
  const identity = core.computeDecisionIdentity(cassette.sidecar.goldAction, cassette.input.stateBefore.elements)
  const outcome: core.LeafReplayResult = { granularity: 'leaf', cassetteId: cassette.id,
    samples: [{ sampleIndex: 0, durationMs: 1, outcome: { kind: 'decision', action: cassette.sidecar.goldAction, identity } }],
    agreement: { k: 1, agreementRate: 1, noConsensus: false, harnessErrorCount: 0, modal: { identity, count: 1 } },
    modalDecision: identity, promptDrift: core.computeReplayDrift(cassette.input, cassette.receipt.promptInputHash),
    briefSource: 'proof', replayedModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }, unconsumedExchanges: [], totalDurationMs: 1 }
  const score = core.scoreCassetteReplay(cassette, outcome, labelRecord)
  const record: local.ScoreRecord = { cassetteId: cassette.id, matcherVersion: 1, score, diffs: [],
    scoringContext: core.createScoringContext({ cassette, outcome, labelRecord, score, judgeRequest: null }) }
  const profile = { plannerModelId: outcome.replayedModel.modelId, fingerprint: 'a'.repeat(64), matcherVersion: 1 }
  const profileKey = core.composeBaselineProfileKey(profile)
  const runRoot = join(root, 'eval/gate', slugBranch(profileKey))
  const replaysRoot = join(runRoot, 'replays')
  const written = new local.FsReplayRecordStore({ root, outputDir: replaysRoot, executionSeed: 17 }).save(outcome)
  const scoreFile = new local.FsScoreStore({ root, outputDir: replaysRoot }).save(record).file
  const report = core.buildEvalReport([{ cassetteId: cassette.id, outcome, score }])
  report.runIdentity = { fingerprint: profile.fingerprint, corpusDigest: core.computeCorpusDigest(local.readActiveCommittedCorpus(committedRoot, root).snapshot.entries) }
  const saveReport = () => new local.FsReportStore({ root, outputDir: join(runRoot, 'reports') }).save(report, undefined, {
    seed: 17, records: [{ cassetteId: cassette.id, replayDigest: digest(JSON.parse(readFileSync(written.file, 'utf8'))), scoreDigest: digest(JSON.parse(readFileSync(scoreFile, 'utf8'))) }],
  })
  const publication = saveReport()
  const input = { agentQaRoot: root, committedRoot, profile }
  const read = (overrides = {}) => Reflect.get(local, 'loadJudgeCalibrationEvidence')?.({ ...input, ...overrides })
  return { root, run, runRoot, replaysRoot, committedRoot, source, cassette, labelRecord, marks, handoff, outcome, record,
    written, scoreFile, report, publication, saveReport, saveMarks, input, read }
}

it('loads one private executable decision with exact published saved replay proof', () => {
  const f = fixture(), result = f.read()
  expect(result?.skippedCounts).toEqual({})
  expect(result?.evidence).toHaveLength(1)
  expect(result.evidence[0]).toMatchObject({ sourceCassetteId: f.source.id, goldCassetteId: f.cassette.id,
    replayedModelId: f.outcome.replayedModel.modelId, recordedModelId: 'gpt-5', truth: { kind: 'resolved', fullMatch: true } })
  expect(result.skippedCounts).toEqual({})
  expect(f.read()).toEqual(result)
})
it.each([
  [{ declared: { provider: 'custom', modelId: 'unknown-supplied' }, resolvedModelId: 'gpt-5' }, 'unknown-supplied'],
  [{ resolvedModelId: 'gemini-2.5-pro' }, 'gemini-2.5-pro'],
  [{}, undefined],
] as const)('preserves actual receipt identity %j without replay fallback', (model, expected) => {
  const f = fixture(model), result = f.read()
  expect(result?.evidence).toHaveLength(1)
  expect(result.evidence[0].recordedModelId).toBe(expected)
  if (expected === undefined) expect(result.evidence[0]).not.toHaveProperty('recordedModelId')
})
it.each(['model', 'profile', 'corpus', 'source', 'gold', 'decision', 'malformed', 'publication', 'context', 'digest', 'missing', 'ambiguous', 'score-decision', 'no-consensus', 'forged-modal'])(
  'rejects %s evidence with explicit diagnostics', mode => {
    const f = fixture(), raw = JSON.parse(readFileSync(f.written.file, 'utf8'))
    if (mode === 'model') { raw.replayedModel.modelId = 'foreign'; writeFileSync(f.written.file, JSON.stringify(raw)); f.saveReport() }
    if (mode === 'profile') { f.report.runIdentity!.fingerprint = 'b'.repeat(64); f.saveReport() }
    if (mode === 'corpus') { f.report.runIdentity!.corpusDigest = 'b'.repeat(64); f.saveReport() }
    if (mode === 'source') { raw.promptDrift.recordedHash = 'b'.repeat(64); writeFileSync(f.written.file, JSON.stringify(raw)); f.saveReport() }
    if (mode === 'gold') { raw.cassetteId = f.source.id; writeFileSync(f.written.file, JSON.stringify(raw)); f.saveReport() }
    if (mode === 'decision') { raw.samples[0].outcome.identity.target.ordinal = 9; writeFileSync(f.written.file, JSON.stringify(raw)); f.saveReport() }
    if (mode === 'malformed') writeFileSync(f.written.file, JSON.stringify({ ...raw, samples: [{ sampleIndex: 0, outcome: { kind: 'decision', action: {} } }] }))
    if (mode === 'publication') rmSync(f.publication.file.replace(/\.json$/, '.publication.json'))
    if (mode === 'context') { delete f.record.scoringContext; writeFileSync(f.scoreFile, JSON.stringify(f.record)); f.saveReport() }
    if (mode === 'digest') { raw.samples[0].durationMs++; writeFileSync(f.written.file, JSON.stringify(raw)) }
    if (mode === 'score-decision') {
      if (f.record.score.kind !== 'leaf') throw new Error('Expected leaf')
      f.record.score.entry.decisionOrdinal = 99
      f.record.scoringContext = core.createScoringContext({ cassette: f.cassette, labelRecord: f.labelRecord, outcome: f.outcome, score: f.record.score, judgeRequest: null })
      writeFileSync(f.scoreFile, JSON.stringify(f.record)); f.saveReport()
    }
    if (mode === 'no-consensus' || mode === 'forged-modal') {
      if (mode === 'no-consensus') raw.agreement.noConsensus = true
      else raw.agreement.modal.count = 0
      writeFileSync(f.written.file, JSON.stringify(raw))
      f.record.scoringContext = core.createScoringContext({ cassette: f.cassette, labelRecord: f.labelRecord, outcome: raw, score: f.record.score, judgeRequest: null })
      writeFileSync(f.scoreFile, JSON.stringify(f.record)); f.saveReport()
    }
    if (mode === 'missing') rmSync(f.written.file)
    if (mode === 'ambiguous') {
      const destination = join(f.root, 'eval/floor', slugBranch(core.composeBaselineProfileKey(f.input.profile)), 'r0-seed17')
      cpSync(f.runRoot, destination, { recursive: true })
    }
    const result = mode === 'ambiguous' ? f.read({ replayRunRoots: [f.runRoot,
      join(f.root, 'eval/floor', slugBranch(core.composeBaselineProfileKey(f.input.profile)), 'r0-seed17')] }) : f.read()
    expect(result?.evidence).toEqual([])
    const expectedReason: Partial<Record<string, core.JudgeCalibrationSkipReason>> = {
      profile: 'foreign-profile', corpus: 'stale-replay', model: 'foreign-replay', source: 'foreign-replay',
      gold: 'foreign-replay', decision: 'foreign-replay', malformed: 'malformed-replay',
      publication: 'missing-profile-proof', context: 'stale-replay', digest: 'stale-replay',
      missing: 'missing-replay', ambiguous: 'ambiguous-replay', 'score-decision': 'stale-replay',
      'no-consensus': 'ambiguous-replay', 'forged-modal': 'malformed-replay',
    }
    expect(result.skippedCounts[expectedReason[mode]!]).toBe(1)
    expect(Object.values(result.skippedCounts).some(value => Number(value) > 0)).toBe(true)
  },
)

it('ranks floor schedule indices numerically before gate without choosing a favorable verdict', () => {
  const f = fixture()
  const floor = join(f.root, 'eval/floor', slugBranch(core.composeBaselineProfileKey(f.input.profile)))
  for (const index of [10, 2]) cpSync(f.runRoot, join(floor, `r${index}-seed17`), { recursive: true })
  const first = f.read()
  expect(first.evidence).toHaveLength(1)
  expect(first.selectedInputs[0].replayFile).toContain('/r2-seed17/')
  expect(f.read()).toEqual(first)
  expect(f.read({ replayRunRoots: [f.runRoot, join(floor, 'r2-seed17')] }).skippedCounts['ambiguous-replay']).toBe(1)
})

it.each(['unknown', 'same-index-seed', 'wrong-seed', 'malformed', 'duplicate-publication'])('refuses %s floor history instead of falling back to a valid gate', mode => {
  const f = fixture()
  const floor = join(f.root, 'eval/floor', slugBranch(core.composeBaselineProfileKey(f.input.profile)))
  const slot = join(floor, 'r0-seed17')
  cpSync(f.runRoot, slot, { recursive: true })
  if (mode === 'unknown') mkdirSync(join(floor, 'unknown-generation'))
  if (mode === 'same-index-seed') cpSync(f.runRoot, join(floor, 'r0-seed29'), { recursive: true })
  if (mode === 'wrong-seed') { rmSync(slot, { recursive: true }); cpSync(f.runRoot, join(floor, 'r0-seed29'), { recursive: true }) }
  if (mode === 'malformed') writeFileSync(join(slot, 'replays', ...f.cassette.id.split('/').map(slugBranch), 'replay.json'), '{')
  if (mode === 'duplicate-publication') {
    const report = { ...f.report, batchKey: 'second-proof' }
    new local.FsReportStore({ root: f.root, outputDir: join(slot, 'reports') }).save(report, undefined, {
      seed: 17, records: [{ cassetteId: f.cassette.id, replayDigest: digest(JSON.parse(readFileSync(f.written.file, 'utf8'))), scoreDigest: digest(JSON.parse(readFileSync(f.scoreFile, 'utf8'))) }],
    })
  }
  const result = f.read()
  expect(result.evidence).toEqual([])
  expect(Object.values(result.skippedCounts).some(count => Number(count) > 0)).toBe(true)
})
it('retains newest empty mark as governing retirement', () => {
  const f = fixture(), before = f.read()
  f.marks.push({ ...f.marks[0]!, ordinal: 2, gold: [] }); f.saveMarks()
  expect(f.read()?.evidence).toEqual([])
  expect(f.read()?.goldSetDigest).not.toBe(before?.goldSetDigest)
})
it.each(['ledger', 'replay', 'score', 'report', 'committed'])( 'refuses %s symlink before loading private evidence', mode => {
  const f = fixture(), outside = mkdtempSync(join(tmpdir(), 'judge-calibration-outside-')); roots.push(outside)
  const path = mode === 'ledger' ? join(f.run, 'marks.jsonl') : mode === 'replay' ? f.written.file
    : mode === 'score' ? f.scoreFile : mode === 'report' ? f.publication.file : f.committedRoot
  const target = join(outside, 'target'); cpSync(path, target, { recursive: true }); rmSync(path, { recursive: true }); symlinkSync(target, path)
  const result = f.read()
  expect(result?.evidence).toEqual([])
  expect(result.skippedCounts['path-refused']).toBeGreaterThan(0)
})
it('refuses an explicit escaped replay root and malformed ledger/handoff', () => {
  const f = fixture()
  expect(f.read({ replayRunRoots: [join(f.root, '..', 'escape')] })?.skippedCounts['path-refused']).toBeGreaterThan(0)
  writeFileSync(join(f.run, 'marks.jsonl'), '{')
  expect(f.read()?.evidence).toEqual([])
  f.saveMarks(); f.handoff.tests[0]!.steps = []; writeFileSync(join(f.run, 'handoff.json'), JSON.stringify(f.handoff))
  expect(f.read()?.skippedCounts['handoff-refused']).toBeGreaterThan(0)
})
it('keeps private judge calibration out of the learner reader', () => {
  expect(Reflect.get(reader, 'loadJudgeCalibrationEvidence')).toBeUndefined()
})
it('changes evidence digest when actual recorded identity changes or disappears', () => {
  const f = fixture(), before = f.read()
  const path = join(f.committedRoot, local.committedCassettePath('shop', f.source.id))
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.receipt.model = { resolvedModelId: 'new-unknown-model' }; writeFileSync(path, JSON.stringify(raw))
  const changed = f.read()
  expect(changed.evidence[0].recordedModelId).toBe('new-unknown-model')
  expect(changed.evidenceDigest).not.toBe(before.evidenceDigest)
  raw.receipt.model = {}; writeFileSync(path, JSON.stringify(raw))
  expect(f.read().evidence[0]).not.toHaveProperty('recordedModelId')
  expect(f.read().evidenceDigest).not.toBe(changed.evidenceDigest)
})
it('honors committed run exclusions and refuses malformed exclusion evidence', () => {
  const f = fixture(), path = join(f.committedRoot, 'exclusions/shop/fixture.json')
  mkdirSync(join(f.committedRoot, 'exclusions/shop'), { recursive: true })
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, runId: f.handoff.runId, runSlug: core.deriveRunSlug(f.handoff.runId),
    product: 'shop', verdicts: [{ class: 'test_bug', producer: 'analyze-run' }], analysisDigest: 'b'.repeat(64), reason: 'excluded-verdict-class' }))
  expect(f.read()?.evidence).toEqual([])
  writeFileSync(path, '{')
  expect(f.read()?.skippedCounts['corpus-refused']).toBeGreaterThan(0)
})
