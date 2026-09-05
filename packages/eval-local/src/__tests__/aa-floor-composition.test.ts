import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeBatchKey, computeGateVerdict, extractRunCassettes } from '@vostride/agent-qa-eval'
import { resolveCapabilities } from '@vostride/agent-qa-model'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as evalLocal from '../index.js'
import {
  incrementingClock,
  noneAuth,
  stubProfile,
  warningStub,
  writeFloorLeaves,
} from './fixtures/floor-fixtures.js'
import {
  actionGenerateResult,
  capturingStub,
  familyStubProfile,
  judgeGenerateResult,
  makeReplayHandoff,
  memArtifacts,
  nonActionGenerateResult,
} from './fixtures/replay-fixtures.js'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aa-floor-'))
  roots.push(root)
  const stub = warningStub()
  return {
    root,
    stub,
    input: {
      ...writeFloorLeaves(root),
      agentQaRoot: root,
      runRoot: join(root, 'r0-seed11'),
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      maskingContextFactory: createMaskingContext,
      seed: 11,
      replayOutputBaseDir: join(root, 'audit'),
      source: 'committed',
      clock: incrementingClock(),
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('replayCorpusOnce', () => {
  it('stages actual profile and supplied corpus identity, leaving undeclared receipts absent', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const corpusDigest = 'a'.repeat(64)
    const first = await evalLocal.replayCorpusOnce({ ...input, corpusDigest })
    const fingerprint = evalLocal.computeReplayProfileFingerprintFor({
      profile: input.profile, modelOverrides: input.modelOverrides, seedPolicy: 'declared',
    })
    expect(first.report.runIdentity).toEqual({ fingerprint, corpusDigest })
    expect(evalLocal.loadStagedReport(input.agentQaRoot, first.report.batchKey,
      join(input.runRoot, 'reports'))).toMatchObject({
      kind: 'loaded', report: { runIdentity: { fingerprint, corpusDigest } },
    })
    const second = await evalLocal.replayCorpusOnce({ ...input, corpusDigest: 'b'.repeat(64),
      profile: { ...input.profile, capabilities: { ...resolveCapabilities(input.profile), vision: true } },
    })
    expect(second.report.runIdentity?.fingerprint).not.toBe(fingerprint)
    expect(second.report.runIdentity?.corpusDigest).toBe('b'.repeat(64))
    const legacy = await evalLocal.replayCorpusOnce(input)
    expect(legacy.report).not.toHaveProperty('runIdentity')
  })

  it('stages one declared-seed batch and decision sidecar, measuring actual calls and injected time', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input, stub } = await fixture()
    const result = await evalLocal.replayCorpusOnce(input)
    expect(result.report.seedHonored).toBe(false)
    expect(result.report.batchKey).toBe(computeBatchKey(input.selected.map(e => e.cassette.id)))
    expect(result.vectors).toHaveLength(3)
    expect(result.replaysRoot).toBe(join(input.runRoot, 'replays'))
    expect(result.modelCalls).toBe(3)
    expect(stub.captured).toHaveLength(3)
    expect(result.wallClockMs).toBeGreaterThan(0)
    expect(existsSync(result.reportFile)).toBe(true)
    expect(existsSync(result.decisionsFile)).toBe(true)
    expect(evalLocal.loadStagedReport(input.agentQaRoot, result.report.batchKey,
      join(input.runRoot, 'reports'))).toMatchObject({
      kind: 'loaded', report: result.report, decisions: { vectors: result.vectors },
    })
    const again = await evalLocal.replayCorpusOnce({ ...input, clock: incrementingClock() })
    expect(again.wallClockMs).toBe(result.wallClockMs)
    expect(again.report.totalCost).toEqual(result.report.totalCost)
  })

  it('leaves records and reports intact in two distinct run roots', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const first = await evalLocal.replayCorpusOnce(input)
    const files = [first.reportFile, first.decisionsFile,
      ...first.sweep.replayedDirs.map(dir => join(dir, 'replay.json'))]
    const before = files.map(file => readFileSync(file, 'utf8'))
    const second = await evalLocal.replayCorpusOnce({ ...input,
      runRoot: join(input.agentQaRoot, 'r1-seed11') })
    expect(first.replaysRoot).not.toBe(second.replaysRoot)
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(before)
    expect(second.sweep.replayedDirs).toHaveLength(3)
    expect(second.sweep.replayedDirs.every(dir => existsSync(join(dir, 'replay.json')))).toBe(true)
    expect(existsSync(second.reportFile)).toBe(true)
  })

  it('excludes stale records and preserves a thrown rerun failure as downstream inconclusive evidence', async () => {
    expect(evalLocal.replayCorpusOnce).toBeTypeOf('function')
    const { input } = await fixture()
    const first = await evalLocal.replayCorpusOnce(input)
    expect(first.vectors).toHaveLength(3)
    const failedId = input.selected[1]!.cassette.id
    const save = evalLocal.FsReplayRecordStore.prototype.save
    vi.spyOn(evalLocal.FsReplayRecordStore.prototype, 'save').mockImplementation(function(this: evalLocal.FsReplayRecordStore, outcome) {
      if (outcome.cassetteId === failedId) throw new Error('current record write failed')
      return save.call(this, outcome)
    })
    const current = await evalLocal.replayCorpusOnce({ ...input, selected: input.selected.slice(0, 2) })
    expect(current.sweep.replayRefusals).toEqual({ 'harness-error': 1 })
    expect(current.report.honesty.harnessErrorCount).toBe(1)
    expect(current.modelCalls).toBe(2)
    expect(current.vectors.map(v => v.cassetteId)).toEqual([input.selected[0]!.cassette.id])
    const verdict = computeGateVerdict({
      expectedProfileKey: 'floor-fixture',
      pointer: { kind: 'absent', others: [] },
      baseline: { report: first.report },
      current: { report: current.report, vectors: current.vectors,
        fingerprint: 'fixture', corpusDigest: 'fixture' },
    })
    expect(verdict.exit).toBe(2)
    expect(verdict.inconclusive).toContainEqual({ reason: 'harness-errors', detail: expect.any(String) })
  })

  it('counts multiple provider rounds for one sample and leaves fingerprinting unchanged', async () => {
    const { input, root } = await fixture()
    const handoff = makeReplayHandoff({ vision: false,
      exchanges: [{ tool: 'lookup_note', args: {}, result: 'continue' }] })
    const leaf = extractRunCassettes({ handoff, artifacts: memArtifacts() }).cassettes
      .find(entry => entry.cassette.granularity === 'leaf')!
    new evalLocal.FsCassetteStore({ root, outputDir: input.cassettesRoot }).write(leaf)
    const selected = evalLocal.loadCassetteBundles(input.cassettesRoot).loaded
      .filter(entry => entry.cassette.id === leaf.cassette.id)
    const stub = capturingStub(call => call === 0
      ? nonActionGenerateResult('lookup_note') : actionGenerateResult())
    const modelOverrides = { languageModels: stub.languageModels }
    const before = evalLocal.computeReplayProfileFingerprintFor({
      profile: input.profile, modelOverrides, seedPolicy: 'declared',
    })
    const result = await evalLocal.replayCorpusOnce({ ...input, selected, modelOverrides })
    expect(result.report.totalCost.sampleCount).toBe(1)
    expect(result.modelCalls).toBe(2)
    expect(stub.captured).toHaveLength(2)
    expect(result.report.totalCost.promptTokens).toBe(18)
    expect(evalLocal.computeReplayProfileFingerprintFor({
      profile: input.profile, modelOverrides, seedPolicy: 'declared',
    })).toBe(before)
  })

  it('includes fresh typed refusals but no stale success when every selected replay is refused', async () => {
    const { input, root, stub } = await fixture()
    await evalLocal.replayCorpusOnce(input)
    expect(stub.captured).toHaveLength(3)
    const handoff = makeReplayHandoff({ vision: true })
    const leaf = extractRunCassettes({ handoff, artifacts: { getBlob: () => undefined } }).cassettes
      .find(entry => entry.cassette.granularity === 'leaf')!
    new evalLocal.FsCassetteStore({ root, outputDir: input.cassettesRoot }).write(leaf)
    const selected = evalLocal.loadCassetteBundles(input.cassettesRoot).loaded
      .filter(entry => entry.cassette.id === leaf.cassette.id)
    const result = await evalLocal.replayCorpusOnce({ ...input, selected })
    expect(result.modelCalls).toBe(0)
    expect(stub.captured).toHaveLength(3)
    expect(result.sweep.replayedDirs).toHaveLength(0)
    expect(result.sweep.recordedDirs).toHaveLength(1)
    expect(result.report.honesty.refusalCounts.completeness).toBe(1)
    expect(result.report.totalCost.sampleCount).toBe(0)
    expect(result.vectors).toEqual([])
  })

  it('includes judge provider calls and preserves their separate usage and identity', async () => {
    const { input, root } = await fixture()
    const handoff = makeReplayHandoff({ vision: false })
    const step = handoff.tests[0]!.steps[0]!
    step.modelProfile!.modelId = 'gemini-recorded-fixture'
    const sub = step.subActions[0]!
    sub.plannedAction = { type: 'fill', ref: sub.stateBefore.elements[0]!.ref,
      text: 'hello world foo', clearMode: 'replace', submit: false }
    const leaf = extractRunCassettes({ handoff, artifacts: memArtifacts() }).cassettes
      .find(entry => entry.cassette.granularity === 'leaf')!
    new evalLocal.FsCassetteStore({ root, outputDir: input.cassettesRoot }).write(leaf)
    const selected = evalLocal.loadCassetteBundles(input.cassettesRoot).loaded
      .filter(entry => entry.cassette.id === leaf.cassette.id)
    const planner = capturingStub(() => ({
      ...actionGenerateResult(),
      content: [{ type: 'tool-call', toolCallId: 'fill-action', toolName: 'web_fill',
        input: JSON.stringify({ ref: 'e-continue', text: 'hello world bar', reasoning: 'fill',
          confidence: 0.95, stepComplete: true, doesActionAdvanceUsTowardsGoal: true }) }],
    }), 'gpt-replay-stub')
    const judge = capturingStub(() => judgeGenerateResult('equivalent', 'high'), 'claude-judge-stub')
    const result = await evalLocal.replayCorpusOnce({ ...input, selected,
      profile: familyStubProfile('gpt-replay-stub'),
      modelOverrides: { languageModels: planner.languageModels },
      judge: { profile: familyStubProfile('claude-judge-stub'), auth: noneAuth,
        modelOverrides: { languageModels: judge.languageModels } },
    })
    expect(planner.captured).toHaveLength(1)
    expect(judge.captured).toHaveLength(2)
    expect(result.modelCalls).toBe(3)
    expect(result.report.totalCost.sampleCount).toBe(1)
    expect(result.report.totalCost.promptTokens).toBe(10)
    expect(result.report.honesty.judge.cost).toEqual({
      calls: 2, inputTokens: 20, outputTokens: 4, outcomesMissingUsage: 0,
    })
    expect(result.report.judge?.judgeModelId).toBe('claude-judge-stub')
  })
})
