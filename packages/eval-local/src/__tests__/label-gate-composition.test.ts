import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runReleaseGate } from '../release-gate-composition.js'
import { FsReportStore } from '../report-store.js'
import { labelGateFixture, labelMetricIds, legacyReport, measuredReport, rewriteReport } from './fixtures/label-gate-fixtures.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-label-gate-')); roots.push(root)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external provider forbidden'))
  return labelGateFixture(root)
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function saved(f: Fixture, stagedOutputDir = f.stagedOutputDir) {
  return { ...f.input, mode: { kind: 'report' as const, profile: f.input.mode.profile,
    modelOverrides: f.input.mode.modelOverrides, batchKey: f.pointer.batchKey, stagedOutputDir } }
}

it.each(['pointer-body', 'pointer-fields', 'baseline-identity'] as const)('refuses foreign %s before replay or staging', async defect => {
  const f = await fixture()
  rewriteReport(defect === 'baseline-identity' ? f.baselineFile : f.pointerFile, value => {
    if (defect === 'pointer-body') value.profileKey = 'foreign'
    else if (defect === 'pointer-fields') value.plannerModelId = 'foreign'
    else value.runIdentity.fingerprint = 'a'.repeat(64)
  })
  const result = await runReleaseGate(f.input)
  expect(result.kind).toBe('refused')
  expect(result).toMatchObject({ refusal: { reason: expect.stringContaining('profile') } })
  expect(f.stub.captured).toHaveLength(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(existsSync(join(f.input.agentQaRoot, 'eval', 'gate'))).toBe(false)
})

it('fresh and saved gates carry identical eleven-row disclosure and saved mode changes no bytes or calls', async () => {
  const f = await fixture()
  const baselineBefore = readFileSync(f.baselineFile, 'utf8')
  const fresh = await runReleaseGate(f.input)
  if (fresh.kind !== 'verdict') throw new Error(JSON.stringify(fresh))
  expect(fresh.verdict.labelMetrics.rows.map(row => row.metric)).toEqual(labelMetricIds)
  const reportBefore = readFileSync(fresh.currentReportFile, 'utf8')
  f.stub.captured.length = 0
  const offline = await runReleaseGate(saved(f, dirname(fresh.currentReportFile)))
  if (offline.kind !== 'verdict') throw new Error(JSON.stringify(offline))
  expect(offline.verdict).toEqual(fresh.verdict)
  expect(offline.lines).toEqual(fresh.lines)
  expect(offline.modelCalls).toBe(0)
  expect(f.stub.captured).toHaveLength(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(readFileSync(f.baselineFile, 'utf8')).toBe(baselineBefore)
  expect(readFileSync(fresh.currentReportFile, 'utf8')).toBe(reportBefore)
})

it('compares numeric same-profile saved metrics and preserves available pre-420 rows', async () => {
  const f = await fixture()
  rewriteReport(f.baselineFile, report => measuredReport(report, 0.5))
  const currentReport = structuredClone(f.baseline.report)
  measuredReport(currentReport, 0.25)
  new FsReportStore({ root: f.input.agentQaRoot, outputDir: f.stagedOutputDir })
    .save(currentReport, f.baseline.decisions)
  const numeric = await runReleaseGate(saved(f))
  if (numeric.kind !== 'verdict') throw new Error(JSON.stringify(numeric))
  expect(numeric.verdict.exit).toBe(0)
  expect(numeric.verdict.labelMetrics.rows.every(row => row.status === 'comparable')).toBe(true)
  for (const row of numeric.verdict.labelMetrics.rows.filter(row => row.unit === 'ratio')) {
    expect(row).toMatchObject({ delta: -0.25, baseline: { rate: 0.5 }, current: { rate: 0.25 } })
  }
  rewriteReport(f.baselineFile, legacyReport)
  const before = readFileSync(f.baselineFile, 'utf8')
  const legacy = await runReleaseGate(saved(f))
  if (legacy.kind !== 'verdict') throw new Error(JSON.stringify(legacy))
  expect(legacy.verdict.exit).toBe(0)
  expect(legacy.verdict.labelMetrics.rows.filter(row => row.status === 'not-comparable').map(row => row.metric))
    .toEqual(['verifierFalsePassRate', 'recovery.weighted', ...labelMetricIds.slice(7)])
  expect(legacy.verdict.labelMetrics.calibration.baseline).toEqual({ status: 'not-available', reason: 'missing-field' })
  expect(readFileSync(f.baselineFile, 'utf8')).toBe(before)
  expect(f.stub.captured).toHaveLength(0)
})

it.each(['baseline', 'saved'] as const)('does not treat malformed present %s metadata as legacy absence', async side => {
  const f = await fixture()
  rewriteReport(side === 'baseline' ? f.baselineFile : f.baseline.file, value => { delete value.perSplit })
  const result = await runReleaseGate(saved(f))
  if (side === 'saved') expect(result).toMatchObject({ kind: 'refused', refusal: {
    reason: expect.stringContaining('metadata') } })
  else {
    if (result.kind !== 'verdict') throw new Error(JSON.stringify(result))
    expect(result.verdict.exit).toBe(2)
    expect(result.refusals.some(refusal => refusal.reason.includes('metadata'))).toBe(true)
    expect(result.verdict.labelMetrics.rows.every(row => row.status === 'not-comparable')).toBe(true)
  }
  expect(f.stub.captured).toHaveLength(0)
})
