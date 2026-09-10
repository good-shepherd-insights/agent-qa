import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { scoreCassetteReplay } from '@vostride/agent-qa-eval'
import { asRef } from '@vostride/agent-qa-schema'
import { runCassetteReplay } from '../replay-composition.js'
import type { RunCassetteReplayInput } from '../replay-composition.js'
import { FsReplayRecordStore } from '../replay-record-store.js'
import { FsScoreStore } from '../score-store.js'
import { loadScoreRecord } from '../replay-read.js'
import { assembleScoredBatch, projectAssembledBatch } from '../replay-batch-assembly.js'
import { FsReportStore, loadStagedReport } from '../report-store.js'
import {
  actionGenerateResult, allContentParts, capturingStub, extractStoreLoad,
  familyStubProfile, findReplayRecords, judgeGenerateResult, makeReplayHandoff,
  memArtifacts, noneAuth,
} from './fixtures/replay-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function member(modelId: string, order: string[]) {
  const stub = capturingStub(index => {
    order.push(`${modelId}:${index}`)
    return judgeGenerateResult('equivalent', 'high')
  }, modelId)
  return { stub, binding: { profile: familyStubProfile(modelId), auth: noneAuth,
    modelOverrides: { languageModels: stub.languageModels } } }
}

async function trace(judge?: RunCassetteReplayInput['judge']) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-panel-tracer-'))
  roots.push(root)
  const handoff = makeReplayHandoff({ vision: false })
  const step = handoff.tests[0]!.steps[0]!
  step.modelProfile!.modelId = 'gemini-recorded'
  const state = step.subActions[0]!.stateBefore!
  state.elements.push({ ...state.elements[0]!, ref: asRef('e-next'), name: 'Next', nameNormalized: 'next' })
  state.refMap[asRef('e-next')] = state.refMap[asRef('e-continue')]!
  const { cassette, artifacts } = extractStoreLoad(handoff, memArtifacts(), root)
  const planner = capturingStub(() => actionGenerateResult('web', 'e-next'), 'gpt-replay')
  const scoreStore = new FsScoreStore({ root })
  const save = vi.spyOn(scoreStore, 'save')
  const outcome = await runCassetteReplay({ cassette, artifacts,
    profile: familyStubProfile('gpt-replay'), auth: noneAuth,
    modelOverrides: { languageModels: planner.languageModels },
    clock: { now: () => 100 },
    replayOutputBaseDir: join(root, 'audit'), recordStore: new FsReplayRecordStore({ root }),
    scoreStore, ...(judge === undefined ? {} : { judge }) })
  const deterministic = scoreCassetteReplay(cassette, outcome)
  expect(deterministic).toMatchObject({ kind: 'leaf', entry: { kind: 'decision',
    score: { kind: 'unresolved-tie', cause: 'partial-identity' } } })
  expect(save).toHaveBeenCalledTimes(1)
  const recordDir = dirname(findReplayRecords(root)[0]!)
  const loaded = loadScoreRecord(recordDir)
  expect(loaded.kind).toBe('loaded')
  if (loaded.kind !== 'loaded') throw new Error('score did not load')
  const batch = assembleScoredBatch({ replaysRoot: join(root, 'eval/replays'),
    cassettesRoot: join(root, 'eval/cassettes'), source: 'panel tracer' })
  expect(batch.entries).toHaveLength(1)
  expect(batch.missingBundleCount).toBe(0)
  const { report } = projectAssembledBatch(batch, {})
  const written = new FsReportStore({ root }).save(report)
  const staged = loadStagedReport(root, report.batchKey)
  expect(staged.kind).toBe('loaded')
  if (staged.kind !== 'loaded') throw new Error('report did not load')
  return { record: loaded.record, report: staged.report,
    scoreBytes: readFileSync(join(recordDir, 'score.json'), 'utf8'),
    reportBytes: readFileSync(written.file, 'utf8') }
}

it('panel tracer persists one shared comparison', async () => {
  const order: string[] = []
  const claude = member('claude-judge', order)
  const llama = member('llama-judge', order)
  const result = await trace({ members: [claude.binding, llama.binding] })
  expect(result.record.judge).toMatchObject({ judgeModelId: 'panel:claude-judge+llama-judge',
    judgeFamily: 'claude+llama', judgeVersion: 2, panelSize: 2,
    members: [{ judgeModelId: 'claude-judge', judgeFamily: 'claude' },
      { judgeModelId: 'llama-judge', judgeFamily: 'llama' }] })
  expect(order).toEqual(['claude-judge:0', 'claude-judge:1', 'llama-judge:0', 'llama-judge:1'])
  expect(result.record.score).toMatchObject({ entry: { score: { kind: 'scored', judgeSettled: {
    judgeId: 'panel:claude-judge+llama-judge', cause: 'partial-identity',
    usage: { calls: 4, inputTokens: 40, outputTokens: 8 },
    members: [{ judgeModelId: 'claude-judge', outcome: { kind: 'settled', resolution: 'equivalent' } },
      { judgeModelId: 'llama-judge', outcome: { kind: 'settled', resolution: 'equivalent' } }],
  } } } })
  expect(result.record.scoringContext?.judgeRequest).toEqual({
    judgeModelId: 'panel:claude-judge+llama-judge', allowSameFamily: false })
  expect(result.report.judge).toEqual(result.record.judge)
  for (const judge of [claude, llama]) {
    const prompts = judge.stub.captured.map(call => allContentParts(call)
      .filter(part => part.type === 'text').map(part => part.text).join('\n'))
    expect(prompts[0]).toContain('name=continue')
    expect(prompts[0]).toContain('name=next')
    expect(prompts[0]).not.toBe(prompts[1])
  }
})

it.each(['gpt-judge', 'gemini-judge', 'claude-second', 'unknown-judge'])(
  'refuses the whole declaration before any judge call: %s', async modelId => {
    const order: string[] = []
    const a = member('claude-judge', order)
    const b = member(modelId, order)
    const result = await trace({ members: [a.binding, b.binding], allowSameFamily: true })
    expect(order).toEqual([])
    expect(result.record.judge).toBeUndefined()
    expect(result.record.score).toMatchObject({ entry: { score: { judgeOutcome: {
      kind: 'not-invoked', reason: 'no-eligible-judge', families: { members: [
        { judgeModelId: 'claude-judge' }, { judgeModelId: modelId },
      ] },
    } } } })
  },
)

it('serializes a singleton exactly like direct single at version 2', async () => {
  const direct = await trace(member('claude-judge', []).binding)
  const singleton = await trace({ members: [member('claude-judge', []).binding] })
  expect(singleton.scoreBytes).toBe(direct.scoreBytes)
  expect(singleton.reportBytes).toBe(direct.reportBytes)
  expect(singleton.record.judge?.judgeVersion).toBe(2)
  expect(singleton.record.judge).not.toHaveProperty('panelSize')
  expect(singleton.record.judge).not.toHaveProperty('members')
})

it('treats an empty declaration as no judge', async () => {
  const direct = await trace()
  const empty = await trace({ members: [] })
  expect(empty.scoreBytes).toBe(direct.scoreBytes)
  expect(empty.reportBytes).toBe(direct.reportBytes)
})
