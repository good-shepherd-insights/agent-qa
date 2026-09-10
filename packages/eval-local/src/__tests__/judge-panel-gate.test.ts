import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { asRef, GateReceiptSchema, receiptDigestOf, slugBranch } from '@vostride/agent-qa-schema'
import { composeBaselineProfileKey, createPanelIdentity, JUDGE_CONFIG } from '@vostride/agent-qa-eval'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import * as local from '../index.js'
import { writeGate1Fixture, gate1Responder } from './fixtures/gate1-fixtures.js'
import { actionGenerateResult, familyStubProfile, judgeGenerateResult, noneAuth, respondingStub } from './fixtures/replay-fixtures.js'
import { incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function fixture(options: { ids?: string[]; recorded?: string; warm?: boolean;
  votes?: ('equivalent' | 'different' | 'unsure' | 'error')[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'judge-panel-gate-'))
  roots.push(root)
  const f = writeGate1Fixture(root)
  const ids = options.ids ?? ['claude-fixture', 'gemini-fixture']
  const panel = ids.length === 0 ? undefined : createPanelIdentity(ids)
  const profile = familyStubProfile('gpt-fixture')
  for (const { cassette } of f.selected) {
    cassette.receipt.model.declared!.modelId = options.recorded ?? 'qwen-recorded'
    if (cassette.id === f.targetId) {
      cassette.input.stateBefore.elements.push({ ...structuredClone(cassette.input.stateBefore.elements[0]!), ref: asRef('e-twin') })
      cassette.input.stateBefore.refMap[asRef('e-twin')] = structuredClone(cassette.input.stateBefore.refMap[asRef('e-continue')]!)
    }
    new local.FsCassetteStore({ root, outputDir: f.cassettesRoot }).write({ cassette, blobs: [] })
  }
  const respond: Parameters<typeof respondingStub>[0] = call => {
    const text = JSON.stringify(call.prompt)
    return text.includes('gate1-target-run') && !text.includes(f.injection.renderedLine)
      ? actionGenerateResult('web', 'e-twin') : gate1Responder(f)(call)
  }
  const planner = respondingStub(respond, profile.model)
  let warmed = false
  const judges = ids.map((id, index) => respondingStub(() => {
    const vote = warmed ? options.votes?.[index] ?? 'different' : 'different'
    if (vote === 'error') throw new Error('fixture judge unavailable')
    return judgeGenerateResult(vote, 'high')
  }, id))
  const members = ids.map((id, index) => ({ profile: familyStubProfile(id),
    modelOverrides: { languageModels: judges[index]!.languageModels }, resolveAuth: vi.fn(async () => noneAuth) }))
  const identity = { ...f.identity, plannerModelId: profile.model,
    ...(panel === undefined ? {} : { judgeModelId: panel.judgeModelId, judgeVersion: JUDGE_CONFIG.judgeVersion,
      judgeMemberModelIds: ids }),
    fingerprint: local.computeReplayProfileFingerprintFor({ profile,
      modelOverrides: { languageModels: planner.languageModels }, seedPolicy: 'declared' }) }
  identity.profileKey = composeBaselineProfileKey(identity)
  const { judgeMemberModelIds: _members, ...floorIdentity } = identity
  expect(local.writeNoiseFloorArtefact({ artefact: { ...f.artefact, ...floorIdentity }, committedRoot: f.committedRoot,
    reportOutputBaseDir: join(root, 'floor-audit') }).kind).toBe('written')
  const runRoot = join(f.agentQaRoot, 'eval/gate', slugBranch(identity.profileKey))
  if (options.warm !== false) await local.replayCorpusOnce({ selected: f.selected, cassettesRoot: f.cassettesRoot,
    agentQaRoot: f.agentQaRoot, runRoot, profile, auth: noneAuth,
    modelOverrides: { languageModels: planner.languageModels },
    ...(members.length === 0 ? {} : { judge: { members: members.map(member => ({ ...member, auth: noneAuth })) } }),
    seed: 11, k: 1, maskingContextFactory: createMaskingContext, replayOutputBaseDir: runRoot,
    source: 'committed', corpusDigest: f.corpusDigest, clock: incrementingClock() })
  planner.captured.length = 0
  warmed = true
  for (const judge of judges) judge.captured.length = 0
  const input: local.RunReplayGateInput = { injection: f.injection, committedRoot: f.committedRoot,
    agentQaRoot: f.agentQaRoot, identity, planner: { profile, resolveAuth: vi.fn(async () => noneAuth),
      modelOverrides: { languageModels: planner.languageModels } }, judgeMembers: members,
    judgeOverrideConfigured: false, k: 3, kSource: 'default', maxScreens: 64,
    baselineSeed: { floorSeeds: [11] }, producedBy: { opId: 'eval.replay-gate' },
    maskingContextFactory: createMaskingContext, clock: incrementingClock() }
  return { f, input, panel, planner, judges, members }
}

it('421 carries the settled panel through cache, candidate and both removal arms', async () => {
  const { f, input, panel, judges, planner } = await fixture()
  const result = await local.runReplayGate(input)
  if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
  expect(result.receipt).toMatchObject({ verdict: 'pass', crossCheck: 'flipped', judge: {
    eligibility: 'eligible', panelSize: 2, members: panel!.members },
    judgeId: `${panel!.judgeModelId}|family=${panel!.judgeFamily}|judgeVersion=2` })
  expect(result.receipt.degradation).toBeUndefined()
  expect(GateReceiptSchema.parse(result.receipt)).toEqual(result.receipt)
  expect(receiptDigestOf(result.receipt)).toBe(result.receipt.receiptDigest)
  expect(judges.map(judge => judge.captured.length)).toEqual([4, 4])
  expect(result.modelCalls).toBe(planner.captured.length + 8)
  for (const arm of ['candidate-arm/replays', 'cross-check/with/sample-1/replays', 'cross-check/without/sample-1/replays']) {
    const score = local.loadScoreRecord(join(f.agentQaRoot, 'eval/gate1', slugBranch(f.injection.candidateId), arm, f.targetId))
    expect(score).toMatchObject({ kind: 'loaded', record: { judge: panel } })
  }
})

it.each([
  { ids: ['gpt-judge', 'claude-fixture'] },
  { ids: ['claude-fixture', 'claude-other'] },
  { ids: ['claude-fixture', 'mystery-judge'] },
  { ids: ['claude-fixture', 'gemini-fixture'], recorded: 'gemini-recorded' },
  { ids: ['claude-fixture', 'gemini-fixture'], recorded: 'mystery-recorded' },
  { ids: ['deepseek-r1-distill-qwen-32b', 'claude-fixture'], recorded: 'qwen-recorded' },
])('421 discloses composite refusal without override or judge calls: %j', async options => {
  const { input, judges, members } = await fixture(options)
  const result = await local.runReplayGate(input)
  if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
  expect(result.receipt).toMatchObject({ degradation: 'replay-diff', judge: { eligibility: 'no-eligible-judge' } })
  expect(result.receipt.reasons).toContain('same-family-refused')
  expect(result.receipt.reasons).not.toContain('baseline-uncached')
  expect(judges.every(judge => judge.captured.length === 0)).toBe(true)
  expect(members.every(member => member.resolveAuth.mock.calls.length === 0)).toBe(true)
})

it.each([['different', 'unsure'], ['different', 'equivalent'], ['different', 'error']] as const)(
  '421 retains %s/%s member outcomes in the removal arm', async (a, b) => {
    const { f, input } = await fixture({ votes: [a, b] })
    const result = await local.runReplayGate(input)
    if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
    expect(result.receipt.judge).toMatchObject({ eligibility: 'eligible', panelSize: 2 })
    const score = local.loadScoreRecord(join(f.agentQaRoot, 'eval/gate1', slugBranch(f.injection.candidateId),
      'cross-check/without/sample-1/replays', f.targetId))
    expect(score).toMatchObject({ kind: 'loaded', record: { score: { entry: { score: {
      kind: 'unresolved-tie', judgeOutcome: { kind: 'abstained', cause: b === 'equivalent' ? 'panel-disagreement' : 'below-quorum',
        members: expect.arrayContaining([expect.objectContaining({ judgeModelId: 'gemini-fixture',
          outcome: expect.objectContaining({ kind: b === 'error' ? 'error' : b === 'unsure' ? 'abstained' : 'settled' }) })]) } } } } } })
  })

it.each([[], ['claude-fixture']])('421 keeps absent/singleton receipt field sets: %j', async (...ids) => {
  const { input } = await fixture({ ids: ids as string[] })
  const result = await local.runReplayGate(input)
  if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
  expect(Object.keys(result.receipt.judge!).sort()).toEqual(['eligibility', 'overrideConfigured'])
  expect(GateReceiptSchema.parse(result.receipt)).toEqual(result.receipt)
})

it('421 cold panel cache spends nothing and preserves every warmup selection', async () => {
  const { input, planner, members } = await fixture({ warm: false })
  input.baselineWarmup = { configPath: 'fixture.yaml', judges: ['first', 'second'] }
  const result = await local.runReplayGate(input)
  if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
  expect(result.receipt.reasons).toEqual(['baseline-uncached'])
  expect(result.receipt.judge).toMatchObject({ eligibility: 'eligible', panelSize: 2 })
  expect(result.notices.join('\n')).toContain("--judge 'first' --judge 'second'")
  expect(planner.captured).toHaveLength(0)
  expect(members.every(member => member.resolveAuth.mock.calls.length === 0)).toBe(true)
})

it('421 rejects another panel in the same cache directory before any credential work', async () => {
  const { input, members, planner } = await fixture()
  members[1]!.profile = familyStubProfile('gemini-other')
  const ids = members.map(member => member.profile.model)
  input.identity = { ...input.identity, judgeModelId: createPanelIdentity(ids).judgeModelId, judgeMemberModelIds: ids }
  const result = await local.runReplayGate(input)
  if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
  expect(result.receipt.reasons).toEqual(['baseline-uncached'])
  expect(planner.captured).toHaveLength(0)
  expect(members.every(member => member.resolveAuth.mock.calls.length === 0)).toBe(true)
})

it('421 refuses mismatched raw member transport instead of inventing members from the composite', async () => {
  const { input, members } = await fixture()
  input.judgeMembers = members.slice(0, 1)
  await expect(local.runReplayGate(input)).rejects.toThrow('judge declaration differs')
  expect(members.every(member => member.resolveAuth.mock.calls.length === 0)).toBe(true)
})
