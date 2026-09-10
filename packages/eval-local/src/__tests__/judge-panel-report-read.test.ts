import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertBaselineComparator, buildEvalReport, createPanelIdentity } from '@vostride/agent-qa-eval'
import { assembleScoredBatch, projectAssembledBatch } from '../replay-batch-assembly.js'
import { FsReportStore, loadStagedReport } from '../report-store.js'
import { FsCommittedRootStore, committedReportPath } from '../committed-root-store.js'
import { listCommittedReports } from '../committed-corpus-source.js'
import { panelScoreFixture } from './fixtures/panel-score-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function root() { const dir = mkdtempSync(join(tmpdir(), 'panel-report-')); roots.push(dir); return dir }

it('round-trips score through assembly, staged read, committed write and strict committed read', async () => {
  const dir = root()
  const f = await panelScoreFixture(dir)
  const batch = assembleScoredBatch({ ...f, source: 'fixture', expectedJudgeRequest: f.judgeRequest })
  const { report } = projectAssembledBatch(batch, {})
  expect(report.judge).toEqual(f.record.judge)
  const staged = new FsReportStore({ root: dir }).save(report)
  expect(loadStagedReport(dir, report.batchKey)).toMatchObject({ kind: 'loaded', report })
  const bytes = readFileSync(staged.file, 'utf8')
  const committedRoot = join(dir, 'committed')
  const path = committedReportPath(report.batchKey, 'report.json')
  expect(new FsCommittedRootStore({ committedRoot }).writeText(path, bytes)).toEqual({ kind: 'written' })
  const read = listCommittedReports(committedRoot)
  expect(read.refusals).toEqual([])
  expect(read.reports[0]?.report).toEqual(report)
  expect(readFileSync(join(committedRoot, path), 'utf8')).toBe(bytes)
})

it.each(['staged', 'committed'] as const)('independently refuses malformed panel identity in %s reader', reader => {
  for (const change of ['size', 'duplicate', 'family', 'order', 'override', 'version', 'missing-members']) {
    const dir = root()
    const report = buildEvalReport([], createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro']))
    if (change === 'size') report.judge!.panelSize = 3
    if (change === 'duplicate') report.judge!.members = [report.judge!.members![0], report.judge!.members![0]]
    if (change === 'family') report.judge!.judgeFamily = 'forged'
    if (change === 'order') report.judge!.members = [...report.judge!.members!].reverse()
    if (change === 'override') report.judge!.familyOverride = 'same-family-allowed'
    if (change === 'version') report.judge!.judgeVersion = 1
    if (change === 'missing-members') delete report.judge!.members
    if (reader === 'staged') {
      new FsReportStore({ root: dir }).save(report)
      expect(loadStagedReport(dir, report.batchKey).kind, change).toBe('refused')
    } else {
      new FsCommittedRootStore({ committedRoot: dir }).writeText(
        committedReportPath(report.batchKey, 'report.json'), JSON.stringify(report))
      const read = listCommittedReports(dir)
      expect(read.reports, change).toEqual([])
      expect(read.refusals, change).toHaveLength(1)
    }
  }
})

it.each([{ ids: ['claude-sonnet-4-5'] }, { ids: ['claude-sonnet-4-5', 'llama-3.3'] }])('preserves mixed persisted identities: $ids', ({ ids }) => {
  const judge = createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro'])
  const other = createPanelIdentity(ids)
  const { report } = projectAssembledBatch({ entries: [], judgeBlocks: [judge, other],
    partitionsById: new Map(), missingBundleCount: 0, notices: [] }, {})
  expect(report.judge).toBeUndefined()
  expect(report.mixedJudgeModelIds).toEqual([judge.judgeModelId, other.judgeModelId].sort())
  expect(assertBaselineComparator(report)).toMatchObject({ ok: false, refusal: { kind: 'mixed-judge-identity' } })
})

it('compares canonical identity without later copied calibration', () => {
  const judge = createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro'])
  const { report } = projectAssembledBatch({ entries: [], judgeBlocks: [judge,
    Object.assign({}, judge, { calibration: { status: 'uncalibrated' } })],
    partitionsById: new Map(), missingBundleCount: 0, notices: [] }, {})
  expect(report.judge).toEqual(judge)
  expect(report.judgeIdentity).toBeUndefined()
})

it.each([undefined, { judgeModelId: 'claude-sonnet-4-5', judgeFamily: 'claude', judgeVersion: 1,
  confidenceThreshold: 'high' as const }])('keeps historical single/no-judge bytes unchanged', judge => {
  const dir = root(), report = buildEvalReport([], judge)
  const bytes = JSON.stringify(report, null, 2) + '\n'
  const path = committedReportPath(report.batchKey, 'report.json')
  new FsCommittedRootStore({ committedRoot: dir }).writeText(path, bytes)
  expect(listCommittedReports(dir).reports[0]?.report).toEqual(report)
  expect(readFileSync(join(dir, path), 'utf8')).toBe(bytes)
})
