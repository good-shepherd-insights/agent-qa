import { describe, expect, it } from 'vitest'
import { AgentQaConfigSchema } from '../config-schema.js'

const minimalConfig = {
  workspace: {
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['suites/**/*.suite.yaml'],
    hooksFile: 'hooks.yaml',
    envFile: '.env',
    secretsFile: '.env.secrets.local',
  },
  use: { mobile: { appState: 'preserve' } },
}

describe('eval.gate2 caps and canary horizon', () => {
  it.each([
    { maxAblations: 4, canaryHorizonBuilds: 5, maxLowerTrustPerScope: 2 },
    { maxAblations: 4 }, { canaryHorizonBuilds: 5 }, { maxLowerTrustPerScope: 2 }, {},
  ])('round-trips optional positive integer settings %j', (gate2) => {
    expect(AgentQaConfigSchema.parse({ ...minimalConfig, eval: { gate2 } }).eval?.gate2)
      .toEqual(gate2)
  })

  it.each(['maxAblations', 'canaryHorizonBuilds', 'maxLowerTrustPerScope'] as const)(
    'refuses zero, negative, fractional and non-number values for %s', (key) => {
      for (const value of [0, -1, 1.5, '2', null, Infinity]) {
        const gate2 = { [key]: value }
        expect(AgentQaConfigSchema.safeParse({ ...minimalConfig, eval: { gate2 } }).success)
          .toBe(false)
      }
    },
  )

  it('refuses unknown keys in the strict gate2 block', () => {
    expect(AgentQaConfigSchema.safeParse({
      ...minimalConfig, eval: { gate2: { bogus: 1 } },
    }).success).toBe(false)
  })

  it.each([{}, { gate1: { maxScreens: 64 } }])('keeps gate2 absent for eval %j', (evalConfig) => {
    const parsed = AgentQaConfigSchema.parse({ ...minimalConfig, eval: evalConfig })
    expect(parsed.eval?.gate2).toBeUndefined()
    expect(parsed.eval).toEqual(evalConfig)
  })
})
