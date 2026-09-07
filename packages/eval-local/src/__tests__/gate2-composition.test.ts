import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { computeCorpusDigest } from '@vostride/agent-qa-eval'
import { computeBriefDigest, slugBranch, type CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { ablateCanaryStep, readCommittedCorpusDigest, GATE2_AUDIT_SUBDIR } from '../index.js'
import { readCommittedCorpus } from '../committed-corpus-source.js'
import { resolveActiveRecordRemoval } from '../replay-gate-composition.js'
import { loadCassetteBundles } from '../replay-sweep.js'
import { buildRootMarkerValue } from '../committed-root-store.js'
import { writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import { actionGenerateResult, respondingStub, stubProfile, noneAuth } from './fixtures/replay-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tree(root: string) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return [relative(root, path), readFileSync(path).toString('base64')]
    }))
}
function fixture(options: Parameters<typeof writeGate1Fixture>[1] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gate2-'))
  roots.push(root)
  const f = writeGate1Fixture(root, { targetInCorpus: false, handoffForTarget: true, proofBrief: true, ...options })
  const handoffPath = join(f.agentQaRoot, 'runs', slugBranch(f.injection.target!.runId), 'handoff.json')
  const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as CompletedRunHandoff
  const step = handoff.tests[0]!.steps[0]!
  const line = step.servedBrief!.channel1[0]!
  line.status = 'candidate'
  line.servedAsCanary = true
  step.servedBrief!.briefDigest = computeBriefDigest(step.servedBrief!)
  const save = () => writeFileSync(handoffPath, JSON.stringify(handoff))
  save()
  return { ...f, handoff, handoffPath, step, line, save }
}
function inputFor(f: ReturnType<typeof fixture>, behavior: 'flipped' | 'held' | 'seed-rejected' | 'mixed' = 'flipped') {
  let withCalls = 0
  const stub = respondingStub((call) => {
    const present = JSON.stringify(call.prompt).includes(f.line.summary.replaceAll('"', '\\"'))
    if (present) withCalls++
    const action = actionGenerateResult('web', behavior === 'held' ||
      (present && !(behavior === 'mixed' && withCalls === 2)) ? 'e-continue' : 'e-other')
    return behavior === 'seed-rejected'
      ? { ...action, warnings: [{ type: 'unsupported' as const, feature: 'seed' }] } : action
  })
  let observedCalls = 0
  const input = {
    agentQaRoot: f.agentQaRoot, committedRoot: f.committedRoot, recordId: f.line.id,
    target: { ...f.injection.target!, testId: f.handoff.tests[0]!.testId },
    attributedObservationId: '../observed/canary', k: 3, baseSeed: 11,
    replay: {
      profile: stubProfile(), auth: noneAuth, modelOverrides: { languageModels: stub.languageModels },
      maskingContextFactory: createMaskingContext,
      modelCallObservation: { onProviderCall: () => { observedCalls++ } },
    },
  }
  return { input, stub, observedCalls: () => observedCalls }
}

describe('Gate 2 live canary ablation (fixture providers only)', () => {
  it('retains a valid initialized empty corpus digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate2-empty-'))
    roots.push(root)
    writeFileSync(join(root, 'eval-root.json'), JSON.stringify(buildRootMarkerValue()))
    expect(readCommittedCorpusDigest({ committedRoot: root })).toEqual({
      kind: 'digest', corpusDigest: computeCorpusDigest([]),
    })
  })
  it.each(['missing', 'malformed', 'unsupported'] as const)('refuses a %s root marker without replay', async (mode) => {
    const f = fixture()
    const marker = join(f.committedRoot, 'eval-root.json')
    if (mode === 'missing') rmSync(marker)
    else writeFileSync(marker, mode === 'malformed' ? '{' : '{"schemaVersion":999}')
    const { input, stub } = inputFor(f)
    expect(readCommittedCorpusDigest(input)).toMatchObject({ kind: 'unavailable', reason: 'corpus-unreadable' })
    expect(await ablateCanaryStep(input)).toMatchObject({ kind: 'unavailable', reason: 'corpus-unreadable' })
    expect(stub.captured).toHaveLength(0)
  })
  it('counts exactly five fresh calls at k=3 and writes only eval/gate2 audit artifacts', async () => {
    const f = fixture()
    const { input, stub, observedCalls } = inputFor(f)
    const beforeCommitted = tree(f.committedRoot)
    const beforeRuntime = tree(f.agentQaRoot)
    const got = await ablateCanaryStep(input)
    expect(got.kind).toBe('ablated')
    if (got.kind !== 'ablated') throw new Error(got.detail)
    expect(got.crossCheck).toBe('flipped')
    expect(stub.captured.length).toBe(5)
    expect(observedCalls()).toBe(5)
    expect(got.spend).toEqual({ modelCalls: 5, screens: 5, promptTokens: 50, completionTokens: 10 })
    expect(got.seeds).toEqual([11, 1938274511, 1319274378])
    expect(got.seeds).toHaveLength(input.k)
    expect(got.seeds[0]).toBe(input.baseSeed)
    expect(got.seedHonored).toBe(true)
    expect(got.notices.join('\n')).toContain('seed was not replayed or verified')
    const digest = computeCorpusDigest(readCommittedCorpus(f.committedRoot).snapshot.entries)
    expect(got.corpusDigest).toBe(digest)
    expect(readCommittedCorpusDigest(input)).toEqual({ kind: 'digest', corpusDigest: digest })
    expect(GATE2_AUDIT_SUBDIR).toBe('eval/gate2')
    const prefix = `eval/gate2/${slugBranch(input.attributedObservationId)}/`
    expect(got.gate2Dir).toBe(join(f.agentQaRoot, prefix.slice(0, -1)))
    const afterRuntime = tree(f.agentQaRoot)
    for (const [path, bytes] of Object.entries(beforeRuntime)) expect(afterRuntime[path]).toBe(bytes)
    const added = Object.keys(afterRuntime).filter((path) => !(path in beforeRuntime))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((path) => path.startsWith(prefix))).toBe(true)
    expect(added.some((path) => path.includes('without/sample-0/replays/') && path.endsWith('replay.json'))).toBe(true)
    expect(tree(f.committedRoot)).toEqual(beforeCommitted)
    const target = loadCassetteBundles(join(got.gate2Dir, 'target/cassettes')).loaded[0]!
    if (target.cassette.granularity !== 'leaf') throw new Error('expected leaf')
    expect(target.cassette.sidecar.goldAction).toEqual(f.step.subActions[0]!.plannedAction)
    const removal = resolveActiveRecordRemoval({ cassette: target.cassette, recordId: f.line.id, servedCanary: true })
    expect(removal.kind).toBe('removed')
    if (removal.kind === 'removed') {
      expect(removal.delta.line).toMatchObject({ status: 'candidate', servedAsCanary: true })
      expect(removal.delta.renderedLine).toBe(f.step.servedBrief!.proof!.promptTurns[0]!.learnedL2)
    }
  })
  it.each(['held', 'mixed', 'seed-rejected'] as const)('preserves %s evidence', async (behavior) => {
    const f = fixture()
    const { input, stub } = inputFor(f, behavior)
    const got = await ablateCanaryStep(input)
    expect(got).toMatchObject({ kind: 'ablated', crossCheck: behavior === 'mixed' ? 'inconclusive' : behavior === 'held' ? 'held' : 'flipped', seedHonored: behavior !== 'seed-rejected' })
    expect(stub.captured).toHaveLength(5)
  })
  it('keeps the k=5 supermajority ladder at nine calls', async () => {
    const f = fixture()
    const { input, stub } = inputFor(f, 'mixed')
    const got = await ablateCanaryStep({ ...input, k: 5 })
    expect(got).toMatchObject({ kind: 'ablated', crossCheck: 'flipped', spend: { modelCalls: 9, screens: 9 } })
    expect(stub.captured).toHaveLength(9)
  })
  it.each(['missing-handoff', 'wrong-run', 'wrong-test', 'wrong-step', 'ambiguous', 'actionless', 'cached', 'unflagged', 'no-proof', 'render-miss', 'corpus'])(
    'refuses %s without provider spend', async (mode) => {
      const f = fixture()
      const { input, stub } = inputFor(f)
      if (mode === 'missing-handoff') rmSync(f.handoffPath)
      if (mode === 'wrong-run') input.target.runId = input.target.runId.replace('-', '/')
      if (mode === 'wrong-test') input.target.testId = 'different-test'
      if (mode === 'wrong-step') input.target.stepIndex = 99
      if (mode === 'ambiguous') f.step.subActions.push(structuredClone(f.step.subActions[0]!))
      if (mode === 'actionless') f.step.subActions = []
      if (mode === 'cached') delete f.step.subActions[0]!.exchanges
      if (mode === 'unflagged') f.line.servedAsCanary = false
      if (mode === 'no-proof') delete f.step.servedBrief!.proof
      if (mode === 'render-miss') f.step.servedBrief!.proof!.promptTurns[0]!.learnedL2 = 'different text'
      if (mode === 'corpus') {
        const path = join(f.committedRoot, 'corpus', 'broken')
        mkdirSync(path, { recursive: true })
        writeFileSync(join(path, 'invalid.json'), '{}')
      }
      if (!['missing-handoff', 'wrong-run', 'wrong-test', 'wrong-step', 'corpus'].includes(mode)) f.save()
      const got = await ablateCanaryStep(input)
      const reason = ['actionless', 'cached'].includes(mode) ? 'no-live-decision'
        : ['unflagged', 'no-proof', 'render-miss'].includes(mode) ? 'brief-line-not-found'
        : mode === 'corpus' ? 'corpus-unreadable' : 'target-unavailable'
      expect(got).toMatchObject({ kind: 'unavailable', reason })
      if (mode === 'ambiguous') expect(got).toMatchObject({ detail: 'ambiguous live step: multiple recorded decisions' })
      if (mode === 'corpus') expect(readCommittedCorpusDigest(input)).toMatchObject({ kind: 'unavailable', reason: 'corpus-unreadable' })
      expect(stub.captured).toHaveLength(0)
    },
  )
  it('uses the live handoff even when a committed target exists', async () => {
    const f = fixture({ targetInCorpus: true })
    // The committed fixture is active; only the live handoff has the served candidate proof.
    const { input } = inputFor(f)
    const got = await ablateCanaryStep(input)
    expect(got).toMatchObject({ kind: 'ablated', crossCheck: 'flipped' })
    if (got.kind !== 'ablated') throw new Error(got.detail)
    const extracted = loadCassetteBundles(join(got.gate2Dir, 'target/cassettes')).loaded[0]!
    if (extracted.cassette.granularity !== 'leaf') throw new Error('expected leaf')
    expect(extracted.cassette.input.servedBrief.channel1[0]).toMatchObject({ status: 'candidate', servedAsCanary: true })
  })
  it.each([0, 1, 2, 4, 3.5, NaN, Infinity])('rejects invalid k=%s before writes or calls', async (k) => {
    const f = fixture()
    const { input, stub } = inputFor(f)
    const before = tree(f.agentQaRoot)
    await expect(ablateCanaryStep({ ...input, k })).rejects.toThrow('k must be an odd integer of at least 3')
    expect(stub.captured).toHaveLength(0)
    expect(tree(f.agentQaRoot)).toEqual(before)
  })
})
