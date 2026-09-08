import type { CompletedRunHandoff, Mark, MarkAddress, MarkReceipt } from '@vostride/agent-qa-schema'
import type { ExtractedCassette } from '../extract/extract-run'
import { deriveGoldCassetteId, deriveLeafCassetteId, deriveRunSlug } from '../extract/ids'
import { collectStepSelections } from '../extract/select'
import { projectCorpusEntry } from './corpus-entry'
import { projectOverturnedVerdictLabelRecord, projectUserMarkLabelRecord } from './label-record'
import type { SeedingPlanCase } from './seeding-plan'

export type GoldenTrajectoryTarget = {
  testIndex: number
  stepIndex: number
  reason: 'step-mark' | 'failing-step' | 'passing-verdict'
}

/** 2026-09-08, 419 D-05: resolve one addressed member, never a whole trace. */
export function resolveMarkedDecisions(
  handoff: CompletedRunHandoff, address: MarkAddress, kind: Mark,
): GoldenTrajectoryTarget[] | { refusal: 'step-not-found'; stepCount: number } {
  if (address.runId !== handoff.runId) throw new Error('mark run does not match handoff')
  const members = handoff.tests.filter(member => member.testIndex === address.testIndex)
  const member = members[0]
  if (members.length !== 1 || member === undefined ||
    (address.testId !== undefined && address.testId !== member.testId)) {
    throw new Error('mark member does not match handoff')
  }
  if (address.stepIndex !== undefined) {
    if (!Number.isInteger(address.stepIndex) || address.stepIndex < 0 || address.stepIndex >= member.steps.length) {
      return { refusal: 'step-not-found', stepCount: member.steps.length }
    }
    return [{ testIndex: member.testIndex, stepIndex: address.stepIndex, reason: 'step-mark' }]
  }
  if (member.steps.length === 0) return { refusal: 'step-not-found', stepCount: 0 }
  const failing = kind === 'false-pass' ? -1 : member.steps.findIndex(step => step.verifierVerdict?.pass === false)
  return [{
    testIndex: member.testIndex,
    stepIndex: failing < 0 ? member.steps.length - 1 : failing,
    reason: failing < 0 ? 'passing-verdict' : 'failing-step',
  }]
}

export interface GoldenTrajectoryPlan {
  product: string
  runId: string
  runSlug: string
  markId: string
  cases: SeedingPlanCase[]
  goldCassettes: ExtractedCassette[]
  skipped: { cassetteId: string; reason: 'missing-cassette' | 'not-leaf' }[]
}

export interface BuildGoldenTrajectoryPlanInput {
  handoff: CompletedRunHandoff
  cassettes: readonly ExtractedCassette[]
  mark: MarkReceipt
  product: string
  supersedes?: string
}

/** Pure freeze plan. The writer executes these private assignments and observed bytes verbatim. */
export function buildGoldenTrajectoryPlan({
  handoff, cassettes, mark, product, supersedes,
}: BuildGoldenTrajectoryPlanInput): GoldenTrajectoryPlan {
  const targets = resolveMarkedDecisions(handoff, mark, mark.kind)
  if ('refusal' in targets) throw new Error(`step-not-found: stepCount=${targets.stepCount}`)
  const runSlug = deriveRunSlug(handoff.runId)
  const plan: GoldenTrajectoryPlan = {
    product, runId: handoff.runId, runSlug, markId: mark.markId,
    cases: [], goldCassettes: [], skipped: [],
  }
  for (const target of targets) {
    const handoffTest = handoff.tests.find(member => member.testIndex === target.testIndex)!
    const step = handoffTest.steps[target.stepIndex]!
    const { selections } = collectStepSelections({ handoffTest, step })
    for (const selection of selections) {
      const leafId = deriveLeafCassetteId({ runSlug, ...selection })
      const matches = cassettes.filter(entry => entry.cassette.id === leafId)
      if (matches.length > 1) throw new Error('duplicate extracted gold source')
      const extracted = matches[0]
      if (extracted === undefined || extracted.cassette.granularity !== 'leaf') {
        plan.skipped.push({ cassetteId: leafId, reason: extracted === undefined ? 'missing-cassette' : 'not-leaf' })
        continue
      }
      const cassette = extracted.cassette
      if (cassette.runId !== handoff.runId || cassette.testIndex !== target.testIndex || cassette.stepIndex !== step.stepIndex) {
        throw new Error('gold source does not match marked decision')
      }
      for (const overturned of mark.kind === 'false-pass' ? [false, true] : [false]) {
        const goldId = deriveGoldCassetteId({ leafCassetteId: overturned ? `${leafId}-overturned` : leafId, markOrdinal: mark.ordinal })
        const gold = { ...cassette, id: goldId }
        const input = { cassette, runId: handoff.runId, goldCassetteId: goldId, mark, supersedes }
        plan.cases.push({
          cassetteId: goldId,
          labelRecord: overturned ? projectOverturnedVerdictLabelRecord(input) : projectUserMarkLabelRecord(input),
          corpusEntry: projectCorpusEntry({ cassette: gold, product, runId: handoff.runId,
            assignment: { split: 'held-out', heldOutVisibility: 'private' } }),
        })
        plan.goldCassettes.push({ ...extracted, cassette: gold })
      }
    }
  }
  plan.cases.sort((a, b) => a.cassetteId < b.cassetteId ? -1 : a.cassetteId > b.cassetteId ? 1 : 0)
  plan.goldCassettes.sort((a, b) => a.cassette.id < b.cassette.id ? -1 : a.cassette.id > b.cassette.id ? 1 : 0)
  plan.skipped.sort((a, b) => a.cassetteId < b.cassetteId ? -1 : a.cassetteId > b.cassetteId ? 1 : 0)
  return plan
}
