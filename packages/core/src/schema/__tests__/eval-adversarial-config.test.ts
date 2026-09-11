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

// 422-06-T2 — the SECOND adversarial budget.
//
// `maxSeedsPerRefresh` bounds how much a reviewer must read; `maxProbeCalls` bounds what a
// refresh may SPEND at a provider. They are separate knobs because the two costs are separate
// and a host must be able to want many deterministic seeds and no provider calls at all. The
// strictness matters more here than one knob over: a seed cap that silently fell back to the
// default wastes review attention, while a call budget that did would buy calls the operator
// explicitly refused, and nothing can un-buy them.
describe('eval.adversarial probe-call budget', () => {
  it.each([{ maxProbeCalls: 4 }, { maxProbeCalls: 1 }, {}])(
    'round-trips the optional positive integer budget %j',
    (adversarial) => {
      expect(AgentQaConfigSchema.parse({ ...minimalConfig, eval: { adversarial } }).eval?.adversarial)
        .toEqual(adversarial)
    },
  )

  it('refuses zero, negative, fractional, string and nonfinite budgets', () => {
    for (const value of [0, -1, -4, 0.5, '4', null, Infinity, -Infinity, Number.NaN]) {
      const parsed = AgentQaConfigSchema.safeParse({
        ...minimalConfig,
        eval: { adversarial: { maxProbeCalls: value } },
      })
      expect(parsed.success, `maxProbeCalls=${String(value)}`).toBe(false)
    }
  })

  it('keeps the two budgets independent, and refuses a near-miss spelling of either', () => {
    const parsed = AgentQaConfigSchema.parse({
      ...minimalConfig,
      eval: { adversarial: { maxSeedsPerRefresh: 8, maxProbeCalls: 2 } },
    })
    expect(parsed.eval?.adversarial).toEqual({ maxSeedsPerRefresh: 8, maxProbeCalls: 2 })
    // Setting one must never imply the other: a host that caps review volume has said nothing
    // about what it is willing to spend.
    expect(AgentQaConfigSchema.parse({
      ...minimalConfig, eval: { adversarial: { maxSeedsPerRefresh: 8 } },
    }).eval?.adversarial).toEqual({ maxSeedsPerRefresh: 8 })
    expect(AgentQaConfigSchema.parse({
      ...minimalConfig, eval: { adversarial: { maxProbeCalls: 2 } },
    }).eval?.adversarial).toEqual({ maxProbeCalls: 2 })
    // A typo is a loud parse failure, never a budget the operator believes is in force.
    for (const key of ['maxProbeCall', 'probeCalls', 'maxProbecalls']) {
      expect(AgentQaConfigSchema.safeParse({
        ...minimalConfig, eval: { adversarial: { [key]: 2 } },
      }).success, key).toBe(false)
    }
  })
})
