import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  ADVERSARIAL_GENERATOR_VERSION, ADVERSARIAL_PROMPT_VERSION, ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION, buildEvalReport, committedFileText, createPanelIdentity,
  projectCorpusEntry, type CorpusGenerator,
} from '@vostride/agent-qa-eval'
import { FsReportStore, loadStagedReport } from '../report-store.js'
import { FsCommittedRootStore, committedCorpusPath, committedReportPath } from '../committed-root-store.js'
import { listCommittedReports } from '../committed-corpus-source.js'
import * as local from '../index.js'
import * as calibrationSource from '../judge-calibration-source.js'
import { writeCommittedFloorFixture, incrementingClock, noneAuth } from './fixtures/floor-fixtures.js'
import { capturingStub, actionGenerateResult, familyStubProfile, judgeGenerateResult } from './fixtures/replay-fixtures.js'
import { createMaskingContext } from '@vostride/agent-qa-safety'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const panel = createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro'])
const interval = { lower: 0.123456789012345, upper: 0.987654321098765, halfWidth: 0.43209876604321 }
const calibrated = { status: 'calibrated', n: 3, pooledAgreement: 2 / 3, wilson95: interval,
  perMember: panel.members!.map(member => ({ judgeModelId: member.judgeModelId, n: 3,
    agreement: 2 / 3, wilson95: interval })) }

function fixture(reader: 'staged' | 'committed', calibration: unknown, judge = panel) {
  const dir = mkdtempSync(join(tmpdir(), 'calibration-report-')); roots.push(dir)
  const report = buildEvalReport([], structuredClone(judge))
  if (calibration !== undefined) Object.assign(report.judge!, { calibration })
  const bytes = JSON.stringify(report, null, 2) + '\n'
  const file = reader === 'staged' ? new FsReportStore({ root: dir }).save(report).file
    : join(dir, committedReportPath(report.batchKey, 'report.json'))
  if (reader === 'committed') new FsCommittedRootStore({ committedRoot: dir }).writeText(
    committedReportPath(report.batchKey, 'report.json'), bytes)
  const read = () => reader === 'staged' ? loadStagedReport(dir, report.batchKey)
    : (() => { const value = listCommittedReports(dir); return value.refusals.length
      ? { kind: 'refused' } : { kind: 'loaded', report: value.reports[0]?.report } })()
  return { dir, report, bytes, file, read }
}

it.each(['absent', 'gap'])('fresh floor reports disclose %s and measured recovery retains guarded copied history', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'calibration-floor-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root, handoff => {
    handoff.tests[0]!.steps[0]!.modelProfile!.modelId = 'llama-recorded'
  })
  const planner = capturingStub(() => actionGenerateResult(), 'gpt-replay-stub')
  const members = ['claude-judge-stub', 'gemini-judge-stub'].map(model => {
    const stub = capturingStub(() => judgeGenerateResult('equivalent', 'high'), model)
    return { profile: familyStubProfile(model), auth: noneAuth, modelOverrides: { languageModels: stub.languageModels } }
  })
  const judge = createPanelIdentity(members.map(member => member.profile.model))
  const input = { ...corpus, agentQaRoot: join(root, '.agent-qa'), profile: familyStubProfile('gpt-replay-stub'),
    auth: noneAuth, modelOverrides: { languageModels: planner.languageModels }, judge: { members },
    maskingContextFactory: createMaskingContext,
    profileKeyInputs: { plannerModelId: 'gpt-replay-stub', matcherVersion: 1,
      judgeModelId: judge.judgeModelId, judgeVersion: judge.judgeVersion },
    seeds: [11, 29], repeats: 3, bootstrapSeed: 97, commit: false,
    reportOutputBaseDir: join(root, 'audit'), clock: incrementingClock() }
  if (mode === 'gap') {
    const artifact = local.createJudgeCalibrationArtifact({ committedRoot: input.committedRoot, agentQaRoot: input.agentQaRoot,
      identity: judge, minN: { value: 20, source: 'flag' }, profile: { ...input.profileKeyInputs,
        fingerprint: local.computeReplayProfileFingerprintFor({ profile: input.profile,
          modelOverrides: input.modelOverrides, seedPolicy: 'declared' }) } },
    { status: 'capability-gap', reason: 'no-credential' })
    const path = join(input.committedRoot, local.judgeCalibrationPath(artifact.profileKey))
    mkdirSync((await import('node:path')).dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(artifact))
  }
  const lines: string[] = []
  const fresh = await local.runNoiseFloorMeasurement({ ...input, onProgress: line => lines.push(line) })
  for (const runRoot of fresh.runRoots) {
    // Locate through actual corpus membership, not a manufactured batch identity.
    const reportFiles = (await import('node:fs')).readdirSync(join(runRoot, 'reports')).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    expect(reportFiles).toHaveLength(1)
    const report = JSON.parse(readFileSync(join(runRoot, 'reports', reportFiles[0]!), 'utf8'))
    expect(report.judge.calibration).toEqual(mode === 'gap' ? { status: 'capability-gap', reason: 'no-credential' }
      : { status: 'uncalibrated', n: 0, provenance: 'unavailable' })
  }
  const fromMeasured = join(root, 'cost.log'); writeFileSync(fromMeasured, lines.join('\n'))
  const read = vi.spyOn(calibrationSource, 'readJudgeCalibration').mockImplementation(() => { throw new Error('history must not read newer artifacts') })
  const calls = planner.captured.length
  const recovered = await local.runNoiseFloorMeasurement({ ...input, auth: undefined, fromMeasured })
  expect(recovered.artefact).toEqual(fresh.artefact)
  expect(read).not.toHaveBeenCalled()
  expect(planner.captured).toHaveLength(calls)
})

for (const reader of ['staged', 'committed'] as const) {
  it.each([calibrated, { ...calibrated, perMember: [...calibrated.perMember].reverse() },
    { ...calibrated, perMember: [calibrated.perMember[0], { judgeModelId: panel.members![1]!.judgeModelId, n: 0 }] },
    { status: 'uncalibrated', n: 7 },
    { status: 'uncalibrated', n: 0, provenance: 'unavailable' },
    ...['panel-not-configured', 'no-credential', 'single-family-host'].map(reason => ({ status: 'capability-gap', reason })),
  ])(`${reader} preserves copied calibration exactly: %j`, calibration => {
    const f = fixture(reader, calibration)
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    mkdirSync(join(f.dir, 'reports/judge-calibration'), { recursive: true })
    writeFileSync(join(f.dir, 'reports/judge-calibration/newer.json'), '{"status":"calibrated","n":999}')
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    expect(readFileSync(f.file, 'utf8')).toBe(f.bytes)
  })
  it.each([
    { status: 'calibrated' }, { status: 'unknown', n: 0 }, { status: 'uncalibrated', n: -1 },
    { status: 'uncalibrated', n: 0.5 }, { status: 'uncalibrated', n: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'uncalibrated', n: 2, pooledAgreement: 1 }, { status: 'uncalibrated', n: 2, provenance: 'unavailable' },
    { status: 'capability-gap', reason: 'invented' }, { status: 'capability-gap', reason: 'no-credential', n: 0 },
    { ...calibrated, n: 0 }, { ...calibrated, pooledAgreement: 1.1 }, { ...calibrated, pooledAgreement: NaN },
    { ...calibrated, n: 1 }, { ...calibrated, pooledAgreement: 0.7 },
    { ...calibrated, wilson95: { ...interval, lower: 1 } },
    { ...calibrated, wilson95: { ...interval, halfWidth: -1 } },
    { ...calibrated, perMember: [] }, { ...calibrated, perMember: [calibrated.perMember[0], calibrated.perMember[0]] },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, judgeModelId: 'foreign' })) },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, n: -1 })) },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, n: 0, agreement: 1 })) },
  ])(`${reader} refuses malformed copied calibration: %j`, calibration => {
    expect(fixture(reader, calibration).read().kind).toBe('refused')
  })
  it(`${reader} refuses calibration on a single judge`, () => {
    expect(fixture(reader, { status: 'uncalibrated', n: 0 }, createPanelIdentity(['claude-sonnet-4-5'])).read().kind).toBe('refused')
  })
  it(`${reader} keeps historical panel-free disclosure unchanged`, () => {
    const f = fixture(reader, undefined)
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    expect(readFileSync(f.file, 'utf8')).toBe(f.bytes)
  })
}

// ---------------------------------------------------------------------------
// 422-20-T2 — the judge-targeted bait subset at the STORED boundary.
//
// Four states must stay visibly different where a reader meets them, and exactly one of them is
// "we measured no bait". An artifact that predates the disclosure carries no block at all and
// must keep reading forever; an artifact that measured an empty adversarial arm carries an
// explicit zero; a run that could not open its corpus carries `unavailable`; and an artifact that
// measured self-authored judge bait names its authors. Collapsing any pair of those into one
// rendering is the failure this block exists to prevent.
const BAIT_PANEL = createPanelIdentity(['claude-judge-stub', 'gemini-judge-stub'])
const baitProfile = { plannerModelId: 'gpt-replay-stub', fingerprint: 'a'.repeat(64),
  matcherVersion: 1, judgeModelId: BAIT_PANEL.judgeModelId, judgeVersion: BAIT_PANEL.judgeVersion }

function baitFixture(options: { bait?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'calibration-bait-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root)
  const seed = corpus.selected[0]!.cassette
  if (seed.granularity !== 'leaf') throw new Error('expected a fixture leaf')
  const store = new FsCommittedRootStore({ committedRoot: corpus.committedRoot })
  const add = (generator: CorpusGenerator, suffix: string) => {
    const entry = { ...projectCorpusEntry({ cassette: seed, product: 'alpha', runId: seed.runId,
      assignment: { split: 'adversarial', generator } }), cassetteId: `${seed.id}--${suffix}` }
    store.writeText(committedCorpusPath('alpha', entry.cassetteId), committedFileText(entry))
  }
  if (options.bait !== false) {
    add({ kind: 'fuzz-label', seedCassetteId: seed.id, generatorVersion: ADVERSARIAL_GENERATOR_VERSION,
      mutator: 'confusable', tableVersion: ADVERSARIAL_TABLE_VERSION, tableHash: ADVERSARIAL_TABLE_HASH }, 'table')
    add({ kind: 'judge-targeted', seedCassetteId: seed.id, generatorVersion: ADVERSARIAL_GENERATOR_VERSION,
      authoringModel: { id: 'claude-judge-stub', family: 'claude' }, promptVersion: ADVERSARIAL_PROMPT_VERSION }, 'bait')
  }
  const input = { committedRoot: corpus.committedRoot, agentQaRoot: join(root, '.agent-qa'),
    identity: BAIT_PANEL, minN: { value: 20, source: 'flag' as const }, profile: baitProfile }
  const artifact = local.createJudgeCalibrationArtifact(input, { status: 'capability-gap', reason: 'no-credential' })
  const write = (value: unknown) => {
    const path = join(input.committedRoot, local.judgeCalibrationPath(artifact.profileKey))
    mkdirSync(join(input.committedRoot, 'reports/judge-calibration'), { recursive: true })
    writeFileSync(path, committedFileText(value))
  }
  return { root, input, artifact, write }
}

/** Re-mint the generation id so a mutation is tested on its MERITS, not on a stale digest. */
const remint = (artifact: Record<string, unknown>) => {
  const { generationId: _drop, ...body } = artifact
  return { ...body, generationId: local.judgeCalibrationGenerationId(body) }
}

it('stores the judge-targeted subset on a fresh artifact and round-trips it off disk', () => {
  const f = baitFixture()
  expect(f.artifact.judgeTargeted).toMatchObject({ basis: 'raw', source: 'resolved', total: 2,
    metadataUnavailable: 0, judgeTargeted: 1, selfAuthored: 1, observedInCalibration: 0 })
  expect((f.artifact.judgeTargeted as { byProvenance: Record<string, number> }).byProvenance)
    .toMatchObject({ table: 1, probe: 1, absent: 0, malformed: 0 })
  expect((f.artifact.judgeTargeted as { byAuthoringModel: unknown[] }).byAuthoringModel).toEqual([
    { authoringModel: 'claude-judge-stub', authoringFamily: 'claude', panelMember: true,
      probeAuthored: 1, judgeTargeted: 1 },
  ])
  f.write(f.artifact)
  expect(local.readJudgeCalibration(f.input)).toEqual({ kind: 'loaded', artifact: f.artifact })
})

it('keeps a measured zero, an unread source and a historical absence three separate facts', () => {
  const zero = baitFixture({ bait: false })
  expect(zero.artifact.judgeTargeted).toMatchObject({ source: 'resolved', total: 0,
    judgeTargeted: 0, selfAuthored: 0, byAuthoringModel: [] })

  // `unavailable` is admissible bytes and carries no count at all — never a zero arm.
  const unread = remint({ ...zero.artifact,
    judgeTargeted: { basis: 'raw', source: 'unavailable', reason: 'corpus-unreadable' } })
  const guarded = local.guardJudgeCalibration(unread)
  expect(guarded?.judgeTargeted).toEqual({ basis: 'raw', source: 'unavailable', reason: 'corpus-unreadable' })

  // A historical artifact predates the field entirely; the read must not invent a zero for it.
  const { judgeTargeted: _absent, ...historicalBody } = zero.artifact
  const historical = remint(historicalBody)
  expect(local.guardJudgeCalibration(historical)).toBeDefined()
  expect(local.guardJudgeCalibration(historical)?.judgeTargeted).toBeUndefined()
  zero.write(historical)
  expect(local.readJudgeCalibration(zero.input)).toMatchObject({ kind: 'loaded' })
})

it.each([
  ['self-authorship exceeding its own judge-targeted subset', { selfAuthored: 2 }],
  ['a judge-targeted count the probe arm cannot hold', { judgeTargeted: 2 }],
  ['more measured-population membership than the subset itself holds', { observedInCalibration: 2 }],
  ['author rows that do not account for the probe arm', { byAuthoringModel: [] }],
  ['a self-authorship count no panel-member author backs', { selfAuthored: 0 }],
  ['a provenance arm this build does not know', { byProvenance: { invented: 1 } }],
])('refuses a stored subset carrying %s', (_label, patch) => {
  const f = baitFixture()
  const subset = f.artifact.judgeTargeted as Record<string, unknown>
  const mutated = remint({ ...f.artifact, judgeTargeted: { ...subset, ...patch,
    ...(('byProvenance' in patch) ? { byProvenance: { ...(subset.byProvenance as object), ...patch.byProvenance } } : {}) } })
  expect(local.guardJudgeCalibration(mutated)).toBeUndefined()
})

it('refuses a stored subset that disagrees with the corpus it claims to describe', () => {
  const f = baitFixture()
  const subset = f.artifact.judgeTargeted as Record<string, unknown>
  // Internally consistent, but not what this committed root holds: a forged clean bill of health.
  f.write(remint({ ...f.artifact, judgeTargeted: { ...subset, judgeTargeted: 0, selfAuthored: 0,
    byKind: { ...(subset.byKind as object), 'judge-targeted': 0, 'fuzz-label': 2 },
    byProvenance: { absent: 0, table: 2, probe: 0, malformed: 0 }, byAuthoringModel: [] } }))
  expect(local.readJudgeCalibration(f.input).kind).toBe('refused')
})
