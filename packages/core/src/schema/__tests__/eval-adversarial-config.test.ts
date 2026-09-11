// 422-03-T1 — the strict `eval.adversarial` config block.
//
// The cap on how many novel seeds one adversarial refresh may stage is operator-visible
// configuration, so it is held to the same strictness every other eval cap is: a positive
// integer or absent, never zero, never negative, never fractional, never a string that looks
// like a number, and never a nonfinite value that would defeat a naive `> 0` check. The block
// itself is strict, so a typo'd subkey is a loud parse failure rather than a silently ignored
// setting that leaves the operator believing a cap is in force.
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

describe('eval.adversarial seed cap', () => {
  it.each([{ maxSeedsPerRefresh: 8 }, { maxSeedsPerRefresh: 1 }, {}])(
    'round-trips the optional positive integer cap %j',
    (adversarial) => {
      expect(AgentQaConfigSchema.parse({ ...minimalConfig, eval: { adversarial } }).eval?.adversarial)
        .toEqual(adversarial)
    },
  )

  it('refuses zero, negative, fractional, string and nonfinite caps', () => {
    for (const value of [0, -1, -8, 1.5, '8', null, Infinity, -Infinity, Number.NaN]) {
      const parsed = AgentQaConfigSchema.safeParse({
        ...minimalConfig,
        eval: { adversarial: { maxSeedsPerRefresh: value } },
      })
      expect(parsed.success, `maxSeedsPerRefresh=${String(value)}`).toBe(false)
    }
  })

  it('refuses unknown keys in the strict adversarial block', () => {
    expect(AgentQaConfigSchema.safeParse({
      ...minimalConfig, eval: { adversarial: { maxSeeds: 8 } },
    }).success).toBe(false)
    expect(AgentQaConfigSchema.safeParse({
      ...minimalConfig, eval: { adversarial: { maxSeedsPerRefresh: 8, bogus: 1 } },
    }).success).toBe(false)
  })

  it.each([{}, { gate2: { maxAblations: 4 } }])(
    'keeps adversarial absent for eval %j rather than defaulting a cap into the parsed config',
    (evalConfig) => {
      const parsed = AgentQaConfigSchema.parse({ ...minimalConfig, eval: evalConfig })
      expect(parsed.eval?.adversarial).toBeUndefined()
      expect(parsed.eval).toEqual(evalConfig)
    },
  )

  it('accepts the adversarial cap beside the existing eval caps without disturbing them', () => {
    const parsed = AgentQaConfigSchema.parse({
      ...minimalConfig,
      eval: {
        gate1: { maxScreens: 64 },
        gate2: { maxAblations: 4 },
        adversarial: { maxSeedsPerRefresh: 3 },
      },
    })
    expect(parsed.eval).toEqual({
      gate1: { maxScreens: 64 },
      gate2: { maxAblations: 4 },
      adversarial: { maxSeedsPerRefresh: 3 },
    })
  })
})
