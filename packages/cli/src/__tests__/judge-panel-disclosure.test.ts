import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as core from '@vostride/agent-qa-eval'
import * as local from '@vostride/agent-qa-eval-local'
import * as llm from '../llm-utils.js'
import { resolveEvalSession, runReportVerb, runJudgeCalibrateVerb } from '../eval-session-composition.js'
import { renderEvalReportMarkdown } from '../eval-report-render.js'
const { panelScoreFixture } = await import(new URL('../../../eval-local/src/__tests__/fixtures/panel-score-fixture.js', import.meta.url).href)
const reader = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@vostride/agent-qa-eval-local', async original => {
  const actual = await original<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, readJudgeCalibration: (...args: Parameters<typeof actual.readJudgeCalibration>) => reader.read(...args) }
})
const roots: string[] = []
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('@vostride/agent-qa-eval-local')>('@vostride/agent-qa-eval-local')
  reader.read.mockReset().mockImplementation(actual.readJudgeCalibration)
  vi.spyOn(llm, 'resolveModelAuth').mockRejectedValue(new Error('report must not resolve auth'))
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
})
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture(verdicts = ['different', 'different'], judges: string[] = ['a', 'b']) {
  const root = mkdtempSync(join(tmpdir(), 'panel-disclosure-')); roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(join(root, 'fixture.secrets'), '')
  writeFileSync(configPath, JSON.stringify({ workspace: { testMatch: ['tests/*.yaml'], suiteMatch: ['suites/*.yaml'], hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: 'fixture.secrets' },
    registry: { llms: ['gpt-5', 'claude-sonnet-4-5', 'gemini-2.5-pro'].map((model, i) => ({ name: ['planner', 'a', 'b'][i], provider: 'openai-compatible', model, baseURL: 'http://127.0.0.1:1/v1' })) },
    use: { llm: 'planner', mobile: { appState: 'preserve' } }, eval: { judges } }))
  const f = await panelScoreFixture(join(root, '.agent-qa/eval'), verdicts)
  const session = await resolveEvalSession({ configPath, keyOnly: true })
  const profile = { plannerModelId: 'gpt-5', matcherVersion: 1,
    judgeModelId: f.record.judge.judgeModelId, judgeVersion: f.record.judge.judgeVersion,
    fingerprint: local.computeReplayProfileFingerprintFor({ profile: { provider: 'openai-compatible', model: 'gpt-5', baseURL: 'http://127.0.0.1:1/v1', auth: { mode: 'none' } }, seedPolicy: 'none' }) }
  return { ...f, root, session, input: { agentQaRoot: join(root, '.agent-qa'), committedRoot: join(root, 'agent-qa-eval'),
    profile, identity: f.record.judge, minN: core.resolveJudgeCalibrationMinimum(20) } }
}
it('new composite report discloses unavailable calibration without auth or score mutation', async () => {
  const f = await fixture(), score = readFileSync(f.written.file, 'utf8')
  const result = await runReportVerb(f.session)
  expect(result.report.judge?.calibration).toEqual({ status: 'uncalibrated', n: 0, provenance: 'unavailable' })
  expect(renderEvalReportMarkdown(result.report)).toContain('- judge calibration: uncalibrated n=0 (unavailable)')
  expect(readFileSync(f.written.file, 'utf8')).toBe(score)
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
it.each(['no-credential', 'single-family-host'] as const)('copies a real guarded %s artifact including an explicit default-valued minimum', async reason => {
  const f = await fixture(); mkdirSync(f.input.committedRoot)
  const artifact = local.createJudgeCalibrationArtifact(f.input, { status: 'capability-gap', reason })
  const path = join(f.input.committedRoot, local.judgeCalibrationPath(artifact.profileKey))
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(artifact))
  const result = await runReportVerb(f.session)
  expect(result.report.judge?.calibration).toEqual({ status: 'capability-gap', reason })
  expect(renderEvalReportMarkdown(result.report)).toContain(`- judge calibration: capability-gap reason=${reason}`)
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
it.each(['corpusDigest', 'goldSetDigest', 'replayEvidenceDigest', 'evidenceDigest', 'profileKey', 'constitutionDigest'])('never borrows an artifact with foreign/stale %s', async field => {
  const f = await fixture(); mkdirSync(f.input.committedRoot)
  const artifact = local.createJudgeCalibrationArtifact(f.input, { status: 'capability-gap', reason: 'no-credential' })
  const path = join(f.input.committedRoot, local.judgeCalibrationPath(artifact.profileKey))
  const body = { ...artifact, [field]: 'f'.repeat(64) }; delete (body as Partial<typeof body>).generationId
  const modified = { ...body, generationId: local.judgeCalibrationGenerationId(body) }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(modified))
  expect((await runReportVerb(f.session)).report.judge?.calibration).toEqual({ status: 'uncalibrated', n: 0, provenance: 'unavailable' })
})
it.each([true, false])('copies guarded measurement precision and insufficient n: calibrated=%s', async calibrated => {
  const f = await fixture(), interval = { lower: 0.123456789012345, upper: 0.987654321098765, halfWidth: 0.43209876604321 }
  const perMember = f.record.judge.members.map((member: { judgeModelId: string }) => ({ judgeModelId: member.judgeModelId, n: 3,
    agreement: 2 / 3, wilson95: interval, settled: 3, errors: 0, abstained: 0, numerator: 2, denominator: 3 }))
  reader.read.mockReturnValue({ kind: 'loaded', artifact: { status: calibrated ? 'calibrated' : 'uncalibrated', n: 3,
    pooledAgreement: 2 / 3, wilson95: interval, perMember } })
  const result = await runReportVerb(f.session, {}, { commit: true })
  const expected = calibrated ? { status: 'calibrated', n: 3, pooledAgreement: 2 / 3, wilson95: interval,
    perMember: perMember.map(({ judgeModelId, n, agreement, wilson95 }: typeof perMember[number]) => ({ judgeModelId, n, agreement, wilson95 })) }
    : { status: 'uncalibrated', n: 3 }
  expect(result.report.judge?.calibration).toEqual(expected)
  expect(reader.read).toHaveBeenCalledWith(expect.objectContaining({ identity: f.record.judge, profile: f.input.profile }))
  expect(result.committed?.kind).toBe('committed')
  const bytes = readFileSync(result.stagedFile!, 'utf8'), markdown = renderEvalReportMarkdown(result.report)
  reader.read.mockReturnValue({ kind: 'loaded', artifact: { status: 'uncalibrated', n: 999 } })
  expect(local.loadStagedReport(f.input.agentQaRoot, result.batchKey)).toMatchObject({ kind: 'loaded', report: result.report })
  expect(local.listCommittedReports(f.input.committedRoot).reports[0]?.report).toEqual(result.report)
  expect(readFileSync(result.stagedFile!, 'utf8')).toBe(bytes)
  expect(core.assertBaselineComparator(result.report)).toEqual({ ok: true })
  expect(markdown.split('\n').filter(line => line.startsWith('- judge calibration:'))).toHaveLength(1)
  if (calibrated) expect(markdown).toContain('pooledAgreement=0.6666666666666666')
})
it('keeps singleton and direct-single reports unchanged and no-composite calibrate remains no-artifact', async () => {
  const f = await fixture(['different'], ['a'])
  const result = await runReportVerb(f.session)
  expect(result.report.judge).toEqual(f.record.judge)
  expect(renderEvalReportMarkdown(result.report)).not.toContain('judge calibration:')
  expect(reader.read).not.toHaveBeenCalled()
  expect(await runJudgeCalibrateVerb(f.session, { commit: true, replace: true })).toMatchObject({ kind: 'capability-gap', reason: 'panel-not-configured', artifactDisposition: 'not-created' })
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
