import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { GateReceiptSchema, receiptDigestOf, slugBranch, asRef } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { composeBaselineProfileKey, JUDGE_CONFIG } from '@vostride/agent-qa-eval'
import { afterEach, describe, expect, it } from 'vitest'
import * as evalLocal from '../index.js'
import { gate1Responder, warmGateRoot, writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import {
  actionGenerateResult,
  familyStubProfile,
  judgeGenerateResult,
  respondingStub,
  noneAuth,
  stubProfile,
  type CapturedCallOptions,
} from './fixtures/replay-fixtures.js'
import { incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
function fixture(options?: Parameters<typeof writeGate1Fixture>[1]) {
  const root = mkdtempSync(join(tmpdir(), 'gate1-'))
  roots.push(root)
  return writeGate1Fixture(root, options)
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
  async function warm(options?: Parameters<typeof writeGate1Fixture>[1], allCorrect = false) {
    const f = fixture(options)
    const baseline = respondingStub((call) =>
      allCorrect || JSON.stringify(call.prompt).includes('gate1-target-sibling-1')
        ? actionGenerateResult()
        : gate1Responder(f)(call),
    )
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
  it('extracts a local target only into its audit directory and abstains baseline-uncached without warming', async () => {
    const { f, stub, input } = await warm({ targetInCorpus: false, handoffForTarget: true })
    const before = digestTree(f.committedRoot)
    input.planner.resolveAuth = async () => {
      throw new Error('no auth before cache')
    }
    const result = await evalLocal.runReplayGate(input)
    expect(receipt(result)).toMatchObject({ verdict: 'abstain', reasons: ['baseline-uncached'] })
    expect(receipt(result).targets).toBeUndefined()
    expect(result.notices.join('\n')).toContain(f.targetId)
    expect(result.notices.join('\n')).toContain('seed the run into the corpus')
    expect(
      existsSync(
        join(
          f.agentQaRoot,
          'eval/gate1',
          slugBranch(f.injection.candidateId),
          'target/cassettes',
          f.targetId,
          'cassette.json',
        ),
      ),
    ).toBe(true)
    expect(existsSync(join(f.agentQaRoot, 'eval/cassettes'))).toBe(false)
    expect(digestTree(f.committedRoot)).toEqual(before)
    expect(stub.captured).toHaveLength(0)
  })
  it.each(['absent', 'version', 'identity', 'step', 'test'])(
    'names an unavailable target from a %s handoff',
    async (mode) => {
      const { f, stub, input } = await warm({
        targetInCorpus: false,
        handoffForTarget: mode !== 'absent',
      })
      const path = join(
        f.agentQaRoot,
        'runs',
        slugBranch(f.injection.target!.runId),
        'handoff.json',
      )
      if (mode === 'version') {
        const handoff = JSON.parse(readFileSync(path, 'utf8'))
        handoff.schemaVersion = 999
        writeFileSync(path, JSON.stringify(handoff))
      }
      if (mode === 'identity') {
        // Slug location is not identity: the canonical loaded run differs from this DATA reference.
        input.injection = {
          ...f.injection,
          target: { ...f.injection.target!, runId: f.injection.target!.runId.replace('-', '/') },
        }
      }
      if (mode === 'step')
        input.injection = { ...f.injection, target: { ...f.injection.target!, stepIndex: 99 } }
      if (mode === 'test')
        input.injection = {
          ...f.injection,
          target: { ...f.injection.target!, testId: 'different-test' },
        }
      input.planner.resolveAuth = async () => {
        throw new Error('no auth before target')
      }
      const result = await evalLocal.runReplayGate(input)
      expect(receipt(result).reasons).toEqual(['target-unavailable'])
      expect(result.notices.join('\n')).toContain(
        mode === 'absent' ? 'corpusEntriesForRun=0 handoffPresent=false' : 'handoffPresent=true',
      )
      if (mode === 'version' || mode === 'identity')
        expect(result.notices.join('\n')).toContain('reason=')
      expect(stub.captured).toHaveLength(0)
    },
  )
  it('uses partition version zero for an unseen gamma product', async () => {
    const { input, stub } = await warm()
    input.injection = { ...input.injection, product: 'gamma' }
    expect(receipt(await evalLocal.runReplayGate(input))).toMatchObject({
      reasons: ['empty-gate-set'],
      corpusVersion: { partitionVersion: 0, gateSetSize: 0 },
    })
    expect(stub.captured).toHaveLength(0)
  })
  it.each(['pass', 'harm', 'all-correct'])(
    'judges every target-step decision: %s',
    async (mode) => {
      const { f, input } = await warm({ targetDecisions: 2 }, mode === 'all-correct')
      const stub = respondingStub((call) => {
        const text = JSON.stringify(call.prompt)
        if (text.includes('gate1-target-sibling-1'))
          return actionGenerateResult('web', mode === 'harm' ? 'e-other' : 'e-continue')
        return gate1Responder(f)(call)
      })
      input.planner.modelOverrides = { languageModels: stub.languageModels }
      input.maxScreens = 11
      const got = receipt(await evalLocal.runReplayGate(input))
      expect(got.targets).toHaveLength(2)
      expect(got.verdict).toBe(mode === 'pass' ? 'pass' : 'fail')
      expect(got.reasons).toEqual(
        mode === 'pass' ? [] : mode === 'harm' ? ['collateral-harm'] : ['no-positive-value'],
      )
      expect(got.spend?.screens).toBe(mode === 'pass' ? 11 : 7)
      if (mode === 'harm') {
        expect(got.harmed?.[0]?.origin).toBe('target-step')
        expect(got.crossCheck).toBe('not-run')
      }
    },
  )
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
    expect(got.baselineSource).toEqual({ runRoot: f.gateRoot, seed: 11, seedSource: 'floor' })
    expect(
      digestTree(join(f.agentQaRoot, 'eval/gate1', slugBranch(f.injection.candidateId))).filter(
        ([path]) => path!.startsWith('/cross-check/'),
      ).length,
    ).toBeGreaterThan(0)
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
  it('names every stale cassette in corpus order with the warm-up line', async () => {
    const { f, input, stub } = await warm()
    const ids = evalLocal
      .readCommittedCorpus(f.committedRoot)
      .snapshot.entries.filter((entry) => f.collateralIds.includes(entry.cassetteId))
      .slice(0, 2)
      .map((entry) => entry.cassetteId)
    for (const id of ids) {
      const path = join(f.gateRoot, 'replays', id, 'replay.json')
      const record = JSON.parse(readFileSync(path, 'utf8'))
      record.promptDrift.recordedHash = 'f'.repeat(64)
      writeFileSync(path, JSON.stringify(record))
    }
    const result = await evalLocal.runReplayGate(input)
    expect(receipt(result).reasons).toEqual(['baseline-uncached'])
    expect(result.notices).toContain(`uncached: ${ids.join(', ')}`)
    expect(result.kind === 'receipt' && result.lines).toContain(
      'eval replay --source committed --seed 11',
    )
    expect(stub.captured).toHaveLength(0)
  })
  it('compares scored collateral and discloses refused rows without replaying them', async () => {
    const { f, input, stub } = await warm()
    const refused = f.collateralIds.slice(0, 2)
    const store = new evalLocal.FsReplayRecordStore({
      root: f.agentQaRoot,
      outputDir: join(f.gateRoot, 'replays'),
    })
    for (const cassetteId of refused)
      store.save({
        kind: 'integrity-refusal',
        cassetteId,
        reason: 'missing-blob',
        detail: 'offline refusal',
      })
    const got = receipt(await evalLocal.runReplayGate(input))
    expect(got.verdict).toBe('pass')
    const population = got.population!
    expect(population.refused).toBe(2)
    expect(got.spend?.screens).toBe(8)
    for (const id of refused) {
      const text = f.selected.find(({ cassette }) => cassette.id === id)!.cassette.input.stepText
      expect(stub.captured.some((call) => JSON.stringify(call.prompt).includes(text))).toBe(false)
    }
  })
  it.each([10, 9])(
    'checks the inclusive cap %i before auth and reports exact spend',
    async (maxScreens) => {
      const { f, input, stub } = await warm({ collateral: 5 })
      const lines: string[] = []
      input.maxScreens = maxScreens
      input.onProgress = (line) => lines.push(line)
      if (maxScreens === 9)
        input.planner.resolveAuth = async () => {
          throw new Error('cap must precede auth')
        }
      const result = await evalLocal.runReplayGate(input)
      const got = receipt(result)
      expect(got.cap).toEqual({ maxScreens })
      expect(got.spend).toEqual(
        maxScreens === 10
          ? {
              screens: 10,
              modelCalls: 10,
              promptTokens: 100,
              completionTokens: 20,
              wallClockMs: 410,
            }
          : { screens: 0, modelCalls: 0, promptTokens: 0, completionTokens: 0, wallClockMs: 10 },
      )
      if (maxScreens === 9) {
        expect(got.reasons).toEqual(['cap-exceeded'])
        expect(result.notices.join('\n')).toContain('planned=10 maxScreens=9')
        expect(stub.captured).toHaveLength(0)
      } else {
        expect(got.verdict).toBe('pass')
        expect(lines).toEqual([
          `gate1 candidate=${f.injection.candidateId}: screens=10 modelCalls=10 promptTokens=100 completionTokens=20 wallClock=410ms seedHonored=true`,
        ])
        expect(Number.isInteger(got.spend!.promptTokens)).toBe(true)
        expect(Number.isInteger(got.spend!.completionTokens)).toBe(true)
      }
    },
  )
  it('counts planner retries as provider calls without inflating screens', async () => {
    const { f, input } = await warm()
    const stub = respondingStub((call, index) =>
      index === 0 ? actionGenerateResult('web', 'missing-ref') : gate1Responder(f)(call),
    )
    input.planner.modelOverrides = { languageModels: stub.languageModels }
    const got = receipt(await evalLocal.runReplayGate(input))
    expect(got.verdict).toBe('pass')
    expect(stub.captured).toHaveLength(11)
    expect(got.spend).toMatchObject({
      screens: 10,
      modelCalls: 11,
      promptTokens: 110,
      completionTokens: 22,
    })
  })
  it('counts both order-swapped eligible judge calls for one tie without adding screens', async () => {
    const { f, input } = await warm()
    const profile = familyStubProfile('gpt-gate1-stub')
    const judgeProfile = familyStubProfile('claude-gate1-stub')
    const tied = f.selected.find(({ cassette }) => cassette.id === f.collateralIds[0])!
    const tieText = tied.cassette.input.stepText
    const goldText = 'hello world foo'
    tied.cassette.sidecar.goldAction = {
      type: 'fill',
      ref: asRef('e-continue'),
      text: goldText,
      clearMode: 'replace',
      submit: false,
    }
    tied.cassette.sidecar.opClass = 'fill'
    tied.cassette.sidecar.goldValue = goldText
    for (const { cassette } of f.selected) {
      cassette.receipt.model.declared!.modelId = 'gemini-recorded-fixture'
      new evalLocal.FsCassetteStore({ root: f.root, outputDir: f.cassettesRoot }).write({
        cassette,
        blobs: [],
      })
    }
    const fill = (text: string) => ({
      ...actionGenerateResult(),
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'fill-action',
          toolName: 'web_fill',
          input: JSON.stringify({
            ref: 'e-continue',
            text,
            reasoning: 'fill the recorded control',
            confidence: 0.95,
            stepComplete: true,
            doesActionAdvanceUsTowardsGoal: true,
          }),
        },
      ],
    })
    const baseline = respondingStub(
      (call) =>
        JSON.stringify(call.prompt).includes(tieText) ? fill(goldText) : gate1Responder(f)(call),
      profile.model,
    )
    const planner = respondingStub(
      (call) =>
        JSON.stringify(call.prompt).includes(tieText)
          ? fill('hello world bar')
          : gate1Responder(f)(call),
      profile.model,
    )
    const judge = respondingStub(
      () => judgeGenerateResult('equivalent', 'high'),
      judgeProfile.model,
    )
    const fingerprint = evalLocal.computeReplayProfileFingerprintFor({
      profile,
      modelOverrides: { languageModels: planner.languageModels },
      seedPolicy: 'declared',
    })
    const identity = {
      ...f.identity,
      plannerModelId: profile.model,
      judgeModelId: judgeProfile.model,
      judgeVersion: JUDGE_CONFIG.judgeVersion,
      fingerprint,
    }
    identity.profileKey = composeBaselineProfileKey(identity)
    const gateRoot = join(f.agentQaRoot, 'eval/gate', slugBranch(identity.profileKey))
    const written = evalLocal.writeNoiseFloorArtefact({
      artefact: { ...f.artefact, ...identity },
      committedRoot: f.committedRoot,
      reportOutputBaseDir: join(f.agentQaRoot, 'judge-fixture-audit'),
    })
    expect(written.kind).toBe('written')
    await evalLocal.replayCorpusOnce({
      selected: f.selected,
      cassettesRoot: f.cassettesRoot,
      agentQaRoot: f.agentQaRoot,
      runRoot: gateRoot,
      profile,
      auth: noneAuth,
      modelOverrides: { languageModels: baseline.languageModels },
      judge: {
        profile: judgeProfile,
        auth: noneAuth,
        modelOverrides: { languageModels: judge.languageModels },
      },
      seed: 11,
      k: 1,
      maskingContextFactory: createMaskingContext,
      replayOutputBaseDir: gateRoot,
      source: 'committed',
      corpusDigest: f.corpusDigest,
      clock: incrementingClock(),
    })
    expect(judge.captured).toHaveLength(0)
    input.identity = identity
    input.planner = {
      profile,
      resolveAuth: async () => noneAuth,
      modelOverrides: { languageModels: planner.languageModels },
    }
    input.judge = {
      profile: judgeProfile,
      resolveAuth: async () => noneAuth,
      modelOverrides: { languageModels: judge.languageModels },
    }
    const got = receipt(await evalLocal.runReplayGate(input))
    expect(got.verdict).toBe('pass')
    expect(got.judge?.eligibility).toBe('eligible')
    expect(judge.captured).toHaveLength(2)
    expect(got.spend).toMatchObject({
      screens: 10,
      modelCalls: 12,
      promptTokens: 120,
      completionTokens: 24,
    })
    expect(got.spend!.modelCalls).toBe(planner.captured.length + judge.captured.length)
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
