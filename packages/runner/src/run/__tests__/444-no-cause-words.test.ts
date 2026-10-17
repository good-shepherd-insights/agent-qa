// C444-NO-CAUSE-WORDS (444-17, D-51): a cancel can come from the dashboard's Cancel, MCP, Ctrl+C or
// a SIGTERM from CI, so the words a cancelled step or test is left with name no cause.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { LanguageModel } from 'ai'

import { executeStep } from '../../loop/index.js'
import { makeAdapter, makePlanner, makeStepContext } from '../../loop/__tests__/loop-harness.js'
import type { LoopPorts } from '../../loop/ports.js'
import type { StepResult } from '../../result.js'
import { runMemberTest } from '../member-runner.js'
import type { MemberRunConfig } from '../member-runner.js'

const STEP_SENTENCE = 'The run was cancelled before this step finished.'
const TEST_SENTENCE = 'The run was cancelled before this test finished.'

function memberConfig(overrides: Partial<MemberRunConfig>): MemberRunConfig {
  return {
    adapter: makeAdapter(),
    planner: makePlanner(),
    plannerModel: {} as unknown as LanguageModel,
    verifierModel: {} as unknown as LanguageModel,
    sink: {
      stepStarted() {},
      loopEmitFor() {
        return { stepFinalized() {}, subActionRecorded() {} }
      },
      hookStarted() {},
      hookFinished() {},
      testRetryScheduled() {},
    },
    testIndex: 0,
    abortSignal: new AbortController().signal,
    ...overrides,
  } as MemberRunConfig
}

describe('C444-NO-CAUSE-WORDS', () => {
  it("a cancelled step's record and a test's default abort reason carry no \"by user\"", async () => {
    const finalized: Array<{ status: string; error?: string }> = []
    const cancel = new AbortController()
    cancel.abort(new Error('stop'))
    const ports: LoopPorts = {
      adapter: makeAdapter(),
      planner: makePlanner(),
      abortSignal: cancel.signal,
      events: {
        stepFinalized(_evidence, enrich) { finalized.push({ status: enrich.status, error: enrich.error }) },
        subActionRecorded() {},
      },
    } as LoopPorts
    const loopStep = await executeStep('Click Log in', ports, makeStepContext())
    expect(loopStep.status).toBe('cancelled')
    expect(loopStep.error).toBe(STEP_SENTENCE)
    expect(finalized).toEqual([{ status: 'cancelled', error: STEP_SENTENCE }])

    // The member runner's own fallback, reached when an injected step never answers the abort.
    const external = new AbortController()
    let started = false
    const hanging = async (): Promise<StepResult> => {
      started = true
      return new Promise<StepResult>(() => undefined)
    }
    const running = runMemberTest(
      { testId: 't_member', name: 'Member test', filePath: '/tests/member.yaml', steps: ['Click OK'] },
      memberConfig({ executeStep: hanging, abortSignal: external.signal }),
    )
    while (!started) await new Promise((tick) => setTimeout(tick, 1))
    external.abort(new Error('stop'))
    const member = await running
    expect(member.status).toBe('cancelled')
    expect(member.steps.map((step) => [step.status, step.error])).toEqual([['cancelled', STEP_SENTENCE]])

    // A test abort with no reason of its own cannot be produced in Node (abort() always supplies
    // one), so the default reason is read where it is written.
    const source = readFileSync(new URL('../member-runner.ts', import.meta.url), 'utf8')
    expect(source).toContain(`new Error('${TEST_SENTENCE}')`)
    for (const file of ['../member-runner.ts', '../../loop/index.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).not.toMatch(/cancelled\sby\suser/iu)
    }
  })
})
