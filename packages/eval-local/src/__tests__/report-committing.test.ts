import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildEvalReport, committedFileText, projectDecisionVectorsDocument } from '@vostride/agent-qa-eval'
import type { DecisionVectorsDocument, EvalBatchReport } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  COMMITTED_REPORTS_DIR,
  FsCommittedRootStore,
  committedReportPath,
} from '../committed-root-store.js'
import {
  COMMITTED_REPORT_JSON_FILE,
  COMMITTED_REPORT_DECISIONS_FILE,
  COMMITTED_REPORT_MARKDOWN_FILE,
  REPORT_EGRESS_CHANNEL,
  commitEvalReport,
} from '../report-committing.js'
import type { CommitEvalReportOutcome } from '../report-committing.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const MARKDOWN = '# Eval baseline report\n\nfirstAttemptDecisionAccuracy: 0/0\n'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

describe('commitEvalReport (D-13, BASE-02)', () => {
  let root: string
  let outDir: string
  let report: EvalBatchReport

  function commit(overrides: {
    report?: EvalBatchReport
    markdown?: string
    decisions?: DecisionVectorsDocument
  } = {}): CommitEvalReportOutcome {
    return commitEvalReport({
      report: overrides.report ?? report,
      markdown: overrides.markdown ?? MARKDOWN,
      ...(overrides.decisions === undefined ? {} : { decisions: overrides.decisions }),
      committedRoot: root,
      reportOutputBaseDir: outDir,
      policy,
    })
  }

  function reportFilePaths(batchKey: string): { json: string; markdown: string } {
    return {
      json: join(root, committedReportPath(batchKey, COMMITTED_REPORT_JSON_FILE)),
      markdown: join(root, committedReportPath(batchKey, COMMITTED_REPORT_MARKDOWN_FILE)),
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-report-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-report-out-'))
    report = buildEvalReport([])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('commits report.json + report.md under reports/<slug(batchKey)>/ (happy path)', () => {
    const outcome = commit()

    expect(outcome.kind).toBe('committed')
    if (outcome.kind !== 'committed') throw new Error('expected committed outcome')
    expect(outcome.json).toBe('written')
    expect(outcome.markdown).toBe('written')
    expect(outcome).not.toHaveProperty('decisions')
    expect(existsSync(join(root, committedReportPath(report.batchKey, 'decisions.json')))).toBe(false)

    const paths = reportFilePaths(report.batchKey)
    expect(existsSync(paths.json)).toBe(true)
    expect(existsSync(paths.markdown)).toBe(true)
    expect(outcome.reportDir).toBe(
      join(root, COMMITTED_REPORTS_DIR, slugBranch(report.batchKey)),
    )
    expect(readFileSync(paths.json, 'utf8')).toBe(committedFileText(report))
    expect(readFileSync(paths.markdown, 'utf8')).toBe(MARKDOWN)
  })

  it('re-committing the byte-identical report is an idempotent no-op (D-17)', () => {
    commit()
    const paths = reportFilePaths(report.batchKey)
    const jsonBefore = readFileSync(paths.json)
    const markdownBefore = readFileSync(paths.markdown)

    const second = commit()

    expect(second.kind).toBe('committed')
    if (second.kind !== 'committed') throw new Error('expected committed outcome')
    expect(second.json).toBe('unchanged')
    expect(second.markdown).toBe('unchanged')
    expect(readFileSync(paths.json).equals(jsonBefore)).toBe(true)
    expect(readFileSync(paths.markdown).equals(markdownBefore)).toBe(true)
  })

  it('refuses divergent bytes at the same batchKey atomically — nothing modified (D-17)', () => {
    // Pre-seed ONLY the markdown at the report path with different bytes: the conflict on one
    // part must leave even the absent, non-conflicting part unwritten (preview-before-write).
    const store = new FsCommittedRootStore({ committedRoot: root })
    const markdownRel = committedReportPath(report.batchKey, COMMITTED_REPORT_MARKDOWN_FILE)
    store.writeText(markdownRel, '# a different report body\n')

    const outcome = commit()

    expect(outcome).toEqual({ kind: 'write-conflict', path: markdownRel })
    const paths = reportFilePaths(report.batchKey)
    expect(existsSync(paths.json)).toBe(false)
    expect(readFileSync(paths.markdown, 'utf8')).toBe('# a different report body\n')
  })

  it('refuses the WHOLE report on a guardrail detection — typed, audited, nothing lands', async () => {
    const outcome = commit({ markdown: `# leaky report\n\nkey: ${AWS_KEY}\n` })

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected egress-blocked outcome')
    expect(
      outcome.detections.some(
        (detection) =>
          detection.detector === 'awsKey' &&
          detection.label === `report-markdown:${report.batchKey}`,
      ),
    ).toBe(true)

    // Atomicity: neither part landed — JSON and markdown are one checkpoint unit.
    const paths = reportFilePaths(report.batchKey)
    expect(existsSync(paths.json)).toBe(false)
    expect(existsSync(paths.markdown)).toBe(false)

    // The audit row landed under the report output base dir BEFORE the block surfaced.
    const auditRaw = await readFile(join(outDir, 'guardrail_audit.jsonl'), 'utf8')
    const rows = auditRaw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { channel: string; detector: string; action: string })
    expect(REPORT_EGRESS_CHANNEL).toBe('eval-report')
    expect(
      rows.some(
        (row) =>
          row.channel === `${REPORT_EGRESS_CHANNEL}:report-markdown:${report.batchKey}` &&
          row.detector === 'awsKey' &&
          row.action === 'block',
      ),
    ).toBe(true)
  })

  function decisions(): DecisionVectorsDocument {
    return projectDecisionVectorsDocument({
      batchKey: report.batchKey, matcherVersion: report.matcherVersion, vectors: [],
    })
  }

  it('commits decisions as a write-once third part beside unchanged report bytes', () => {
    expect(COMMITTED_REPORT_DECISIONS_FILE).toBe('decisions.json')
    const document = decisions()
    expect(commit({ decisions: document })).toMatchObject({
      kind: 'committed', json: 'written', markdown: 'written', decisions: 'written',
    })
    const path = join(root, committedReportPath(report.batchKey, COMMITTED_REPORT_DECISIONS_FILE))
    expect(readFileSync(path, 'utf8')).toBe(committedFileText(document))
    const paths = reportFilePaths(report.batchKey)
    expect(readFileSync(paths.json, 'utf8')).toBe(committedFileText(report))
    expect(readFileSync(paths.markdown, 'utf8')).toBe(MARKDOWN)
    expect(commit({ decisions: document })).toMatchObject({
      kind: 'committed', json: 'unchanged', markdown: 'unchanged', decisions: 'unchanged',
    })
    expect(commit()).not.toHaveProperty('decisions')
    expect(readFileSync(path, 'utf8')).toBe(committedFileText(document))
  })

  it('a conflicting decisions part refuses the whole preview set without any other write', () => {
    const path = committedReportPath(report.batchKey, COMMITTED_REPORT_DECISIONS_FILE)
    const oldBytes = 'previous decisions\n'
    new FsCommittedRootStore({ committedRoot: root }).writeText(path, oldBytes)
    expect(commit({ decisions: decisions() })).toEqual({ kind: 'write-conflict', path })
    const paths = reportFilePaths(report.batchKey)
    expect(existsSync(paths.json)).toBe(false)
    expect(existsSync(paths.markdown)).toBe(false)
    expect(readFileSync(join(root, path), 'utf8')).toBe(oldBytes)
  })

  it('a planted secret in decisions blocks all three parts on eval-report', () => {
    const document = decisions()
    document.vectors = [{
      key: `${AWS_KEY}#-#0`, cassetteId: AWS_KEY, decisionOrdinal: 0,
      product: 'fixture', briefSource: 'proof',
      axes: {
        headline: 'correct', elementIdentity: 'correct', value: 'not-applicable',
        opClass: 'correct', sideEffect: 'correct', loop: 'not-applicable',
      },
    }]
    expect(commit({ decisions: document })).toEqual({
      kind: 'egress-blocked',
      detections: [{ label: `report-decisions:${report.batchKey}`, detector: 'awsKey' }],
    })
    expect(existsSync(join(root, 'reports'))).toBe(false)
    const rows = readFileSync(join(outDir, 'guardrail_audit.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toContainEqual(expect.objectContaining({
      channel: `${REPORT_EGRESS_CHANNEL}:report-decisions:${report.batchKey}`,
      detector: 'awsKey', action: 'block',
    }))
  })

  it.each(['batchKey', 'matcherVersion'] as const)(
    'rejects a foreign decisions %s as a caller bug before any output', field => {
      const document = decisions()
      if (field === 'batchKey') document.batchKey = 'foreign'
      else document.matcherVersion += 1
      expect(() => commit({ decisions: document })).toThrow(TypeError)
      expect(existsSync(join(root, 'reports'))).toBe(false)
      expect(existsSync(join(outDir, 'guardrail_audit.jsonl'))).toBe(false)
    },
  )
})
