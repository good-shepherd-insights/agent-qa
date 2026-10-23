import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@vostride/agent-qa-eval'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import {
  MARK_RECEIPT_SCHEMA_VERSION,
  asRunId,
  sha256hex,
  slugBranch,
  type MarkReceipt,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import * as local from '../index.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'

const NO_DECLARED_SECRETS = (text: string) => text
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const digest = (value: unknown) => sha256hex(core.canonicalJson(value))
const tempRoot = (prefix: string) => { const root = mkdtempSync(join(tmpdir(), prefix)); roots.push(root); return root }
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

function calibrationFixture() {
  const root = tempRoot('eval-runtime-stamps-')
  const committedRoot = join(root, 'committed')
  const handoff = makeLocalV2Handoff({ runId: asRunId('eval-runtime-stamps'), scope: { tier: 'product', key: 'shop' } })
  handoff.tests[0]!.steps = [handoff.tests[0]!.steps[0]!]
  for (const sub of handoff.tests[0]!.steps[0]!.subActions) sub.stateBefore.timestamp = 1_725_000_000
  const run = join(root, 'runs', core.deriveRunSlug(handoff.runId)); mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'handoff.json'), JSON.stringify(handoff))
  new FsEvidenceArtifactStore({ root, runId: handoff.runId }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
  const cassettes = core.extractRunCassettes({ handoff, artifacts: new local.FsRunArtifactSource({ root, runId: handoff.runId }) }).cassettes
  const source = cassettes.find(row => row.cassette.granularity === 'leaf')!.cassette as core.LeafCassette
  source.receipt.model = { declared: { provider: 'openai', modelId: 'gpt-5' } }
  const plan = core.buildSeedingPlan({ handoff, cassettes, partition: { saltHex: 'a'.repeat(64), heldOutFraction: 0.000001, privateFraction: 0.5 } })
  if (local.seedCommittedCorpus({ plan, cassettes, committedRoot, mask: NO_DECLARED_SECRETS }).refusals.length) throw new Error('Fixture seed refused')
  const mark: MarkReceipt = { schemaVersion: MARK_RECEIPT_SCHEMA_VERSION, markId: 'mark_abcdef012345', runId: handoff.runId,
    runSlug: core.deriveRunSlug(handoff.runId), testIndex: 0, stepIndex: 0, kind: 'confirmed-bug', origin: 'user', ordinal: 1,
    markedAt: 0, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 }, gold: [], evidence: { confirmed: 0, overturned: 0 } }
  const frozen = core.buildGoldenTrajectoryPlan({ handoff, cassettes, mark, product: 'shop' })
  if (local.seedCommittedCorpus({ plan: { ...plan, cases: frozen.cases }, cassettes: frozen.goldCassettes, committedRoot,
    mask: NO_DECLARED_SECRETS }).refusals.length) throw new Error('Fixture gold refused')
  mark.gold = frozen.cases.map(row => ({ cassetteId: row.cassetteId, sourceCassetteId: source.id, channel: 'user-mark' }))
  writeFileSync(join(run, 'marks.jsonl'), JSON.stringify(mark) + '\n')
  const cassette = frozen.goldCassettes[0]!.cassette as core.LeafCassette, labelRecord = frozen.cases[0]!.labelRecord
  const identity = core.computeDecisionIdentity(cassette.sidecar.goldAction, cassette.input.stateBefore.elements)
  const outcome: core.LeafReplayResult = { granularity: 'leaf', cassetteId: cassette.id,
    samples: [{ sampleIndex: 0, durationMs: 1, outcome: { kind: 'decision', action: cassette.sidecar.goldAction, identity } }],
    agreement: { k: 1, agreementRate: 1, noConsensus: false, harnessErrorCount: 0, modal: { identity, count: 1 } },
    modalDecision: identity, promptDrift: core.computeReplayDrift(cassette.input, cassette.receipt.promptInputHash),
    briefSource: 'proof', replayedModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }, unconsumedExchanges: [], totalDurationMs: 1 }
  const score = core.scoreCassetteReplay(cassette, outcome, labelRecord)
  const record: local.ScoreRecord = { cassetteId: cassette.id, matcherVersion: 1, score, diffs: [],
    scoringContext: core.createScoringContext({ cassette, outcome, labelRecord, score, judgeRequest: null }) }
  const profile = { plannerModelId: outcome.replayedModel.modelId, fingerprint: 'a'.repeat(64), matcherVersion: 1 }
  const runRoot = join(root, 'eval/gate', slugBranch(core.composeBaselineProfileKey(profile)))
  const replaysRoot = join(runRoot, 'replays')
  const written = new local.FsReplayRecordStore({ root, outputDir: replaysRoot, executionSeed: 17 }).save(outcome)
  const scoreFile = new local.FsScoreStore({ root, outputDir: replaysRoot }).save(record).file
  const report = core.buildEvalReport([{ cassetteId: cassette.id, outcome, score }])
  report.runIdentity = { fingerprint: profile.fingerprint, corpusDigest: core.computeCorpusDigest(local.readActiveCommittedCorpus(committedRoot, root).snapshot.entries) }
  const saveReport = () => new local.FsReportStore({ root, outputDir: join(runRoot, 'reports') }).save(report, undefined, {
    seed: 17, records: [{ cassetteId: cassette.id, replayDigest: digest(readJson(written.file)), scoreDigest: digest(readJson(scoreFile)) }],
  })
  saveReport()
  const read = () => local.loadJudgeCalibrationEvidence({ agentQaRoot: root, committedRoot, profile })
  return { scoreFile, saveReport, read }
}

describe('eval runtime stamps', () => {
  it('admits a replay score whose scoring context the current scoring path stamped 2', () => {
    const f = calibrationFixture()
    expect(readJson(f.scoreFile).scoringContext.schemaVersion).toBe(2)
    const result = f.read()
    expect(result.evidence).toHaveLength(1)
    expect(result.skippedCounts).toEqual({})
  })

  it('reads a stored score whose scoring context is stamped 1 as stale-replay', () => {
    const f = calibrationFixture()
    const stored = readJson(f.scoreFile)
    stored.scoringContext.schemaVersion = 1
    writeFileSync(f.scoreFile, JSON.stringify(stored))
    f.saveReport()
    const result = f.read()
    expect(result.evidence).toEqual([])
    expect(result.skippedCounts).toEqual({ 'stale-replay': 1 })
  })
})
