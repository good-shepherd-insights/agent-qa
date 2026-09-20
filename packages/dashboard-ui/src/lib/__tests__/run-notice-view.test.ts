import { expect, it } from 'vitest'
import type { RunDetailProjection } from '@vostride/agent-qa-schema'
import { isPreMilestoneRun } from '../run-notice-view'

const unavailable = { state: 'absent', reason: 'unavailable' } as const
function historical(): RunDetailProjection {
  return {
    runId: 'historical',
    members: [0, 1].map(testIndex => ({ testIndex, name: 'Checkout', attempts: 1, recording: { ...unavailable } })),
    steps: [0, 1].flatMap(testIndex => [0, 1].map(stepIndex => ({
      testIndex, stepIndex, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' },
      selfHealOccurred: false, briefDigest: '', evidence: {
        variables: { kind: 'variables', ...unavailable }, network: { kind: 'network', ...unavailable },
        console: { kind: 'console', ...unavailable }, a11y: { kind: 'a11y', ...unavailable },
      },
    }))),
    subActions: [0, 1].map(testIndex => ({
      testIndex, stepIndex: 1, subActionIndex: 0, plan: 'Wait', plannedAction: { type: 'delay', ms: 1 },
      screenStateHash: 'a'.repeat(64), result: { success: true }, ariaEvidence: { kind: 'aria', ...unavailable },
    })),
    tokens: { measuredSteps: 0, unmeasuredSteps: 4 },
  }
}

it('NOTICE-PRE-MILESTONE-SHOWN requires all normalized entries and at least one step', () => {
  expect(isPreMilestoneRun(historical())).toBe(true)
  const noSteps = historical()
  noSteps.steps = []
  expect(isPreMilestoneRun(noSteps)).toBe(false)
  const missing = historical()
  missing.steps[1]!.evidence = undefined
  expect(isPreMilestoneRun(missing)).toBe(false)
  const missingRecording = historical()
  missingRecording.members[1]!.recording = undefined
  expect(isPreMilestoneRun(missingRecording)).toBe(false)
  const missingAria = historical()
  missingAria.subActions[1]!.ariaEvidence = undefined
  expect(isPreMilestoneRun(missingAria)).toBe(false)
})

it('NOTICE-HIDDEN-WHEN-ANY-RECORDED checks all kinds, steps, sub-actions and members', () => {
  expect(isPreMilestoneRun(historical())).toBe(true)
  for (const state of ['present', 'empty', 'not-captured', 'unsupported', 'failed']) {
    for (const kind of ['variables', 'network', 'console', 'a11y', 'aria', 'video']) {
      const detail = historical()
      const entry = kind === 'video' ? detail.members[1]!.recording!
        : kind === 'aria' ? detail.subActions[1]!.ariaEvidence! : detail.steps[3]!.evidence![kind as 'variables']
      Object.assign(entry, state === 'present' ? { state: 'present' } : { reason: state })
      expect(isPreMilestoneRun(detail), `${kind}:${state}`).toBe(false)
    }
  }
})

it('NOTICE-HIDDEN-FOR-BYTES-GONE never labels missing bytes as never recorded', () => {
  expect(isPreMilestoneRun(historical())).toBe(true)
  for (const kind of ['variables', 'network', 'console', 'a11y', 'aria', 'video']) {
    const detail = historical()
    const entry = kind === 'video' ? detail.members[1]!.recording!
      : kind === 'aria' ? detail.subActions[1]!.ariaEvidence! : detail.steps[3]!.evidence![kind as 'variables']
    Object.assign(entry, { evidenceIncomplete: true })
    expect(isPreMilestoneRun(detail), kind).toBe(false)
  }
})
