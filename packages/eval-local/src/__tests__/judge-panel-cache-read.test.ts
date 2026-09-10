import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildEvalReport, canonicalJson, createScoringContext, composeBaselineProfileKey, createPanelIdentity } from '@vostride/agent-qa-eval'
import { sha256hex, slugBranch } from '@vostride/agent-qa-schema'
import { baselineScoreSchema } from '../baseline-cache-guards.js'
import { resolveBaselineCache } from '../baseline-cache-read.js'
import { FsReportStore } from '../report-store.js'
import { panelScoreFixture } from './fixtures/panel-score-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture(verdicts = ['unsure', 'error']) {
  const root = mkdtempSync(join(tmpdir(), 'panel-cache-')); roots.push(root)
  const profileKey = composeBaselineProfileKey({ plannerModelId: 'gpt-5', fingerprint: 'a'.repeat(64),
    matcherVersion: 1, ...createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro']) })
  const run = join(root, 'eval/floor', slugBranch(profileKey), 'r0-seed29')
  const f = await panelScoreFixture(run, verdicts)
  const report = buildEvalReport([{ cassetteId: f.cassette.id, outcome: f.outcome, score: f.record.score }], f.record.judge)
  report.runIdentity = { fingerprint: 'a'.repeat(64), corpusDigest: 'b'.repeat(64) }
  new FsReportStore({ root, outputDir: join(run, 'reports') }).save(report)
  const input = { agentQaRoot: root, profileKey, fingerprint: 'a'.repeat(64), matcherVersion: 1,
    plannerModelId: f.outcome.replayedModel.modelId, judgeIdentity: f.record.judge,
    gateRootSeed: 11, gateRootSeedSource: 'floor',
    cassettes: [{ id: f.cassette.id, promptInputHash: f.cassette.receipt.promptInputHash }] }
  return { ...f, input }
}

it.each([
  { verdicts: ['unsure', 'error'], cause: 'below-quorum' },
  { verdicts: ['equivalent', 'different'], cause: 'panel-disagreement' },
  { verdicts: ['different', 'different'], cause: undefined },
])('reuses complete cached panel outcome $cause', async ({ verdicts, cause }) => {
  const f = await fixture(verdicts)
  if (cause !== undefined) expect(f.record.score).toMatchObject({ entry: { score: { judgeOutcome: { cause } } } })
  expect(baselineScoreSchema.safeParse(f.record).success).toBe(true)
  const cached = resolveBaselineCache(f.input)
  expect(cached.rows).toMatchObject([{ kind: 'cached', score: f.record, seed: 29 }])
  expect(cached.rows[0].kind === 'cached' && cached.rows[0].score).toEqual(f.record)
})

it.each(['size', 'unknown-kind', 'unknown-cause', 'member', 'member-error', 'usage', 'foreign-request', 'old-version', 'digest', 'replay-digest', 'missing-context'])(
  'refuses corrupt or stale cache panel evidence: %s', async corruption => {
    const f = await fixture()
    const raw = JSON.parse(readFileSync(f.written.file, 'utf8'))
    const stamp = raw.score.entry.score.judgeOutcome
    if (corruption === 'size') raw.judge.panelSize++
    if (corruption === 'unknown-kind') stamp.kind = 'unknown'
    if (corruption === 'unknown-cause') stamp.cause = 'unknown'
    if (corruption === 'member') stamp.members[0].judgeModelId = 'foreign'
    if (corruption === 'member-error') stamp.members[1].outcome.reason = 'unknown'
    if (corruption === 'usage') stamp.members[0].usage.calls = -1
    if (corruption === 'foreign-request') raw.scoringContext.judgeRequest.judgeModelId = 'foreign'
    if (corruption === 'old-version') { raw.judge.judgeVersion = 1; stamp.judgeVersion = 1 }
    if (corruption === 'digest') raw.scoringContext.finalScoreDigest = 'f'.repeat(64)
    if (corruption === 'replay-digest') raw.scoringContext.replayDigest = 'f'.repeat(64)
    if (corruption === 'missing-context') delete raw.scoringContext
    writeFileSync(f.written.file, JSON.stringify(raw))
    expect(resolveBaselineCache(f.input).rows[0].kind).toBe('uncached')
  })

it('rejects nonfinite nested usage before serialization and preserves closed member error vocabulary', async () => {
  const f = await fixture()
  const raw = JSON.parse(readFileSync(f.written.file, 'utf8'))
  raw.score.entry.score.judgeOutcome.members[0].usage.inputTokens = Infinity
  expect(baselineScoreSchema.safeParse(raw).success).toBe(false)
})

it('rejects a self-consistent score with a foreign scoring request', async () => {
  const f = await fixture(['different', 'different'])
  f.record.scoringContext = createScoringContext({ ...f, ...f.record,
    judgeRequest: { judgeModelId: 'foreign', allowSameFamily: false } })
  expect(sha256hex(canonicalJson(f.record.score))).toBe(f.record.scoringContext.finalScoreDigest)
  writeFileSync(f.written.file, JSON.stringify(f.record))
  expect(resolveBaselineCache(f.input).rows[0].kind).toBe('uncached')
})
