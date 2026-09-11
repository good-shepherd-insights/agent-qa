import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as core from '@vostride/agent-qa-eval'
import * as local from '../index.js'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, asRef, sha256hex, slugBranch, type MarkReceipt } from '@vostride/agent-qa-schema'
import { createMaskingContext, getActiveMaskingContext, getActiveAuditSink } from '@vostride/agent-qa-safety'
import { runJudgePanelCalibration, runJudgeCalibration } from '../judge-calibration-composition.js'
import * as publication from '../judge-calibration-source.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'
import { capturingStub, judgeGenerateResult } from './fixtures/replay-fixtures.js'

const binds = vi.hoisted(() => ({ count: 0, fail: false }))
vi.mock('../judge-binding.js', async original => {
  const actual = await original<typeof import('../judge-binding.js')>()
  return { ...actual, bindJudgePanel: (...args: Parameters<typeof actual.bindJudgePanel>) => {
    binds.count++
    expect(getActiveMaskingContext()).toBeDefined()
    if (binds.fail) throw new Error('fixture-private-binding-error')
    return actual.bindJudgePanel(...args)
  } }
})
const roots: string[] = []
const digest = (value: unknown) => sha256hex(core.canonicalJson(value))
afterEach(() => { binds.count = 0; binds.fail = false; vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(models: core.CassetteModelReceipt[] = [{}], verdicts: ('equivalent' | 'different' | 'error' | 'unsure')[] = ['equivalent', 'equivalent'], ambiguous = false, excluded: readonly number[] = []) {
  const project = mkdtempSync(join(tmpdir(), 'judge-probe-')); roots.push(project)
  const memberIds = ['claude-sonnet-4', 'gemini-2.5', 'llama-3'].slice(0, verdicts.length)
  const rows = models.map((model, index) => addEvidence(project, index, model, memberIds, ambiguous, excluded.includes(index)))
  for (const row of rows) { row.report.runIdentity!.corpusDigest = core.computeCorpusDigest(local.readActiveCommittedCorpus(row.committedRoot, row.root).snapshot.entries); row.saveReport() }
  const contexts: ReturnType<typeof createMaskingContext>[] = []
  const disposes: number[] = []
  let calls = 0
  const members = memberIds.map((model, index) => {
    const stub = capturingStub(() => {
      calls++
      expect(getActiveMaskingContext()).toBe(contexts.at(-1))
      expect(getActiveMaskingContext()!.mask('fixture-private-api-key')).not.toContain('fixture-private-api-key')
      getActiveAuditSink()!.appendGuardrailAudit({ channel: 'provider-request', detector: 'bearer', action: 'redact' })
      if (verdicts[index] === 'error') throw new Error('fixture-private-provider-error')
      return judgeGenerateResult(verdicts[index] === 'unsure' ? 'unsure' : verdicts[index]!, 'high')
    }, model)
    return { profile: { provider: 'openai-compatible' as const, model, baseURL: 'http://127.0.0.1:1/v1', auth: { mode: 'none' as const } },
      auth: { kind: 'api-key' as const, apiKey: 'fixture-private-api-key' }, modelOverrides: { languageModels: stub.languageModels } }
  })
  const input = { ...rows[0]!.input, members, replayProfile: { provider: 'openai-compatible' as const, model: 'gpt-5', auth: { mode: 'none' as const } },
    maskingContextFactory: () => { const context = createMaskingContext(); const dispose = context.dispose.bind(context); const index = contexts.length;
      contexts.push(context); context.dispose = () => { disposes.push(index); dispose() }; return context } }
  return { input, rows, contexts, disposes, calls: () => calls }
}
it.each([false, true])('publishes and rereads legitimate nonexecutable exclusions: all excluded=%s', async allExcluded => {
  const f = fixture([{}, {}], undefined, false, allExcluded ? [0, 1] : [1])
  const n = allExcluded ? 0 : 1, skips = { 'missing-executable-correction': allExcluded ? 4 : 2 }
  const read = local.loadJudgeCalibrationEvidence(f.input)
  expect(read.evidence).toHaveLength(n)
  expect(read.skippedCounts).toEqual(skips)
  const preview = await runJudgePanelCalibration(f.input)
  expect(preview).toMatchObject({ status: 'uncalibrated', n, minN: 20, skippedCounts: skips,
    counts: { selected: n, admitted: n, attempted: n }, cost: { usage: { calls: n * 4 } } })
  expect(f.calls()).toBe(n * 4)
  const result = await runJudgeCalibration({ kind: 'probe', probe: f.input, commit: true })
  expect(result.kind).toBe('committed')
  if (result.kind !== 'committed') throw new Error('expected publication')
  expect(result.artifact).toMatchObject({ status: 'uncalibrated', n, skippedCounts: skips })
  expect(f.calls()).toBe(n * 8)
  expect(publication.readJudgeCalibration({ ...f.input, identity: preview.identity })).toEqual({ kind: 'loaded', artifact: result.artifact })
  // A valid excluded label change still has to invalidate the measured evidence generation.
  const row = f.rows[1]!
  const labelPath = join(row.committedRoot, local.committedLabelPath('shop', row.cassette.id))
  const originalLabel = readFileSync(labelPath, 'utf8')
  const label = JSON.parse(originalLabel)
  label.provenance.receiptDigest = 'f'.repeat(64)
  expect(core.parseStandaloneLabelRecord(label).ok).toBe(true)
  for (const stage of ['after-lock', 'before-rename']) {
    // Remove only the artifact to exercise both publication boundaries instead of unchanged.
    rmSync(join(f.input.committedRoot, result.path))
    const drift = await publication.publishJudgeCalibration({ ...f.input, identity: preview.identity,
      minN: core.resolveJudgeCalibrationMinimum(), artifact: result.artifact,
      auditDirectory: join(f.input.agentQaRoot, 'eval/calibrate/drift'),
      onBoundary: at => { if (at === stage) writeFileSync(labelPath, JSON.stringify(label)) } })
    expect(drift.kind).toBe('input-drift')
    writeFileSync(labelPath, originalLabel)
    expect((await publication.publishJudgeCalibration({ ...f.input, identity: preview.identity,
      minN: core.resolveJudgeCalibrationMinimum(), artifact: result.artifact,
      auditDirectory: join(f.input.agentQaRoot, 'eval/calibrate/restore') })).kind).toBe('committed')
  }
  writeFileSync(labelPath, JSON.stringify(label))
  const changed = local.loadJudgeCalibrationEvidence(f.input)
  expect(changed.skippedCounts).toEqual(skips)
  expect(changed.goldSetDigest).not.toBe(read.goldSetDigest)
  expect(publication.readJudgeCalibration({ ...f.input, identity: preview.identity }).kind).toBe('refused')
})
it.each(['omitted', 'different'] as const)('rejects %s diagnostics against real positive semantic exclusions', async mutation => {
  const f = fixture([{}, {}], undefined, false, [1])
  const preview = await runJudgePanelCalibration(f.input)
  expect(preview.skippedCounts).toEqual({ 'missing-executable-correction': 2 })
  const input = { ...f.input, identity: preview.identity, minN: core.resolveJudgeCalibrationMinimum() }
  const valid = publication.createJudgeCalibrationArtifact(input, preview)
  const artifact = structuredClone(valid)
  if (mutation === 'omitted') delete artifact.skippedCounts
  else artifact.skippedCounts = { 'missing-executable-correction': 999 }
  const { generationId: _generationId, ...body } = artifact
  artifact.generationId = publication.judgeCalibrationGenerationId(body)
  expect(publication.guardJudgeCalibration(artifact)).toEqual(artifact)
  const path = join(f.input.committedRoot, publication.judgeCalibrationPath(artifact.profileKey))
  const publish = (candidate: typeof artifact) => publication.publishJudgeCalibration({ ...input,
    artifact: candidate, auditDirectory: join(f.input.agentQaRoot, 'eval/calibrate/counts') })
  expect((await publish(artifact)).kind).toBe('refused')
  expect(existsSync(path)).toBe(false)
  mkdirSync(join(f.input.committedRoot, 'reports/judge-calibration'), { recursive: true })
  writeFileSync(path, JSON.stringify(artifact))
  const tamperedBytes = readFileSync(path, 'utf8')
  expect(publication.readJudgeCalibration(input).kind).toBe('refused')
  expect(readFileSync(path, 'utf8')).toBe(tamperedBytes)
  rmSync(path)
  expect((await publish(valid)).kind).toBe('committed')
  const validBytes = readFileSync(path, 'utf8')
  expect(publication.readJudgeCalibration(input)).toEqual({ kind: 'loaded', artifact: valid })
  expect((await publish(valid)).kind).toBe('unchanged')
  expect(readFileSync(path, 'utf8')).toBe(validBytes)
})
it('preserves independently measured rates when refused receipt rows are present', async () => {
  const only = fixture([{}]), mixed = fixture([{}, { resolvedModelId: 'claude-sonnet-4' }])
  const a = await runJudgePanelCalibration(only.input), b = await runJudgePanelCalibration(mixed.input)
  expect(b.counts).toMatchObject({ selected: 2, eligible: 1, attempted: 1, eligibilityRefused: 1 })
  for (const key of ['n', 'pooledAgreement', 'wilson95', 'perMember', 'abstention', 'disagreement', 'cost'] as const) expect(b[key]).toEqual(a[key])
  expect(mixed.calls()).toBe(4)
})
it('keeps all refused histories n0 with zero bindings, cost and absent estimates', async () => {
  const f = fixture([{ resolvedModelId: 'claude-sonnet-4' }, { resolvedModelId: 'supplied-unknown' }]), result = await runJudgePanelCalibration(f.input)
  expect(result).toMatchObject({ status: 'uncalibrated', n: 0, counts: { attempted: 0, eligibilityRefused: 2 }, cost: { callBound: 0, usage: { calls: 0 } } })
  expect(result).not.toHaveProperty('pooledAgreement'); expect(result).not.toHaveProperty('wilson95')
  expect(result.abstention).not.toHaveProperty('rate'); expect(result.disagreement).not.toHaveProperty('rate')
  expect(binds.count).toBe(0); expect(f.calls()).toBe(0); expect(f.contexts).toHaveLength(1)
})
it('keeps sequential fresh scoped bindings, durable audit paths and disposal across decisions', async () => {
  const f = fixture([{}, {}]), result = await runJudgePanelCalibration(f.input)
  expect(f.contexts).toHaveLength(3); expect(f.contexts[1]).not.toBe(f.contexts[2]); expect(f.disposes).toEqual([1, 2, 0])
  expect(result.cost.usage.calls).toBe(8); expect(f.calls()).toBe(8); expect(binds.count).toBe(2)
  const audit = readFileSync(join(result.auditDirectory, 'guardrail_audit.jsonl'), 'utf8')
  expect(audit.trim().split('\n')).toHaveLength(8)
  expect(audit).not.toContain('fixture-private-api-key')
  expect(JSON.stringify(result)).not.toContain('fixture-private-api-key')
})
it('retains errored member call cost separately from abstention and pair denominators', async () => {
  const f = fixture([{}], ['equivalent', 'error', 'different']), result = await runJudgePanelCalibration(f.input)
  expect(result.n).toBe(0)
  expect(result.perMember[1]).toMatchObject({ errors: 1, abstained: 0, n: 0 })
  expect(result.abstention).toEqual({ numerator: 1, denominator: 1, rate: 1 })
  expect(result.disagreement).toMatchObject({ numerator: 1, denominator: 1, rate: 1 })
  expect(result.cost.usage.calls).toBe(6); expect(f.calls()).toBe(6)
  expect(result.cost.usage.inputTokens).toBe(40)
  expect(JSON.stringify(result)).not.toContain('fixture-private-provider-error')
  expect(f.disposes).toEqual([1, 0])
})
it('disposes the fresh scope when binding throws without invoking a provider', async () => {
  const f = fixture(); binds.fail = true
  await expect(runJudgePanelCalibration(f.input)).rejects.toThrow('Judge calibration probe failed; inspect the local audit and retry.')
  expect(f.calls()).toBe(0); expect(f.disposes).toEqual([1, 0])
})
it('still probes a guarded ambiguous target with independently unresolved truth', async () => {
  const f = fixture([{}], ['equivalent', 'equivalent'], true)
  const read = local.loadJudgeCalibrationEvidence(f.input)
  expect(read.evidence).toHaveLength(1)
  expect(read.evidence[0]!.truth.kind).toBe('unresolved')
  const result = await runJudgePanelCalibration(f.input)
  expect(result.counts).toMatchObject({ attempted: 1, unresolvedTruth: 1, truthComparable: 0 })
  expect(result.n).toBe(0); expect(result.cost.usage.calls).toBe(4); expect(f.calls()).toBe(4)
  expect(result).not.toHaveProperty('pooledAgreement')
})
it('masks credential-bearing receipt diagnostics at the direct composition boundary', async () => {
  const f = fixture([{ resolvedModelId: 'claude-sonnet-4/fixture-private-api-key' }])
  const result = await runJudgePanelCalibration(f.input)
  expect(JSON.stringify(result)).not.toContain('fixture-private-api-key')
  expect(result.counts.eligibilityRefused).toBe(1)
  expect(f.calls()).toBe(0)
})
it('discloses selected gold independently from saved-evidence admission', async () => {
  const f = fixture([{}, {}]); rmSync(f.rows[1]!.written.file)
  const result = await runJudgePanelCalibration(f.input)
  expect(result.counts).toMatchObject({ selected: 2, admitted: 1, evidenceSkipped: 1, attempted: 1 })
  expect(result.skippedCounts['missing-replay']).toBeGreaterThan(0)
  expect(f.calls()).toBe(4)
})
it('refuses credential-bearing canonical member identity without inventing or binding one', async () => {
  const f = fixture()
  f.input.members[0]!.profile.model = 'claude-sonnet-4/fixture-private-api-key'
  await expect(runJudgePanelCalibration(f.input)).rejects.toThrow('Judge calibration probe failed; inspect the local audit and retry.')
  expect(binds.count).toBe(0); expect(f.calls()).toBe(0); expect(f.disposes).toEqual([0])
})
it('requires an explicit composite at the direct operator boundary', async () => {
  const f = fixture(); f.input.members.pop()
  await expect(runJudgePanelCalibration(f.input)).rejects.toThrow('Judge calibration probe failed')
  expect(binds.count).toBe(0); expect(f.calls()).toBe(0)
})
it('rejects a foreign panel profile before admitting or binding evidence', async () => {
  const f = fixture(); f.input.profile.judgeModelId = 'foreign-panel'
  await expect(runJudgePanelCalibration(f.input)).rejects.toThrow('Judge calibration probe failed')
  expect(binds.count).toBe(0); expect(f.calls()).toBe(0)
})

function committedBytes(root: string): [string, string][] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? committedBytes(path) : [[path, readFileSync(path).toString('hex')]] as [string, string][]
  })
}
it.each([false, true])('bypasses the writer entirely for no-composite gaps with replace=%s', async replace => {
  const f = fixture(), before = committedBytes(f.input.committedRoot)
  const writer = vi.spyOn(publication, 'publishJudgeCalibration')
  const result = await runJudgeCalibration({ kind: 'capability-gap', reason: 'panel-not-configured',
    minN: core.resolveJudgeCalibrationMinimum(), commit: true, replace })
  expect(result).toMatchObject({ kind: 'capability-gap', reason: 'panel-not-configured', artifactDisposition: 'not-created' })
  expect(result).not.toHaveProperty('profileKey'); expect(result).not.toHaveProperty('path'); expect(result).not.toHaveProperty('identity')
  expect(writer).not.toHaveBeenCalled(); expect(binds.count).toBe(0); expect(f.calls()).toBe(0)
  expect(committedBytes(f.input.committedRoot)).toEqual(before)
  expect(existsSync(join(f.input.committedRoot, 'reports/judge-calibration'))).toBe(false)
})
it('publishes and reads an exact measured artifact while retaining labels and report history', async () => {
  const f = fixture([{}, {}]), before = committedBytes(f.input.committedRoot)
  const result = await runJudgeCalibration({ kind: 'probe', probe: { ...f.input, minN: core.resolveJudgeCalibrationMinimum(2) }, commit: true })
  expect(result.kind).toBe('committed')
  if (!('artifact' in result)) throw new Error('expected artifact')
  expect(result.artifact).toMatchObject({ status: 'calibrated', n: 2, pooledAgreement: 1, cost: { usage: { calls: 8 } } })
  expect(publication.readJudgeCalibration({ ...f.input, identity: core.createPanelIdentity(f.input.members.map(m => m.profile.model)), minN: core.resolveJudgeCalibrationMinimum(2) }))
    .toEqual({ kind: 'loaded', artifact: result.artifact })
  for (const [path, bytes] of before) expect(readFileSync(path).toString('hex')).toBe(bytes)
  expect(committedBytes(f.input.committedRoot).length).toBe(before.length + 1)
})
it('publishes guarded valid-composite gaps with zero probes and no estimates', async () => {
  const f = fixture(), context = { ...f.input, identity: core.createPanelIdentity(f.input.members.map(m => m.profile.model)), minN: core.resolveJudgeCalibrationMinimum() }
  const options = { kind: 'capability-gap' as const, reason: 'no-credential' as const, minN: context.minN, publication: context, commit: true }
  const result = await runJudgeCalibration(options)
  expect(result.kind).toBe('committed')
  if (!('artifact' in result)) throw new Error('expected artifact')
  expect(result.artifact).toMatchObject({ status: 'capability-gap', reason: 'no-credential', n: 0, selected: 1, admitted: 1, cost: { callBound: 0, usage: { calls: 0 } } })
  expect(result.artifact).not.toHaveProperty('pooledAgreement'); expect(result.artifact).not.toHaveProperty('wilson95')
  expect(publication.readJudgeCalibration(context)).toEqual({ kind: 'loaded', artifact: result.artifact })
  expect((await runJudgeCalibration(options)).kind).toBe('unchanged')
  const changed = { ...options, minN: core.resolveJudgeCalibrationMinimum(2), publication: { ...context, minN: core.resolveJudgeCalibrationMinimum(2) } }
  expect((await runJudgeCalibration(changed)).kind).toBe('write-conflict')
  expect((await runJudgeCalibration({ ...changed, replace: true })).kind).toBe('committed')
  expect(f.calls()).toBe(0); expect(binds.count).toBe(0)
})
it('refuses unavailable saved evidence on valid-composite gap publication with its typed diagnostics', async () => {
  const f = fixture(); rmSync(f.rows[0]!.written.file)
  const before = committedBytes(f.input.committedRoot)
  const result = await runJudgeCalibration({ kind: 'capability-gap', reason: 'no-credential', commit: true,
    minN: core.resolveJudgeCalibrationMinimum(), publication: { ...f.input,
      identity: core.createPanelIdentity(f.input.members.map(m => m.profile.model)), minN: core.resolveJudgeCalibrationMinimum() } })
  expect(result).toMatchObject({ kind: 'refused', skippedCounts: { 'missing-replay': 1 } })
  expect(committedBytes(f.input.committedRoot)).toEqual(before)
  expect(f.calls()).toBe(0); expect(binds.count).toBe(0)
})

function addEvidence(project: string, index: number, model: core.CassetteModelReceipt, members: readonly string[], ambiguous = false, excluded = false) {
  const root = join(project, '.agent-qa')
  const committedRoot = join(project, 'agent-qa-eval')
  const handoff = makeLocalV2Handoff({ runId: asRunId(`judge-calibration-local-${index}`), scope: { tier: 'product', key: 'shop' } })
  handoff.tests[0]!.steps = [handoff.tests[0]!.steps[0]!]
  if (ambiguous) for (const sub of handoff.tests[0]!.steps[0]!.subActions) {
    const ref = asRef('e-alternative')
    sub.stateBefore.elements.push({ ...structuredClone(sub.stateBefore.elements[0]!), ref })
    sub.stateBefore.refMap[ref] = structuredClone(sub.stateBefore.refMap[sub.stateBefore.elements[0]!.ref]!)
  }
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
    runSlug: core.deriveRunSlug(handoff.runId), testIndex: 0, stepIndex: 0, kind: excluded ? 'false-pass' : 'confirmed-bug', origin: 'user', ordinal: 1,
    markedAt: 0, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 }, gold: [], evidence: { confirmed: 0, overturned: 0 } }
  const frozen = core.buildGoldenTrajectoryPlan({ handoff, cassettes, mark, product: 'shop' })
  const freeze = local.seedCommittedCorpus({ plan: { ...plan, cases: frozen.cases }, cassettes: frozen.goldCassettes, committedRoot, seedingOutputBaseDir: join(root, 'gold-seed') })
  if (freeze.refusals.length) throw new Error('Fixture gold refused')
  mark.gold = frozen.cases.map(row => ({ cassetteId: row.cassetteId, sourceCassetteId: source.id, channel: row.labelRecord.label.sourceChannel as 'user-mark' | 'overturned-verdict' }))
  const marks = [mark]
  const saveMarks = () => writeFileSync(join(run, 'marks.jsonl'), marks.map(value => JSON.stringify(value)).join('\n') + '\n')
  saveMarks()
  const cassette = frozen.goldCassettes[0]!.cassette as core.LeafCassette, labelRecord = frozen.cases[0]!.labelRecord
  const action = ambiguous ? { type: 'click' as const, ref: asRef('e-alternative') } : cassette.sidecar.goldAction
  const identity = core.computeDecisionIdentity(action, cassette.input.stateBefore.elements)
  const outcome: core.LeafReplayResult = { granularity: 'leaf', cassetteId: cassette.id,
    samples: [{ sampleIndex: 0, durationMs: 1, outcome: { kind: 'decision', action, identity } }],
    agreement: { k: 1, agreementRate: 1, noConsensus: false, harnessErrorCount: 0, modal: { identity, count: 1 } },
    modalDecision: identity, promptDrift: core.computeReplayDrift(cassette.input, cassette.receipt.promptInputHash),
    briefSource: 'proof', replayedModel: { provider: 'openai-compatible', modelId: 'gpt-5' }, unconsumedExchanges: [], totalDurationMs: 1 }
  const judge = core.createPanelIdentity(members)
  const score = core.scoreCassetteReplay(cassette, outcome, labelRecord)
  const record: local.ScoreRecord = { cassetteId: cassette.id, matcherVersion: 1, score, judge, diffs: [],
    scoringContext: core.createScoringContext({ cassette, outcome, labelRecord, score, judge, judgeRequest: { judgeModelId: judge.judgeModelId, allowSameFamily: false } }) }
  const profile = { plannerModelId: outcome.replayedModel.modelId, fingerprint: local.computeReplayProfileFingerprintFor({ profile: { provider: 'openai-compatible', model: 'gpt-5', baseURL: 'http://127.0.0.1:1/v1', auth: { mode: 'none' } }, seedPolicy: 'declared' }), matcherVersion: 1, judgeModelId: judge.judgeModelId, judgeVersion: judge.judgeVersion }
  const profileKey = core.composeBaselineProfileKey(profile)
  const runRoot = join(root, 'eval/floor', slugBranch(profileKey), `r${index}-seed17`)
  const replaysRoot = join(runRoot, 'replays')
  const written = new local.FsReplayRecordStore({ root, outputDir: replaysRoot, executionSeed: 17 }).save(outcome)
  const scoreFile = new local.FsScoreStore({ root, outputDir: replaysRoot }).save(record).file
  const report = core.buildEvalReport([{ cassetteId: cassette.id, outcome, score }], judge)
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
