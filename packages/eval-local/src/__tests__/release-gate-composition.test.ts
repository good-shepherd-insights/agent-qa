import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  buildEvalReport,
  computeBatchKey,
  computeCorpusDigest,
  projectBaselinePointer,
  renderGateLines,
} from '@vostride/agent-qa-eval'
import { resolveCapabilities } from '@vostride/agent-qa-model'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as evalLocal from '../index.js'
import {
  MEMBERSHIP_DEFECTS,
  changeCommittedMembership,
  incrementingClock,
  noneAuth,
  stubProfile,
  warningStub,
  writeCommittedFloorFixture,
} from './fixtures/floor-fixtures.js'
import { actionGenerateResult, capturingStub, makeReplayHandoff, nonActionGenerateResult, REPLAY_FIXTURE_BLOB_SHA } from './fixtures/replay-fixtures.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(configure?: Parameters<typeof writeCommittedFloorFixture>[1]) {
  expect(evalLocal.runReleaseGate).toBeTypeOf('function')
  const root = await mkdtemp(join(tmpdir(), 'release-gate-'))
  roots.push(root)
  const corpus = writeCommittedFloorFixture(root, configure)
  const stub = warningStub()
  const profile = stubProfile()
  const agentQaRoot = join(root, '.agent-qa')
  const profileKeyInputs = { plannerModelId: profile.model, matcherVersion: buildEvalReport([]).matcherVersion }
  const fresh = {
    kind: 'fresh' as const,
    profile,
    auth: noneAuth,
    modelOverrides: { languageModels: stub.languageModels },
    maskingContextFactory: createMaskingContext,
    seed: 11,
    cassettesRoot: corpus.cassettesRoot,
    replayOutputBaseDir: join(root, 'audit'),
  }
  const floor = await evalLocal.runNoiseFloorMeasurement({
    ...fresh, committedRoot: corpus.committedRoot, agentQaRoot, profileKeyInputs,
    seeds: [11, 29], repeats: 3, bootstrapSeed: 97, commit: true,
    reportOutputBaseDir: fresh.replayOutputBaseDir, clock: incrementingClock(),
  })
  expect(floor.committed?.kind).toBe('written')
  const batchKey = computeBatchKey(corpus.selected.map(entry => entry.cassette.id))
  const baseline = evalLocal.loadStagedReport(agentQaRoot, batchKey, join(floor.runRoots[0]!, 'reports'))
  if (baseline.kind !== 'loaded' || baseline.decisions === undefined) throw new Error('expected fixture baseline')
  expect(evalLocal.commitEvalReport({
    report: baseline.report, decisions: baseline.decisions, markdown: '# Fixture baseline\n',
    committedRoot: corpus.committedRoot, reportOutputBaseDir: fresh.replayOutputBaseDir,
  }).kind).toBe('committed')
  const pointer = projectBaselinePointer({
    ...profileKeyInputs, batchKey, fingerprint: floor.fingerprint, corpusDigest: floor.artefact.corpusDigest,
  })
  expect(evalLocal.writeBaselinePointer({ report: baseline.report, pointer,
    committedRoot: corpus.committedRoot, reportOutputBaseDir: fresh.replayOutputBaseDir,
  }).kind).toBe('written')
  stub.captured.length = 0
  return {
    root, corpus, stub, floor, baseline, pointer,
    input: { committedRoot: corpus.committedRoot, agentQaRoot, profileKeyInputs,
      mode: fresh, clock: incrementingClock() },
    pointerFile: join(corpus.committedRoot, evalLocal.committedBaselinePointerPath(floor.profileKey)),
    floorFile: join(corpus.committedRoot, evalLocal.committedNoiseFloorPath(floor.profileKey)),
    baselineFile: join(corpus.committedRoot, evalLocal.committedReportPath(batchKey, 'report.json')),
    baselineDecisionsFile: join(corpus.committedRoot, evalLocal.committedReportPath(batchKey, 'decisions.json')),
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

function offline(f: Fixture, stagedOutputDir?: string) {
  return {
    ...f.input,
    mode: { kind: 'report' as const, batchKey: f.pointer.batchKey, stagedOutputDir,
      profile: f.input.mode.profile, modelOverrides: f.input.mode.modelOverrides },
    clock: incrementingClock(),
  }
}

function requireVerdict(result: Awaited<ReturnType<typeof evalLocal.runReleaseGate>>) {
  expect(result.kind).toBe('verdict')
  if (result.kind !== 'verdict') throw new Error(JSON.stringify(result))
  return result
}

function rewrite(file: string, change: (value: Record<string, any>) => void) {
  const value = JSON.parse(readFileSync(file, 'utf8'))
  change(value)
  writeFileSync(file, JSON.stringify(value))
}

describe('runReleaseGate', () => {
  it.each(MEMBERSHIP_DEFECTS)('refuses fresh %s before provider calls', async defect => {
    const f = await fixture()
    changeCommittedMembership(f.corpus, defect)
    expect(await evalLocal.runReleaseGate(f.input)).toMatchObject({
      kind: 'refused', refusal: { reason: expect.stringMatching(/committed corpus/i) },
    })
    expect(f.stub.captured).toHaveLength(0)
    expect(existsSync(join(f.input.agentQaRoot, 'eval', 'gate'))).toBe(false)
  })

  it('passes identical fresh decisions, stages the pair locally, and never changes committed evidence', async () => {
    const f = await fixture()
    const committedFiles = [f.pointerFile, f.floorFile, f.baselineFile, f.baselineDecisionsFile]
    const before = committedFiles.map(file => readFileSync(file, 'utf8'))
    const lines: string[] = []
    const result = requireVerdict(await evalLocal.runReleaseGate({ ...f.input,
      mode: { ...f.input.mode, onProgress: line => lines.push(line) },
    }))
    expect(result.verdict.exit).toBe(0)
    expect(result.verdict.pairing.n).toBe(3)
    expect(result.lines).toEqual(renderGateLines(result.verdict))
    expect(result.mode).toBe('fresh')
    expect(result.profileKey).toBe(f.floor.profileKey)
    expect(result.fingerprint).toBe(f.floor.fingerprint)
    expect(result.currentReportFile).toBe(join(f.input.agentQaRoot, 'eval', 'gate',
      slugBranch(f.floor.profileKey), 'reports', `${f.pointer.batchKey}.json`))
    expect(existsSync(result.currentReportFile.replace(/\.json$/, '.decisions.json'))).toBe(true)
    expect(result.currentReport.runIdentity).toEqual({
      fingerprint: result.fingerprint, corpusDigest: f.floor.artefact.corpusDigest,
    })
    expect(result.modelCalls).toBe(3)
    expect(f.stub.captured).toHaveLength(3)
    expect(result.wallClockMs).toBeGreaterThan(0)
    expect(lines).toContainEqual(expect.stringMatching(/^gate seed=11: decisions=3 modelCalls=3 promptTokens=30 completionTokens=6 wallClock=\d+ms seedHonored=false$/))
    expect(result.refusals).toEqual([])
    expect(committedFiles.map(file => readFileSync(file, 'utf8'))).toEqual(before)
    expect(evalLocal.listCommittedReports(f.input.committedRoot).reports).toHaveLength(1)
  })

  it('returns exit 1 naming the headline and axes worsened beyond the measured floor', async () => {
    const f = await fixture()
    const changed = capturingStub(() => ({ ...actionGenerateResult(),
      warnings: [{ type: 'unsupported', feature: 'seed' }],
      content: [{ type: 'tool-call', toolCallId: 'different-action', toolName: 'web_fill',
        input: JSON.stringify({ ref: 'e-continue', text: 'different', reasoning: 'fill',
          confidence: 0.95, stepComplete: true, doesActionAdvanceUsTowardsGoal: true }) }],
    }))
    const result = requireVerdict(await evalLocal.runReleaseGate({ ...f.input,
      mode: { ...f.input.mode, modelOverrides: { languageModels: changed.languageModels } },
    }))
    expect(result.verdict.exit).toBe(1)
    expect(result.verdict.regressions).toContainEqual(expect.objectContaining({ axis: 'headline', n: 3 }))
    expect(result.lines).toContainEqual(expect.stringContaining('regression: headline'))
    expect(changed.captured).toHaveLength(3)
  })

  it.each(['old', 'expected'] as const)('distinguishes a v1 body at its %s pointer filename', async placement => {
    const f = await fixture()
    const oldKey = `planner=${f.pointer.plannerModelId}|matcher=${f.pointer.matcherVersion}|judge=none|judgeVersion=none`
    const { fingerprint: _fingerprint, corpusDigest: _corpusDigest, ...rest } = f.pointer
    const legacy = { ...rest, schemaVersion: 1, profileKey: oldKey }
    const oldFile = join(f.input.committedRoot, evalLocal.committedBaselinePointerPath(oldKey))
    if (placement === 'old') renameSync(f.pointerFile, oldFile)
    writeFileSync(placement === 'old' ? oldFile : f.pointerFile, JSON.stringify(legacy))
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.verdict.inconclusive).toContainEqual({
      reason: placement === 'old' ? 'missing-baseline' : 'incomparable-baseline',
      detail: expect.stringContaining(placement === 'old' ? oldKey : 'no-fingerprint'),
    })
  })

  it('does not accept the expected body stored at an unrelated pointer filename', async () => {
    const f = await fixture()
    renameSync(f.pointerFile, join(dirname(f.pointerFile), 'wrong-key.json'))
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.verdict.inconclusive).toContainEqual({ reason: 'missing-baseline', detail: expect.any(String) })
  })

  it('refuses a mismatched body in the expected pointer file before replay', async () => {
    const f = await fixture()
    rewrite(f.pointerFile, value => { value.profileKey = 'planner=another|fingerprint=another' })
    const result = await evalLocal.runReleaseGate(f.input)
    expect(result).toMatchObject({ kind: 'refused', refusal: { path: f.pointerFile,
      reason: expect.stringContaining('profileKey') } })
    expect(f.stub.captured).toHaveLength(0)
  })

  it.each(['pointer', 'floor'] as const)('names both corpus digests for a stale %s', async leg => {
    const f = await fixture()
    const staleDigest = 'a'.repeat(64)
    rewrite(leg === 'pointer' ? f.pointerFile : f.floorFile, value => { value.corpusDigest = staleDigest })
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    const reason = result.verdict.inconclusive.find(entry => entry.reason === (leg === 'pointer' ? 'stale-baseline' : 'stale-floor'))
    expect(reason?.detail).toContain(staleDigest)
    expect(reason?.detail).toContain(f.floor.artefact.corpusDigest)
  })

  it('refuses a changed seed support regime', async () => {
    const f = await fixture()
    rewrite(f.floorFile, value => { value.seedHonored = true })
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.verdict.inconclusive).toContainEqual({ reason: 'seed-regime-mismatch', detail: expect.any(String) })
  })

  it('names the baseline when committed decision vectors are absent', async () => {
    const f = await fixture()
    unlinkSync(f.baselineDecisionsFile)
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.verdict.inconclusive).toContainEqual({ reason: 'no-decision-vector', detail: expect.stringMatching(/^baseline:/) })
  })

  it.each(['pointer', 'floor', 'baseline', 'baselineDecisions'] as const)('carries exact-file %s parse refusals without throwing', async leg => {
    const f = await fixture()
    const file = f[`${leg}File`]
    writeFileSync(file, '{invalid')
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.refusals).toContainEqual({ path: file, reason: expect.any(String) })
  })

  it('refuses loader failures with unchanged corpus digest before provider calls', async () => {
    const f = await fixture()
    const brokenDir = evalLocal.listCassetteBundleDirs(f.corpus.cassettesRoot)[0]!
    const original = evalLocal.loadCassetteBundle(brokenDir)
    if (original.kind !== 'loaded') throw new Error('expected valid fixture bundle')
    const file = join(brokenDir, 'cassette.json')
    writeFileSync(file, '{invalid')
    expect(computeCorpusDigest(evalLocal.readCommittedCorpus(f.input.committedRoot).snapshot.entries))
      .toBe(f.floor.artefact.corpusDigest)
    expect(await evalLocal.runReleaseGate(f.input)).toMatchObject({
      kind: 'refused', refusal: { path: file, reason: expect.stringContaining('parse-failed') },
    })
    expect(f.stub.captured).toHaveLength(0)
  })

  it('retains missing-blob replay refusals after admitting all committed members', async () => {
    const f = await fixture((handoff, index) => {
      if (index === 0) handoff.tests[0]!.steps[0] = makeReplayHandoff({ vision: true }).tests[0]!.steps[0]!
    })
    const bundle = evalLocal.listCassetteBundleDirs(f.corpus.cassettesRoot)
      .find(dir => existsSync(join(dir, 'blobs', REPLAY_FIXTURE_BLOB_SHA)))!
    unlinkSync(join(bundle, 'blobs', REPLAY_FIXTURE_BLOB_SHA))
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.currentReport.batchKey).toBe(f.pointer.batchKey)
    expect(result.currentReport.honesty.refusalCounts['missing-blob']).toBe(1)
    expect(result.currentReport.runIdentity?.corpusDigest).toBe(f.floor.artefact.corpusDigest)
    expect(result.verdict).toMatchObject({ exit: 2, pairing: { n: 2 } })
    expect(result.modelCalls).toBe(2)
    expect(f.stub.captured).toHaveLength(2)
  })

  it('keeps legitimately unpaired scored axes after complete input admission', async () => {
    const f = await fixture()
    rewrite(f.baselineDecisionsFile, document => {
      document.vectors[0].axes.headline = 'not-applicable'
    })
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict).toMatchObject({
      exit: 0, inconclusive: [], pairing: { n: 2, currentOnly: 1, baselineOnly: 0 },
    })
    expect(result.modelCalls).toBe(3)
  })

  it('does not inherit prior successful decisions after a current record write fails', async () => {
    const f = await fixture()
    requireVerdict(await evalLocal.runReleaseGate(f.input))
    const failedId = f.corpus.selected[0]!.cassette.id
    const save = evalLocal.FsReplayRecordStore.prototype.save
    vi.spyOn(evalLocal.FsReplayRecordStore.prototype, 'save').mockImplementation(function(this: evalLocal.FsReplayRecordStore, outcome) {
      if (outcome.cassetteId === failedId) throw new Error('current record write failed')
      return save.call(this, outcome)
    })
    const result = requireVerdict(await evalLocal.runReleaseGate(f.input))
    expect(result.verdict.exit).toBe(2)
    expect(result.currentReport.honesty.harnessErrorCount).toBe(1)
    expect(result.verdict.pairing.n).toBe(2)
    expect(result.modelCalls).toBe(3)
    expect(result.verdict.inconclusive).toContainEqual({ reason: 'harness-errors', detail: expect.any(String) })
  })

  it('discloses actual provider rounds rather than sample counts', async () => {
    const f = await fixture(handoff => {
      handoff.tests[0]!.steps[0]!.subActions[0]!.exchanges = [{ tool: 'lookup_note', args: {}, result: 'continue' }]
    })
    const stub = capturingStub(call => ({
      ...(call % 2 === 0 ? nonActionGenerateResult('lookup_note') : actionGenerateResult()),
      warnings: [{ type: 'unsupported', feature: 'seed' }],
    }))
    const result = requireVerdict(await evalLocal.runReleaseGate({ ...f.input,
      mode: { ...f.input.mode, modelOverrides: { languageModels: stub.languageModels } },
    }))
    expect(result.currentReport.totalCost.sampleCount).toBe(3)
    expect(result.modelCalls).toBe(6)
    expect(stub.captured).toHaveLength(6)
  })

  it('returns an exact-file refusal when fresh report staging cannot write', async () => {
    const f = await fixture()
    const reportsRoot = join(f.input.agentQaRoot, 'eval', 'gate', slugBranch(f.floor.profileKey), 'reports')
    mkdirSync(reportsRoot, { recursive: true })
    const blockedFile = join(reportsRoot, `${f.pointer.batchKey}.json`)
    mkdirSync(blockedFile)
    await expect(evalLocal.runReleaseGate(f.input)).resolves.toMatchObject({
      kind: 'refused', refusal: { path: blockedFile, reason: expect.any(String) },
    })
  })
})

describe('offline release gate', () => {
  it('reproduces the fresh verdict with zero calls and the original report untouched', async () => {
    const f = await fixture()
    const fresh = requireVerdict(await evalLocal.runReleaseGate(f.input))
    const before = readFileSync(fresh.currentReportFile, 'utf8')
    f.stub.captured.length = 0
    const result = requireVerdict(await evalLocal.runReleaseGate(offline(f, dirname(fresh.currentReportFile))))
    expect(result.verdict).toEqual(fresh.verdict)
    expect(result.lines).toEqual(fresh.lines)
    expect(result.currentReport).toEqual(fresh.currentReport)
    expect(result.currentReportFile).toBe(fresh.currentReportFile)
    expect(result.mode).toBe('report')
    expect(result.modelCalls).toBe(0)
    expect(result.wallClockMs).toBeGreaterThan(0)
    expect(f.stub.captured).toHaveLength(0)
    expect(readFileSync(result.currentReportFile, 'utf8')).toBe(before)
  })

  it('keeps a historical report without a sidecar explicitly inconclusive on current vectors', async () => {
    const f = await fixture()
    const { runIdentity: _runIdentity, ...legacy } = f.baseline.report
    const stored = new evalLocal.FsReportStore({ root: f.input.agentQaRoot }).save(legacy)
    const result = requireVerdict(await evalLocal.runReleaseGate(offline(f)))
    expect(result.verdict.exit).toBe(2)
    expect(result.verdict.inconclusive.filter(entry => entry.reason === 'no-decision-vector')).toEqual([
      { reason: 'no-decision-vector', detail: expect.stringMatching(/^current:/) },
    ])
    expect(result.currentReportFile).toBe(stored.file)
    expect(result.currentReport).not.toHaveProperty('runIdentity')
    expect(result.notices).toContain('staged report carries no decisions sidecar — the verdict is inconclusive (no-decision-vector: current); re-run eval report to stage vectors')
    expect(f.stub.captured).toHaveLength(0)
  })

  it('probes exactly the selected directory and names the absent report', async () => {
    const f = await fixture()
    new evalLocal.FsReportStore({ root: f.input.agentQaRoot }).save(f.baseline.report, f.baseline.decisions)
    const selected = join(f.root, 'empty-selected')
    expect(await evalLocal.runReleaseGate(offline(f, selected))).toMatchObject({
      kind: 'refused', refusal: { reason: 'staged report absent', path: join(selected, `${f.pointer.batchKey}.json`) },
    })
    const unknown = offline(f)
    unknown.mode.batchKey = 'unknown-batch'
    expect(await evalLocal.runReleaseGate(unknown)).toMatchObject({
      kind: 'refused', refusal: { reason: 'staged report absent', path: join(f.input.agentQaRoot, 'eval', 'reports', 'unknown-batch.json') },
    })
    expect(f.stub.captured).toHaveLength(0)
  })

  it.each(['report', 'decisions'] as const)('returns the exact offending staged %s file', async part => {
    const f = await fixture()
    const stored = new evalLocal.FsReportStore({ root: f.input.agentQaRoot }).save(f.baseline.report, f.baseline.decisions)
    const file = part === 'report' ? stored.file : stored.decisionsFile!
    writeFileSync(file, '{invalid')
    expect(await evalLocal.runReleaseGate(offline(f))).toMatchObject({
      kind: 'refused', refusal: { path: file, reason: expect.any(String) },
    })
    expect(f.stub.captured).toHaveLength(0)
  })

  it.each(['profile', 'corpus'] as const)('does not relabel a saved fresh run after the %s changes', async changed => {
    const f = await fixture()
    const fresh = requireVerdict(await evalLocal.runReleaseGate(f.input))
    const before = readFileSync(fresh.currentReportFile, 'utf8')
    const input = offline(f, dirname(fresh.currentReportFile))
    if (changed === 'profile') input.mode.profile = { ...input.mode.profile,
      capabilities: { ...resolveCapabilities(input.mode.profile), vision: true } }
    else {
      const entry = evalLocal.readCommittedCorpus(f.input.committedRoot).snapshot.entries[0]!
      rewrite(join(f.input.committedRoot, evalLocal.committedCorpusPath(entry.product, entry.cassetteId)),
        value => { value.captured_at_ordinal += 1 })
    }
    f.stub.captured.length = 0
    const result = await evalLocal.runReleaseGate(input)
    expect(result).toMatchObject({ kind: 'refused', refusal: { path: fresh.currentReportFile,
      reason: expect.stringContaining(changed === 'profile' ? 'fingerprint' : 'corpusDigest') } })
    expect(f.stub.captured).toHaveLength(0)
    expect(readFileSync(fresh.currentReportFile, 'utf8')).toBe(before)
  })

  it.each([undefined, null, [], {}, { fingerprint: 12, corpusDigest: 'bad' },
    { fingerprint: 'bad', corpusDigest: 'a'.repeat(64) }])('refuses missing or malformed saved run identity %j with vectors', async identity => {
    const f = await fixture()
    const invalid = structuredClone(f.baseline.report)
    if (identity === undefined) Reflect.deleteProperty(invalid, 'runIdentity')
    else Reflect.set(invalid, 'runIdentity', identity)
    const stored = new evalLocal.FsReportStore({ root: f.input.agentQaRoot }).save(invalid, f.baseline.decisions)
    expect(await evalLocal.runReleaseGate(offline(f))).toMatchObject({
      kind: 'refused', refusal: { path: stored.file, reason: expect.stringContaining('runIdentity') },
    })
    expect(f.stub.captured).toHaveLength(0)
  })

  it.each(['current', 'baseline'] as const)('refuses malformed %s mixed judge metadata without throwing', async side => {
    const f = await fixture()
    const stored = new evalLocal.FsReportStore({ root: f.input.agentQaRoot }).save(f.baseline.report, f.baseline.decisions)
    const file = side === 'current' ? stored.file : f.baselineFile
    rewrite(file, value => { value.judgeIdentity = 'mixed'; value.mixedJudgeModelIds = 'malformed-list' })
    const result = await evalLocal.runReleaseGate(offline(f))
    if (side === 'current') expect(result).toMatchObject({ kind: 'refused', refusal: { path: file, reason: expect.stringContaining('mixedJudgeModelIds') } })
    else {
      const verdict = requireVerdict(result)
      expect(verdict.verdict.exit).toBe(2)
      expect(verdict.refusals).toContainEqual({ path: file, reason: expect.stringContaining('mixedJudgeModelIds') })
    }
    expect(f.stub.captured).toHaveLength(0)
  })
})
