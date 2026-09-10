import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEvalReport, type EvalBatchReport } from '@vostride/agent-qa-eval'
import { readFileSync } from 'node:fs'
import { createEvalCommand } from '../commands/eval.js'
import { renderEvalReportMarkdown } from '../eval-report-render.js'
import * as verbs from '../eval-session-composition.js'

afterEach(() => { process.exitCode = 0; vi.restoreAllMocks() })
const oldReport = () => JSON.parse(readFileSync(new URL('./fixtures/pre-420-report/report.json', import.meta.url), 'utf8')) as EvalBatchReport

function measured() {
  const report = buildEvalReport([])
  report.headline.verifierFalsePassRate = { numerator: 2, denominator: 5, rate: 0.123 }
  report.calibration = { status: 'calibrated', n_gold: 23,
    verifierFalsePassRate: { numerator: 3, denominator: 23, rate: 0.456 } }
  report.recovery = { ...report.recovery, recoveredPositiveCount: 2, eligiblePositiveCount: 7,
    recoveryAccuracy: 0.234, weightedAccuracy: 0.345, weightSum: 7.5, pairsWithoutWeight: 3 }
  const cells = [report.perSplit.natural, report.perSplit['held-out'].shared,
    report.perSplit['held-out'].private, report.perSplit.adversarial]
  for (const [index, cell] of cells.entries()) {
    cell.firstAttemptDecisionAccuracy = { numerator: index, denominator: 9, rate: 0.111 + index }
    cell.verifierFalsePassRate = { numerator: index, denominator: 8, rate: 0.222 + index }
    cell.recovery = { ...report.recovery, weightSum: 3.5 + index }
    cell.perDecisionCost = { decisionCount: 9, promptTokens: 123.5 + index,
      completionTokens: 234.5 + index, totalTokens: 345.5 + index, durationMs: 456.5 + index }
  }
  return report
}
const disclosure = [
  'verifierFalsePassRate: 2/5 (rate: 0.123)',
  'calibration.status: calibrated', 'calibration.n_gold: 23',
  'calibration.verifierFalsePassRate: 3/23 (rate: 0.456)',
  'recovery.recoveryAccuracy: 2/7 (rate: 0.234)',
  'recovery.weightedAccuracy: 0.345 (weightSum: 7.5)', 'recovery.pairsWithoutWeight: 3',
]
function checkMeasured(text: string) {
  for (const line of disclosure) expect(text).toContain(line)
  for (const [index, name] of ['natural', 'held-out.shared', 'held-out.private', 'adversarial'].entries()) {
    const prefix = `perSplit.${name}`
    expect(text).toContain(`${prefix}.firstAttemptDecisionAccuracy: ${index}/9 (rate: ${0.111 + index})`)
    expect(text).toContain(`${prefix}.verifierFalsePassRate: ${index}/8 (rate: ${0.222 + index})`)
    expect(text).toContain(`${prefix}.recovery.weightedAccuracy: 0.345 (weightSum: ${3.5 + index})`)
    expect(text).toContain(`${prefix}.perDecisionCost: decisionCount=9 promptTokens=${123.5 + index} completionTokens=${234.5 + index} totalTokens=${345.5 + index} durationMs=${456.5 + index}`)
  }
}

describe('420 label report projections', () => {
  it('copies measured metrics and all four splits without recalculating rates or costs', () => {
    const report = measured(), before = JSON.stringify(report)
    const markdown = renderEvalReportMarkdown(report)
    checkMeasured(markdown)
    expect(renderEvalReportMarkdown(report)).toBe(markdown)
    expect(JSON.stringify(report)).toBe(before)
  })
  it('distinguishes valid zero, empty denominators and absent historical fields', () => {
    const empty = buildEvalReport([])
    empty.headline.verifierFalsePassRate = { numerator: 0, denominator: 5, rate: 0 }
    const text = renderEvalReportMarkdown(empty)
    expect(text).toContain('verifierFalsePassRate: 0/5 (rate: 0)')
    expect(text).toContain('perSplit.natural.verifierFalsePassRate: 0/0 (rate: unavailable (zero denominator))')
    expect(text).toContain('recovery.weightedAccuracy: unavailable (zero weightSum) (weightSum: 0)')
    expect(text).toContain('recovery.pairsWithoutWeight: 0')
    const legacy = renderEvalReportMarkdown(oldReport())
    expect(legacy).toContain('verifierFalsePassRate: unavailable (not supplied)')
    expect(legacy).toContain('recovery.pairsWithoutWeight: unavailable (not supplied)')
    for (const split of ['natural', 'held-out.shared', 'held-out.private', 'adversarial']) {
      expect(legacy).toContain(`perSplit.${split}.firstAttemptDecisionAccuracy: unavailable (not supplied)`)
    }
    expect(legacy).not.toContain('weightSum: 0')
  })
  it.each(['measured', 'empty', 'legacy'] as const)('actual console and JSON routes preserve %s DTO disclosure', async kind => {
    const report = kind === 'measured' ? measured() : kind === 'empty' ? buildEvalReport([]) : oldReport()
    vi.spyOn(verbs, 'resolveEvalSession').mockResolvedValue({} as verbs.EvalSession)
    const dto: verbs.ReportVerbResult = { report, batchKey: report.batchKey, entries: 0,
      judgeIdentity: 'absent', source: 'committed', notices: [] }
    vi.spyOn(verbs, 'runReportVerb').mockResolvedValue(dto)
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')) })
    const program = () => new Command().addCommand(createEvalCommand())
    await program().parseAsync(['eval', 'report'], { from: 'user' })
    const text = lines.join('\n')
    if (kind === 'measured') checkMeasured(text)
    else expect(text).toContain(kind === 'empty'
      ? 'verifierFalsePassRate: 0/0 (rate: unavailable (zero denominator))'
      : 'verifierFalsePassRate: unavailable (not supplied)')
    lines.length = 0
    await program().parseAsync(['eval', 'report', '--json'], { from: 'user' })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toEqual(dto)
    expect(process.exitCode ?? 0).toBe(0)
  })
})
