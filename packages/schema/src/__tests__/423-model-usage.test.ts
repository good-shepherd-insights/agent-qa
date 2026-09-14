import { expect, test } from 'vitest'
import { projectStepFinalized } from '../run/bus-projections'
import type { StepEvidence } from '../handoff/step-evidence'

const evidence: StepEvidence = {
  stepIndex: 0, stepText: 'inspect', cacheStatus: 'hit', subActions: [],
  verifierVerdict: { pass: true, reasoning: 'observed' },
  servedBrief: { scope: { tier: 'test', key: 'usage' }, asOfBuild: 1, budget: 1,
    truncation: 'none', channel1: [], channel2: [], channel3: [], briefDigest: 'brief' },
}
type Attempt = { role: 'planner' | 'verifier'; kind: 'start' | 'success' | 'failure';
  report?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number;
    respondingModelId?: string } }
const success = (inputTokens = 100, cachedInputTokens: number | undefined = 40): Attempt => ({
  role: 'planner', kind: 'success', report: { inputTokens, outputTokens: 10,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    respondingModelId: 'reported-SYNTHETIC' },
})
function project(attempts: Attempt[], declared = true) {
  const extra = { status: 'passed' as const, modelObservations: { attempts, roles: {
    planner: declared ? { declared: { provider: 'provider-SYNTHETIC', modelId: 'alias-SYNTHETIC' } } : {},
    verifier: declared ? { declared: { provider: 'other-SYNTHETIC', modelId: 'judge-SYNTHETIC' } } : {},
  } } }
  return projectStepFinalized(evidence, { testIndex: 0, stepIndex: 0 },
    value => value.replaceAll('SYNTHETIC', '[masked]'), extra)
}

test('MODEL-USAGE-OPTIONAL: missing observations and zero calls never fabricate measurements', () => {
  const old = projectStepFinalized(evidence, { testIndex: 0, stepIndex: 0 }, value => value)
  expect(old).not.toHaveProperty('modelUsage')
  expect(old).not.toHaveProperty('tokenUsage')
  expect(project([], false)).not.toHaveProperty('modelUsage')
  expect(project([])).toMatchObject({ modelUsage: { roles: {
    planner: { declared: { provider: 'provider-[masked]', modelId: 'alias-[masked]' } },
  }, calls: { started: 0, succeeded: 0, failed: 0 } } })
  expect(project([])).not.toHaveProperty('tokenUsage')
})

test('MODEL-USAGE-MASK: declared and distinct responding identities cross the live mask', () => {
  const payload = project([success(), success()])
  expect(payload).toMatchObject({ modelUsage: { roles: {
    planner: { declared: { provider: 'provider-[masked]', modelId: 'alias-[masked]' },
      respondingModelIds: ['reported-[masked]'] },
    verifier: { declared: { provider: 'other-[masked]', modelId: 'judge-[masked]' } },
  } } })
  expect(JSON.stringify(payload)).not.toContain('SYNTHETIC')
})

test('INPUT-SAMPLE-POPULATION: inclusive totals count each attempt once without adding cache reads', () => {
  expect(project([success(), success(200, 80)])).toMatchObject({
    tokenUsage: { promptTokens: 300, completionTokens: 20, totalTokens: 320, cachedInputTokens: 120 },
    modelUsage: { calls: { started: 2, succeeded: 2, failed: 0 } },
  })
})

test('MODEL-USAGE-OPTIONAL: reported zero is present and mixed reporting omits cache', () => {
  expect(project([success(0, 0)])).toMatchObject({ tokenUsage: { cachedInputTokens: 0 } })
  const unknown = success()
  delete unknown.report!.cachedInputTokens
  const mixed = project([success(), unknown])
  expect(mixed).toMatchObject({ tokenUsage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 } })
  expect(mixed.tokenUsage).not.toHaveProperty('cachedInputTokens')
})

test.each(['failure', 'start'] as const)(
  'INPUT-SAMPLE-POPULATION: %s attempt prevents certification of the complete population', kind => {
    const payload = project([success(), { role: 'verifier', kind }])
    expect(payload).toMatchObject({ modelUsage: { calls: { started: 2, succeeded: 1,
      failed: kind === 'failure' ? 1 : 0 } } })
    expect(payload).not.toHaveProperty('tokenUsage')
  },
)

test('C423-MODEL-ROLES-EXACT: runtime roles are literally planner and verifier', () => {
  expect(project([])).toHaveProperty('modelUsage.roles')
  const payload = project([]) as unknown as { modelUsage: { roles: object } }
  expect(Object.keys(payload.modelUsage.roles).sort()).toEqual(['planner', 'verifier'])
})
