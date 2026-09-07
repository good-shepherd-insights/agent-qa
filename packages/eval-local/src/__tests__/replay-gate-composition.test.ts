import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { GateReceiptSchema, receiptDigestOf, slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import * as evalLocal from '../index.js'
import { gate1Responder, warmGateRoot, writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import {
  actionGenerateResult,
  respondingStub,
  noneAuth,
  stubProfile,
  type CapturedCallOptions,
} from './fixtures/replay-fixtures.js'
import { incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gate1-'))
  roots.push(root)
  return writeGate1Fixture(root)
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function cacheInput(f: ReturnType<typeof fixture>) {
  return {
    agentQaRoot: f.agentQaRoot,
    ...f.identity,
    gateRootSeed: 11,
    gateRootSeedSource: 'floor',
    cassettes: f.selected.map((row) => ({
      id: row.cassette.id,
      promptInputHash: row.cassette.receipt.promptInputHash,
    })),
  }
}

describe('leaf candidate earns a Gate-1 receipt', () => {
  it('exports the gate and removal cross-check composition', () => {
    expect(Reflect.get(evalLocal, 'runReplayGate')).toBeTypeOf('function')
    expect(Reflect.get(evalLocal, 'removalFlipsOutcome')).toBeTypeOf('function')
  })
  async function warm() {
    const f = fixture()
    const baseline = respondingStub(gate1Responder(f))
    await warmGateRoot(f, baseline)
    const stub = respondingStub(gate1Responder(f))
    const input: evalLocal.RunReplayGateInput = {
      injection: f.injection,
      committedRoot: f.committedRoot,
      agentQaRoot: f.agentQaRoot,
      identity: f.identity,
      planner: {
        profile: stubProfile(),
        modelOverrides: { languageModels: stub.languageModels },
        resolveAuth: async () => noneAuth,
      },
      judgeOverrideConfigured: false,
      k: 3,
      kSource: 'default',
      maxScreens: 64,
      baselineSeed: { floorSeeds: [11] },
      producedBy: { opId: 'eval.replay-gate' },
      clock: incrementingClock(),
    }
    return { f, baseline, stub, input }
  }
  function receipt(result: evalLocal.RunReplayGateResult) {
    expect(result.kind).toBe('receipt')
    if (result.kind !== 'receipt') throw new Error(JSON.stringify(result))
    return result.receipt
  }
  function digestTree(root: string) {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((row) => row.isFile())
      .map((row) => {
        const file = join(row.parentPath, row.name)
        return [
          file.slice(root.length),
          createHash('sha256').update(readFileSync(file)).digest('hex'),
        ]
      })
      .sort()
  }
  it('passes with a zero-call baseline, one call per check, paired evidence and immutable source roots', async () => {
    const { f, baseline, stub, input } = await warm()
    const beforeBaseline = digestTree(f.gateRoot)
    const beforeCommitted = digestTree(f.committedRoot)
    const result = await evalLocal.runReplayGate(input)
    const got = receipt(result)
    expect(got).toMatchObject({
      verdict: 'pass',
      crossCheck: 'flipped',
      reasons: [],
      degradation: 'replay-diff',
      harmed: [],
      population: { rendered: 6, renderedExcluded: 0 },
      samples: { k: 3, seeds: [11, 1938274511, 1319274378] },
      spend: {
        screens: 10,
        modelCalls: 10,
        promptTokens: 100,
        completionTokens: 20,
        wallClockMs: 410,
      },
    })
    expect(got.targets?.[0]).toMatchObject({
      source: 'committed',
      baselineCorrect: false,
      candidateCorrect: true,
      baselineBriefSource: 'empty',
      candidateBriefSource: 'rendered',
    })
    expect(got.samples.detail).toHaveLength(6)
    expect(GateReceiptSchema.parse(got)).toEqual(got)
    expect(receiptDigestOf(got)).toBe(got.receiptDigest)
    expect(stub.captured.length).toBe(got.spend?.screens)
    for (let i = 0; i < 5; i++) {
      const key = `gate1-collateral-${i}`
      const before = baseline.captured.find((call) => JSON.stringify(call.prompt).includes(key))!
      const candidates = stub.captured.filter((call) => JSON.stringify(call.prompt).includes(key))
      expect(candidates).toHaveLength(1)
      const candidate = JSON.stringify(candidates[0]!.prompt)
      expect(candidate).toContain(f.injection.renderedLine)
      // The prompt builder adds a served-brief section around the one observation.
      const base = JSON.stringify(before.prompt)
      const commonPrefix = Array.from(base).findIndex((char, index) => candidate[index] !== char)
      let suffix = 0
      while (
        base.at(-1 - suffix) === candidate.at(-1 - suffix) &&
        suffix < base.length - commonPrefix
      )
        suffix++
      expect(base.slice(commonPrefix, base.length - suffix)).toBe('')
      expect(candidate.slice(commonPrefix, candidate.length - suffix)).toContain(
        f.injection.renderedLine,
      )
    }
    expect(digestTree(f.gateRoot)).toEqual(beforeBaseline)
    expect(digestTree(f.committedRoot)).toEqual(beforeCommitted)
    expect(
      digestTree(join(f.agentQaRoot, 'eval/gate1', slugBranch(f.injection.candidateId))).length,
    ).toBeGreaterThan(0)
    expect(result.kind === 'receipt' && result.lines[0]).toBe(
      'gate 1 · pass · replay-diff · crossCheck flipped · k=3 · 10/64 screens · 10 calls',
    )
  })
  it.each([
    'procedure',
    'unknown',
    'target-unavailable',
    'baseline-uncached',
    'collateral-unscorable',
    'cap-exceeded',
    'unprovenanced-candidate',
    'empty-gate-set',
  ])('abstains %s before auth and all model calls', async (mode) => {
    const { f, stub, input } = await warm()
    let authCalls = 0
    input.planner.resolveAuth = async () => {
      authCalls++
      return noneAuth
    }
    input.maskingContextFactory = () => {
      throw new Error('preflight must not create masking context')
    }
    if (mode === 'procedure' || mode === 'unknown') input.injection = { ...f.injection, kind: mode }
    if (mode === 'target-unavailable') input.injection = { ...f.injection, target: undefined }
    if (mode === 'baseline-uncached') input.agentQaRoot = join(f.root, 'cold')
    if (mode === 'cap-exceeded') input.maxScreens = 1
    if (mode === 'collateral-unscorable') {
      const store = new evalLocal.FsReplayRecordStore({
        root: f.agentQaRoot,
        outputDir: join(f.gateRoot, 'replays'),
      })
      for (const cassetteId of f.collateralIds)
        store.save({
          kind: 'integrity-refusal',
          cassetteId,
          reason: 'missing-blob',
          detail: 'fixture unavailable blob',
        })
    }
    if (mode === 'unprovenanced-candidate')
      input.injection = {
        ...f.injection,
        provenance: { runIds: [], receiptDigests: [], capturedAtOrdinals: [] },
      }
    if (mode === 'empty-gate-set') input.injection = { ...f.injection, product: 'missing' }
    const result = await evalLocal.runReplayGate(input)
    const got = receipt(result)
    const expected = mode === 'procedure' || mode === 'unknown' ? 'tier-not-implemented' : mode
    expect(got).toMatchObject({
      verdict: 'abstain',
      reasons: [expected],
      crossCheck: 'not-run',
      spend: { modelCalls: 0, screens: 0 },
    })
    if (expected === 'tier-not-implemented') expect(got.degradation).toBe('tier-not-implemented')
    expect(stub.captured.length).toBe(0)
    expect(authCalls).toBe(0)
    if (mode === 'baseline-uncached')
      expect(result.kind === 'receipt' && result.lines).toContain(
        'eval replay --source committed --seed 11',
      )
  })
  it('discloses split target samples as inconclusive', async () => {
    const { f, input } = await warm()
    let targetWith = 0
    const stub = respondingStub((call) => {
      const text = JSON.stringify(call.prompt)
      if (
        text.includes('gate1-target-run') &&
        text.includes(f.injection.renderedLine) &&
        ++targetWith > 1
      )
        return actionGenerateResult('web', 'e-other')
      return gate1Responder(f)(call)
    })
    input.planner.modelOverrides = { languageModels: stub.languageModels }
    const got = receipt(await evalLocal.runReplayGate(input))
    expect(got).toMatchObject({
      verdict: 'abstain',
      crossCheck: 'inconclusive',
      reasons: ['inconclusive'],
    })
    expect(got.samples.detail).toHaveLength(6)
  })
})

describe('gate-1 fixture and the profile-keyed baseline cache', () => {
  it('exports the cache resolution and root discovery operations', () => {
    expect(Reflect.get(evalLocal, 'resolveBaselineCache')).toBeTypeOf('function')
    expect(Reflect.get(evalLocal, 'listBaselineRunRoots')).toBeTypeOf('function')
  })
  it('lists the gate root first, sorted floor roots with seeds, and no cold roots', async () => {
    const f = fixture()
    await warmGateRoot(f, respondingStub(gate1Responder(f)))
    const floor = join(f.agentQaRoot, 'eval', 'floor', slugBranch(f.profileKey), 'r0-seed7')
    mkdirSync(floor, { recursive: true })
    expect(evalLocal.listBaselineRunRoots(f.agentQaRoot, f.profileKey)).toEqual([
      { root: f.gateRoot, kind: 'gate' },
      { root: floor, kind: 'floor', seed: 7 },
    ])
    expect(evalLocal.listBaselineRunRoots(join(f.root, 'cold'), f.profileKey)).toEqual([])
  })
  it('resolves every warm row cached with seedSource and no new provider call', async () => {
    const f = fixture()
    const stub = respondingStub(gate1Responder(f))
    const warmed = await warmGateRoot(f, stub)
    const calls = stub.captured.length
    const result = evalLocal.resolveBaselineCache(cacheInput(f))
    expect(result.rows).toHaveLength(6)
    for (const row of result.rows)
      expect(row).toMatchObject({
        kind: 'cached',
        seed: 11,
        seedSource: 'floor',
        seedHonored: warmed.report.seedHonored,
      })
    expect(result.roots).toEqual([f.gateRoot])
    expect(stub.captured.length).toBe(calls)
  })
  it('names missing replay records on a cold root and fingerprint mismatch on a foreign root', async () => {
    const f = fixture()
    const cold = evalLocal.resolveBaselineCache(cacheInput(f))
    expect(
      cold.rows.every((row) => row.kind === 'uncached' && row.reason.includes('replay record')),
    ).toBe(true)
    await warmGateRoot(f, respondingStub(gate1Responder(f)))
    const foreign = evalLocal.resolveBaselineCache({
      ...cacheInput(f),
      fingerprint: 'f'.repeat(64),
    })
    expect(
      foreign.rows.every((row) => row.kind === 'uncached' && row.reason.includes('fingerprint')),
    ).toBe(true)
  })
  it('responds with gold except for a target missing the renderedLine', () => {
    const f = fixture()
    const respond = gate1Responder(f)
    const call = (text: string) =>
      ({ prompt: [{ role: 'user', content: [{ type: 'text', text }] }] }) as CapturedCallOptions
    expect(respond(call('gate1-collateral-0'))).toEqual(actionGenerateResult())
    expect(respond(call('gate1-target-run'))).toEqual(actionGenerateResult('web', 'e-other'))
    expect(respond(call('gate1-target-run ' + f.injection.renderedLine))).toEqual(
      actionGenerateResult(),
    )
  })
})
