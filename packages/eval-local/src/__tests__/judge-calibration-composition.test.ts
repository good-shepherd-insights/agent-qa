import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as core from '@vostride/agent-qa-eval'
import * as local from '../index.js'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, asRef, sha256hex, slugBranch, type MarkReceipt } from '@vostride/agent-qa-schema'
import { createMaskingContext, getActiveMaskingContext, getActiveAuditSink } from '@vostride/agent-qa-safety'
import { runJudgePanelCalibration } from '../judge-calibration-composition.js'
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
function fixture(models: core.CassetteModelReceipt[] = [{}], verdicts: ('equivalent' | 'different' | 'error' | 'unsure')[] = ['equivalent', 'equivalent'], ambiguous = false) {
  const project = mkdtempSync(join(tmpdir(), 'judge-probe-')); roots.push(project)
  const memberIds = ['claude-sonnet-4', 'gemini-2.5', 'llama-3'].slice(0, verdicts.length)
  const rows = models.map((model, index) => addEvidence(project, index, model, memberIds, ambiguous))
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
  expect(binds.count).toBe(0); expect(f.calls()).toBe(0); expect(f.contexts).toHaveLength(0)
})
it('keeps sequential fresh scoped bindings, durable audit paths and disposal across decisions', async () => {
  const f = fixture([{}, {}]), result = await runJudgePanelCalibration(f.input)
  expect(f.contexts).toHaveLength(2); expect(f.contexts[0]).not.toBe(f.contexts[1]); expect(f.disposes).toEqual([0, 1])
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
  expect(f.disposes).toEqual([0])
})
it('disposes the fresh scope when binding throws without invoking a provider', async () => {
  const f = fixture(); binds.fail = true
  await expect(runJudgePanelCalibration(f.input)).rejects.toThrow('Judge calibration probe failed; inspect the local audit and retry.')
  expect(f.calls()).toBe(0); expect(f.disposes).toEqual([0])
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

function addEvidence(project: string, index: number, model: core.CassetteModelReceipt, members: readonly string[], ambiguous = false) {
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
  const profile = { plannerModelId: outcome.replayedModel.modelId, fingerprint: local.computeReplayProfileFingerprintFor({ profile: { provider: 'openai-compatible', model: 'gpt-5', baseURL: 'http://127.0.0.1:1/v1', auth: { mode: 'none' } }, seedPolicy: 'none' }), matcherVersion: 1, judgeModelId: judge.judgeModelId, judgeVersion: judge.judgeVersion }
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
