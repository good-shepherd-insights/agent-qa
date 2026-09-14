import { expect, test, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import { createStepModelScope, withStepModelCall } from '../step-model-observations.js'
import type { StepModelCallEvent, StepModelCallReport, StepModelObservation, StepModelScopeKey,
  StepModelScopeFactory } from '../ports.js'
import { runMemberTest, type MemberRunConfig } from '../member-runner.js'
import { fakeModel, makeAdapter, makePlanner } from '../../loop/__tests__/loop-harness.js'

function fixture(testIndex = 3, stepIndex = 2) {
  const observers = new Map<LanguageModel, StepModelObservation>()
  const bind = (observation: StepModelObservation): LanguageModel => {
    const model = { modelId: 'requested-alias' } as Exclude<LanguageModel, string>
    observers.set(model, observation)
    return model
  }
  const scope = createStepModelScope({
    key: { runId: 'synthetic-run-423' as StepModelScopeKey['runId'], testIndex, stepIndex },
    models: { planner: { model: fakeModel as Exclude<LanguageModel, string>, bind },
      verifier: { model: fakeModel as Exclude<LanguageModel, string>, bind } },
    profiles: { planner: { provider: 'synthetic', modelId: 'requested-alias' },
      verifier: { provider: 'synthetic-judge', modelId: 'judge-alias' } },
    mask: text => text.replaceAll('sensitive-model', '[secret]'),
    createConsumers: () => ({ planner: makePlanner() }),
  })
  const emit = (model: LanguageModel, event: StepModelCallEvent) => observers.get(model)!.onCall(event)
  const dispatch = (model: LanguageModel, report: StepModelCallReport) => withStepModelCall(model, async bound => {
    emit(bound, { kind: 'start' })
    emit(bound, { kind: 'success', report })
    return 'unchanged'
  })
  return { scope, emit, dispatch, observers }
}
const report = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 40, respondingModelId: 'raw-model' }

test('USAGE-ALL-CALLS: each invocation and retry contributes once to the inclusive population', async () => {
  const f = fixture()
  for (const model of [f.scope.plannerModel, f.scope.verifierModel, f.scope.verifierModel]) {
    expect((await f.dispatch(model, report)).result).toBe('unchanged')
  }
  await withStepModelCall(f.scope.plannerModel, async model => {
    for (let i = 0; i < 2; i++) {
      f.emit(model, { kind: 'start' })
      f.emit(model, { kind: 'success', report })
    }
  })
  expect(f.scope.finish()).toMatchObject({ started: 5, succeeded: 5, failed: 0,
    inputTokens: 500, outputTokens: 50, cachedInputTokens: 200,
    roles: { planner: { respondingModelIds: ['raw-model'] }, verifier: { respondingModelIds: ['raw-model'] } },
  })
  expect(f.scope.snapshot().attempts.map(item => item.invocation)).toEqual([0, 1, 2, 3, 3])
})

test('MIXED-COVERAGE: one missing report removes cache coverage without manufacturing a zero', async () => {
  const f = fixture()
  await f.dispatch(f.scope.plannerModel, report)
  expect(f.scope.snapshot().cachedInputTokens).toBe(40)
  await f.dispatch(f.scope.verifierModel, { inputTokens: 20, outputTokens: 3 })
  expect(f.scope.finish()).toMatchObject({ started: 2, inputTokens: 120, outputTokens: 13 })
  expect(f.scope.snapshot()).not.toHaveProperty('cachedInputTokens')
})

test('ZERO-CALL: no dispatch and pre-dispatch refusal have no usage or responding identity', async () => {
  const f = fixture()
  const refusal = new Error('synthetic pre-dispatch refusal')
  await expect(withStepModelCall(f.scope.plannerModel, async () => { throw refusal })).rejects.toBe(refusal)
  const facts = f.scope.finish()
  expect(facts).toMatchObject({ started: 0, succeeded: 0, failed: 0 })
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens']) expect(facts).not.toHaveProperty(key)
  expect(facts.roles.planner.respondingModelIds).toEqual([])
})

test('USAGE-CONCURRENT: interleaved steps and same-role overlap retain invocation identity', async () => {
  const a = fixture(1, 0)
  const b = fixture(2, 0)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const slow = withStepModelCall(a.scope.plannerModel, async model => {
    a.emit(model, { kind: 'start' })
    await waiting
    a.emit(model, { kind: 'success', report: { ...report, respondingModelId: 'slow' } })
    return 'slow result'
  })
  const other = await b.dispatch(b.scope.verifierModel, { ...report, inputTokens: 7, cachedInputTokens: 0,
    respondingModelId: 'other' })
  const fast = await a.dispatch(a.scope.plannerModel, { ...report, respondingModelId: 'fast' })
  release()
  expect((await slow).respondingModelId).toBe('slow')
  expect(fast.respondingModelId).toBe('fast')
  expect(other.respondingModelId).toBe('other')
  expect(a.scope.finish()).toMatchObject({ testIndex: 1, started: 2, inputTokens: 200,
    cachedInputTokens: 80, roles: { planner: { respondingModelIds: ['slow', 'fast'] } } })
  expect(b.scope.finish()).toMatchObject({ testIndex: 2, started: 1, inputTokens: 7,
    cachedInputTokens: 0, roles: { planner: { respondingModelIds: [] }, verifier: { respondingModelIds: ['other'] } } })
})

test('USAGE-SCOPE-LIFETIME: member binds canonical indices before calls and disposes after terminal', async () => {
  const f = fixture(4, 0)
  const finish = vi.spyOn(f.scope, 'finish')
  const dispose = vi.spyOn(f.scope, 'dispose')
  const create: StepModelScopeFactory = vi.fn(() => f.scope)
  const terminal = vi.fn(() => {
    expect(finish).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
  })
  const config: MemberRunConfig & { stepModelScope: { runId: string; create: StepModelScopeFactory } } = {
    adapter: makeAdapter(), planner: makePlanner(), plannerModel: fakeModel, verifierModel: fakeModel,
    testIndex: 4, abortSignal: new AbortController().signal,
    sink: { stepStarted: vi.fn(), loopEmitFor: () => ({ stepFinalized: terminal, subActionRecorded: vi.fn() }),
      hookStarted: vi.fn(), hookFinished: vi.fn(), testRetryScheduled: vi.fn() },
    stepModelScope: { runId: 'synthetic-run-423', create },
    executeStep: async (_instruction, ports, context) => {
      expect(ports.planner).toBe(f.scope.planner)
      expect(context.plannerModel).toBe(f.scope.plannerModel)
      await f.dispatch(context.plannerModel, report)
      return { name: 'Scoped step', status: 'passed', duration: 1 }
    },
  }
  const result = await runMemberTest({ testId: 'synthetic-test-423', name: 'Scoped step',
    filePath: 'synthetic.yaml', steps: ['Scoped step'] }, config)
  expect(result.status).toBe('passed')
  expect(create).toHaveBeenCalledWith({ runId: 'synthetic-run-423', testIndex: 4, stepIndex: 0 })
  expect(terminal).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
})
