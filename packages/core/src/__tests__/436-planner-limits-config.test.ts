// 2026-10-07, 436-07 (D-02, D-03): the per-step planner limits in the project config and in test
// and suite `use` overrides, and the resolution order every door uses.
import { generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { resolvePlannerLimits } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { AgentQaConfigSchema } from '../schema/config-schema.js'
import { PlannerConfigSchema } from '../schema/primitives.js'
import { SuiteDefinitionSchema } from '../schema/suite-schema.js'
import { TestDefinitionSchema } from '../schema/test-schema.js'

const LIMIT_KEYS = ['maxActions', 'maxPlanningTurns'] as const

function projectConfig(planner: Record<string, unknown> | undefined) {
  return {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      suiteMatch: ['suites/**/*.suite.yaml'],
      testPathIgnore: [],
      hooksFile: 'hooks.yaml',
      envFile: '.env',
      secretsFile: '.env.secrets.local',
    },
    registry: {
      llms: [{ name: 'main', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' }],
      targets: { web: { platform: 'web', url: 'https://example.com' } },
    },
    use: {
      mobile: { appState: 'preserve' },
      ...(planner === undefined ? {} : { planner }),
    },
  }
}

function testDefinition(planner: Record<string, unknown>) {
  return {
    'test-id': generateTestId(),
    name: 'Bulk import',
    target: 'web',
    use: { planner },
    steps: ['Import the file'],
  }
}

function suiteDefinition(planner: Record<string, unknown>) {
  return {
    'suite-id': generateSuiteId(),
    name: 'Imports',
    target: 'web',
    tests: [{ test: 'tests/bulk-import.yaml', id: generateTestId() }],
    use: { planner },
  }
}

describe('C436-PLANNER-LIMITS-CONFIG', () => {
  it('the project config accepts maxActions and maxPlanningTurns as positive integers', () => {
    const result = AgentQaConfigSchema.safeParse(
      projectConfig({ maxActions: 12, maxPlanningTurns: 40, previousStepCount: 5 }),
    )
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    expect(result.data?.use?.planner).toEqual({ maxActions: 12, maxPlanningTurns: 40, previousStepCount: 5 })
  })

  it('test and suite use overrides accept them', () => {
    const test = TestDefinitionSchema.safeParse(testDefinition({ maxActions: 200, maxPlanningTurns: 150 }))
    expect(test.success, JSON.stringify(test.error?.issues)).toBe(true)
    expect(test.data?.use?.planner).toEqual({ maxActions: 200, maxPlanningTurns: 150 })

    const suite = SuiteDefinitionSchema.safeParse(suiteDefinition({ maxActions: 50, maxPlanningTurns: 60 }))
    expect(suite.success, JSON.stringify(suite.error?.issues)).toBe(true)
    expect(suite.data?.use?.planner).toEqual({ maxActions: 50, maxPlanningTurns: 60 })
  })

  it("0, -1, 2.5 and '7' are refused for each key; 1 and 1000000 are accepted", () => {
    for (const key of LIMIT_KEYS) {
      for (const bad of [0, -1, 2.5, '7']) {
        const label = `${key}=${JSON.stringify(bad)}`
        expect(PlannerConfigSchema.safeParse({ [key]: bad, previousStepCount: 5 }).success, label).toBe(false)
        expect(
          AgentQaConfigSchema.safeParse(projectConfig({ [key]: bad, previousStepCount: 5 })).success,
          `config ${label}`,
        ).toBe(false)
        expect(TestDefinitionSchema.safeParse(testDefinition({ [key]: bad })).success, `test ${label}`).toBe(false)
        expect(SuiteDefinitionSchema.safeParse(suiteDefinition({ [key]: bad })).success, `suite ${label}`).toBe(false)
      }
      for (const good of [1, 1000000]) {
        const label = `${key}=${good}`
        expect(PlannerConfigSchema.safeParse({ [key]: good, previousStepCount: 5 }).success, label).toBe(true)
        expect(
          AgentQaConfigSchema.safeParse(projectConfig({ [key]: good, previousStepCount: 5 })).success,
          `config ${label}`,
        ).toBe(true)
        expect(TestDefinitionSchema.safeParse(testDefinition({ [key]: good })).success, `test ${label}`).toBe(true)
        expect(SuiteDefinitionSchema.safeParse(suiteDefinition({ [key]: good })).success, `suite ${label}`).toBe(true)
      }
    }
  })

  it('no planner block, or previousStepCount alone, resolves to 30/30', () => {
    const bare = AgentQaConfigSchema.parse(projectConfig(undefined))
    expect(bare.use?.planner).toBeUndefined()
    expect(resolvePlannerLimits(bare.use)).toEqual({ maxActions: 30, maxPlanningTurns: 30 })

    const countOnly = AgentQaConfigSchema.parse(projectConfig({ previousStepCount: 5 }))
    expect(countOnly.use?.planner).toEqual({ previousStepCount: 5 })
    expect(resolvePlannerLimits(countOnly.use)).toEqual({ maxActions: 30, maxPlanningTurns: 30 })

    const oneAction = AgentQaConfigSchema.parse(projectConfig({ maxActions: 1, previousStepCount: 5 }))
    expect(resolvePlannerLimits(oneAction.use)).toEqual({ maxActions: 1, maxPlanningTurns: 30 })
  })

  it('a test override wins per key over suite and project', () => {
    const project = AgentQaConfigSchema.parse(
      projectConfig({ maxActions: 10, maxPlanningTurns: 12, previousStepCount: 5 }),
    ).use
    const suite = SuiteDefinitionSchema.parse(suiteDefinition({ maxPlanningTurns: 80 })).use
    const test = TestDefinitionSchema.parse(testDefinition({ maxActions: 400 })).use

    expect(resolvePlannerLimits(project, suite, test)).toEqual({ maxActions: 400, maxPlanningTurns: 80 })
    expect(resolvePlannerLimits(project, suite)).toEqual({ maxActions: 10, maxPlanningTurns: 80 })
    expect(resolvePlannerLimits(project)).toEqual({ maxActions: 10, maxPlanningTurns: 12 })
  })
})
