import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import * as core from '@vostride/agent-qa-eval'
import * as local from '@vostride/agent-qa-eval-local'
import * as llm from '../../llm-utils.js'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, sha256hex, slugBranch, type MarkReceipt } from '@vostride/agent-qa-schema'
const { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } = await import(new URL('../../../../eval-local/src/__tests__/fixtures/local-handoff-fixture.js', import.meta.url).href)
const { capturingStub, judgeGenerateResult, actionGenerateResult } = await import(new URL('../../../../eval-local/src/__tests__/fixtures/replay-fixtures.js', import.meta.url).href)
import { files as filesUnder } from '../../gates/__tests__/feedback-fixture.js'
import { runJudgeCalibrateVerb, resolveEvalSession, resolveReplayProfileDeclaration } from '../../eval-session-composition.js'
import { getActiveMaskingContext, getActiveAuditSink } from '@vostride/agent-qa-safety'

const boundary = vi.hoisted(() => ({ calls: 0, binds: 0, comparisons: 0, publications: 0,
  inputs: [] as unknown[], overrides: {} as import('@vostride/agent-qa-model').ModelProviderOverrides }))
vi.mock('@vostride/agent-qa-eval-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, runJudgeCalibration: (...args: Parameters<typeof actual.runJudgeCalibration>) => {
    boundary.inputs.push(args[0])
    if (args[0].kind === 'probe' || args[0].publication !== undefined) boundary.publications++
    return actual.runJudgeCalibration(...args)
  } }
})
vi.mock('@vostride/agent-qa-model', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-model')>()
  return { ...actual, createModel: (...args: Parameters<typeof actual.createModel>) => {
    boundary.binds++
    return actual.createModel(args[0], args[1], boundary.overrides, args[3])
  } }
})
vi.mock('@vostride/agent-qa-eval', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval')>()
  return { ...actual, adjudicatePanelComparison: (...args: Parameters<typeof actual.adjudicatePanelComparison>) => {
    boundary.comparisons++
    return actual.adjudicatePanelComparison(...args)
  } }
})
const roots: string[] = []
const secret = 'fixture-judge-secret-42111'
const digest = (value: unknown) => sha256hex(core.canonicalJson(value))
const bytes = (root: string) => filesUnder(root).map(path => [path, readFileSync(path).toString('hex')])
beforeEach(() => {
  boundary.calls = boundary.binds = boundary.comparisons = 0
  boundary.publications = 0; boundary.inputs = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden') })
  vi.spyOn(llm, 'resolveModelAuth').mockImplementation(async name => ({ kind: 'api-key', credentialKey: name, provider: 'openai-compatible', apiKey: secret }))
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); process.exitCode = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(models: core.CassetteModelReceipt[] = [{}], members = ['claude-sonnet-4', 'gemini-2.5']) {
  const project = mkdtempSync(join(tmpdir(), 'judge-operator-')); roots.push(project)
  const configPath = join(project, 'agent-qa.config.yaml')
  writeFileSync(join(project, 'fixture.secrets'), '')
  writeFileSync(configPath, JSON.stringify({ workspace: { testMatch: ['tests/*.yaml'], suiteMatch: ['suites/*.yaml'], hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: 'fixture.secrets' },
    registry: { llms: ['gpt-5', ...members].map((model, i) => ({ name: `model${i}`, provider: 'openai-compatible', model, baseURL: 'http://127.0.0.1:1/v1', vision: false })) },
    use: { llm: 'model0', mobile: { appState: 'preserve' } }, eval: { judges: members.map((_, i) => `model${i + 1}`) } }))
  const rows = models.map((model, index) => addEvidence(project, index, model, members))
  for (const row of rows) {
    row.report.runIdentity!.corpusDigest = core.computeCorpusDigest(local.readActiveCommittedCorpus(row.committedRoot, row.root).snapshot.entries)
    row.saveReport()
  }
  const stubs = members.map(model => capturingStub(() => {
    expect(getActiveMaskingContext()).toBeDefined()
    expect(getActiveMaskingContext()!.mask(secret)).not.toContain(secret)
    expect(getActiveAuditSink()).toBeDefined()
    boundary.calls++; return judgeGenerateResult('equivalent', 'high')
  }, model))
  boundary.overrides = { languageModels: Object.assign({}, ...stubs.map(stub => stub.languageModels)) }
  return { project, configPath, rows, stubs, committedRoot: join(project, 'agent-qa-eval') }
}

async function invoke(configPath: string, flags = ['--judge-panel', '--json']) {
  const program = new Command('agent-qa').option('--config <path>').addCommand(createEvalCommand()).exitOverride()
  vi.mocked(console.log).mockClear(); vi.mocked(console.error).mockClear(); process.exitCode = 0
  await program.parseAsync(['--config', configPath, 'eval', 'calibrate', ...flags], { from: 'user' })
  const stdout = vi.mocked(console.log).mock.calls.map(row => row.join(' ')).join('\n')
  return { stdout, result: flags.includes('--json') ? JSON.parse(stdout) : undefined, exit: process.exitCode }
}

// Use the actual saved-run producer; transport alone is replaced by the existing fake factory.
async function produceSavedRun(f: ReturnType<typeof fixture>, floor = false) {
  const session = await resolveEvalSession({ configPath: f.configPath })
  const profile = await resolveReplayProfileDeclaration(session)
  const root = join(f.project, '.agent-qa')
  rmSync(join(root, 'eval/floor'), { recursive: true, force: true })
  const planner = capturingStub(() => actionGenerateResult(), profile.model)
  boundary.overrides.languageModels = { ...boundary.overrides.languageModels, ...planner.languageModels }
  const snapshot = local.readActiveCommittedCorpus(f.committedRoot, root)
  const identity = core.createPanelIdentity(f.stubs.map(stub => Object.keys(stub.languageModels)[0]!))
  const profileInputs = { plannerModelId: profile.model, matcherVersion: 1,
    judgeModelId: identity.judgeModelId, judgeVersion: identity.judgeVersion }
  const fingerprint = local.computeReplayProfileFingerprintFor({ profile, seedPolicy: 'declared' })
  const profileKey = core.composeBaselineProfileKey({ ...profileInputs, fingerprint })
  const common = { committedRoot: f.committedRoot, cassettesRoot: join(f.committedRoot, 'cassettes'),
    agentQaRoot: root, profile, auth: { kind: 'none' as const }, clock: () => 0,
    maskingContextFactory: session.maskingContextFactory,
    judge: { members: identity.members!.map(member => ({ profile: { ...profile, model: member.judgeModelId }, auth: { kind: 'none' as const } })) } }
  const produced = floor ? await local.runNoiseFloorMeasurement({ ...common, profileKeyInputs: profileInputs,
    seeds: [11, 29], repeats: 3, bootstrapSeed: 7, commit: false, reportOutputBaseDir: join(root, 'floor-audit') })
    : await local.replayCorpusOnce({ ...common, runRoot: join(root, 'eval/gate', slugBranch(profileKey)),
      selected: local.loadCassetteBundles(common.cassettesRoot).loaded,
      corpusDigest: core.computeCorpusDigest(snapshot.snapshot.entries), source: 'committed', seed: 11,
      labelRecords: snapshot.snapshot.labelsById, corpusEntriesById: snapshot.corpusEntriesById,
      excludedLabelIds: snapshot.snapshot.excludedLabelIds,
      productByCassetteId: new Map(snapshot.snapshot.entries.map(entry => [entry.cassetteId, entry.product])),
      replayOutputBaseDir: join(root, 'gate-audit') })
  boundary.calls = boundary.binds = boundary.comparisons = 0
  return { produced, profile: { ...profileInputs, fingerprint }, identity, agentQaRoot: root, committedRoot: f.committedRoot }
}

it('admits actual saved gate output without eval.seed through preview, publication and read-back', async () => {
  const f = fixture()
  const saved = await produceSavedRun(f)
  expect(local.loadJudgeCalibrationEvidence(saved)).toMatchObject({ selected: 1, evidence: [expect.anything()] })
  const preview = await invoke(f.configPath)
  expect(preview.result.counts).toMatchObject({ selected: 1, admitted: 1, attempted: 1 })
  const committed = await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])
  expect(committed.result.kind).toBe('committed')
  expect(local.readJudgeCalibration(saved)).toEqual({ kind: 'loaded', artifact: committed.result.artifact })
})

it('forces four calls on a guarded deterministic non-tie without changing committed bytes', async () => {
  const f = fixture(), before = bytes(f.committedRoot)
  await resolveEvalSession({ configPath: f.configPath })
  const output = await invoke(f.configPath)
  expect(output.exit).toBe(0)
  expect(output.result).toMatchObject({ kind: 'dry-run', counts: { selected: 1, eligible: 1, attempted: 1, eligibilityRefused: 0 }, cost: { callBound: 4, usage: { calls: 4, inputTokens: 40, outputTokens: 8 } } })
  expect(boundary).toMatchObject({ binds: 2, comparisons: 1, calls: 4 })
  expect(output.stdout).not.toContain(secret)
  expect(bytes(f.committedRoot)).toEqual(before)
  expect(output.result.auditDirectory).toContain('/.agent-qa/eval/calibrate/')
})
it.each(['claude-sonnet-4', 'unclassified-supplied', 'deepseek-r1-distill-llama'])('refuses actual recorded %s before binding with the whole declaration', async recorded => {
  const members = recorded.startsWith('deepseek') ? ['llama-3', 'gemini-2.5'] : ['claude-sonnet-4', 'gemini-2.5']
  const f = fixture([{ declared: { provider: 'custom', modelId: recorded } }], members)
  const { result } = await invoke(f.configPath)
  expect(result).toMatchObject({ status: 'uncalibrated', n: 0, counts: { selected: 1, eligibilityRefused: 1, attempted: 0 }, cost: { callBound: 0, usage: { calls: 0 } } })
  expect(result.rows[0]).toMatchObject({ recordedModelId: recorded, kind: 'not-invoked', reason: 'no-eligible-judge' })
  expect(result.rows[0].eligibility.families.members.map((m: { judgeModelId: string }) => m.judgeModelId).sort()).toEqual([...members].sort())
  expect(result.identity.panelSize).toBe(2)
  expect(result.identity).not.toHaveProperty('familyOverride')
  expect(boundary).toMatchObject({ binds: 0, comparisons: 0, calls: 0 })
})
it('keeps genuine absence optional and independently admits only mixed-history eligible rows', async () => {
  const f = fixture([{}, { resolvedModelId: 'claude-sonnet-4' }]), { result } = await invoke(f.configPath)
  expect(result.counts).toMatchObject({ selected: 2, eligible: 1, attempted: 1, eligibilityRefused: 1 })
  expect(result.rows.find((row: { kind: string }) => row.kind === 'attempted')).not.toHaveProperty('recordedModelId')
  expect(boundary).toMatchObject({ binds: 2, comparisons: 1, calls: 4 })
})
it.each([['--judge-panel', '--min-gold', '2'], ['--min-n', '2'], ['--judge-panel', '--min-n', '1']])('rejects mixed or invalid mode flags before any resolution %j', async (...flags) => {
  const { result, exit } = await invoke('/missing/config', [...flags, '--json'])
  expect(result.kind).toBe('refused'); expect(exit).toBe(1)
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  expect(boundary).toMatchObject({ binds: 0, calls: 0 })
})
it('returns the no-configuration gap successfully without provider calls', async () => {
  const f = fixture([]), config = JSON.parse(readFileSync(f.configPath, 'utf8')); config.eval = {}
  writeFileSync(f.configPath, JSON.stringify(config))
  const { result, exit } = await invoke(f.configPath)
  expect(exit).toBe(0); expect(result).toMatchObject({ status: 'capability-gap', reason: 'panel-not-configured', cost: { usage: { calls: 0 } } })
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
import { createEvalCommand } from '../eval.js'

it('offers an explicit judge panel preview and independent minimum on the calibration verb', () => {
  const command = createEvalCommand().commands.find(child => child.name() === 'calibrate')!
  expect(command.helpInformation()).toContain('--judge-panel')
  expect(command.helpInformation()).toContain('--min-n <n>')
})

it('publishes through the public command and regenerates unchanged without changing labels', async () => {
  const f = fixture(), before = bytes(f.committedRoot)
  const first = await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])
  expect(first.exit).toBe(0)
  expect(first.result.kind).toBe('committed')
  expect(first.result.artifact.status).toBe('uncalibrated')
  expect(first.result.artifact.n).toBe(1)
  expect(first.result.artifact).not.toHaveProperty('auditDirectory')
  expect(boundary.calls).toBe(4)
  const second = await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])
  expect(second.result.kind).toBe('unchanged')
  expect(second.result.artifact).toEqual(first.result.artifact)
  for (const [path, content] of before) expect(readFileSync(path!).toString('hex')).toBe(content)
  const conflict = await invoke(f.configPath, ['--judge-panel', '--commit', '--min-n', '2', '--json'])
  expect(conflict.exit).toBe(1); expect(conflict.result.kind).toBe('write-conflict')
  const replaced = await invoke(f.configPath, ['--judge-panel', '--commit', '--replace', '--min-n', '2', '--json'])
  expect(replaced.exit).toBe(0); expect(replaced.result.kind).toBe('committed')
  expect(local.readJudgeCalibration({ ...f.rows[0]!.input, identity: replaced.result.artifact.identity,
    minN: core.resolveJudgeCalibrationMinimum(2) })).toEqual({ kind: 'loaded', artifact: replaced.result.artifact })
  for (const [path, content] of before) expect(readFileSync(path!).toString('hex')).toBe(content)
})

it.each([undefined, [], ['model1']].flatMap(judges => [false, true].flatMap(replace => [false, true].map(json => ({ judges, replace, json })))))('keeps no-composite public matrix %j a successful zero-write gap', async ({ judges, replace, json }) => {
  const f = fixture()
  await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])
  const historical = readFileSync(new URL('../../../../../../demo/init/agent-qa-eval/contracts/judge-config.v1.json', import.meta.url), 'utf8')
  expect(sha256hex(historical)).toBe('8f385c65a0c4011b7610a698c64848645c0cf51167b7e3f8018e280dd4ba9eea')
  writeFileSync(join(f.committedRoot, 'contracts/judge-config.v1.json'), historical)
  // Existing unrelated bytes are protected even when they are outside panel admission.
  writeFileSync(join(f.committedRoot, 'labels/calibration.json'), JSON.stringify(core.calibrateLabels({ snapshot: {
    entries: [], labelsById: new Map(), cassettesById: new Map(), blobPresentById: new Map() }, marks: [] })))
  for (const [name, judge] of [['historical-single', core.createPanelIdentity(['claude-sonnet-4'])], ['historical-none', undefined]] as const) {
    const dir = join(f.committedRoot, 'reports', name); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'report.json'), JSON.stringify(core.buildEvalReport([], judge)))
  }
  const before = bytes(f.committedRoot)
  const config = JSON.parse(readFileSync(f.configPath, 'utf8')); config.eval = judges === undefined ? {} : { judges }
  writeFileSync(f.configPath, JSON.stringify(config))
  boundary.calls = boundary.binds = boundary.comparisons = 0
  boundary.publications = 0; boundary.inputs = []
  vi.mocked(llm.resolveModelAuth).mockClear()
  const flags = ['--judge-panel', '--commit', ...(replace ? ['--replace'] : []), ...(json ? ['--json'] : [])]
  for (const existing of [true, false]) {
    if (!existing) rmSync(f.committedRoot, { recursive: true })
    const output = await invoke(f.configPath, flags)
    expect(output.exit).toBe(0)
    if (json) {
      expect(output.result).toMatchObject({ kind: 'capability-gap', reason: 'panel-not-configured', artifactDisposition: 'not-created' })
      for (const field of ['identity', 'artifact', 'profileKey', 'path']) expect(output.result).not.toHaveProperty(field)
    } else {
      expect(output.stdout).toContain('panel-not-configured'); expect(output.stdout).toContain('No committed artifact created.')
      expect(output.stdout).not.toMatch(/panel:claude|profileKey|judge-calibration\//)
    }
    if (existing) expect(bytes(f.committedRoot)).toEqual(before)
    else expect(existsSync(f.committedRoot)).toBe(false)
  }
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  expect(boundary).toMatchObject({ calls: 0, binds: 0, comparisons: 0, publications: 0 })
  expect(boundary.inputs).toEqual(Array.from({ length: 2 }, () => ({ kind: 'capability-gap', reason: 'panel-not-configured',
    minN: { value: 20, source: 'default' }, commit: true, replace: replace || undefined })))
})
it('routes a credential gap through the same public checked writer with zero provider calls', async () => {
  const f = fixture(), before = bytes(f.committedRoot)
  vi.mocked(llm.resolveModelAuth).mockImplementation(async name => ({ kind: 'missing', credentialKey: name,
    provider: 'openai-compatible', required: true, message: 'fixture missing' }))
  const first = await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])
  expect(first.exit).toBe(0)
  expect(first.result).toMatchObject({ kind: 'committed', artifact: { status: 'capability-gap', reason: 'no-credential', n: 0, selected: 1,
    cost: { callBound: 0, usage: { calls: 0 } } } })
  expect(first.result.artifact).not.toHaveProperty('pooledAgreement')
  expect(local.readJudgeCalibration({ ...f.rows[0]!.input, identity: first.result.artifact.identity })).toEqual({ kind: 'loaded', artifact: first.result.artifact })
  expect(boundary.publications).toBe(1)
  expect((await invoke(f.configPath, ['--judge-panel', '--commit', '--json'])).result.kind).toBe('unchanged')
  expect((await invoke(f.configPath, ['--judge-panel', '--commit', '--min-n', '2', '--json'])).result.kind).toBe('write-conflict')
  expect((await invoke(f.configPath, ['--judge-panel', '--commit', '--replace', '--min-n', '2', '--json'])).result.kind).toBe('committed')
  expect(boundary.calls).toBe(0); expect(boundary.binds).toBe(0)
  for (const [path, content] of before) expect(readFileSync(path!).toString('hex')).toBe(content)
})
it('refuses replace without commit before any config or auth work', async () => {
  const output = await invoke('/missing/config', ['--judge-panel', '--replace', '--json'])
  expect(output.exit).toBe(1); expect(output.result.reason).toContain('--replace requires --commit')
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

function addEvidence(project: string, index: number, model: core.CassetteModelReceipt, members: readonly string[]) {
  const root = join(project, '.agent-qa')
  const committedRoot = join(project, 'agent-qa-eval')
  const handoff = makeLocalV2Handoff({ runId: asRunId(`judge-calibration-local-${index}`), scope: { tier: 'product', key: 'shop' } })
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
