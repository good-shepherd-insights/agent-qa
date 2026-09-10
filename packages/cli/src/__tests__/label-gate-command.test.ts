import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import { afterEach, expect, it, vi } from 'vitest'
import { FsReportStore } from '@vostride/agent-qa-eval-local'
import type { DecisionVectorsDocument, EvalBatchReport } from '@vostride/agent-qa-eval'
import type { ModelProviderOverrides } from '@vostride/agent-qa-model'
import { createEvalCommand } from '../commands/eval.js'
import * as verbs from '../eval-session-composition.js'

// Test-only peer fixture import; production package ownership remains unchanged.
const { labelGateFixture, labelMetricIds, legacyReport, measuredReport, rewriteReport } = await import(
  new URL('../../../eval-local/src/__tests__/fixtures/label-gate-fixtures.js', import.meta.url).href)
const roots: string[] = []
afterEach(() => {
  process.exitCode = 0
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-label-gate-cli-')); roots.push(root)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external provider forbidden'))
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const f = await labelGateFixture(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, ['workspace:', '  testMatch: [tests/**/*.yaml]',
    '  suiteMatch: [suites/**/*.suite.yaml]', '  hooksFile: hooks.yaml', '  envFile: .env',
    '  secretsFile: .env.secrets.local', 'registry:', '  llms:', '    - name: planner',
    '      provider: openai-compatible', `      model: ${f.input.mode.profile.model}`,
    '      baseURL: http://localhost:1/v1', 'use:', '  llm: planner', '  mobile:',
    '    appState: preserve', ''].join('\n'))
  writeFileSync(join(root, '.env.secrets.local'), '')
  const actual = verbs.runGateVerb
  const overrides: ModelProviderOverrides = f.input.mode.modelOverrides
  vi.spyOn(verbs, 'runGateVerb').mockImplementation((session, opts) =>
    actual(session, { ...opts, plannerOverrides: overrides }))
  const logs: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  async function command(args: string[]) {
    logs.length = 0
    await new Command().option('--config <path>').addCommand(createEvalCommand())
      .parseAsync(['--config', configPath, 'eval', 'gate', ...args], { from: 'user' })
    return logs.join('\n')
  }
  return { ...f, configPath, command }
}

it.each([0, 1, 2] as const)('actual saved JSON/text carry all eleven rows at unchanged exit %s', async exit => {
  const f = await fixture()
  const report: EvalBatchReport = structuredClone(f.baseline.report)
  const decisions: DecisionVectorsDocument = structuredClone(f.baseline.decisions)
  measuredReport(report, 0.25)
  rewriteReport(f.baselineFile, (value: EvalBatchReport) => measuredReport(value, 0.5))
  if (exit === 1) for (const vector of decisions.vectors) vector.axes.headline = 'incorrect'
  if (exit === 2) report.honesty.harnessErrorCount = 1
  const saved = new FsReportStore({ root: f.input.agentQaRoot, outputDir: f.stagedOutputDir }).save(report, decisions)
  const before = readFileSync(saved.file, 'utf8')
  for (const legacy of [false, true]) {
    if (legacy) rewriteReport(f.baselineFile, legacyReport)
    const baselineBytes = readFileSync(f.baselineFile, 'utf8')
    const args = ['--report', report.batchKey, '--staged-dir', f.stagedOutputDir]
    const json = JSON.parse(await f.command([...args, '--json'])) as verbs.GateVerbResult
    expect(process.exitCode).toBe(exit)
    if (json.kind !== 'verdict') throw new Error(JSON.stringify(json))
    expect(json.verdict.labelMetrics.rows.map(row => row.metric)).toEqual(labelMetricIds)
    expect(json.modelCalls).toBe(0)
    const text = await f.command(args)
    expect(process.exitCode).toBe(exit)
    for (const row of json.verdict.labelMetrics.rows) {
      const line = text.split('\n').find(line => line.startsWith(`label-metric: ${row.metric} `))!
      expect(line).toBeDefined()
      expect(JSON.parse(line.slice(`label-metric: ${row.metric} `.length))).toEqual(row)
    }
    expect(text).toContain('label-calibration: ')
    const falsePass = json.verdict.labelMetrics.rows[0]!
    expect(falsePass).toMatchObject(legacy ? { status: 'not-comparable', reasons: expect.arrayContaining([
      expect.objectContaining({ side: 'baseline', reason: 'missing-field' })]) } : { status: 'comparable', delta: -0.25 })
    expect(readFileSync(f.baselineFile, 'utf8')).toBe(baselineBytes)
  }
  expect(readFileSync(saved.file, 'utf8')).toBe(before)
  expect(f.stub.captured).toHaveLength(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('actual fresh and default saved commands disclose identical values and saved mode spends zero', async () => {
  const f = await fixture()
  const fresh = JSON.parse(await f.command(['--json'])) as verbs.GateVerbResult
  expect(process.exitCode).toBe(0)
  if (fresh.kind !== 'verdict') throw new Error(JSON.stringify(fresh))
  expect(fresh.modelCalls).toBe(3)
  expect(fresh.verdict.labelMetrics.rows.map(row => row.metric)).toEqual(labelMetricIds)
  f.stub.captured.length = 0
  const before = readFileSync(fresh.currentReportFile, 'utf8')
  const saved = JSON.parse(await f.command(['--report', fresh.currentReport.batchKey, '--json'])) as verbs.GateVerbResult
  if (saved.kind !== 'verdict') throw new Error(JSON.stringify(saved))
  expect(saved.verdict).toEqual(fresh.verdict)
  expect(saved.modelCalls).toBe(0)
  expect(f.stub.captured).toHaveLength(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(readFileSync(fresh.currentReportFile, 'utf8')).toBe(before)
})

it('actual JSON/text refuse a foreign profile with exit2 before replay', async () => {
  const f = await fixture()
  rewriteReport(f.pointerFile, (value: Record<string, unknown>) => { value.profileKey = 'foreign' })
  const result = JSON.parse(await f.command(['--json'])) as verbs.GateVerbResult
  expect(result.kind).toBe('refused')
  expect(process.exitCode).toBe(2)
  expect(await f.command([])).toContain('release-gate: refused')
  expect(process.exitCode).toBe(2)
  expect(f.stub.captured).toHaveLength(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it.each(['partial', 'null', 'bad-rate', 'missing-split'])('present %s metadata refuses at the gate root without default fallback', async defect => {
  const f = await fixture()
  const fresh = JSON.parse(await f.command(['--json'])) as verbs.GateVerbResult
  if (fresh.kind !== 'verdict') throw new Error(JSON.stringify(fresh))
  new FsReportStore({ root: f.input.agentQaRoot }).save(f.baseline.report, f.baseline.decisions)
  rewriteReport(fresh.currentReportFile, (report: any) => {
    if (defect === 'partial') delete report.perSplit
    else if (defect === 'null') report.calibration = null
    else if (defect === 'bad-rate') report.headline.verifierFalsePassRate = { numerator: 0, denominator: 2, rate: 5 }
    else delete report.perSplit['held-out'].private
  })
  const before = readFileSync(fresh.currentReportFile, 'utf8')
  f.stub.captured.length = 0
  const result = JSON.parse(await f.command(['--report', fresh.currentReport.batchKey, '--json'])) as verbs.GateVerbResult
  expect(result).toMatchObject({ kind: 'refused', refusal: { path: fresh.currentReportFile,
    reason: expect.stringContaining('metadata') }, probedDirs: [dirname(fresh.currentReportFile)] })
  expect(process.exitCode).toBe(2)
  expect(readFileSync(fresh.currentReportFile, 'utf8')).toBe(before)
  expect(f.stub.captured).toHaveLength(0)
})
