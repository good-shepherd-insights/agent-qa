import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@vostride/agent-qa-eval'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, type MarkReceipt, type Verdict } from '@vostride/agent-qa-schema'
import { afterEach, expect, it } from 'vitest'
import * as local from '../index.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function verdict(producer: Verdict['producer'], classification: Verdict['class']): Verdict {
  return { perTest: 0, producer, class: classification, confidence: 1,
    evidence: { citedSteps: [], citedAnchors: [], citedArtifacts: [], rationale: 'fixture' }, memoryMisdirectionRuledOut: true }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'calibration-evidence-'))
  roots.push(root)
  const committedRoot = join(root, 'committed')
  const handoff = makeLocalV2Handoff({ runId: asRunId('calibration-local'), scope: { tier: 'product', key: 'shop' } })
  const member = handoff.tests[0]!
  member.steps = [member.steps[0]!, { ...structuredClone(member.steps[0]!), stepIndex: 1 }]
  member.rootCause = verdict('deterministic-classifier', 'app_bug')
  for (const step of member.steps) for (const sub of step.subActions) sub.stateBefore.timestamp = 1_725_000_000
  const run = join(root, 'runs', core.deriveRunSlug(handoff.runId))
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'handoff.json'), JSON.stringify(handoff))
  new FsEvidenceArtifactStore({ root, runId: handoff.runId }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
  const cassettes = core.extractRunCassettes({ handoff, artifacts: new local.FsRunArtifactSource({ root, runId: handoff.runId }) }).cassettes
  const plan = core.buildSeedingPlan({ handoff, cassettes, partition: { saltHex: 'a'.repeat(64), heldOutFraction: 0.000001, privateFraction: 0.5 } })
  const seeded = local.seedCommittedCorpus({ plan, cassettes, committedRoot, seedingOutputBaseDir: join(root, 'seed') })
  if (seeded.refusals.length) throw new Error('Fixture seeding refused')
  const marks: MarkReceipt[] = []
  for (const step of member.steps) {
    const mark: MarkReceipt = { schemaVersion: 1, markId: `mark_aaaaaaaaaaa${step.stepIndex}`, runId: handoff.runId,
      runSlug: core.deriveRunSlug(handoff.runId), testIndex: 0, stepIndex: step.stepIndex, kind: 'confirmed-bug',
      origin: 'user', ordinal: step.stepIndex + 1, markedAt: 0, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 },
      gold: [], evidence: { confirmed: 0, overturned: 0 } }
    const frozen = local.freezeGoldenTrajectory({ agentQaRoot: root, committedRoot, product: 'shop', handoff, mark,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} } })
    if (frozen.kind !== 'frozen') throw new Error('Fixture gold refused')
    marks.push({ ...mark, gold: frozen.cases })
  }
  const saveMarks = () => writeFileSync(join(run, 'marks.jsonl'), marks.map(mark => JSON.stringify(mark)).join('\n') + '\n')
  saveMarks()
  const analysis = { schemaVersion: 1, runId: handoff.runId, verdicts: [verdict('analyze-run', 'test_bug')], parts: [] }
  const saveAnalysis = () => writeFileSync(join(run, 'analysis.json'), JSON.stringify(analysis))
  saveAnalysis()
  const read = () => Reflect.get(local, 'loadCalibrationEvidence')?.({ committedRoot, agentQaRoot: root })
  return { root, run, committedRoot, handoff, marks, analysis, saveMarks, saveAnalysis, read }
}

it('keeps two actual producers independent at member grain across multiple source steps', () => {
  const input = fixture(), evidence = input.read()
  expect(evidence?.observations).toHaveLength(2)
  const report = core.calibrateLabels(evidence)
  expect(report.channels['recorded-verdict'].n).toBe(2)
  expect(report.rootCauseClassifierAccuracy).toEqual({ 'analyze-run': { n: 1, correct: 0, accuracy: 0 }, 'deterministic-classifier': { n: 1, correct: 1, accuracy: 1 } })
  expect(evidence.missingEvidenceCounts).toEqual({})
})
it.each(['missing', 'malformed', 'run-mismatch', 'producer-spoof', 'foreign-member', 'symlink'] as const)('discloses %s analysis while retaining deterministic evidence', mode => {
  const input = fixture(), path = join(input.run, 'analysis.json')
  if (mode === 'missing') rmSync(path)
  if (mode === 'malformed') writeFileSync(path, '{')
  if (mode === 'run-mismatch') { input.analysis.runId = asRunId('foreign'); input.saveAnalysis() }
  if (mode === 'producer-spoof') { input.analysis.verdicts[0]!.producer = 'deterministic-classifier'; input.saveAnalysis() }
  if (mode === 'foreign-member') { input.analysis.verdicts[0]!.perTest = 42; input.saveAnalysis() }
  if (mode === 'symlink') {
    const outside = mkdtempSync(join(tmpdir(), 'calibration-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'analysis.json'), JSON.stringify(input.analysis))
    rmSync(path)
    symlinkSync(join(outside, 'analysis.json'), path)
  }
  const evidence = input.read()
  expect(evidence?.observations).toEqual([{ runId: input.handoff.runId, testIndex: 0, producer: 'deterministic-classifier', class: 'app_bug' }])
  expect(Object.values(evidence.missingEvidenceCounts).reduce((a: number, b) => a + Number(b), 0)).toBeGreaterThan(0)
})
it('retains receipt-only empty successors and retires old gold despite missing handoff', () => {
  const input = fixture()
  input.marks.push({ ...input.marks[0]!, ordinal: 3, gold: [] })
  input.saveMarks()
  rmSync(join(input.run, 'handoff.json'))
  const evidence = input.read()
  expect(evidence?.marks).toHaveLength(2)
  expect(evidence.marks.find((mark: MarkReceipt) => mark.stepIndex === 0)?.gold).toEqual([])
  expect(core.calibrateLabels(evidence).channels['user-mark'].n_gold).toBe(1)
  expect(evidence.observations).toEqual([])
  expect(evidence.missingEvidenceCounts['handoff-missing']).toBe(1)
})
it.each(['identity', 'producer', 'member', 'ledger'] as const)('fails closed for invalid %s evidence', mode => {
  const input = fixture()
  if (mode === 'identity') input.handoff.runId = asRunId('foreign')
  if (mode === 'producer') input.handoff.tests[0]!.rootCause!.producer = 'analyze-run'
  if (mode === 'member') input.handoff.tests[0]!.rootCause!.perTest = 1
  if (mode === 'ledger') writeFileSync(join(input.run, 'marks.jsonl'), '{')
  writeFileSync(join(input.run, 'handoff.json'), JSON.stringify(input.handoff))
  const evidence = input.read()
  expect(evidence).toBeDefined()
  expect(evidence.observations.filter((row: core.CalibrationObservation) => row.producer === 'deterministic-classifier')).toEqual([])
  expect(Object.keys(evidence.missingEvidenceCounts).length).toBeGreaterThan(0)
})
it('refuses a ledger outside the operator root before active-gold consumption', () => {
  const input = fixture(), outside = mkdtempSync(join(tmpdir(), 'calibration-ledger-'))
  roots.push(outside)
  const path = join(input.run, 'marks.jsonl')
  writeFileSync(join(outside, 'marks.jsonl'), input.marks.map(mark => JSON.stringify(mark)).join('\n') + '\n')
  rmSync(path)
  symlinkSync(join(outside, 'marks.jsonl'), path)
  const evidence = input.read()
  expect(evidence?.marks).toEqual([])
  expect(evidence.observations).toEqual([])
  expect(evidence.missingEvidenceCounts['path-refused']).toBe(1)
  expect(core.calibrateLabels(evidence).channels['recorded-verdict'].n).toBe(0)
})
it('discloses absent deterministic observation and rejects source steps absent from guarded handoff', () => {
  const input = fixture()
  delete input.handoff.tests[0]!.rootCause
  input.handoff.tests[0]!.steps.pop()
  writeFileSync(join(input.run, 'handoff.json'), JSON.stringify(input.handoff))
  const evidence = input.read()
  expect(evidence?.missingEvidenceCounts['deterministic-missing']).toBe(1)
  expect(evidence.missingEvidenceCounts['source-refused']).toBeGreaterThan(0)
  const report = core.calibrateLabels(evidence)
  expect(report.channels['recorded-verdict'].n).toBe(1)
  expect(report.rootCauseClassifierAccuracy['deterministic-classifier'].n).toBe(0)
})
