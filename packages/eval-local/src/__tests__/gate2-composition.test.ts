import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assignSplit, computeCorpusDigest } from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest, distilledScreenStateDigest, slugBranch, type CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { ablateCanaryStep, readCommittedCorpusDigest, GATE2_AUDIT_SUBDIR } from '../index.js'
import { readCommittedCorpus } from '../committed-corpus-source.js'
import { resolveActiveRecordRemoval } from '../replay-gate-composition.js'
import { loadCassetteBundles } from '../replay-sweep.js'
import { buildRootMarkerValue } from '../committed-root-store.js'
import { writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import { actionGenerateResult, respondingStub, stubProfile, noneAuth } from './fixtures/replay-fixtures.js'
import { stageFeedbackEntry, isNovelState, listStagedFeedback, admitStagedFeedback } from '../gate2-composition.js'
import * as seeding from '../seeding-composition.js'
import { committedCorpusPath, committedLabelPath } from '../committed-root-store.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function feedbackInput(f: ReturnType<typeof fixture>, route = 'novel') {
  f.step.subActions[0]!.stateBefore.url = `https://feedback.example/${route}`
  f.step.subActions[0]!.stateBefore.timestamp = 1_725_000_000
  f.save()
  return { agentQaRoot: f.agentQaRoot, committedRoot: f.committedRoot,
    product: f.handoff.scope.key, target: { runId: String(f.handoff.runId), testId: f.handoff.tests[0]!.testId, stepIndex: 0 },
    attributedObservationId: 'fixture-feedback-observation', benefit: 'rode-along' as const,
    candidateId: f.line.id, stateDigest: distilledScreenStateDigest(f.step.subActions[0]!.stateBefore) }
}
function admissionInput(f: ReturnType<typeof fixture>, dryRun = false) {
  return { agentQaRoot: f.agentQaRoot, committedRoot: f.committedRoot, dryRun,
    seedingOutputBaseDir: join(f.agentQaRoot, 'eval/audit/seed-feedback') }
}

describe('418 feedback staging and explicit admission', () => {
  it('rechecks staged text on eval-seeding and retains egress-refused entries', async () => {
    const f = fixture()
    expect(await stageFeedbackEntry(feedbackInput(f))).toMatchObject({ kind: 'staged' })
    const [entry] = listStagedFeedback({ agentQaRoot: f.agentQaRoot })
    const cassette = entry!.extracted.cassette
    cassette.input.stepText = 'AKIAIOSFODNN7EXAMPLE'
    writeFileSync(join(entry!.dir, 'cassette.json'), JSON.stringify(cassette))
    const result = await admitStagedFeedback(admissionInput(f))
    expect(result.admitted).toEqual([])
    expect(result.refusals).toMatchObject([{ kind: 'egress-blocked', cassetteId: cassette.id }])
    expect(listStagedFeedback({ agentQaRoot: f.agentQaRoot })).toHaveLength(1)
    expect(result.nextCorpusDigest).toBe(result.previousCorpusDigest)
  })
  it('checks committed novelty, publishes write-once locally, and never changes committed bytes', async () => {
    const f = fixture({ targetInCorpus: true })
    const committed = loadCassetteBundles(join(f.committedRoot, 'cassettes')).loaded.find(b => b.cassette.granularity === 'leaf')!
    if (committed.cassette.granularity !== 'leaf') throw new Error('leaf expected')
    const input = feedbackInput(f)
    expect(isNovelState({ ...input, stateDigest: distilledScreenStateDigest(committed.cassette.input.stateBefore) })).toBe(false)
    const before = tree(f.committedRoot)
    expect(isNovelState(input)).toBe(true)
    expect(await stageFeedbackEntry(input)).toMatchObject({ kind: 'staged' })
    const staged = listStagedFeedback(input)
    expect(staged).toHaveLength(1)
    expect(Object.keys(tree(staged[0]!.dir)).sort()).toContain('cassette.json')
    expect(Object.keys(tree(staged[0]!.dir))).toContain('feedback.json')
    expect(staged[0]!.dir).toContain(`/eval/feedback/${slugBranch(input.product)}/${input.stateDigest}`)
    const bytes = tree(f.agentQaRoot)
    expect(isNovelState(input)).toBe(false)
    expect(await stageFeedbackEntry(input)).toEqual({ kind: 'already-staged' })
    expect(tree(f.agentQaRoot)).toEqual(bytes)
    expect(tree(f.committedRoot)).toEqual(before)
  })
  it.each(['egress', 'digest', 'wrong-product', 'wrong-run', 'rerun', 'ambiguous'] as const)('refuses %s before any publication', async mode => {
    const f = fixture()
    const input = feedbackInput(f)
    if (mode === 'egress') f.step.stepText = 'AKIAIOSFODNN7EXAMPLE'
    if (mode === 'digest') input.stateDigest = '../outside'
    if (mode === 'wrong-product') input.product = 'other-product'
    if (mode === 'wrong-run') input.target.runId = 'another-run'
    if (mode === 'rerun') f.handoff.tests[0]!.isRerun = true
    if (mode === 'ambiguous') f.step.subActions.push(structuredClone(f.step.subActions[0]!))
    f.save()
    const runtime = tree(f.agentQaRoot)
    const committed = tree(f.committedRoot)
    const auditSink = { appendGuardrailAudit: vi.fn(), appendExecutionAudit: vi.fn() }
    expect(await stageFeedbackEntry({ ...input, auditSink })).toEqual({ kind: mode === 'egress' ? 'egress-blocked' : 'target-unavailable' })
    expect(listStagedFeedback({ agentQaRoot: f.agentQaRoot })).toEqual([])
    expect(tree(f.agentQaRoot)).toEqual(runtime)
    expect(tree(f.committedRoot)).toEqual(committed)
    if (mode === 'egress') expect(auditSink.appendGuardrailAudit).toHaveBeenCalledWith(expect.objectContaining({ channel: 'eval-feedback-staging:cassette' }))
  })
  it('admits a mixed-product and mixed-run batch once with real provenance, natural splits and unchanged labels', async () => {
    const f = fixture()
    const first = feedbackInput(f, 'one')
    expect(await stageFeedbackEntry(first)).toMatchObject({ kind: 'staged' })
    f.handoff.runId = asRunId(`${f.handoff.runId}-second`)
    f.handoff.buildOrdinal += 1
    f.handoff.scope = { tier: 'product', key: 'second/product' }
    f.handoff.aggregateVerdict = 'failed'
    f.handoff.tests[0]!.outcome = 'failed'
    f.step.verifierVerdict = { pass: false, reasoning: 'fixture failed live step' }
    const runDir = join(f.agentQaRoot, 'runs', slugBranch(f.handoff.runId))
    mkdirSync(runDir, { recursive: true })
    const second = feedbackInput(f, 'two')
    writeFileSync(join(runDir, 'handoff.json'), JSON.stringify(f.handoff))
    expect(await stageFeedbackEntry({ ...second, benefit: 'exercised-harmed' })).toMatchObject({ kind: 'staged' })
    const entries = listStagedFeedback({ agentQaRoot: f.agentQaRoot })
    const heldOut = assignSplit({ cassetteId: entries[0]!.extracted.cassette.id, saltHex: '0'.repeat(64), heldOutFraction: 0.999999, privateFraction: 0.999999, isPairMember: false })
    expect(heldOut.split).toBe('held-out')
    const runtime = tree(f.agentQaRoot), committed = tree(f.committedRoot)
    const dry = await admitStagedFeedback(admissionInput(f, true))
    expect(dry.entries).toHaveLength(2)
    expect(dry.admitted).toHaveLength(0)
    expect(dry).not.toHaveProperty('nextCorpusDigest')
    expect(tree(f.agentQaRoot)).toEqual(runtime)
    expect(tree(f.committedRoot)).toEqual(committed)
    const seed = vi.spyOn(seeding, 'seedCommittedCorpus')
    const result = await admitStagedFeedback(admissionInput(f))
    expect(seed).toHaveBeenCalledTimes(1)
    expect(result.refusals).toEqual([])
    expect(result.admitted).toHaveLength(2)
    expect(result.nextCorpusDigest).not.toBe(result.previousCorpusDigest)
    for (const entry of result.admitted) {
      const corpusEntry = JSON.parse(readFileSync(join(f.committedRoot, committedCorpusPath(entry.product, entry.extracted.cassette.id)), 'utf8'))
      expect(corpusEntry).toMatchObject({ split: 'natural', product: entry.product, source: 'canary-feedback',
        attributedObservationId: entry.attributedObservationId, benefit: entry.benefit,
        run_links: { runId: entry.runId, runSlug: slugBranch(entry.runId) }, captured_at_ordinal: entry.extracted.cassette.receipt.buildOrdinal })
      expect(Number.isInteger(corpusEntry.captured_at_ordinal)).toBe(true)
      expect(corpusEntry.run_links.runId).not.toBe('')
      const label = JSON.parse(readFileSync(join(f.committedRoot, committedLabelPath(entry.product, entry.extracted.cassette.id)), 'utf8'))
      expect(label.label).toEqual(entry.extracted.cassette.label)
      expect(label.label.tier).toBe('silver')
      expect(label.label.verdict.pass).toBe(entry.product !== 'second/product')
      expect(label.provenance).toMatchObject({ runId: entry.runId, capturedAtOrdinal: corpusEntry.captured_at_ordinal })
      expect(isNovelState({ agentQaRoot: f.agentQaRoot, committedRoot: f.committedRoot, product: entry.product, stateDigest: entry.stateDigest })).toBe(false)
    }
    const after = tree(f.committedRoot)
    const rerun = await admitStagedFeedback(admissionInput(f))
    expect(rerun.entries).toEqual([])
    expect(rerun.nextCorpusDigest).toBe(result.nextCorpusDigest)
    expect(tree(f.committedRoot)).toEqual(after)
    expect(seed).toHaveBeenCalledTimes(1)
    seed.mockRestore()
  })
  it('retains a refused case while admitting the other case, without inferring success from aggregate counts', async () => {
    const f = fixture()
    expect(await stageFeedbackEntry(feedbackInput(f, 'one'))).toMatchObject({ kind: 'staged' })
    // Same run, new decision id and state: the stored entry remains the original immutable snapshot.
    f.step.stepIndex = 1
    const second = { ...feedbackInput(f, 'two'), target: { runId: String(f.handoff.runId), testId: f.handoff.tests[0]!.testId, stepIndex: 1 } }
    expect(await stageFeedbackEntry(second)).toMatchObject({ kind: 'staged' })
    const entries = listStagedFeedback({ agentQaRoot: f.agentQaRoot })
    const refused = entries[0]!
    const path = join(f.committedRoot, committedCorpusPath(refused.product, refused.extracted.cassette.id))
    // Plant valid conflicting corpus bytes, so the digest read itself remains valid.
    const dry = await admitStagedFeedback(admissionInput(f, true))
    expect(dry.entries).toHaveLength(2)
    const { projectCorpusEntry } = await import('@vostride/agent-qa-eval')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(projectCorpusEntry({ cassette: refused.extracted.cassette, product: refused.product,
      runId: refused.runId, assignment: { split: 'natural' } })))
    const result = await admitStagedFeedback(admissionInput(f))
    expect(result.admitted).toHaveLength(1)
    expect(result.refusals).toHaveLength(1)
    expect(result.refusals[0]).toMatchObject({ cassetteId: refused.extracted.cassette.id, kind: 'write-conflict' })
    expect(listStagedFeedback({ agentQaRoot: f.agentQaRoot }).map(entry => entry.dir)).toEqual([refused.dir])
  })
})

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
  it('replays and stages the unique live decision after a different cached prefix', async () => {
    const f = fixture()
    const input = feedbackInput(f, 'live-after-cache')
    const live = structuredClone(f.step.subActions[0]!)
    const cached = structuredClone(live)
    cached.stateBefore.url = 'https://feedback.example/cached-prefix'
    delete cached.exchanges
    f.step.subActions = [cached, live]
    f.save()
    const { input: replay, stub } = inputFor(f)
    const result = await ablateCanaryStep(replay)
    expect(result).toMatchObject({ kind: 'ablated', crossCheck: 'flipped' })
    expect(stub.captured).toHaveLength(5)
    expect(await stageFeedbackEntry(input)).toMatchObject({ kind: 'staged' })
    const [entry] = listStagedFeedback(input)
    expect(entry!.extracted.cassette.input.decisionOrdinal).toBe(1)
    expect(distilledScreenStateDigest(entry!.extracted.cassette.input.stateBefore)).toBe(input.stateDigest)
  })
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
