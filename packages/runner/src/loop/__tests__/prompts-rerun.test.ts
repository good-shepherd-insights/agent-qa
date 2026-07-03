// New for 353-03: the D-13 re-run context block (LOOP-03 planner visibility).
// The re-run flag surfaces to the planner as prompt context; when absent the prompt
// output is byte-identical to v1 (no empty re-run block leaks).
import { describe, it, expect } from 'vitest'
import { buildStepPrompt } from '../prompts.js'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '../types.js'
import { buildAgentScreenState } from './screen-fixtures.js'

function makeScreenState(): ScreenState {
  return buildAgentScreenState({
    tree: '- button "Submit" [ref=e1]',
    elements: [{ ref: 'e1', role: 'button', name: 'Submit', attributes: {} }],
    timestamp: 0,
    metadata: { coordSpace: 'viewport', viewportWidth: 0, viewportHeight: 0 },
  })
}

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    stepInstruction: 'click submit',
    testName: 'checkout test',
    previousSteps: [],
    plannerModel: {} as any,
    verifierModel: {} as any,
    ...overrides,
  }
}

describe('D-13 re-run context block (LOOP-03)', () => {
  const screenState = makeScreenState()

  it('renders the re-run attempt number and failure summary when isRerun is true', () => {
    const ctx = makeContext({
      isRerun: true,
      rerunAttempt: 2,
      previousFailureSummary: 'step 4 timed out waiting for the confirmation toast',
    })
    const result = buildStepPrompt('click submit', screenState, ctx)

    expect(result).toContain('re-run attempt 2')
    expect(result).toContain('step 4 timed out waiting for the confirmation toast')
  })

  it('renders the attempt banner even without a failure summary', () => {
    const ctx = makeContext({ isRerun: true, rerunAttempt: 3 })
    const result = buildStepPrompt('click submit', screenState, ctx)

    expect(result).toContain('re-run attempt 3')
    expect(result).toContain('A previous attempt of this test failed')
  })

  it('produces output identical to v1 when isRerun is absent (no re-run wording leaks)', () => {
    const baseline = makeContext()
    const withAbsentRerunFields = makeContext({
      isRerun: false,
      rerunAttempt: undefined,
      previousFailureSummary: undefined,
    })

    const baselinePrompt = buildStepPrompt('click submit', screenState, baseline)
    const absentPrompt = buildStepPrompt('click submit', screenState, withAbsentRerunFields)

    expect(absentPrompt).toBe(baselinePrompt)
    expect(absentPrompt).not.toContain('re-run attempt')
    expect(absentPrompt).not.toContain('RE-RUN CONTEXT')
  })
})
