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

describe('eval.gate1 screen cap', () => {
  it.each([{ maxScreens: 40 }, {}])('accepts optional positive integer cap %j', (gate1) => {
    const result = AgentQaConfigSchema.safeParse({ ...minimalConfig, eval: { gate1 } })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.eval?.gate1).toEqual(gate1)
  })
  it.each([{ maxScreens: 0 }, { maxScreens: -1 }, { maxScreens: 1.5 }, { bogus: 1 }])(
    'refuses invalid or unknown gate1 fields %j',
    (gate1) => {
      expect(AgentQaConfigSchema.safeParse({ ...minimalConfig, eval: { gate1 } }).success).toBe(
        false,
      )
    },
  )
  it('keeps the gate1 block optional', () => {
    expect(AgentQaConfigSchema.parse({ ...minimalConfig, eval: {} }).eval?.gate1).toBeUndefined()
  })
})
