import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { asRef, ORIGIN_PRIORS, GateReceiptSchema, receiptDigestOf, screenStateHash, sha256hex, type Verdict, type PostProcessingStatus, type RunNotification } from '@vostride/agent-qa-schema'
import { readCommittedCorpus, readLabelCalibration, FsReplayRecordStore, FsScoreStore, FsReportStore,
  committedLabelPath, runReplayGate, serializeReplayGateReceipt, FsRunArtifactSource, seedCommittedCorpus } from '@vostride/agent-qa-eval-local'
import { projectSilverLabelRecord, extractRunCassettes, buildSeedingPlan, projectCorpusEntry, canonicalJson, type LeafCassette } from '@vostride/agent-qa-eval'
import { createKnowledgeReader, DIGEST_JOB_ID_SOURCE } from '@vostride/agent-qa-agent-local'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'
import { createEvalCommand } from '../commands/eval.js'
import { createRunsCommand } from '../commands/runs.js'
import { resolveEvalSession, runReportVerb } from '../eval-session-composition.js'
import { buildTrustPriorsResolver, trustPriorsForHost, formatTrustPriorDisclosure } from '../curation/trust-priors.js'
import { createKnowledgeChecks } from '../commands/doctor-knowledge-checks.js'
import { renderEvalReportMarkdown } from '../eval-report-render.js'
import * as host from '../composition/local-agent-host.js'
import * as verbs from '../eval-session-composition.js'
import { composeCliPostRunTail } from '../curation/post-run-tail-composition.js'
import type { PostRunTailOperations } from '../curation/post-run-tail.js'

// Existing peers create real persisted bundles, score records and SQLite indexes.
const { metricEntry } = await import(new URL('../../../eval/src/match/__tests__/fixtures/label-metric-fixtures.js', import.meta.url).href)
const { openKnowledgeReader: openIndexReader } = await import(new URL('../../../knowledge-local/src/index-reader.js', import.meta.url).href)
const { rebuildIndex } = await import(new URL('../../../knowledge-local/src/index-rebuild.js', import.meta.url).href)
const { acquireWriterLease, releaseLease } = await import(new URL('../../../knowledge-local/src/lease/writer-lease.js', import.meta.url).href)
const { labelGateFixture, labelMetricIds, legacyReport, rewriteReport } = await import(new URL('../../../eval-local/src/__tests__/fixtures/label-gate-fixtures.js', import.meta.url).href)
const { gate1Responder, warmGateRoot, writeGate1Fixture } = await import(new URL('../../../eval-local/src/__tests__/fixtures/gate1-fixtures.js', import.meta.url).href)
const { actionGenerateResult, respondingStub, noneAuth, stubProfile } = await import(new URL('../../../eval-local/src/__tests__/fixtures/replay-fixtures.js', import.meta.url).href)
const { incrementingClock } = await import(new URL('../../../eval-local/src/__tests__/fixtures/floor-fixtures.js', import.meta.url).href)
const actualCreateModel = model.createModel
let fixtureModels = false
const roots: string[] = []
const terminals: Array<PassThrough | Writable> = []
const bytes = (root: string) => files(root).map(path => [path, readFileSync(path).toString('hex')])
beforeEach(() => {
  fixtureModels = false
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('external provider forbidden') })
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model creation forbidden') })
  const compose = host.composeCliLocalAgent
  vi.spyOn(host, 'composeCliLocalAgent').mockImplementation(options => {
    const input = new PassThrough(), output = new Writable({ write(chunk, _encoding, done) {
      if (String(chunk).includes('[y/N]')) queueMicrotask(() => input.write('y\n'))
      done()
    } })
    terminals.push(input, output)
    return compose({ ...options, resolveExecutionContext: () => 'local-interactive',
      confirm: host.createTtyConfirmPort({ isTty: true, input, output }) })
  })
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  if (!fixtureModels) expect(model.createModel).not.toHaveBeenCalled()
  process.exitCode = 0
  vi.restoreAllMocks()
  for (const terminal of terminals.splice(0)) terminal.destroy()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function command(configPath: string, args: string[]) {
  vi.mocked(console.log).mockClear(); vi.mocked(console.error).mockClear(); process.exitCode = 0
  await new Command('agent-qa').option('--config <path>')
    .addCommand(createEvalCommand()).addCommand(createRunsCommand()).exitOverride()
    .parseAsync(['--config', configPath, ...args], { from: 'user' })
  const stdout = vi.mocked(console.log).mock.calls.map(row => row.join(' ')).join('\n')
  const stderr = vi.mocked(console.error).mock.calls.map(row => row.join(' ')).join('\n')
  return { stdout, stderr, exit: process.exitCode }
}
async function json(configPath: string, args: string[]) {
  const output = await command(configPath, [...args, '--json'])
  if (args[1] !== 'gate' && args[1] !== 'report') expect(output.stderr).toBe('')
  return { ...output, dto: JSON.parse(output.stdout) }
}
async function fixture() {
  const f = markFixture(); roots.push(f.root)
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  const member = f.handoff.tests[0]!, original = member.steps[0]!
  member.outcome = 'passed'; f.handoff.aggregateVerdict = 'passed'
  // Twenty-one distinct source addresses, including one false-pass correction.
  // The near-gold pair is a separate source and never pads the marked denominator.
  member.steps = Array.from({ length: 21 }, (_, stepIndex) => ({ ...structuredClone(original), stepIndex,
    verifierVerdict: { pass: true, reasoning: 'Recorded fixture verdict' } }))
  const pair = structuredClone(original); pair.stepIndex = 21
  pair.modelProfile = { provider: 'openai', modelId: 'small-fixture', vision: true }
  pair.verifierVerdict = { pass: true, reasoning: 'Recovery verified' }
  const failed = pair.subActions[0]!, recovering = structuredClone(failed), ref = asRef('e-recovery')
  failed.result = { success: false, error: 'First action failed' }
  recovering.stateBefore.elements.push({ ...structuredClone(recovering.stateBefore.elements[0]!), ref, name: 'Recovery', nameNormalized: 'recovery' })
  recovering.stateBefore.refMap[ref] = structuredClone(recovering.stateBefore.refMap[recovering.stateBefore.elements[0]!.ref]!)
  recovering.plannedAction = { type: 'click', ref }; recovering.result = { success: true }
  recovering.callRecord = { resolvedModelId: 'small-fixture' }
  pair.subActions = [failed, recovering]
  pair.selfHeal = { failedDecision: { plan: failed.plan, plannedAction: failed.plannedAction, result: failed.result },
    recoveringDecision: { plan: recovering.plan, plannedAction: recovering.plannedAction, result: recovering.result } }
  member.steps.push(pair); f.save()
  const seeded = await json(f.configPath, ['eval', 'seed', '--held-out-fraction', '0.4', '--private-fraction', '0.5'])
  expect(seeded.exit, seeded.stdout).toBe(0)
  expect(seeded.dto).toMatchObject({ seededCount: 23, refusals: [], runsSkipped: [] })
  const mark = async (step: number) => {
    const flags = step === 0 ? ['--corrected-action', JSON.stringify({ type: 'delay', ms: 137 }), '--corrected-expectation', 'Authored correction'] : []
    const result = await json(f.configPath, ['runs', 'mark', f.handoff.runId, '--step', String(step),
      '--kind', 'false-pass', ...flags])
    expect(result.exit, result.stdout).toBe(0)
    expect(result.dto.kind).toBe('marked')
    return result.dto.receipt
  }
  const calibrate = (flags: string[] = []) => json(f.configPath, ['eval', 'calibrate', ...flags])
  return { ...f, committedRoot: join(f.root, 'agent-qa-eval'), mark, calibrate }
}

it('drives sovereign gold through no-gold, 19/20/21, preview, commit, repeat and explicit replacement', async () => {
  const f = await fixture(), noGoldBytes = bytes(f.root)
  const empty = (await f.calibrate()).dto
  expect(empty.artifact.channels['recorded-verdict']).toMatchObject({ status: 'uncalibrated', n: 0 })
  expect(empty.artifact.priors).toEqual({})
  expect(bytes(f.root)).toEqual(noGoldBytes)
  const correction = await f.mark(0)
  expect(correction.gold).toHaveLength(2)
  expect(new Set(correction.gold.map((row: { sourceCassetteId: string }) => row.sourceCassetteId)).size).toBe(1)
  for (const gold of correction.gold) {
    expect(readCommittedCorpus(f.committedRoot).snapshot.labelsById.get(gold.cassetteId)).toMatchObject({
      label: { tier: 'gold', sourceChannel: gold.channel }, correction: { verdict: 'fail',
        correctedAction: { type: 'delay', ms: 137 }, correctedExpectation: 'Authored correction' } })
  }
  for (let step = 1; step < 19; step++) await f.mark(step)
  const nineteen = (await f.calibrate()).dto
  expect(nineteen.artifact.channels['recorded-verdict']).toMatchObject({ status: 'uncalibrated', n: 19, n_gold: 19 })
  expect(nineteen.artifact.priors).toEqual({})
  await f.mark(19)
  const beforePreview = bytes(f.root), preview = (await f.calibrate()).dto
  expect(bytes(f.root)).toEqual(beforePreview)
  expect(preview.artifact.minGold).toEqual({ value: 20, source: 'default' })
  expect(preview.artifact.channels['recorded-verdict']).toMatchObject({ status: 'calibrated', n: 20, n_gold: 20, precision: 0 })
  expect(preview.artifact.channels['user-mark'].precision).toBe('by-construction')
  expect(preview.artifact.channels['overturned-verdict'].precision).toBe('by-construction')
  for (const minimum of [19, 20, 21]) {
    const dto = (await f.calibrate(['--min-gold', String(minimum)])).dto
    expect(dto.artifact.minGold).toEqual({ value: minimum, source: 'cli' })
    expect(dto.artifact.channels['recorded-verdict'].status).toBe(minimum === 21 ? 'uncalibrated' : 'calibrated')
  }
  const committed = (await f.calibrate(['--commit'])).dto
  expect(committed).toEqual({ ...preview, kind: 'committed' })
  expect(committed.refreshedCount).toBe(2)
  expect(readLabelCalibration(f.committedRoot)).toMatchObject({ kind: 'loaded', artifact: committed.artifact })
  const firstBytes = bytes(f.root)
  expect((await f.calibrate(['--commit'])).dto).toEqual({ ...committed, kind: 'unchanged', refreshedCount: 0 })
  expect(bytes(f.root)).toEqual(firstBytes)
  await f.mark(20)
  const changedBytes = bytes(f.root), conflict = await f.calibrate(['--commit'])
  expect(conflict.exit).toBe(1); expect(conflict.dto.kind).toBe('write-conflict')
  expect(bytes(f.root)).toEqual(changedBytes)
  const replacement = (await f.calibrate(['--commit', '--replace'])).dto
  expect(replacement.artifact.channels['recorded-verdict']).toMatchObject({ status: 'calibrated', n: 21, precision: 0 })
  expect(replacement.artifact.generationId).not.toBe(committed.artifact.generationId)
  const finalBytes = bytes(f.root)
  expect((await f.calibrate(['--commit', '--replace'])).dto).toEqual({ ...replacement, kind: 'unchanged', refreshedCount: 0 })
  expect(bytes(f.root)).toEqual(finalBytes)
})

it('adopts a real prior generation in new bundle/index hosts and matches report, doctor and preserved old-host identities', async () => {
  const f = await fixture()
  for (let step = 0; step < 20; step++) await f.mark(step)
  const old = trustPriorsForHost(f)
  const oldReader = createKnowledgeReader(() => f.knowledgeRoot, undefined, undefined, old.resolve)
  const before = await oldReader.candidateInjection!({ candidateId: f.published.id })
  expect(before.kind).toBe('found')
  const bundleBytes = bytes(f.knowledgeRoot)
  const publication = (await f.calibrate(['--commit'])).dto
  expect(bytes(f.knowledgeRoot)).toEqual(bundleBytes)
  const fresh = trustPriorsForHost(f), freshReader = createKnowledgeReader(() => f.knowledgeRoot, undefined, undefined, fresh.resolve)
  const after = await freshReader.candidateInjection!({ candidateId: f.published.id })
  expect(after.kind).toBe('found')
  if (before.kind !== 'found' || after.kind !== 'found') throw new Error('fixture bundle absent')
  expect(after.injection.line.trust).not.toBe(before.injection.line.trust)
  expect({ ...after.injection.line, trust: before.injection.line.trust }).toEqual(before.injection.line)
  expect(after.injection.renderedLine).toBe(before.injection.renderedLine)
  expect(await oldReader.candidateInjection!({ candidateId: f.published.id })).toEqual(before)
  const prior = fresh.resolve()!['agent-verified']!
  expect(prior.alpha + prior.beta).toBe(ORIGIN_PRIORS['agent-verified'].alpha + ORIGIN_PRIORS['agent-verified'].beta)
  expect(prior.alpha / (prior.alpha + prior.beta)).toBeCloseTo(0)
  expect(fresh.disclosure.digest).toBe(publication.artifact.generationId)
  for (const mode of ['done', 'failed', 'partial', 'handed-off'] as const) {
    const info = vi.fn()
    const notification = { schemaVersion: 3, runId: f.handoff.runId, outcome: mode === 'failed' ? 'failed' : 'done',
      verdictSummary: { total: 1, byClass: { app_bug: 1 } },
      stages: { analysis: { status: 'done' }, curation: { status: mode === 'failed' ? 'failed' : 'done', curated: 2, deprecated: 1 } } } as RunNotification
    const operations = {
      loadCompletedRunHandoff: () => f.handoff, resolveKnowledgeRoot: () => f.knowledgeRoot,
      composeHost: () => ({ jobs: async () => ({ idSource: DIGEST_JOB_ID_SOURCE,
        store: { adoptEpoch: async () => ({ epoch: 7 }) },
        queue: { recoverAbandonedClaims: async () => ({ recovered: 0 }), runNextJob: async () => ({ ran: false, reason: 'no-job' }) } }), close: async () => undefined }),
      acquireWriterLease: () => mode === 'handed-off' ? { kind: 'held', holder: { pid: 42, leaseId: 'held', epoch: 1 } } : { kind: 'acquired', leaseId: 'fixture-lease', epoch: 7 },
      releaseLease: () => ({ kind: 'released' }), nudgeDaemon: async () => undefined,
      runCurationTail: async () => undefined, createChipEmitter: () => ({ observe: () => undefined }),
      readPostProcessingStatus: async (): Promise<PostProcessingStatus> => ({ runId: f.handoff.runId,
        chips: { analysis: 'done', curation: mode === 'failed' ? 'failed' : 'pending' },
        ...(mode === 'done' || mode === 'failed' ? { notification } : {}) }),
      readRunDigest: async () => ({ pendingProposalCount: 0 }),
    } as unknown as PostRunTailOperations
    const tail = composeCliPostRunTail({ runId: f.handoff.runId, configDir: f.root, configFilePath: f.configPath,
      knowledgeConfig: { dir: 'agent-qa-knowledge' }, auditSink: {} as never,
      log: { info, warn: vi.fn() }, operations, trustPriors: fresh })
    await tail.drain(); await tail.finish()
    expect(tail.report().drain).toBe(mode === 'handed-off' ? 'handed-off' : 'drained')
    expect(info.mock.calls[0]?.[0]).toContain(formatTrustPriorDisclosure(fresh.disclosure))
  }
  const lease = acquireWriterLease(f.knowledgeRoot)
  expect(lease.kind).toBe('acquired')
  if (lease.kind !== 'acquired') throw new Error('fixture lease unavailable')
  const authority = { knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch }
  const oldIndex = openIndexReader(f.knowledgeRoot, { priors: old.resolve() })
  try {
    const oldRow = oldIndex.getById(f.published.id)
    await rebuildIndex({ knowledgeRoot: f.knowledgeRoot, writerAuthority: authority, priors: fresh.resolve() })
    const newIndex = openIndexReader(f.knowledgeRoot, { priors: fresh.resolve() })
    try {
      expect(newIndex.source).toBe('index')
      expect(newIndex.getById(f.published.id).trust).toBe(after.injection.line.trust)
      expect(oldIndex.getById(f.published.id)).toEqual(oldRow)
      expect(oldIndex.source).toBe('scan')
    } finally { newIndex.close() }
  } finally { oldIndex.close(); releaseLease(authority) }
  const read = readCommittedCorpus(f.committedRoot)
  for (const entry of read.snapshot.entries) {
    const scored = metricEntry(entry.cassetteId)
    new FsReplayRecordStore({ root: f.agentQaRoot }).save(scored.outcome)
    new FsScoreStore({ root: f.agentQaRoot }).save({ cassetteId: entry.cassetteId, matcherVersion: 1, score: scored.score, diffs: [] })
  }
  const session = await resolveEvalSession({ configPath: f.configPath })
  const report = (await runReportVerb(session, {}, { source: 'committed' })).report
  const reportCommand = await json(f.configPath, ['eval', 'report', '--source', 'committed'])
  expect(reportCommand.exit).toBe(0)
  expect(reportCommand.dto.report).toEqual(report)
  expect(report.calibration).toEqual({ status: 'calibrated', n_gold: 20, verifierFalsePassRate: publication.artifact.verifierFalsePassRate })
  expect(report.headline.verifierFalsePassRate).toEqual({ numerator: 20, denominator: 23, rate: 20 / 23 })
  expect(report.recovery.eligiblePositiveCount).toBe(1)
  expect(report.recovery.weightSum).toBeGreaterThan(0)
  const markdown = renderEvalReportMarkdown(report)
  for (const key of ['verifierFalsePassRate', 'recovery.recoveryAccuracy', 'recovery.weightedAccuracy', 'calibration.status',
    'perSplit.natural', 'perSplit.held-out.shared', 'perSplit.held-out.private', 'perSplit.adversarial']) expect(markdown).toContain(key)
  const doctor = async () => createKnowledgeChecks({ configPath: f.configPath, config: { knowledge: { dir: 'agent-qa-knowledge' } },
    probes: { resolveEmbedderCapability: async () => ({ kind: 'lexical-only' }),
      buildPromotionPosture: async () => ({ kind: 'no-eval-root', committedRoot: f.committedRoot }) } })[3].check()
  const beforeDoctor = bytes(f.root), current = await doctor()
  expect(current.message).toContain('goldDigest current')
  expect(current.message).toContain(formatTrustPriorDisclosure(fresh.disclosure))
  expect(bytes(f.root)).toEqual(beforeDoctor)
  await f.mark(20)
  const beforeStale = bytes(f.root), stale = await doctor()
  expect(stale.message).toContain('goldDigest stale')
  expect(stale.message).toContain(publication.artifact.generationId)
  expect(bytes(f.root)).toEqual(beforeStale)
  expect(buildTrustPriorsResolver({ ...f, inspectCalibration: true })).toMatchObject({ kind: 'ready', calibration: expect.stringContaining('stale') })
})

it('keeps all eleven own-profile comparison rows and legacy exits through real fresh/saved gate commands', async () => {
  // These model calls use in-process fixture languageModels; the external fetch port still throws.
  fixtureModels = true; vi.mocked(model.createModel).mockImplementation(actualCreateModel)
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-calibration-gate-')); roots.push(root)
  const f = await labelGateFixture(root), configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, ['workspace:', '  testMatch: [tests/**/*.yaml]', '  suiteMatch: [suites/**/*.suite.yaml]',
    '  hooksFile: hooks.yaml', '  envFile: .env', '  secretsFile: .env.secrets.local', 'registry:', '  llms:',
    '    - name: planner', '      provider: openai-compatible', `      model: ${f.input.mode.profile.model}`,
    '      baseURL: http://localhost:1/v1', 'use:', '  llm: planner', '  mobile:', '    appState: preserve', ''].join('\n'))
  writeFileSync(join(root, '.env.secrets.local'), '')
  const actualGate = verbs.runGateVerb
  vi.spyOn(verbs, 'runGateVerb').mockImplementation((session, opts) => actualGate(session, { ...opts, plannerOverrides: f.input.mode.modelOverrides }))
  const fresh = await json(configPath, ['eval', 'gate'])
  expect(fresh.exit).toBe(0); expect(fresh.dto.kind).toBe('verdict')
  expect(fresh.dto.verdict.labelMetrics.rows.map((row: { metric: string }) => row.metric)).toEqual(labelMetricIds)
  // This historical floor fixture has no mark/handoff population and reports that absence.
  expect(fresh.dto.currentReport.calibration).toEqual({ status: 'uncalibrated' })
  f.stub.captured.length = 0
  const currentBytes = readFileSync(fresh.dto.currentReportFile, 'utf8')
  for (const legacy of [false, true]) {
    if (legacy) rewriteReport(f.baselineFile, legacyReport)
    const baselineBytes = readFileSync(f.baselineFile, 'utf8')
    const flags = ['eval', 'gate', '--report', fresh.dto.currentReport.batchKey]
    const saved = await json(configPath, flags)
    expect(saved.exit).toBe(fresh.exit); expect(saved.dto.modelCalls).toBe(0)
    const text = await command(configPath, flags)
    for (const row of saved.dto.verdict.labelMetrics.rows) {
      const line = text.stdout.split('\n').find(line => line.startsWith(`label-metric: ${row.metric} `))!
      expect(JSON.parse(line.slice(`label-metric: ${row.metric} `.length))).toEqual(row)
    }
    if (legacy) expect(saved.dto.verdict.labelMetrics.rows[0]).toMatchObject({ status: 'not-comparable',
      reasons: expect.arrayContaining([expect.objectContaining({ side: 'baseline', reason: 'missing-field' })]) })
    else expect(saved.dto.verdict).toEqual(fresh.dto.verdict)
    expect(readFileSync(f.baselineFile, 'utf8')).toBe(baselineBytes)
  }
  expect(readFileSync(fresh.dto.currentReportFile, 'utf8')).toBe(currentBytes)
  expect(f.stub.captured).toHaveLength(0)
  // A genuine saved report with harness-error accounting still yields exit2.
  const errored = structuredClone(fresh.dto.currentReport)
  errored.honesty.harnessErrorCount = 1
  const decisions = JSON.parse(readFileSync(fresh.dto.currentReportFile.replace(/\.json$/, '.decisions.json'), 'utf8'))
  const directory = join(root, 'staged-error')
  new FsReportStore({ root: f.input.agentQaRoot, outputDir: directory }).save(errored, decisions)
  expect((await json(configPath, ['eval', 'gate', '--report', errored.batchKey, '--staged-dir', directory])).exit).toBe(2)
})

it('persists an actual zero-tolerance harmed receipt carrying the weight produced by calibration', async () => {
  const f = await fixture()
  await f.calibrate(['--commit'])
  const weight = [...readCommittedCorpus(f.committedRoot).snapshot.labelsById.values()].find(row => row.weight)?.weight!
  expect(weight.value).toBeGreaterThan(0)
  fixtureModels = true; vi.mocked(model.createModel).mockImplementation(actualCreateModel)
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-calibration-harm-')); roots.push(root)
  const gate = writeGate1Fixture(root)
  const baseline = respondingStub((call: { prompt: unknown }) => JSON.stringify(call.prompt).includes('gate1-target-sibling-1')
    ? actionGenerateResult() : gate1Responder(gate)(call))
  await warmGateRoot(gate, baseline)
  const stub = respondingStub((call: { prompt: unknown }) => JSON.stringify(call.prompt).includes('gate1-collateral-0')
    ? actionGenerateResult('web', 'e-other') : gate1Responder(gate)(call))
  const { cassette } = gate.selected.find((row: { cassette: LeafCassette }) => row.cassette.input.stepText === 'gate1-collateral-0')!
  const label = { ...projectSilverLabelRecord({ cassette, runId: cassette.runId }), weight }
  const path = join(gate.committedRoot, committedLabelPath('alpha', cassette.id))
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(label))
  const result = await runReplayGate({ injection: gate.injection, committedRoot: gate.committedRoot, agentQaRoot: gate.agentQaRoot,
    identity: gate.identity, planner: { profile: stubProfile(), modelOverrides: { languageModels: stub.languageModels }, resolveAuth: async () => noneAuth },
    judgeOverrideConfigured: false, k: 3, kSource: 'default', maxScreens: 64,
    baselineSeed: { floorSeeds: [11] }, producedBy: { opId: 'eval.replay-gate' }, clock: incrementingClock() })
  expect(result.kind).toBe('receipt')
  if (result.kind !== 'receipt') throw new Error('gate receipt refused')
  expect(result.receipt.verdict).toBe('fail')
  expect(result.receipt.reasons).toEqual(['collateral-harm'])
  expect(result.receipt.harmed).toEqual([expect.objectContaining({ cassetteId: cassette.id, softWeight: weight.value })])
  const receiptPath = join(root, 'receipt.json')
  writeFileSync(receiptPath, serializeReplayGateReceipt(result.receipt))
  const saved = GateReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, 'utf8')))
  expect(saved).toEqual(result.receipt); expect(receiptDigestOf(saved)).toBe(saved.receiptDigest)
})

const fractions = { heldOutFraction: 0.4, privateFraction: 0.5 }
const partition = { ...fractions, saltHex: '0'.repeat(64) }
const verdict = (classification: Verdict['class'], perTest: number): Verdict => ({ class: classification,
  producer: 'deterministic-classifier', perTest, confidence: 1, memoryMisdirectionRuledOut: true,
  evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded failure' } })
function rerunFixture(existingOriginal = true) {
  const f = markFixture(); roots.push(f.root)
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  const member = f.handoff.tests[0]!
  f.handoff.tests = [member]
  const committedRoot = join(f.root, 'agent-qa-eval')
  const artifacts = new FsRunArtifactSource({ root: f.agentQaRoot, runId: f.handoff.runId })
  const evidence = structuredClone(member.steps[0]!)
  // 422-12: extraction now projects the member's recorded root cause onto the cassette label, so
  // the ORIGINAL cassette must be extracted from a handoff carrying the ORIGINAL attempt's
  // verdict — the one `rerunOrigin.rootCause` preserves below — never the rerun's final class.
  member.rootCause = verdict('environment', 0)
  const originalExtraction = extractRunCassettes({ handoff: f.handoff, artifacts }).cassettes
  const original = originalExtraction.find(row => row.cassette.granularity === 'leaf')!.cassette
  if (original.granularity !== 'leaf') throw new Error('fixture leaf missing')
  const label = projectSilverLabelRecord({ cassette: original, runId: f.handoff.runId })
  const originalPlan = buildSeedingPlan({ handoff: f.handoff, cassettes: originalExtraction, partition })
  originalPlan.cases = [{ cassetteId: original.id, labelRecord: label, corpusEntry: projectCorpusEntry({
    cassette: original, product: 'default', runId: f.handoff.runId, assignment: { split: 'natural' },
  }) }]
  if (existingOriginal) {
    const initial = seedCommittedCorpus({ plan: originalPlan, cassettes: originalExtraction,
      committedRoot, seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'original') })
    expect(initial.refusals).toEqual([])
    expect(initial.seededCount).toBe(1)
  }
  const facts = { runId: f.handoff.runId, testId: member.testId, testIndex: member.testIndex,
    stepIndex: evidence.stepIndex, decisionOrdinal: 0, evidence }
  const origin = { attempt: 0, outcome: 'failed' as const, rootCause: verdict('environment', 0),
    decisions: [{ ...facts, screenStateHash: screenStateHash(evidence.subActions[0]!.stateBefore),
      evidenceDigest: sha256hex(canonicalJson(facts)) }] }
  member.isRerun = true; member.rerunAttempt = 2
  member.rerunOrigin = { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) }
  member.rootCause = verdict('flake', 0)
  member.outcome = 'passed'
  member.steps[0]!.verifierVerdict = { pass: true, reasoning: 'Retry passed' }
  // A recovery on a later step keeps distinct actual cassette addresses from the original.
  const pairStep = structuredClone(member.steps[0]!)
  pairStep.stepIndex = 1
  const failed = pairStep.subActions[0]!, recovering = structuredClone(failed)
  failed.result = { success: false, error: 'Action rejected' }
  const ref = asRef('e-recovery')
  recovering.stateBefore.elements.push({ ...structuredClone(recovering.stateBefore.elements[0]!), ref,
    name: 'Recovery', nameNormalized: 'recovery' })
  recovering.stateBefore.refMap[ref] = structuredClone(recovering.stateBefore.refMap[recovering.stateBefore.elements[0]!.ref]!)
  recovering.plannedAction = { type: 'click', ref }
  recovering.result = { success: true }
  pairStep.subActions = [failed, recovering]
  const decision = (sub: typeof failed) => ({ plan: sub.plan, plannedAction: sub.plannedAction, result: sub.result })
  pairStep.selfHeal = { failedDecision: decision(failed), recoveringDecision: decision(recovering) }
  member.steps.push(pairStep)
  const silver = structuredClone(member)
  silver.testIndex = 2; silver.rootCause = verdict('flake', 2)
  delete silver.rerunOrigin
  silver.steps = [structuredClone(member.steps[0]!)]
  const excluded = structuredClone(member)
  excluded.testIndex = 5; excluded.rootCause = verdict('timeout', 5)
  excluded.outcome = 'timeout'
  delete excluded.isRerun; delete excluded.rerunAttempt; delete excluded.rerunOrigin
  // Even a self-heal step here must not enter this mixed run's admission/population.
  f.handoff.tests = [member, silver, excluded]
  f.save()
  return { ...f, member, silver, excluded, original, committedRoot, artifacts }
}

it('seeds original-failure rerun quarantine and recovery through the actual command and repeats byte-identically', async () => {
  const f = rerunFixture(), old = bytes(f.committedRoot)
  const result = (await json(f.configPath, ['eval', 'seed', '--held-out-fraction', '0.4', '--private-fraction', '0.5'])).dto
  expect(result).toMatchObject({ seededCount: 3, supersededOriginalCount: 1,
    retirementCounts: { missing: 0, conflict: 0 }, refusals: [], runsSkipped: [] })
  const read = readCommittedCorpus(f.committedRoot)
  expect(read.snapshot.labelsById.get(f.original.id)?.quarantine).toBe('rerun-overturned')
  expect(read.snapshot.entries.some(entry => entry.cassetteId === f.original.id)).toBe(false)
  const pairs = [...read.snapshot.labelsById.values()].filter(label => label.label.sourceChannel === 'self-heal-pair')
  expect(pairs).toHaveLength(2)
  for (const label of pairs) expect(label).toMatchObject({ weight: { k: 1, n: 1 }, provenance: { rerun: { attempt: 2 } } })
  for (const [path, content] of old) expect(readFileSync(path!).toString('hex')).toBe(content)
  const before = bytes(f.root)
  expect((await json(f.configPath, ['eval', 'seed'])).dto).toMatchObject({ seededCount: 0, unchangedCount: 3, supersededOriginalCount: 0 })
  expect(bytes(f.root)).toEqual(before)
})
