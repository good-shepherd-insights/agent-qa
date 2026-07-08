// D-04 / RESEARCH Open Q1: the per-run SafetyHookRunner is captured lexically at the CLI
// composition root and threaded through the additive `SuiteMemberInput.safetyHooks` field into
// `runTest`'s config (which already carries it into LoopPorts). This pins the passthrough:
// runner's RunConfig/MemberTestRunContext deliberately gain no safety channel.
import { describe, it, expect, vi } from 'vitest'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { TestResult } from '@vostride/agent-qa-runner'

// Capture the config `runTest` receives without running the real loop.
const runTestMock = vi.fn(
  async (): Promise<TestResult> => ({
    name: 't',
    filePath: 't.test.ts',
    status: 'passed',
    steps: [],
    duration: 1,
  }),
)

vi.mock('../../agent/runner.js', () => ({
  runTest: (...args: unknown[]) => runTestMock(...args),
}))

import { executeSuiteMember, type SuiteMemberInput } from '../member.js'

function fakeSafetyHooks(): SafetyHookRunner {
  return {
    runPreToolCall: vi.fn(),
    runPostToolCall: vi.fn(),
  } as unknown as SafetyHookRunner
}

function baseInput(overrides: Partial<SuiteMemberInput> = {}): SuiteMemberInput {
  return {
    suite: { name: 's', tests: [] } as unknown as SuiteMemberInput['suite'],
    test: { name: 't', steps: [] } as unknown as SuiteMemberInput['test'],
    filePath: '/nonexistent/t.yaml',
    index: 0,
    totalTests: 1,
    config: {} as unknown as SuiteMemberInput['config'],
    reporter: undefined,
    suiteRunId: 'suite-run-1',
    suiteHookVars: {},
    suiteSandboxOptions: undefined,
    suiteArtifact: undefined,
    memoryEnabled: false,
    memoryRoot: '/tmp',
    ...overrides,
  }
}

describe('executeSuiteMember — safetyHooks passthrough (D-04/Open-Q1)', () => {
  it('threads input.safetyHooks into the runTest config', async () => {
    runTestMock.mockClear()
    const hooks = fakeSafetyHooks()
    await executeSuiteMember(baseInput({ safetyHooks: hooks }))
    expect(runTestMock).toHaveBeenCalledTimes(1)
    const config = runTestMock.mock.calls[0][1] as { safetyHooks?: SafetyHookRunner }
    expect(config.safetyHooks).toBe(hooks)
  })

  it('leaves runTest config.safetyHooks undefined when the input omits it (byte-identical to runSuite path)', async () => {
    runTestMock.mockClear()
    await executeSuiteMember(baseInput())
    const config = runTestMock.mock.calls[0][1] as { safetyHooks?: SafetyHookRunner }
    expect(config.safetyHooks).toBeUndefined()
  })
})
