import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildEvalReport, createPanelIdentity } from '@vostride/agent-qa-eval'
import { FsReportStore, loadStagedReport } from '../report-store.js'
import { FsCommittedRootStore, committedReportPath } from '../committed-root-store.js'
import { listCommittedReports } from '../committed-corpus-source.js'

const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const panel = createPanelIdentity(['claude-sonnet-4-5', 'gemini-2.5-pro'])
const interval = { lower: 0.123456789012345, upper: 0.987654321098765, halfWidth: 0.43209876604321 }
const calibrated = { status: 'calibrated', n: 3, pooledAgreement: 2 / 3, wilson95: interval,
  perMember: panel.members!.map(member => ({ judgeModelId: member.judgeModelId, n: 3,
    agreement: 2 / 3, wilson95: interval })) }

function fixture(reader: 'staged' | 'committed', calibration: unknown, judge = panel) {
  const dir = mkdtempSync(join(tmpdir(), 'calibration-report-')); roots.push(dir)
  const report = buildEvalReport([], structuredClone(judge))
  if (calibration !== undefined) Object.assign(report.judge!, { calibration })
  const bytes = JSON.stringify(report, null, 2) + '\n'
  const file = reader === 'staged' ? new FsReportStore({ root: dir }).save(report).file
    : join(dir, committedReportPath(report.batchKey, 'report.json'))
  if (reader === 'committed') new FsCommittedRootStore({ committedRoot: dir }).writeText(
    committedReportPath(report.batchKey, 'report.json'), bytes)
  const read = () => reader === 'staged' ? loadStagedReport(dir, report.batchKey)
    : (() => { const value = listCommittedReports(dir); return value.refusals.length
      ? { kind: 'refused' } : { kind: 'loaded', report: value.reports[0]?.report } })()
  return { dir, report, bytes, file, read }
}

for (const reader of ['staged', 'committed'] as const) {
  it.each([calibrated, { status: 'uncalibrated', n: 7 },
    { status: 'uncalibrated', n: 0, provenance: 'unavailable' },
    ...['panel-not-configured', 'no-credential', 'single-family-host'].map(reason => ({ status: 'capability-gap', reason })),
  ])(`${reader} preserves copied calibration exactly: %j`, calibration => {
    const f = fixture(reader, calibration)
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    mkdirSync(join(f.dir, 'reports/judge-calibration'), { recursive: true })
    writeFileSync(join(f.dir, 'reports/judge-calibration/newer.json'), '{"status":"calibrated","n":999}')
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    expect(readFileSync(f.file, 'utf8')).toBe(f.bytes)
  })
  it.each([
    { status: 'calibrated' }, { status: 'unknown', n: 0 }, { status: 'uncalibrated', n: -1 },
    { status: 'uncalibrated', n: 0.5 }, { status: 'uncalibrated', n: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'uncalibrated', n: 2, pooledAgreement: 1 }, { status: 'uncalibrated', n: 2, provenance: 'unavailable' },
    { status: 'capability-gap', reason: 'invented' }, { status: 'capability-gap', reason: 'no-credential', n: 0 },
    { ...calibrated, n: 0 }, { ...calibrated, pooledAgreement: 1.1 }, { ...calibrated, pooledAgreement: NaN },
    { ...calibrated, wilson95: { ...interval, lower: 1 } },
    { ...calibrated, wilson95: { ...interval, halfWidth: -1 } },
    { ...calibrated, perMember: [] }, { ...calibrated, perMember: [calibrated.perMember[0], calibrated.perMember[0]] },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, judgeModelId: 'foreign' })) },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, n: -1 })) },
    { ...calibrated, perMember: calibrated.perMember.map(row => ({ ...row, n: 0, agreement: 1 })) },
  ])(`${reader} refuses malformed copied calibration: %j`, calibration => {
    expect(fixture(reader, calibration).read().kind).toBe('refused')
  })
  it(`${reader} refuses calibration on a single judge`, () => {
    expect(fixture(reader, { status: 'uncalibrated', n: 0 }, createPanelIdentity(['claude-sonnet-4-5'])).read().kind).toBe('refused')
  })
  it(`${reader} keeps historical panel-free disclosure unchanged`, () => {
    const f = fixture(reader, undefined)
    expect(f.read()).toMatchObject({ kind: 'loaded', report: f.report })
    expect(readFileSync(f.file, 'utf8')).toBe(f.bytes)
  })
}
